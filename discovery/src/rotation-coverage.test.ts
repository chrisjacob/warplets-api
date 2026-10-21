import { afterEach, expect, it, vi } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { readdirSync, readFileSync } from "node:fs";
import { sqliteD1 } from "../../app/functions/_lib/sqliteTestDb";
import { key } from "./wallet-fixtures.test-helper";
import { GmgnDailyCohort, GMGN_REGRESSION_MINTS } from "./gmgn-rotation";
import { hashJson } from "./solana";
import { rotationCoverage } from "./rotation-coverage";
import { RotationCoverage } from "./rotation-coverage-model";
import worker, { type LocalEnv } from "./worker";

const opened: DatabaseSync[] = [], at = new Date("2026-10-22T12:00:00.000Z"), a = key(101), b = key(102), c = key(103);
afterEach(() => { opened.splice(0).forEach(db => db.close()); vi.restoreAllMocks(); });
function setup() {
  const sqlite = new DatabaseSync(":memory:"); opened.push(sqlite);
  for (const file of readdirSync(new URL("../migrations/", import.meta.url)).filter(f => f.endsWith(".sql")).sort()) sqlite.exec(readFileSync(new URL(`../migrations/${file}`, import.meta.url), "utf8"));
  return { sqlite, db: sqliteD1(sqlite) };
}
async function cohort(sqlite: DatabaseSync, day: string, addresses = [a, b, c], last: string | null = null, hour = "01") {
  const cutoff = `${day}T${hour}:00:00.000Z`, regression = GMGN_REGRESSION_MINTS[0];
  const manifest = GmgnDailyCohort.parse({ version: "gmgn-daily-rotation-v1", day, cutoff, source: "active_chain_observed_inventory",
    selection_policy: "least_recent_then_age_liquidity_v4_diversity_then_day_hash_v1", selected: addresses, scoring_effect: "none",
    inventory: [...addresses, regression].map(address => ({ address, input_hash: "b".repeat(64), checked_at: cutoff, age_band: "first_day", liquidity_band: "at_least_25k", v4_band: "at_least_50", v4_score: 60, verification: "provisional", last_selected_day: last,
      disposition: address === regression ? "regression_fixture" : "selected", tie_hash: "c".repeat(64) })) });
  sqlite.prepare("INSERT INTO tenx_gmgn_daily_cohorts(day,cutoff,payload,payload_hash) VALUES(?,?,?,?)").run(day, cutoff, JSON.stringify(manifest), await hashJson(manifest));
}
let sequence = 0;
async function attempt(sqlite: DatabaseSync, address: string, kind: string, state: string, time: string, day = time.slice(0, 10)) {
  const id = `synthetic-${++sequence}`, request = { kind, address };
  // Operational metadata fixture only; no source payload, token facts or acceptance evidence is invented.
  sqlite.prepare("INSERT INTO tenx_source_reservations(id,owner,request_hash,request,reserved_at,lease_until,day,state,bytes) VALUES(?,?,?,?,?,?,?,?,?)")
    .run(id, id, await hashJson(request), JSON.stringify(request), time, time, day, state, 1);
}

it("keeps missing manifests unknown and performs no collection, enrollment or storage writes", async () => {
  const { sqlite, db } = setup(), fetcher = vi.spyOn(globalThis, "fetch").mockRejectedValue(Error("no network"));
  const before = sqlite.prepare("SELECT total_changes() AS n").get();
  const report = await rotationCoverage(db, at);
  expect(report.days).toHaveLength(14); expect(report.days[0]!.day).toBe("2026-10-22"); expect(report.days[13]!.day).toBe("2026-10-09");
  expect(report.days.every(day => day.manifest_cutoff === null && day.targets.length === 0)).toBe(true);
  expect(report.counts.attempted).toBe(0); expect(report.target.data_quality_pass).toBeNull();
  expect(sqlite.prepare("SELECT total_changes() AS n").get()).toEqual(before); expect(fetcher).not.toHaveBeenCalled();
});

it("partitions failures/pending/successes by selected mint and endpoint without hiding unattempted mints", async () => {
  const { sqlite, db } = setup(); await cohort(sqlite, "2026-10-22");
  await attempt(sqlite, a, "gmgn_token_info", "succeeded", "2026-10-22T01:00:00.000Z");
  await attempt(sqlite, a, "gmgn_token_candles", "failed", "2026-10-22T02:00:00.000Z");
  await attempt(sqlite, a, "gmgn_token_candles", "fetching", "2026-10-22T03:00:00.000Z");
  await attempt(sqlite, b, "gmgn_token_security", "failed", "2026-10-22T00:30:00.000Z");
  await attempt(sqlite, b, "gmgn_token_info", "reserved", "2026-10-22T04:00:00.000Z");
  await attempt(sqlite, key(104), "gmgn_token_info", "succeeded", "2026-10-22T04:00:00.000Z");
  await attempt(sqlite, a, "gmgn_token_traders", "succeeded", "2026-10-22T04:00:00.000Z");
  const report = await rotationCoverage(db, at);
  expect(report).toMatchObject({ distinct_selected: 3, distinct_attempted: 2, newly_investigated: 1, new_investigation_days: 1, receipt_payloads_replayed: false,
    counts: { attempted: 4, recorded_succeeded: 1, failed: 1, pending: 2, configured_weight: 6 } });
  expect(report.days[0]!).toMatchObject({ inventory: 4, regression_fixtures: 1, all_core_attempts: 6, scheduled_baseline_remaining: 15 });
  expect(report.days[0]!.targets.find(t => t.address === b)).toMatchObject({ first_selection: true, prior_gmgn_attempts: 1, newly_investigated: false });
  expect(report.days[0]!.targets.find(t => t.address === c)!.kinds.every(k => k.counts.attempted === 0)).toBe(true);
  expect(report.days[0]!.targets.some(t => t.address === GMGN_REGRESSION_MINTS[0])).toBe(false);
});

it("uses UTC and cutoff boundaries, excludes future evidence and deduplicates repeated mints", async () => {
  const { sqlite, db } = setup(); await cohort(sqlite, "2026-10-21", [a]); await cohort(sqlite, "2026-10-22", [a], "2026-10-21");
  await cohort(sqlite, "2026-10-08", [b]); await cohort(sqlite, "2026-10-23", [c]);
  await attempt(sqlite, a, "gmgn_token_info", "succeeded", "2026-10-21T02:00:00.000Z");
  await attempt(sqlite, a, "gmgn_token_info", "succeeded", at.toISOString());
  await attempt(sqlite, a, "gmgn_token_info", "failed", "2026-10-22T12:00:00.001Z");
  await attempt(sqlite, a, "gmgn_token_info", "failed", "2026-10-22T00:00:00.000Z", "2026-10-21");
  const report = await rotationCoverage(db, at);
  expect(report).toMatchObject({ distinct_selected: 1, distinct_attempted: 1, newly_investigated: 1, new_investigation_days: 1, counts: { attempted: 2, recorded_succeeded: 2 } });
  expect(report.days[0]!.targets[0]).toMatchObject({ first_selection: false, newly_investigated: false });
  expect(report.days.every(day => day.day !== "2026-10-08" && day.day !== "2026-10-23")).toBe(true);
});

it("distinguishes an empty frozen selection from no manifest and withholds a future cutoff", async () => {
  const { sqlite, db } = setup(); await cohort(sqlite, "2026-10-21", []); await cohort(sqlite, "2026-10-22", [a], null, "13");
  const report = await rotationCoverage(db, at);
  expect(report.days[0]!.manifest_hash).toBeNull(); expect(report.days[1]!.manifest_hash).not.toBeNull(); expect(report.days[1]!.targets).toEqual([]);
});

it("shows exhausted scheduled headroom from earlier work even without a rotation manifest", async () => {
  const { sqlite, db } = setup();
  for (let i = 0; i < 34; i++) await attempt(sqlite, a, "gmgn_token_candles", "failed", "2026-10-22T01:00:00.000Z");
  const report = await rotationCoverage(db, at);
  expect(report.days[0]).toMatchObject({ manifest_cutoff: null, all_core_attempts: 34, scheduled_baseline_remaining: 0 });
  expect(report.counts.attempted).toBe(0); expect(report.newly_investigated).toBe(0);
});

it("fails closed on corrupt frozen selection hashes and rejects inconsistent count partitions", async () => {
  const { sqlite, db } = setup(); await cohort(sqlite, "2026-10-22");
  const report = await rotationCoverage(db, at), broken = structuredClone(report); broken.counts.attempted = 1;
  expect(RotationCoverage.safeParse(broken).success).toBe(false);
  sqlite.exec("DROP TRIGGER tenx_gmgn_daily_cohorts_no_update; UPDATE tenx_gmgn_daily_cohorts SET payload_hash='" + "a".repeat(64) + "'");
  await expect(rotationCoverage(db, at)).rejects.toThrow("hash_mismatch");
});

it("serves the typed local read without writes or provider IO and preserves runtime and mutation gates", async () => {
  const { sqlite, db } = setup(), fetcher = vi.spyOn(globalThis, "fetch").mockRejectedValue(Error("no network"));
  const env: LocalEnv = { TENX_DB: db, TENX_LOCAL_ONLY: "true", TENX_NODE_RELAY: "false", TENX_ADMIN_TOKEN: "a".repeat(64), TENX_RPC_URL: "https://api.mainnet-beta.solana.com", TENX_RPC_DAILY_LIMIT: "5000", TENX_MARKET_DAILY_LIMIT: "600", TENX_MARKET_PROVIDER: "dexscreener", TENX_QUALITY_ENABLED: "true", TENX_QUALITY_RPC_DAILY_LIMIT: "1800", TENX_MARKET_ENABLED: "false", TENX_WALLET_ANALYSIS_ENABLED: "true", TENX_WALLET_RPC_DAILY_LIMIT: "800" };
  const before = sqlite.prepare("SELECT total_changes() AS n").get();
  const response = await worker.fetch(new Request("http://localhost/api/10x/discovery/rotation-coverage"), env);
  expect(response.status).toBe(200); const body = await response.json() as { data: unknown };
  expect(RotationCoverage.parse(body.data).provider_requests).toBe(0);
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect((await worker.fetch(new Request("https://app.10x.meme/api/10x/discovery/rotation-coverage"), env)).status).toBe(503);
  expect((await worker.fetch(new Request("http://localhost/api/10x/discovery/rotation-coverage", { method: "POST" }), env)).status).toBe(404);
  expect(sqlite.prepare("SELECT total_changes() AS n").get()).toEqual(before); expect(fetcher).not.toHaveBeenCalled();
});
