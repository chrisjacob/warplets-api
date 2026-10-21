import { HolderEvidenceSchema, analyzeHolders, type HolderEvidence } from "./holders";
import { ATA } from "./pump";
import { base64, findPda, hashJson, publicKey, Reader } from "./solana";
import { HOLDER_HISTORY_LIMITS as L, HolderHistoryInputSchema, HolderHistoryReportSchema, HolderHistoryDeltaSchema,
  type HolderHistoryInput } from "./holder-history-model";
import { z } from "zod";

export class HolderHistoryError extends Error {}
type Meta = HolderHistoryInput["index"][number];
const order = (a: Meta, b: Meta) => Date.parse(a.observed_at)-Date.parse(b.observed_at) || a.slot-b.slot || a.payload_hash.localeCompare(b.payload_hash);
export function selectedHolderSnapshots(index: Meta[]) {
  if (index.length > L.records) return [];
  const sorted = [...index].sort(order);
  return [...new Map([sorted[0], ...sorted.slice(-2)].filter((v): v is Meta => !!v).map(v => [v.payload_hash, v])).values()].sort(order);
}
function bounded(raw: unknown, limit: number) {
  if (new TextEncoder().encode(JSON.stringify(raw)).length > limit) throw new HolderHistoryError("holder_history_byte_limit");
}
function assertEvidence(raw: unknown): asserts raw is HolderEvidence {
  // Validate without rebuilding the archived object: original receipt hashes
  // include its JSON property order and any preserved RPC extension fields.
  HolderEvidenceSchema.parse(raw);
}
async function snapshot(meta: Meta, raw: unknown) {
  bounded(raw, L.snapshot_bytes);
  if (await hashJson(raw) !== meta.payload_hash) throw new HolderHistoryError("holder_history_payload_hash_mismatch");
  assertEvidence(raw);
  const evidence = raw;
  if (evidence.mint !== meta.address || evidence.inventory.context.slot !== meta.slot) throw new HolderHistoryError("holder_history_identity_mismatch");
  const analysis = await analyzeHolders(evidence, meta.observed_at);
  if (analysis.payload_hash !== meta.payload_hash) throw new HolderHistoryError("holder_history_normalized_hash_mismatch");
  const vault = await findPda(ATA, [publicKey(evidence.pool), publicKey(evidence.program), publicKey(evidence.mint)]);
  const balances = new Map<string, bigint>();
  // Replay above validates every account/layout, supply and the exact vault.
  // Reconstruct all owners from full evidence, never from the public top 20.
  for (const row of evidence.inventory.value) {
    if (row.pubkey === vault) continue;
    const reader = new Reader(base64(row.account.data[0])); reader.key();
    const owner = reader.key(), amount = reader.u64();
    if (amount > 0n) balances.set(owner, (balances.get(owner) ?? 0n) + amount);
  }
  if (balances.size !== analysis.holder_count) throw new HolderHistoryError("holder_history_owner_count_mismatch");
  return { balances, public: { payload_hash: meta.payload_hash, observed_at: meta.observed_at, context_slot: meta.slot,
    mint_slot: evidence.mint_state.context.slot, pool: evidence.pool, program: evidence.program, supply_raw: analysis.supply_raw,
    account_count: analysis.account_count, raw_owner_count: analysis.holder_count, complete: analysis.status === "verified",
    layout_certified: analysis.layout_certified, acquisition_provenance: "unknown" as const, gaps: analysis.gaps } };
}
type Snapshot = Awaited<ReturnType<typeof snapshot>>;
function delta(a: Snapshot, b: Snapshot, conflict: boolean): z.infer<typeof HolderHistoryDeltaSchema> {
  const first = a.public, last = b.public, gaps: string[] = [];
  if (!first.complete || !last.complete) gaps.push("inventory_incomplete");
  if (!first.layout_certified || !last.layout_certified) gaps.push("layout_not_certified");
  if (first.pool !== last.pool || first.program !== last.program || first.supply_raw !== last.supply_raw) gaps.push("inventory_scope_or_supply_changed");
  if (last.context_slot <= first.context_slot || last.mint_slot < first.mint_slot) gaps.push("slots_not_advancing");
  const duration = (Date.parse(last.observed_at)-Date.parse(first.observed_at))/1000;
  if (duration <= 0 || conflict) gaps.push("archive_timestamp_conflict");
  let retained = 0;
  for (const owner of a.balances.keys()) if (b.balances.has(owner)) retained++;
  const start = a.balances.size, end = b.balances.size, held = gaps.length > 0;
  return HolderHistoryDeltaSchema.parse({ status: held ? "held" : "measured", start_at: first.observed_at, end_at: last.observed_at,
    duration_seconds: Math.max(0,duration), start_hash: first.payload_hash, end_hash: last.payload_hash,
    starting_owners: held ? null : start, ending_owners: held ? null : end, entrants: held ? null : end-retained,
    exits: held ? null : start-retained, retained: held ? null : retained, net_change: held ? null : end-start,
    raw_growth_pct: held || !start ? null : (end-start)/start*100,
    positive_balance_retention_pct: held || !start ? null : retained/start*100, gaps });
}
export async function reviewHolderHistory(raw: unknown) {
  bounded(raw, L.input_bytes);
  const input = HolderHistoryInputSchema.parse(raw), cutoff = Date.parse(input.cutoff_at), start = cutoff-86_400_000;
  const index = [...input.index].sort(order), hashes = new Set<string>(), dates = new Set<number>();
  let conflict = false;
  for (const row of index) {
    const time = Date.parse(row.observed_at);
    if (row.address !== input.address || time > cutoff || time < start || hashes.has(row.payload_hash)) throw new HolderHistoryError("holder_history_index_mismatch");
    if (dates.has(time)) conflict = true;
    dates.add(time); hashes.add(row.payload_hash);
  }
  const selected = selectedHolderSnapshots(index);
  if (input.samples.length !== selected.length || new Set(input.samples.map(row => row.payload_hash)).size !== input.samples.length ||
    input.samples.some(row => !selected.some(meta => meta.payload_hash === row.payload_hash))) throw new HolderHistoryError("holder_history_selection_mismatch");
  const snapshots: Snapshot[] = [];
  for (const meta of selected) snapshots.push(await snapshot(meta, input.samples.find(row => row.payload_hash === meta.payload_hash)!.evidence));
  const gaps = ["positive_balances_include_unsolicited_dust", "voluntary_acquisition_unknown", "beneficial_owner_links_unknown",
    "exact_24h_boundary_not_established", "since_creation_baseline_not_established", "snapshots_do_not_prove_continuous_retention",
    "archive_times_are_collector_times_not_block_times", "archived_request_finality_not_independently_attested"];
  if (index.length > L.records) gaps.push("archive_record_limit");
  if (snapshots.length < 2) gaps.push("comparable_baseline_missing");
  if (conflict) gaps.push("archive_timestamp_conflict");
  const latest = snapshots.at(-1), stale = !latest || cutoff-Date.parse(latest.public.observed_at) > 1_800_000;
  if (stale) gaps.push("latest_inventory_stale_or_missing");
  const sinceFirst = snapshots.length >= 2 ? delta(snapshots[0]!,latest!,conflict) : null;
  const recent = snapshots.length >= 2 ? delta(snapshots.at(-2)!,latest!,conflict) : null;
  const report = { version: "holder-history-v1" as const, address: input.address, cutoff_at: input.cutoff_at,
    requested_start: new Date(start).toISOString(), status: index.length > L.records ? "limited" : index.length ? "available" : "no_history",
    archive_records: index.length, archive_limit: 96, selection: input.selection, snapshots: snapshots.map(row=>row.public),
    since_first: sinceFirst, recent, stale, gaps, input_hash: await hashJson(input),
    meaningful_holder_growth: null, trailing_24h_holder_growth: null, since_creation_holder_growth: null,
    organic_demand_certified: false, acquisition_provenance: "unknown", continuous_coverage: false,
    scoring_effect: "none", evidence_gates_changed: false, provider_requests: 0, database_writes: 0 };
  return HolderHistoryReportSchema.parse({ ...report, report_hash: await hashJson(report) });
}
export async function replayHolderHistoryRecord(raw: unknown) {
  bounded(raw,L.input_bytes+100_000);
  const record=z.object({inputs:HolderHistoryInputSchema,report:HolderHistoryReportSchema}).strict().parse(raw);
  const actual=await reviewHolderHistory(record.inputs);
  if(await hashJson(actual)!==await hashJson(record.report))throw new HolderHistoryError("holder_history_report_mismatch");
  return actual;
}
