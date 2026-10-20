import { assess, CandidateSchema, DEFAULT_POLICY, type Candidate } from "./model";
import { ElectionInputSchema, ElectionRecordSchema, ElectionReplaySchema, ElectionResultSchema, ElectionSummarySchema, type ElectionInput, type ElectionRecord, type ElectionResult, type ElectionSummary } from "./election-model";
import { hashJson } from "./solana";

export class ElectionError extends Error {}
const ascii = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;

// Versioned discovery rehearsal. Community backing and launch certification are
// deliberately absent. Preserve this engine when introducing another version.
export function evaluateElection(raw: ElectionInput): ElectionResult {
  const input = ElectionInputSchema.parse(raw), now = new Date(input.as_of), seen = new Set<string>();
  for (const c of input.candidates) {
    if (c.mode !== "live") throw new ElectionError("election_fixture_input");
    if (seen.has(c.address)) throw new ElectionError("election_duplicate_candidate");
    seen.add(c.address);
    const times = [c.checked_at, c.first_seen_at, c.creation?.block_time, c.creation?.fetched_at, c.graduation?.block_time, c.graduation?.fetched_at, c.risk.observed_at, c.market?.fetched_at, c.market?.observed_at, c.holders?.observed_at, c.wallet_analysis?.observed_at];
    if (times.some(t => t && Date.parse(t) > now.getTime())) throw new ElectionError("election_evidence_from_future");
  }
  const assessed = input.candidates.map(c => assess(c, input.policy, now));
  const eligible = assessed.filter(c => c.eligibility === "eligible").sort((a, b) => (b.market?.liquidity_usd ?? 0) - (a.market?.liquidity_usd ?? 0) || ascii(a.creation!.block_time, b.creation!.block_time) || ascii(a.address, b.address));
  const ranks = new Map(eligible.slice(0, input.policy.max_candidates).map((c, i) => [c.address, i + 1]));
  const ordered = [...assessed].sort((a, b) => (ranks.get(a.address) ?? 1000) - (ranks.get(b.address) ?? 1000) || ascii(a.address, b.address));
  return ElectionResultSchema.parse({
    version: "election-result-v1", as_of: input.as_of, outcome: eligible.length ? "simulated_winner" : "no_eligible_winner", winner_address: eligible[0]?.address ?? null,
    ranking_rule: "eligible liquidity descending, creation ascending, address ASCII ascending",
    counts: { observed: assessed.length, eligible: eligible.length, provisional: assessed.filter(c => c.eligibility === "provisional").length, excluded: assessed.filter(c => c.eligibility === "excluded").length, shortlisted: ranks.size },
    candidates: ordered.map(c => ({ address: c.address, symbol: c.symbol, name: c.name, eligibility: c.eligibility, reasons: c.reasons, rank: ranks.get(c.address) ?? null, created_at: c.creation?.block_time ?? null, market_cap_usd: c.market?.market_cap_usd ?? null, liquidity_usd: c.market?.liquidity_usd ?? null })),
    voting_enabled: false, launch_enabled: false,
    gaps: ["bounded_local_candidate_inventory", "proposed_local_policy", "community_backing_not_enabled", "launch_adapters_not_certified", "no_onchain_execution"],
  });
}
export function freezeElection(candidates: Candidate[], at: Date): ElectionInput {
  return ElectionInputSchema.parse({ version: "election-input-v1", rules_version: "discovery-election-v1", as_of: at.toISOString(), policy: DEFAULT_POLICY, candidates: [...candidates].sort((a, b) => ascii(a.address, b.address)) });
}
const metadata = (r: ElectionSummary) => ({ id: r.id, kind: r.kind, day: r.day, created_at: r.created_at, input_hash: r.input_hash, result_hash: r.result_hash });
export async function replayElection(raw: ElectionRecord) {
  const record = ElectionRecordSchema.parse(raw);
  if (record.created_at !== record.inputs.as_of || record.result.as_of !== record.inputs.as_of || record.day !== record.created_at.slice(0, 10) || (record.kind === "daily" ? record.id !== `daily-${record.day}` : !record.id.startsWith("manual-"))) throw new ElectionError("election_metadata_mismatch");
  if (await hashJson(record.inputs) !== record.input_hash || await hashJson(record.result) !== record.result_hash || await hashJson(metadata(record)) !== record.record_hash) throw new ElectionError("election_hash_mismatch");
  if (await hashJson(evaluateElection(record.inputs)) !== record.result_hash) throw new ElectionError("election_replay_mismatch");
  return ElectionReplaySchema.parse({ status: "verified", input_hash_matches: true, result_hash_matches: true, result_matches: true, provider_requests: 0 });
}
type Row = { summary: string; inputs: string };
export async function electionRecord(db: D1Database, id: string): Promise<ElectionRecord | null> {
  const row = await db.prepare("SELECT summary,inputs FROM tenx_election_runs WHERE id=?1").bind(id).first<Row>();
  if (!row) return null;
  const record = ElectionRecordSchema.parse({ ...JSON.parse(row.summary), inputs: JSON.parse(row.inputs) });
  if (record.id !== id) throw new ElectionError("election_metadata_mismatch");
  await replayElection(record);
  return record;
}
export async function electionSummaries(db: D1Database): Promise<ElectionSummary[]> {
  const rows = await db.prepare("SELECT summary FROM tenx_election_runs ORDER BY created_at DESC,id DESC LIMIT 10").all<{ summary: string }>();
  return Promise.all(rows.results.map(async row => {
    const summary = ElectionSummarySchema.parse(JSON.parse(row.summary));
    if (await hashJson(summary.result) !== summary.result_hash || await hashJson(metadata(summary)) !== summary.record_hash) throw new ElectionError("election_hash_mismatch");
    return summary;
  }));
}
export async function createElection(db: D1Database, options: { id: string; kind: "manual" | "daily"; reason: string; now?: Date }): Promise<ElectionRecord> {
  const existing = await electionRecord(db, options.id);
  if (existing) return existing;
  // One SELECT observes a consistent candidate inventory. Never silently drop
  // the 501st row, or cut off a large snapshot to fit a D1 row.
  const rows = await db.prepare(`SELECT CASE WHEN COUNT(*) OVER()>500 OR SUM(length(CAST(payload AS BLOB))) OVER()>1600000 THEN NULL ELSE payload END AS payload,
    COUNT(*) OVER() AS total_count,SUM(length(CAST(payload AS BLOB))) OVER() AS total_bytes
    FROM tenx_candidates WHERE mode='live' ORDER BY address LIMIT 501`).all<{ payload: string | null; total_count: number; total_bytes: number }>();
  if (rows.results.length > 500) throw new ElectionError("election_candidate_limit");
  if (rows.results.some(r => r.total_bytes > 1_600_000 || r.payload === null)) throw new ElectionError("election_snapshot_size_limit");
  const at = options.now ?? new Date(), inputs = freezeElection(rows.results.map(r => CandidateSchema.parse(JSON.parse(r.payload!))), at), result = evaluateElection(inputs);
  const inputText = JSON.stringify(inputs), inputHash = await hashJson(inputs), resultHash = await hashJson(result);
  const meta = { id: options.id, kind: options.kind, day: at.toISOString().slice(0, 10), created_at: at.toISOString(), input_hash: inputHash, result_hash: resultHash };
  const summary = ElectionSummarySchema.parse({ ...meta, record_hash: await hashJson(meta), result });
  const record = ElectionRecordSchema.parse({ ...summary, inputs }); await replayElection(record);
  if (new TextEncoder().encode(inputText).length > 1_600_000 || new TextEncoder().encode(JSON.stringify(summary)).length > 200_000) throw new ElectionError("election_snapshot_size_limit");
  // Stable ID wins races. Audit and snapshot commit together; retry reads the
  // original record even after prices, policy, or source availability change.
  await db.batch([
    db.prepare("INSERT OR IGNORE INTO tenx_election_runs(id,kind,created_at,summary,inputs) VALUES(?1,?2,?3,?4,?5)").bind(record.id, record.kind, record.created_at, JSON.stringify(summary), inputText),
    db.prepare("INSERT OR IGNORE INTO tenx_audit(id,action,actor,reason,data_hash,created_at) SELECT ?1,'election_snapshot','local-operator',?2,?3,?4 WHERE EXISTS(SELECT 1 FROM tenx_election_runs WHERE id=?5 AND json_extract(summary,'$.record_hash')=?3)").bind(`election:${record.id}`, options.reason, record.record_hash, record.created_at, record.id),
  ]);
  return (await electionRecord(db, record.id))!;
}
export async function dailyElection(db: D1Database, now = new Date()) {
  // A readiness observation at the first local maintenance tick of this UTC
  // day, NOT a retrospective cutoff election. Sleeping days are not backfilled.
  const id = `daily-${now.toISOString().slice(0, 10)}`;
  if (await db.prepare("SELECT id FROM tenx_election_runs WHERE id=?1").bind(id).first()) return { id, state: "already_recorded" };
  await createElection(db, { id, kind: "daily", reason: "Automatic daily local discovery rehearsal", now });
  return { id, state: "recorded" };
}
export async function electionAutomation(db: D1Database) {
  const state = await db.prepare("SELECT election_error FROM tenx_control WHERE id=1").first<{ election_error: string | null }>();
  const latest = await db.prepare("SELECT id,created_at FROM tenx_election_runs WHERE kind='daily' ORDER BY created_at DESC LIMIT 1").first<{ id: string; created_at: string }>();
  return { last_error: state?.election_error ?? null, latest_id: latest?.id ?? null, last_snapshot_at: latest?.created_at ?? null };
}
