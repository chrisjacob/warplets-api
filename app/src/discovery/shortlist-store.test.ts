import { expect, it } from "vitest";
import { toBase58 } from "../../../discovery/src/solana";
import { createShortlistRepository, parseShortlist, shortlistKey, SHORTLIST_LIMIT } from "./shortlist-store";

const at = new Date("2026-10-22T01:00:00.000Z");
const token = (n = 1) => ({ address: toBase58(new Uint8Array(32).fill(n)), name: `Token ${n}`, symbol: "SAME" });
function storage() {
  const data = new Map<string, string>();
  return { data, getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value); }, removeItem: (key: string) => { data.delete(key); } };
}
const encoded = (entries: unknown[], version = "discovery-shortlist-v1") => JSON.stringify({ version, entries });
const entry = (n = 1) => ({ ...token(n), chain: "solana", mode: "live", saved_at: at.toISOString() });

it("persists identities once across visits, keeps duplicate symbols distinct and stores no score/evidence fields", () => {
  const local = storage(), repo = createShortlistRepository(() => local);
  repo.change("live", { type: "save", token: token() }, at);
  repo.change("live", { type: "save", token: token(2) }, at);
  repo.change("live", { type: "save", token: { ...token(), name: "later hint" } }, new Date("2026-10-23T00:00:00Z"));
  const reopened = createShortlistRepository(() => local).read("live");
  expect(reopened.entries.map(e => e.address)).toEqual([token(2).address, token().address]);
  expect(reopened.entries[1]).toEqual(entry());
  expect(Object.keys(JSON.parse(local.getItem(shortlistKey("live"))!).entries[0]).sort()).toEqual(["address", "chain", "mode", "name", "saved_at", "symbol"]);
  expect(reopened.status).toBe("saved");
});

it("isolates simulation/live keys and clears only the selected list", () => {
  const local = storage(), repo = createShortlistRepository(() => local);
  local.setItem("unrelated:session", "preserve");
  repo.change("live", { type: "save", token: token() }, at);
  repo.change("fixture", { type: "save", token: token() }, at);
  expect(repo.change("live", { type: "save", token: { ...token(2), mode: "fixture" } }, at).message).toContain("matching");
  expect(repo.read("live").entries).toHaveLength(1);
  expect(repo.read("fixture").entries[0].mode).toBe("fixture");
  repo.change("live", { type: "clear" });
  expect(local.getItem(shortlistKey("live"))).toBeNull();
  expect(repo.read("live").entries).toEqual([]);
  expect(repo.read("fixture").entries).toHaveLength(1);
  expect(local.getItem("unrelated:session")).toBe("preserve");
});

it("reads the newest persisted list before explicit idempotent actions from another tab", () => {
  const local = storage(), a = createShortlistRepository(() => local), b = createShortlistRepository(() => local);
  a.read("live"); b.read("live");
  a.change("live", { type: "save", token: token() }, at);
  b.change("live", { type: "save", token: token(2) }, at);
  expect(a.read("live").entries).toHaveLength(2);
  a.change("live", { type: "remove", address: token().address });
  a.change("live", { type: "remove", address: token().address });
  expect(b.read("live").entries.map(e => e.address)).toEqual([token(2).address]);
});

it("keeps blocked storage useful in memory and does not claim persistence after a reload", () => {
  const blocked = () => { throw Error("storage blocked"); }, repo = createShortlistRepository(blocked);
  expect(repo.read("live").status).toBe("memory");
  expect(repo.change("live", { type: "save", token: token() }, at).entries).toHaveLength(1);
  expect(repo.read("live").entries).toHaveLength(1);
  expect(repo.read("fixture").entries).toHaveLength(0);
  repo.change("live", { type: "remove", address: token().address });
  expect(repo.read("live").entries).toHaveLength(0);
  expect(repo.change("live", { type: "clear" }).message).toContain("Browser storage could not be cleared");
  expect(createShortlistRepository(blocked).read("live").entries).toHaveLength(0);
});

it("preserves the last loaded list plus unsaved changes when writes fail", () => {
  const local = storage(); local.setItem(shortlistKey("live"), encoded([entry()]));
  const repo = createShortlistRepository(() => ({ ...local, setItem: () => { throw Error("quota"); } }));
  expect(repo.change("live", { type: "save", token: token(2) }, at).status).toBe("memory");
  expect(repo.read("live").entries.map(e => e.address)).toEqual([token(2).address, token().address]);
  expect(parseShortlist(local.getItem(shortlistKey("live")), "live")).toHaveLength(1);
  expect(repo.change("live", { type: "clear" }).status).toBe("saved");
  expect(local.getItem(shortlistKey("live"))).toBeNull();
});

it("holds malformed/unsupported storage without overwriting it until the user clears it", () => {
  const local = storage(), repo = createShortlistRepository(() => local), key = shortlistKey("live");
  for (const raw of ["{broken", encoded([entry()], "future-version")]) {
    local.setItem(key, raw);
    expect(repo.read("live").status).toBe("invalid");
    expect(repo.change("live", { type: "save", token: token(2) }, at).status).toBe("invalid");
    expect(local.getItem(key)).toBe(raw);
  }
  expect(repo.change("live", { type: "clear" }).status).toBe("saved");
  expect(repo.change("live", { type: "save", token: token() }, at).entries).toHaveLength(1);
});

it("rejects incorrect scopes, duplicate/invalid addresses, extra evidence, bad dates and oversized records", () => {
  const original = entry();
  for (const modified of [{ chain: "base" }, { mode: "fixture" }, { address: "not-an-address" }, { saved_at: "yesterday" }, { name: "x".repeat(121) }, { symbol: "x".repeat(41) }, { score: 100 }]) {
    expect(() => parseShortlist(encoded([{ ...original, ...modified }]), "live")).toThrow();
  }
  expect(() => parseShortlist(encoded([original, original]), "live")).toThrow();
  expect(() => parseShortlist(encoded(Array.from({ length: 101 }, (_, i) => entry(i + 1))), "live")).toThrow();
  expect(() => parseShortlist(" ".repeat(100_001), "live")).toThrow();
  expect(() => parseShortlist(JSON.stringify({ version: "discovery-shortlist-v1", entries: [], extra: true }), "live")).toThrow();
});

it("never silently drops old entries at capacity and can remove before saving another", () => {
  const local = storage(), repo = createShortlistRepository(() => local);
  local.setItem(shortlistKey("live"), encoded(Array.from({ length: SHORTLIST_LIMIT }, (_, i) => entry(i + 1))));
  expect(repo.change("live", { type: "save", token: token(101) }, at).message).toContain("full");
  expect(repo.read("live").entries).toHaveLength(100);
  repo.change("live", { type: "remove", address: token().address });
  expect(repo.change("live", { type: "save", token: token(101) }, at).entries).toHaveLength(100);
  expect(repo.read("live").entries[0].address).toBe(token(101).address);
});

it("refuses malformed or serialization-heavy saves without throwing or losing an existing list", () => {
  const local = storage(), repo = createShortlistRepository(() => local);
  expect(repo.change("live", { type: "save", token: { ...token(), address: "invalid" } }, at).message).toContain("unchanged");
  const rows: ReturnType<typeof entry>[] = [];
  for (let n = 1; n <= SHORTLIST_LIMIT; n++) {
    const next = { ...entry(n), name: "\u0000".repeat(120), symbol: "\u0000".repeat(40) };
    if (encoded([...rows, next]).length > 100_000) break;
    rows.push(next);
  }
  expect(rows.length).toBeLessThan(SHORTLIST_LIMIT);
  const original = encoded(rows); local.setItem(shortlistKey("live"), original);
  const result = repo.change("live", { type: "save", token: { ...token(200), name: "\u0000".repeat(120), symbol: "\u0000".repeat(40) } }, at);
  expect(result.message).toContain("unchanged");
  expect(result.entries).toHaveLength(rows.length);
  expect(local.getItem(shortlistKey("live"))).toBe(original);
});
