import { afterEach, expect, it, vi } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import { sqliteD1 } from "../../app/functions/_lib/sqliteTestDb";
import { normalizeAttention } from "./attention-feed-contract";
import { buildAttentionQueue } from "./attention-queue";
import { planAttentionHolderCohort, readAttentionHolderReadiness, assessAttentionHolderCohort, ATTENTION_HOLDER_COHORT_POLICY as policy } from "./attention-holder-cohort";
import { fixtureCandidates } from "./fixtures";
import { key } from "./wallet-fixtures.test-helper";
import { DEFAULT_POLICY } from "./model";
const at = new Date("2026-10-20T12:00:00.000Z"), databases: DatabaseSync[] = [];
afterEach(() => { databases.splice(0).forEach(db => db.close()); vi.restoreAllMocks(); });
function queue() {
  const report = buildAttentionQueue([normalizeAttention({ kind: "gmgn_hot_searches" }, { code: 0, data: [{ chain: "sol", interval: "24h", tokens: Array.from({ length: 13 }, (_, i) => ({ address: key(i + 1), symbol: "DUPLICATE" })) }] }, at.toISOString())], at);
  report.rows[1]!.checks = "adverse"; return report;
}
const missing = (addresses: readonly string[]) => addresses.map(address => ({ address, candidate_bytes: null, payload: null, lead_at: null }));
it("selects fixed source positions and distinct controls before any readiness lookup, with complete denominators", async () => {
  const fetcher = vi.spyOn(globalThis, "fetch"), input = queue(), original = JSON.stringify(input), cohort = await planAttentionHolderCohort(input);
  expect(cohort.plan.slots.map(s => s.member?.position)).toEqual([1, 2, 11]); expect(cohort.plan.selected_addresses).toEqual([input.rows[0]!.address, input.rows[1]!.address, input.rows[10]!.address]);
  expect(cohort.plan.population).toMatchObject({ returned: 13, solana: 13, fresh_solana: 13, selected: 3, unselected_fresh_solana: 10 });
  expect(cohort.plan).toMatchObject({ rpc_dispatch_allowed: false, provider_requests: 0, database_writes: 0, scoring_effect: "none", evidence_gates_changed: false });
  expect(JSON.stringify(input)).toBe(original); input.rows[0]!.symbol = "Changed"; expect(cohort.queue.rows[0]!.symbol).toBe("DUPLICATE"); expect(fetcher).not.toHaveBeenCalled();
});
it("keeps empty strata empty without a fallback and excludes stale/unsupported rows from Solana selection", async () => {
  const report = queue(); report.rows = report.rows.slice(0, 1); report.rows[0]!.checks = "adverse";
  const cohort = await planAttentionHolderCohort(report); expect(cohort.plan.slots.map(s => s.member?.position ?? null)).toEqual([null, 1, null]);
  expect((await assessAttentionHolderCohort(cohort, missing(cohort.plan.selected_addresses))).members).toHaveLength(1);
  const stale = buildAttentionQueue([normalizeAttention({ kind: "gmgn_hot_searches" }, { code: 0, data: [{ chain: "sol", interval: "24h", tokens: [{ address: key(1) }] }, { chain: "base", interval: "24h", tokens: [{ address: "0x0000000000000000000000000000000000001234" }] }] }, new Date(at.getTime() - 7200001).toISOString())], at);
  expect((await planAttentionHolderCohort(stale)).plan.population).toMatchObject({ solana: 1, other_chains: 1, fresh_solana: 0, selected: 0 });
});
it.each(["duplicate", "future", "family", "fresh", "window"])("holds inconsistent source context: %s", async mutation => {
  const report = queue(), row = report.rows[0]!;
  if (mutation === "duplicate") report.rows.push(structuredClone(row));
  if (mutation === "future") row.sources[0]!.received_at = new Date(at.getTime() + 1).toISOString();
  if (mutation === "family") row.attention_families++;
  if (mutation === "fresh") row.sources[0]!.fresh = false;
  if (mutation === "window") row.sources.push(structuredClone(row.sources[0]!));
  await expect(planAttentionHolderCohort(report)).rejects.toThrow();
});
it("retains missing members and unknown full cost instead of substituting or admitting dispatch", async () => {
  const cohort = await planAttentionHolderCohort(queue()), plan = JSON.stringify(cohort.plan), rows = missing(cohort.plan.selected_addresses);
  const report = await assessAttentionHolderCohort(cohort, rows);
  expect(report.members.map(m => m.address)).toEqual(cohort.plan.selected_addresses); expect(report.members.every(m => !m.recorded_quality_fields_match && !m.dispatch_admitted && !m.source_proof_replayed)).toBe(true);
  expect(report.cost).toMatchObject({ two_snapshot_reference_rpc_ceiling: 24, intake_rpc_cost: null, wallet_followup_rpc_cost: null, total_qualification_rpc_cost: null, free_budget_admitted: false }); expect(JSON.stringify(cohort.plan)).toBe(plan);
  await expect(assessAttentionHolderCohort(cohort, rows.slice(1))).rejects.toThrow("readiness_identity");
  await expect(assessAttentionHolderCohort(cohort, [rows[0], rows[0], rows[2]])).rejects.toThrow("readiness_identity");
  const forged = { ...cohort, plan: { ...cohort.plan, selected_addresses: [...cohort.plan.selected_addresses].reverse() } };
  await expect(assessAttentionHolderCohort(forged, rows)).rejects.toThrow("plan_mismatch");
});
it("describes matching recorded fields without verifying proofs, granting collection or weakening reference screens", async () => {
  const fixture = (await fixtureCandidates(at))[0]!, report = queue(); report.rows[0]!.address = fixture.address;
  const cohort = await planAttentionHolderCohort(report), rows = missing(cohort.plan.selected_addresses) as {address:string;candidate_bytes:number|null;payload:string|null;lead_at:string|null}[];
  const c = { ...fixture, mode: "live", market: { ...fixture.market!, liquidity_usd: 25000, market_cap_usd: 100000 } }, payload = JSON.stringify(c);
  Object.assign(rows[0]!, { payload, candidate_bytes: new TextEncoder().encode(payload).length, lead_at: at.toISOString() });
  expect(policy.existing_quality_reference).toMatchObject({ minimum_liquidity_usd: DEFAULT_POLICY.min_liquidity_usd, minimum_market_cap_usd: DEFAULT_POLICY.min_market_cap_usd });
  const result = await assessAttentionHolderCohort(cohort, rows); expect(result.members[0]).toMatchObject({ recorded_quality_fields_match: true, source_proof_replayed: false, dispatch_admitted: false });
  const future = { ...c, checked_at: new Date(at.getTime() + 1).toISOString() }; rows[0]!.payload = JSON.stringify(future); rows[0]!.candidate_bytes = new TextEncoder().encode(rows[0]!.payload).length;
  const held = await assessAttentionHolderCohort(cohort, rows); expect(held.members[0]!.gaps).toContain("latest_candidate_has_observations_after_cutoff"); expect(held.members[0]!.recorded_verification).toBeNull();
});
it("bounds candidate transfer in SQL, reads only selected members and makes no writes", async () => {
  const sqlite = new DatabaseSync(":memory:"); databases.push(sqlite); for (const f of readdirSync(new URL("../migrations/", import.meta.url)).filter(f => f.endsWith(".sql")).sort()) sqlite.exec(readFileSync(new URL(`../migrations/${f}`, import.meta.url), "utf8"));
  const cohort = await planAttentionHolderCohort(queue()), address = cohort.plan.selected_addresses[0]!;
  sqlite.prepare("INSERT INTO tenx_candidates(address,pool,payload,checked_at,mode) VALUES(?,?,?,?,?)").run(address, key(19), "x".repeat(1_600_001), at.toISOString(), "live");
  const before = sqlite.prepare("SELECT total_changes() n").get(), rows = await readAttentionHolderReadiness(sqliteD1(sqlite), cohort); expect(rows).toHaveLength(3); expect(rows.find(r => r.address === address)).toMatchObject({ payload: null, candidate_bytes: 1_600_001 });
  const result = await assessAttentionHolderCohort(cohort, rows); expect(result.members[0]!.gaps).toContain("candidate_exceeds_existing_read_bound"); expect(sqlite.prepare("SELECT total_changes() n").get()).toEqual(before);
});
