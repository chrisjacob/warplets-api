import { afterEach, describe, expect, it } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { readdirSync, readFileSync } from "node:fs";
import { sqliteD1 } from "../../app/functions/_lib/sqliteTestDb";
import { dueLeads } from "./lead-queue";
import { fixtureCandidates } from "./fixtures";
import { saveCandidate } from "./store";
import { expireCandidates } from "./candidate-expiry";

const opened: DatabaseSync[] = [], now = new Date("2026-10-22T10:00:00.000Z"), at = now.toISOString();
afterEach(() => opened.splice(0).forEach(db => db.close()));
function setup() {
  const sqlite = new DatabaseSync(":memory:"); opened.push(sqlite);
  for (const file of readdirSync(new URL("../migrations/", import.meta.url)).filter(file => file.endsWith(".sql")).sort()) sqlite.exec(readFileSync(new URL(`../migrations/${file}`, import.meta.url), "utf8"));
  return { sqlite, db: sqliteD1(sqlite) };
}
type Fixture = ReturnType<typeof setup>;
function lead(f: Fixture, address: string, options: { first?: string; checked?: string; due?: string; migrated?: number; cap?: number; liquidity?: number; creation?: boolean; mode?: string; marketPool?: string } = {}) {
  f.sqlite.prepare("INSERT INTO tenx_leads(address,pool,migration_tx,migration_signature,first_seen_at,checked_at,next_attempt_at,attempts) VALUES(?1,'pool',?2,'signature',?3,?4,?5,?6)")
    .run(address, JSON.stringify({ blockTime: options.migrated ?? Math.floor(now.getTime() / 1000) - 1800 }), options.first ?? at, options.checked ?? null, options.due ?? null, options.checked ? 1 : 0);
  if (options.cap !== undefined) f.sqlite.prepare("INSERT INTO tenx_lead_markets(address,pool,payload,attempted_at) VALUES(?1,?2,?3,?4)")
    .run(address, options.marketPool ?? "pool", JSON.stringify({ market_cap_usd: options.cap, liquidity_usd: options.liquidity ?? null }), at);
  if (options.checked) f.sqlite.prepare("INSERT INTO tenx_candidates(address,pool,payload,checked_at,mode) VALUES(?1,'pool',?2,?3,?4)")
    .run(address, JSON.stringify({ creation: options.creation ? { block_time: at } : null }), options.checked, options.mode ?? "live");
}
const addresses = async (f: Fixture, cutoff = at) => (await dueLeads(f.db, cutoff)).map(row => row.address);

describe("fair first inspection and bounded retry queue", () => {
  it("protects the oldest unchecked lead before a richer creation-unknown retry", async () => {
    const f = setup();
    lead(f, "new-hot", { cap: 900000, liquidity: 90000, first: "2026-10-22T09:50:00.000Z" });
    lead(f, "old-cold", { first: "2026-10-22T09:00:00.000Z" });
    lead(f, "retry-hot", { checked: "2026-10-22T09:30:00.000Z", cap: 2000000, liquidity: 200000 });
    expect(await addresses(f)).toEqual(["old-cold", "retry-hot"]);
  });
  it("lends an empty retry lane to two untouched leads using oldest wait and address ties", async () => {
    const f = setup(); for (const name of ["c", "b", "a"]) lead(f, name, { cap: name === "c" ? 900000 : 100, liquidity: 50000 });
    expect(await addresses(f)).toEqual(["a", "b"]);
  });
  it("lends an empty first-inspection lane to two retries using existing market-floor priorities", async () => {
    const f = setup();
    lead(f, "retry-known", { checked: "2026-10-22T08:00:00.000Z", cap: 900000, liquidity: 200000, creation: true });
    lead(f, "retry-low", { checked: "2026-10-22T07:00:00.000Z", cap: 100, liquidity: 100 });
    lead(f, "retry-good", { checked: "2026-10-22T09:00:00.000Z", cap: 200000, liquidity: 50000 });
    lead(f, "retry-better", { checked: "2026-10-22T09:00:00.000Z", cap: 200000, liquidity: 100000 });
    expect(await addresses(f)).toEqual(["retry-better", "retry-good"]);
  });
  it("preserves retry tie priorities for check age and recent first observation", async () => {
    const f = setup();
    lead(f, "later-check", { checked: "2026-10-22T09:00:00.000Z", first: "2026-10-22T08:30:00.000Z" });
    lead(f, "older-first", { checked: "2026-10-22T08:00:00.000Z", first: "2026-10-22T07:00:00.000Z" });
    lead(f, "newer-first", { checked: "2026-10-22T08:00:00.000Z", first: "2026-10-22T07:30:00.000Z" });
    expect(await addresses(f)).toEqual(["newer-first", "older-first"]);
  });
  it("honours due time, inclusive 24h migration bounds, expiry and future exclusion", async () => {
    const f = setup(), second = Math.floor(now.getTime() / 1000);
    lead(f, "fresh-unchecked", { due: at, migrated: second });
    lead(f, "oldest-retry", { checked: at, due: at, migrated: second - 86400 });
    lead(f, "not-due", { due: "2026-10-22T10:00:01.000Z", first: "2026-10-22T08:00:00.000Z" });
    lead(f, "old", { migrated: second - 86401, first: "2026-10-22T08:00:00.000Z" });
    lead(f, "future", { migrated: second + 1, first: "2026-10-22T08:00:00.000Z" });
    const candidate = (await fixtureCandidates(now))[0]!, older = (await fixtureCandidates(new Date(now.getTime() - 172800000)))[0]!;
    await saveCandidate(f.db, { ...candidate, mode: "live", creation: older.creation });
    await expireCandidates(f.db, now);
    lead(f, candidate.address, { first: "2026-10-22T08:00:00.000Z" });
    expect(await addresses(f)).toEqual(["fresh-unchecked", "oldest-retry"]);
  });
  it("keeps exact pool and live-candidate joins when choosing retries", async () => {
    const f = setup();
    lead(f, "wrong-pool", { checked: at, cap: 5000000, liquidity: 500000, marketPool: "different-pool" });
    lead(f, "valid", { checked: at, cap: 200000, liquidity: 50000 });
    lead(f, "fixture-only", { checked: at, cap: 200000, liquidity: 60000, creation: true, mode: "fixture" });
    expect(await addresses(f)).toEqual(["fixture-only", "valid"]);
  });
  it("drains forty prior untouched leads despite hot retries and continual newer arrivals", async () => {
    const f = setup(), original = Array.from({ length: 40 }, (_, n) => `untouched-${String(n).padStart(2, "0")}`), firsts: string[] = [];
    original.forEach((name, n) => lead(f, name, { first: new Date(now.getTime() - 3600000 + n * 1000).toISOString() }));
    for (let n = 0; n < 16; n++) lead(f, `retry-${n}`, { checked: "2026-10-22T09:00:00.000Z", cap: 2000000, liquidity: 200000 + n });
    for (let cycle = 0; cycle < 40; cycle++) {
      const cutoff = new Date(now.getTime() + cycle * 60000).toISOString();
      lead(f, `arrival-${cycle}`, { first: cutoff, cap: 5000000, liquidity: 500000 });
      const selected = await dueLeads(f.db, cutoff);
      expect(selected).toHaveLength(2); expect(new Set(selected.map(row => row.address)).size).toBe(2);
      expect(selected[0]!.address).toBe(original[cycle]); firsts.push(selected[0]!.address);
      expect(selected[1]!.checked_at).not.toBeNull();
      for (const item of selected) f.sqlite.prepare("UPDATE tenx_leads SET checked_at=?1,next_attempt_at=?2,attempts=attempts+1 WHERE address=?3")
        .run(cutoff, new Date(Date.parse(cutoff) + 900000).toISOString(), item.address);
    }
    expect(firsts).toEqual(original);
    expect(f.sqlite.prepare("SELECT count(*) AS n FROM tenx_leads WHERE address LIKE 'untouched-%' AND checked_at IS NULL").get()).toEqual({ n: 0 });
  });
  it("returns empty when no lane is due without mutating queue or quotas", async () => {
    const f = setup(); lead(f, "waiting", { due: "2026-10-22T11:00:00.000Z" });
    const before = f.sqlite.prepare("SELECT * FROM tenx_leads").all();
    expect(await addresses(f)).toEqual([]); expect(f.sqlite.prepare("SELECT * FROM tenx_leads").all()).toEqual(before);
    expect(f.sqlite.prepare("SELECT count(*) AS n FROM tenx_usage").get()).toEqual({ n: 0 });
  });
  it("retains malformed or non-integer headers without selecting them or poisoning usable lanes", async () => {
    const f = setup(); lead(f, "usable");
    for (const [name, payload] of [["malformed", "broken-json"], ["null", '{"blockTime":null}'], ["string", '{"blockTime":"1792661400"}'], ["fractional", '{"blockTime":1792661400.5}']] as const) {
      lead(f, name, { first: "2026-10-22T08:00:00.000Z" });
      f.sqlite.prepare("UPDATE tenx_leads SET migration_tx=?1 WHERE address=?2").run(payload, name);
    }
    expect(await addresses(f)).toEqual(["usable"]);
    expect(f.sqlite.prepare("SELECT count(*) AS n FROM tenx_leads WHERE checked_at IS NULL AND attempts=0").get()).toEqual({ n: 5 });
  });
  it("handles malformed cached market or candidate JSON as missing queue-priority fields", async () => {
    const f = setup(); lead(f, "first"); lead(f, "retry", { checked: at, cap: 200000, liquidity: 50000 });
    f.sqlite.exec("UPDATE tenx_lead_markets SET payload='broken-market'; UPDATE tenx_candidates SET payload='broken-candidate'");
    const selected = await dueLeads(f.db, at);
    expect(selected.map(row => row.address)).toEqual(["first", "retry"]);
    expect(selected[1]!.market_payload).toBeNull();
  });
});
