import { z } from "zod";
import { reviewCanonicalAttentionState, TARGETED_CANONICAL_POLICY } from "./canonical-attention-intake";
import { creationProof, creationUser, graduationProof, migrations } from "./pump";
import { MAX_TRANSACTION_VERSION, RpcClient, SignatureRows, SourceError, TransactionSchema, persistRpcBackoff } from "./rpc";
import { hashJson } from "./solana";
import type { QualitySettings } from "./quality-cycle";
import { attentionHistoryTargets, TARGETED_HISTORY_POLICY, type HistoryTargetKind } from "./attention-history-targeting";

export const ATTENTION_HISTORY_POLICY = {
  version: "attention-historical-proof-v1", scope: "canonical_pump_wsol_research_only",
  pages_per_mint: 3, signatures_per_page: 1000, bodies_per_page: 4, turns_per_utc_hour: 3,
  rpc_calls_per_turn: 6, turn_observation_bytes: 1800000, plan_receipt_bytes: 32000,
  selection: "oldest_original_canonical_intake_then_next_original_page",
  bodies: "first_two_then_last_two_finalized_successes_at_or_before_state_slot",
  missing_is_unknown: true, candidate_admitted: false, scoring_effect: "none",
} as const;
type Canonical = Awaited<ReturnType<typeof reviewCanonicalAttentionState>>;
type Origin = NonNullable<Awaited<ReturnType<typeof creationProof>>> & { creator: string | null };
type Graduation = { proof: Awaited<ReturnType<typeof graduationProof>>; identity: Canonical["identity"] };
export type HistoryReceipt = {
  version: "attention-history-receipt-v1" | "attention-history-receipt-v2"; plan_hash: string; observed_at: string; turn: number;
  target_kind?: HistoryTargetKind; target_address?: string; page_full?: boolean;
  address: string; canonical_receipt_hash: string; parent_receipt_hash: string | null;
  observation_hashes: string[]; inspected: { signature: string; outcome: string }[];
  origin: Origin | null; graduation: Graduation | null; next_before_signature: string | null; last_page_slot: number | null;
  continuation_allowed: boolean; status: "verified" | "scanning" | "unknown_within_bound";
  historical_creation_proven: boolean; historical_migration_proven: boolean; historical_pair_verified: boolean;
  candidate_admitted: false; scoring_effect: "none"; evidence_gates_changed: false; receipt_hash: string;
};
export async function planAttentionHistory(canonical: Canonical, previous: HistoryReceipt | null, at: string, hourSlot: number) {
  z.iso.datetime().parse(at); z.number().int().min(1).max(3).parse(hourSlot);
  z.iso.datetime().parse(canonical.observed_at);
  if (canonical.authority_checks !== "revoked" || Date.parse(at) < Date.parse(canonical.observed_at)) throw Error("history_canonical_state_unusable");
  if (previous) { const { receipt_hash, ...body } = previous; if (await hashJson(body) !== receipt_hash) throw Error("history_parent_hash_mismatch"); }
  if (previous && (previous.address !== canonical.address || previous.canonical_receipt_hash !== canonical.receipt_hash || !previous.continuation_allowed || previous.turn >= 3 || Date.parse(previous.observed_at) > Date.parse(at))) throw Error("history_parent_unusable");
  const body = { version: ATTENTION_HISTORY_POLICY.version, policy_hash: await hashJson(ATTENTION_HISTORY_POLICY),
    address: canonical.address, curve: canonical.identity.curve, canonical_receipt_hash: canonical.receipt_hash,
    state_slot: canonical.accounts.context.slot, state_observed_at: canonical.observed_at, created_at: at,
    utc_hour: at.slice(0, 13), hour_slot: hourSlot, turn: (previous?.turn ?? 0) + 1,
    parent_receipt_hash: previous?.receipt_hash ?? null, before_signature: previous?.next_before_signature ?? null,
    previous_last_slot: previous?.last_page_slot ?? null, candidate_admitted: false, scoring_effect: "none" } as const;
  return { ...body, plan_hash: await hashJson(body) };
}
export async function planTargetedAttentionHistory(canonical: Canonical, previous: HistoryReceipt | null, at: string, hourSlot: number) {
  z.iso.datetime().parse(at); z.number().int().min(1).max(3).parse(hourSlot);
  z.iso.datetime().parse(canonical.observed_at);
  if (canonical.authority_checks !== "revoked" || Date.parse(at) < Date.parse(canonical.observed_at)) throw Error("history_canonical_state_unusable");
  if (previous) {
    const { receipt_hash, ...body } = previous;
    if (await hashJson(body) !== receipt_hash) throw Error("history_parent_hash_mismatch");
    if (previous.version !== "attention-history-receipt-v2" || previous.address !== canonical.address || previous.canonical_receipt_hash !== canonical.receipt_hash ||
      !previous.continuation_allowed || previous.turn >= 3 || Date.parse(previous.observed_at) > Date.parse(at)) throw Error("history_parent_unusable");
  }
  const targets = await attentionHistoryTargets(canonical.identity);
  const target = !previous || previous.target_kind === "pool_lp_mint" && previous.page_full && !previous.graduation ? targets.migration : targets.creation;
  const sameTarget = previous?.target_address === target.address;
  const body = { version: TARGETED_HISTORY_POLICY.version, policy_hash: await hashJson(TARGETED_HISTORY_POLICY),
    address: canonical.address, curve: canonical.identity.curve, canonical_receipt_hash: canonical.receipt_hash,
    canonical_intake_plan_hash: canonical.plan_hash, target_kind: target.kind, target_address: target.address,
    state_slot: canonical.accounts.context.slot, state_observed_at: canonical.observed_at, created_at: at,
    utc_hour: at.slice(0, 13), hour_slot: hourSlot, turn: (previous?.turn ?? 0) + 1,
    parent_receipt_hash: previous?.receipt_hash ?? null, before_signature: sameTarget ? previous.next_before_signature : null,
    previous_last_slot: sameTarget ? previous.last_page_slot : null, candidate_admitted: false, scoring_effect: "none" } as const;
  return { ...body, plan_hash: await hashJson(body) };
}
type Plan = Awaited<ReturnType<typeof planAttentionHistory>> | Awaited<ReturnType<typeof planTargetedAttentionHistory>>;
const Observation = z.object({ step: z.number().int().min(0).max(4), request: z.unknown(), response: z.unknown(),
  error: z.enum(["archival_body_missing", "unsupported_transaction_version", "transaction_layout_unsupported"]).nullable(),
  observed_at: z.iso.datetime(), observation_hash: z.string().regex(/^[a-f0-9]{64}$/) }).strict();
export type HistoryObservation = z.infer<typeof Observation>;
const targetAddress = (plan: Plan) => "target_address" in plan ? plan.target_address : plan.curve;
const pageRequest = (plan: Plan) => ({ method: "getSignaturesForAddress", params: [targetAddress(plan), { commitment: "finalized", limit: 1000, ...(plan.before_signature ? { before: plan.before_signature } : {}) }] });
const bodyRequest = (signature: string) => ({ method: "getTransaction", params: [signature, { commitment: "finalized", encoding: "json", maxSupportedTransactionVersion: MAX_TRANSACTION_VERSION }] });
export async function historyObservation(step: number, request: unknown, response: unknown, error: HistoryObservation["error"], at: string): Promise<HistoryObservation> {
  const body = { step, request, response, error, observed_at: at };
  return Observation.parse({ ...body, observation_hash: await hashJson(body) });
}
export function selectHistoryBodies(plan: Plan, raw: unknown, priorSignatures: string[], observedAt: string, priorInspected: string[] = []) {
  const page = SignatureRows.parse(raw), prior = new Set(z.array(z.string()).max(2000).parse(priorSignatures));
  if (new Set(page.map(r => r.signature)).size !== page.length || page.some((r, i) => r.slot <= 0 || prior.has(r.signature) || r.signature === plan.before_signature ||
    (i > 0 && r.slot > page[i - 1]!.slot) || (plan.previous_last_slot !== null && r.slot > plan.previous_last_slot) ||
    r.blockTime !== null && (r.blockTime < 0 || r.blockTime * 1000 > Date.parse(observedAt)))) throw Error("history_page_identity_order_or_time");
  const inspected = new Set(z.array(z.string()).max(8).parse(priorInspected));
  const eligible = page.filter(r => r.err === null && r.confirmationStatus === "finalized" && r.slot <= plan.state_slot && (!inspectTarget(plan) || !inspected.has(r.signature)));
  const selected = [...eligible.slice(0, 2), ...eligible.slice(-2)];
  return { page, selected: selected.filter((r, i) => selected.findIndex(other => other.signature === r.signature) === i) };
}
// The caller replays the original canonical receipt and every previous turn first.
// A current pool, search age or missing transaction can never supply a proof.
const inspectTarget = (plan: Plan) => plan.version === TARGETED_HISTORY_POLICY.version;
export async function reviewAttentionHistory(plan: Plan, canonical: Canonical, previous: HistoryReceipt | null, priorSignatures: string[], raw: unknown, observedAt: string, priorInspected: string[] = []): Promise<HistoryReceipt> {
  const expected = inspectTarget(plan) ? await planTargetedAttentionHistory(canonical, previous, plan.created_at, plan.hour_slot) : await planAttentionHistory(canonical, previous, plan.created_at, plan.hour_slot);
  if (JSON.stringify(expected) !== JSON.stringify(plan)) throw Error("history_plan_mismatch");
  z.iso.datetime().parse(observedAt);
  const reads = z.array(Observation).min(1).max(5).parse(raw);
  if (new TextEncoder().encode(JSON.stringify(reads)).length > ATTENTION_HISTORY_POLICY.turn_observation_bytes) throw Error("history_turn_bytes");
  for (const [index, read] of reads.entries()) {
    const { observation_hash, ...body } = read;
    if (index !== read.step || await hashJson(body) !== observation_hash || Date.parse(read.observed_at) < Date.parse(index ? reads[index - 1]!.observed_at : plan.created_at) || Date.parse(read.observed_at) > Date.parse(observedAt)) throw Error("history_observation_mismatch");
  }
  if (JSON.stringify(reads[0]!.request) !== JSON.stringify(pageRequest(plan)) || reads[0]!.error !== null) throw Error("history_page_request_mismatch");
  const { page, selected } = selectHistoryBodies(plan, reads[0]!.response, priorSignatures, reads[0]!.observed_at, priorInspected);
  if (reads.length !== selected.length + 1) throw Error("history_body_count_mismatch");
  let origin = previous?.origin ?? null, graduation = previous?.graduation ?? null;
  const inspected: HistoryReceipt["inspected"] = [];
  for (const [index, item] of selected.entries()) {
    const read = reads[index + 1]!;
    if (JSON.stringify(read.request) !== JSON.stringify(bodyRequest(item.signature))) throw Error("history_body_request_mismatch");
    if (read.error !== null) { if (read.response !== null) throw Error("history_missing_body_mismatch"); inspected.push({ signature: item.signature, outcome: read.error }); continue; }
    const tx = TransactionSchema.parse(read.response);
    if (tx.transaction.signatures[0] !== item.signature || tx.slot !== item.slot || tx.slot > plan.state_slot || tx.blockTime === null || tx.blockTime * 1000 > Date.parse(plan.state_observed_at) || item.blockTime !== null && tx.blockTime !== item.blockTime || tx.meta?.err !== null) throw Error("history_transaction_identity_or_time");
    if (inspectTarget(plan) && ![...tx.transaction.message.accountKeys, ...(tx.meta?.loadedAddresses?.writable ?? []), ...(tx.meta?.loadedAddresses?.readonly ?? [])].includes(targetAddress(plan))) throw Error("history_transaction_target_mismatch");
    const foundOrigin = await creationProof(tx, plan.address, read.observed_at);
    const match = (await migrations(tx)).find(m => Object.entries(canonical.identity).every(([key, value]) => m[key as keyof typeof m] === value));
    if (foundOrigin) { if (origin && origin.proof.signature !== item.signature) throw Error("history_conflicting_origin"); origin = { ...foundOrigin, creator: await creationUser(tx, plan.address) }; }
    if (match) { if (graduation && graduation.proof.signature !== item.signature) throw Error("history_conflicting_migration"); graduation = { proof: await graduationProof(tx, match, read.observed_at), identity: canonical.identity }; }
    inspected.push({ signature: item.signature, outcome: foundOrigin && match ? "origin_and_migration_verified" : foundOrigin ? "origin_verified" : match ? "migration_verified" : "not_target_proof" });
  }
  if (origin && graduation && (origin.proof.slot > graduation.proof.slot || origin.proof.block_time > graduation.proof.block_time)) throw Error("history_origin_after_migration");
  const verified = !!origin && !!graduation;
  const moreTargetWork = "target_kind" in plan && plan.target_kind === "pool_lp_mint"
    ? page.length === 1000 || !origin : page.length === 1000 && !origin;
  const continuation = !verified && plan.turn < 3 && (inspectTarget(plan) ? moreTargetWork : page.length === 1000);
  const body = { version: inspectTarget(plan) ? "attention-history-receipt-v2" as const : "attention-history-receipt-v1" as const,
    ...("target_kind" in plan ? { target_kind: plan.target_kind, target_address: plan.target_address, page_full: page.length === 1000 } : {}),
    plan_hash: plan.plan_hash, observed_at: observedAt, turn: plan.turn,
    address: plan.address, canonical_receipt_hash: canonical.receipt_hash, parent_receipt_hash: plan.parent_receipt_hash,
    observation_hashes: reads.map(r => r.observation_hash), inspected, origin, graduation,
    next_before_signature: page.at(-1)?.signature ?? null, last_page_slot: page.at(-1)?.slot ?? null,
    continuation_allowed: continuation, status: verified ? "verified" as const : continuation ? "scanning" as const : "unknown_within_bound" as const,
    historical_creation_proven: !!origin, historical_migration_proven: !!graduation, historical_pair_verified: verified,
    candidate_admitted: false as const, scoring_effect: "none" as const, evidence_gates_changed: false as const };
  return { ...body, receipt_hash: await hashJson(body) };
}

type StoredTurn = { id: string; plan: string; plan_hash: string; receipt: string; receipt_hash: string };
export async function replayAttentionHistory(db: D1Database, address: string, canonical: Canonical) {
  if (canonical.address !== address) throw Error("history_canonical_address_mismatch");
  const turns = await db.prepare(`SELECT p.id,p.plan_hash,CASE WHEN length(CAST(p.plan AS BLOB))<=32000 THEN p.plan ELSE NULL END AS plan,
    r.receipt_hash,CASE WHEN length(CAST(r.receipt AS BLOB))<=32000 THEN r.receipt ELSE NULL END AS receipt
    FROM tenx_attention_history_plans p LEFT JOIN tenx_attention_history_receipts r ON r.plan_id=p.id WHERE p.address=?1 ORDER BY p.turn LIMIT 3`).bind(address).all<StoredTurn>();
  let previous: HistoryReceipt | null = null; const seen: string[] = [], byTarget = new Map<string, string[]>(), inspected: string[] = [];
  for (const turn of turns.results) {
    if (!turn.receipt || !turn.plan) throw Error("history_original_turn_unfinished");
    const saved = await db.prepare(`SELECT observation_hash,CASE WHEN length(CAST(observation AS BLOB))<=1800000
      AND (SELECT COALESCE(SUM(length(CAST(observation AS BLOB))),0) FROM tenx_attention_history_reads WHERE plan_id=?1)<=1800000
      THEN observation ELSE NULL END AS observation FROM tenx_attention_history_reads WHERE plan_id=?1 ORDER BY step LIMIT 5`).bind(turn.id).all<{ observation: string; observation_hash: string }>();
    if (saved.results.reduce((sum, row) => sum + (row.observation ? new TextEncoder().encode(row.observation).length : 1800001), 0) > 1800000) throw Error("history_turn_bytes");
    const reads = saved.results.map(row => { const read = Observation.parse(JSON.parse(row.observation)); if (read.observation_hash !== row.observation_hash) throw Error("history_read_hash_mismatch"); return read; });
    const plan = JSON.parse(turn.plan) as Plan;
    if (plan.plan_hash !== turn.plan_hash || plan.turn !== (previous?.turn ?? 0) + 1) throw Error("history_plan_chain_mismatch");
    if (previous && inspectTarget(plan) !== (previous.version === "attention-history-receipt-v2")) throw Error("history_policy_chain_mismatch");
    const receipt = await reviewAttentionHistory(plan, canonical, previous, inspectTarget(plan) ? byTarget.get(targetAddress(plan)) ?? [] : seen, reads, JSON.parse(turn.receipt).observed_at, inspected);
    if (receipt.receipt_hash !== turn.receipt_hash || JSON.stringify(receipt) !== turn.receipt) throw Error("history_receipt_replay_mismatch");
    previous = receipt; const page = SignatureRows.parse(reads[0]!.response).map(row => row.signature);
    seen.push(...page); byTarget.set(targetAddress(plan), [...(byTarget.get(targetAddress(plan)) ?? []), ...page]); inspected.push(...receipt.inspected.map(row => row.signature));
  }
  return { previous, seen, byTarget, inspected };
}

export async function collectAttentionHistory(s: QualitySettings, owner: string, remainingCalls: number, clock: () => Date, quota: () => Promise<void>) {
  const db = s.db, now = clock(), at = now.toISOString(), day = at.slice(0, 10), hour = at.slice(0, 13);
  const held = (reason: string) => ({ state: "held", reason, rpc_calls: 0, scoring_effect: "none" });
  if (!s.qualityEnabled || s.qualityDailyLimit <= 0 || s.rpcDailyLimit <= 0 || remainingCalls < 6) return held("history_quality_disabled_or_cycle_budget");
  if (!await db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='tenx_attention_history_plans'").first()) return held("history_migration_required");
  const owned = async () => { const current = clock().toISOString(); return current.slice(0, 10) === day && Date.parse(current) - now.getTime() <= 120000 && !!await db.prepare(`SELECT 1 FROM tenx_quality_control WHERE id=1 AND lease_owner=?1 AND lease_until>?2 AND EXISTS(SELECT 1 FROM tenx_control WHERE id=1 AND paused=0 AND (retry_after IS NULL OR retry_after<=?2))`).bind(owner, current).first(); };
  if (!await owned()) return held("history_quality_lease_pause_or_backoff");
  const spent = await db.prepare("SELECT id FROM tenx_jobs WHERE id IN (?1,?2,?3)").bind(...[1, 2, 3].map(slot => `attention-history-${hour}-${slot}`)).all<{ id: string }>();
  const hourSlot = [1, 2, 3].find(slot => !spent.results.some(row => row.id === `attention-history-${hour}-${slot}`));
  if (!hourSlot) return held("history_hour_spent");
  const row = await db.prepare(`SELECT p.address,p.plan_hash,CASE WHEN length(CAST(p.plan AS BLOB))<=32000 THEN p.plan ELSE NULL END AS plan,r.receipt_hash,CASE WHEN length(CAST(r.receipt AS BLOB))<=1800000 THEN r.receipt ELSE NULL END AS receipt
    FROM tenx_canonical_intakes p JOIN tenx_canonical_intake_receipts r ON r.address=p.address
    WHERE json_extract(r.receipt,'$.authority_checks')='revoked'
    AND NOT EXISTS(SELECT 1 FROM tenx_attention_history_plans h LEFT JOIN tenx_attention_history_receipts x ON x.plan_id=h.id WHERE h.address=p.address AND (x.plan_id IS NULL OR json_extract(x.receipt,'$.continuation_allowed')=0))
    AND (SELECT count(*) FROM tenx_attention_history_plans h WHERE h.address=p.address)<3 ORDER BY p.created_at,p.address LIMIT 1`).first<{ address: string; plan_hash: string; plan: string; receipt_hash: string; receipt: string }>();
  if (!row) return held("history_no_unspent_canonical_lead");
  const original = JSON.parse(row.receipt), canonical = await reviewCanonicalAttentionState(JSON.parse(row.plan), original.accounts, original.observed_at);
  if (canonical.address !== row.address || canonical.receipt_hash !== row.receipt_hash || JSON.stringify(canonical) !== row.receipt || JSON.parse(row.plan).plan_hash !== row.plan_hash) throw Error("history_canonical_replay_mismatch");
  const { previous, seen, byTarget, inspected } = await replayAttentionHistory(db, row.address, canonical);
  const targeted = JSON.parse(row.plan).version === TARGETED_CANONICAL_POLICY.version;
  if (previous && targeted !== (previous.version === "attention-history-receipt-v2")) throw Error("history_cohort_policy_mismatch");
  const plan = targeted ? await planTargetedAttentionHistory(canonical, previous, at, hourSlot) : await planAttentionHistory(canonical, previous, at, hourSlot), job = `attention-history-${hour}-${hourSlot}`;
  const priorSignatures = targeted ? byTarget.get(targetAddress(plan)) ?? [] : seen;
  if (new TextEncoder().encode(JSON.stringify(plan)).length > 32000 || !await owned()) return held("history_plan_bytes_or_lease");
  const saved = await db.batch([
    db.prepare(`INSERT OR IGNORE INTO tenx_jobs(id,kind,state,started_at) SELECT ?1,'attention_history','running',?2 WHERE EXISTS(SELECT 1 FROM tenx_quality_control WHERE id=1 AND lease_owner=?3 AND lease_until>?2) AND EXISTS(SELECT 1 FROM tenx_control WHERE id=1 AND paused=0 AND (retry_after IS NULL OR retry_after<=?2))`).bind(job, at, owner),
    db.prepare(`INSERT OR IGNORE INTO tenx_attention_history_plans(id,address,utc_hour,hour_slot,turn,plan_hash,plan,created_at) SELECT ?1,?2,?3,?4,?5,?6,?7,?8 WHERE EXISTS(SELECT 1 FROM tenx_jobs WHERE id=?1 AND state='running' AND started_at=?8) AND EXISTS(SELECT 1 FROM tenx_quality_control WHERE id=1 AND lease_owner=?9 AND lease_until>?8)`).bind(job, row.address, hour, hourSlot, plan.turn, plan.plan_hash, JSON.stringify(plan), at, owner),
  ]);
  if (saved[0]!.meta.changes !== 1 || saved[1]!.meta.changes !== 1) { if (saved[0]!.meta.changes === 1) await db.prepare("UPDATE tenx_jobs SET state='failed',finished_at=?2,error_code='history_plan_not_retained' WHERE id=?1 AND state='running'").bind(job, clock().toISOString()).run(); return held("history_original_job_or_turn_spent"); }
  const guard = async () => { if (!await owned() || !await db.prepare("SELECT 1 FROM tenx_jobs j JOIN tenx_attention_history_plans p ON p.id=j.id WHERE j.id=?1 AND j.state='running' AND p.plan_hash=?2").bind(job, plan.plan_hash).first()) throw new SourceError("history_lease_day_or_pause"); };
  const transport = s.transport ?? fetch, rpc = new RpcClient(s.rpcUrl, async () => { await guard(); await quota(); await guard(); }, async (input, init) => { await guard(); return transport(input, init); }, 6);
  const reads: HistoryObservation[] = []; let retainedBytes = 0, receipt: HistoryReceipt | null = null, error: string | null = null;
  const retain = async (read: HistoryObservation) => { await guard(); const text = JSON.stringify(read), size = new TextEncoder().encode(text).length; if (retainedBytes + size > 1800000) throw Error("history_turn_bytes");
    const result = await db.prepare(`INSERT INTO tenx_attention_history_reads(plan_id,step,observation_hash,observation,observed_at) SELECT ?1,?2,?3,?4,?5 WHERE EXISTS(SELECT 1 FROM tenx_quality_control WHERE id=1 AND lease_owner=?6 AND lease_until>?5) AND EXISTS(SELECT 1 FROM tenx_control WHERE id=1 AND paused=0 AND (retry_after IS NULL OR retry_after<=?5)) AND EXISTS(SELECT 1 FROM tenx_jobs WHERE id=?1 AND state='running')`).bind(job, read.step, read.observation_hash, text, read.observed_at, owner).run();
    if (result.meta.changes !== 1) throw Error("history_observation_not_retained"); reads.push(read); retainedBytes += size; };
  try {
    await rpc.checkCluster(); const page = await rpc.signatures(targetAddress(plan), 1000, plan.before_signature ?? undefined);
    await retain(await historyObservation(0, pageRequest(plan), page, null, clock().toISOString()));
    const { selected } = selectHistoryBodies(plan, page, priorSignatures, clock().toISOString(), inspected);
    for (const [index, item] of selected.entries()) {
      let tx = null, bodyError: HistoryObservation["error"] = null;
      try { tx = await rpc.transaction(item.signature); if (!tx) bodyError = "archival_body_missing"; }
      catch (cause) { if (cause instanceof SourceError && (cause.code === "unsupported_transaction_version" || cause.code === "transaction_layout_unsupported")) bodyError = cause.code; else throw cause; }
      await retain(await historyObservation(index + 1, bodyRequest(item.signature), tx, bodyError, clock().toISOString()));
    }
    receipt = await reviewAttentionHistory(plan, canonical, previous, priorSignatures, reads, clock().toISOString(), inspected); const text = JSON.stringify(receipt);
    if (new TextEncoder().encode(text).length > 32000) throw Error("history_receipt_bytes"); await guard();
    const result = await db.prepare(`INSERT INTO tenx_attention_history_receipts(plan_id,receipt_hash,receipt,observed_at) SELECT ?1,?2,?3,?4 WHERE EXISTS(SELECT 1 FROM tenx_quality_control WHERE id=1 AND lease_owner=?5 AND lease_until>?4) AND EXISTS(SELECT 1 FROM tenx_control WHERE id=1 AND paused=0 AND (retry_after IS NULL OR retry_after<=?4)) AND EXISTS(SELECT 1 FROM tenx_jobs WHERE id=?1 AND state='running')`).bind(job, receipt.receipt_hash, text, receipt.observed_at, owner).run();
    if (result.meta.changes !== 1) throw Error("history_receipt_not_retained");
  } catch (cause) { receipt = null; error = cause instanceof SourceError ? cause.code : cause instanceof Error && /^[a-z0-9_]{1,100}$/.test(cause.message) ? cause.message : "history_data_unusable"; await persistRpcBackoff(db, cause, clock()); }
  await db.prepare("UPDATE tenx_jobs SET state=?2,finished_at=?3,rpc_calls=?4,processed=?5,error_code=?6 WHERE id=?1 AND state='running'").bind(job, error ? "failed" : "succeeded", clock().toISOString(), rpc.calls, receipt ? 1 : 0, error).run();
  return { state: error ? "failed" : "collected", job, address: row.address, rpc_calls: rpc.calls, error, receipt_saved: !!receipt,
    historical_creation_proven: receipt?.historical_creation_proven ?? false, historical_migration_proven: receipt?.historical_migration_proven ?? false,
    historical_pair_verified: receipt?.historical_pair_verified ?? false, candidate_admitted: false, scoring_effect: "none" };
}
