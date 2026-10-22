import { afterEach, expect, it, vi } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import { sqliteD1 } from "../../app/functions/_lib/sqliteTestDb";
import { participationFixture } from "./holder-participation-fixtures.test-helper";
import { reviewHolderParticipation } from "./holder-participation";
import { verifyHolderParticipation } from "./holder-participation-model";
import { attentionHolderRequest, attentionHolderParticipation } from "./attention-holder-participation";
import worker, { type LocalEnv } from "./worker";
const opened: DatabaseSync[] = [];
afterEach(() => { opened.splice(0).forEach(db => db.close()); vi.restoreAllMocks(); vi.useRealTimers(); });
async function setup() {
  const input = await participationFixture(), sqlite = new DatabaseSync(":memory:"); opened.push(sqlite);
  for (const f of readdirSync(new URL("../migrations/", import.meta.url)).filter(f => f.endsWith(".sql")).sort()) sqlite.exec(readFileSync(new URL(`../migrations/${f}`, import.meta.url), "utf8"));
  for (const meta of input.history.index) sqlite.prepare("INSERT INTO tenx_holder_evidence VALUES(?,?,?,?,?)").run(meta.payload_hash, meta.address, meta.slot, JSON.stringify(input.history.samples.find(s => s.payload_hash === meta.payload_hash)!.evidence), meta.observed_at);
  const meta = input.wallet_index[0]!; sqlite.prepare("INSERT INTO tenx_wallet_evidence VALUES(?,?,?,?)").run(meta.evidence_hash, meta.address, JSON.stringify(input.wallet!.evidence), meta.observed_at);
  return { input, sqlite, db: sqliteD1(sqlite), address: meta.address, at: new Date(input.history.cutoff_at) };
}
it("replays the existing qualification report exactly without source IO, writes or private inputs", async () => {
  const { input, sqlite, db, address, at } = await setup(), before = sqlite.prepare("SELECT total_changes() n").get();
  const fetcher = vi.spyOn(globalThis, "fetch").mockRejectedValue(Error("No provider request permitted"));
  const expected = await reviewHolderParticipation(input);
  expect(await attentionHolderParticipation(db, address, at)).toEqual(expected);
  vi.useFakeTimers(); vi.setSystemTime(new Date(at.getTime() + 86_400_000));
  const env = { TENX_DB: db, TENX_LOCAL_ONLY: "true" } as LocalEnv;
  const response = await worker.fetch(new Request(`http://localhost/api/10x/discovery/attention/holders/solana/${address}?cutoff=${at.toISOString()}`), env);
  expect(response.status).toBe(200); const report = await verifyHolderParticipation(await response.json()); expect(report).toEqual(expected);
  expect(JSON.stringify(report)).not.toMatch(/"(inputs|evidence|wallets|records)":/);
  expect(fetcher).not.toHaveBeenCalled(); expect(sqlite.prepare("SELECT total_changes() n").get()).toEqual(before);
  expect(sqlite.prepare("SELECT * FROM tenx_usage").all()).toEqual([]);
});
it("excludes saved inventories and wallet receipts after the pinned cutoff", async () => {
  const { sqlite, db, address, at } = await setup(), before = await attentionHolderParticipation(db, address, at);
  sqlite.prepare("INSERT INTO tenx_holder_evidence VALUES(?,?,?,?,?)").run("f".repeat(64), address, 999999, "{}", new Date(at.getTime() + 1).toISOString());
  sqlite.prepare("INSERT INTO tenx_wallet_evidence VALUES(?,?,?,?)").run("f".repeat(64), address, "{}", new Date(at.getTime() + 1).toISOString());
  expect(await attentionHolderParticipation(db, address, at)).toEqual(before);
});
it("keeps missing archives unknown without initiating collection", async () => {
  const { sqlite, db, address, at } = await setup(); sqlite.exec("DELETE FROM tenx_holder_evidence;DELETE FROM tenx_wallet_evidence");
  const before = sqlite.prepare("SELECT total_changes() n").get(), fetcher = vi.spyOn(globalThis, "fetch").mockRejectedValue(Error("No collection"));
  const report = await attentionHolderParticipation(db, address, at);
  expect(report).toMatchObject({ since_first: null, recent: null, freshness: "unknown", meaningful_holder_growth_24h: null, organic_demand_certified: false, scoring_effect: "none", provider_requests: 0, database_writes: 0 });
  expect(fetcher).not.toHaveBeenCalled(); expect(sqlite.prepare("SELECT total_changes() n").get()).toEqual(before);
});
it.each(["", "cutoff=bad", "cutoff=2026-10-21T00:00:00Z", "cutoff=2026-10-21T00:00:00.000Z&cutoff=2026-10-21T00:00:00.000Z", "cutoff=2026-10-21T00:00:00.000Z&extra=1", "cutoff=2030-01-01T00:00:00.000Z"])("rejects an invalid query before database access: %s", async query => {
  const prepare = vi.fn(() => { throw Error("Database must not be read"); }), address = "So11111111111111111111111111111111111111112";
  vi.useFakeTimers(); vi.setSystemTime(new Date("2026-10-22T00:00:00.000Z"));
  const response = await worker.fetch(new Request(`http://localhost/api/10x/discovery/attention/holders/solana/${address}?${query}`), { TENX_LOCAL_ONLY: "true", TENX_DB: { prepare } } as unknown as LocalEnv);
  expect(response.status).toBe(400); expect(prepare).not.toHaveBeenCalled();
});
it("rejects invalid identities and clocks and foreign-browser GETs before archive reads", async () => {
  expect(() => attentionHolderRequest("bad", new URLSearchParams("cutoff=2026-10-21T00:00:00.000Z"))).toThrow();
  const address = "So11111111111111111111111111111111111111112", params = new URLSearchParams("cutoff=2026-10-21T00:00:00.000Z");
  expect(() => attentionHolderRequest(address, params, new Date("invalid"))).toThrow();
  const prepare = vi.fn(() => { throw Error("No archive read"); }), env = { TENX_LOCAL_ONLY: "true", TENX_DB: { prepare } } as unknown as LocalEnv;
  const response = await worker.fetch(new Request(`http://localhost/api/10x/discovery/attention/holders/solana/${address}?${params}`, { headers: { origin: "https://foreign.example", "sec-fetch-site": "cross-site" } }), env);
  expect(response.status).toBe(403); expect(prepare).not.toHaveBeenCalled();
});
it("returns a fixed unavailable response on corrupt saved evidence without repairing it", async () => {
  const { sqlite, db, address, at } = await setup(); sqlite.exec("UPDATE tenx_wallet_evidence SET payload='{}'");
  const before = sqlite.prepare("SELECT total_changes() n").get(); vi.useFakeTimers(); vi.setSystemTime(at);
  const response = await worker.fetch(new Request(`http://localhost/api/10x/discovery/attention/holders/solana/${address}?cutoff=${at.toISOString()}`), { TENX_LOCAL_ONLY: "true", TENX_DB: db } as LocalEnv);
  expect(response.status).toBe(503); expect(await response.json()).toEqual({ error: "saved_holder_participation_unavailable" }); expect(sqlite.prepare("SELECT total_changes() n").get()).toEqual(before);
});
