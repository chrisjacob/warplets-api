import { z } from "zod";
import { readAttentionQueue } from "./attention-queue";
import { AttentionQueue } from "./attention-queue-model";
import { Address, CandidateSchema } from "./model";
import { ATA, TOKEN, TOKEN_2022, WSOL, canonicalPool, curveAddress, verifyState, type CanonicalPoolStateIdentity } from "./pump";
import { AccountsSchema, RpcClient, SourceError, persistRpcBackoff } from "./rpc";
import { hashJson, findPda, publicKey } from "./solana";
import type { QualitySettings } from "./quality-cycle";
import { TARGETED_HISTORY_POLICY } from "./attention-history-targeting";

export const CANONICAL_ATTENTION_POLICY = {
  version: "canonical-attention-intake-v1", scope: "current_pump_wsol_pool_state_only",
  reported_min_age_seconds: 86400, rpc_calls_max: 2, intakes_per_utc_hour: 1,
  plan_bytes_max: 32000, receipt_bytes_max: 1800000,
  selection: "first_fresh_nonadverse_reported_older_solana_with_market_pool_not_previously_attempted",
  historical_creation_proven: false, historical_migration_proven: false, scoring_effect: "none",
} as const;
export const TARGETED_CANONICAL_POLICY = {
  ...CANONICAL_ATTENTION_POLICY, version: "canonical-attention-intake-v2",
  future_history_policy: TARGETED_HISTORY_POLICY.version,
} as const;
export async function planCanonicalAttentionIntake(raw: unknown, attempted: string[]) {
  const queue = AttentionQueue.parse(raw), at = Date.parse(queue.as_of), prior = new Set(z.array(Address).max(100).parse(attempted));
  const selected = queue.rows.find(row => row.chain === "solana" && row.checks === "review" && row.attention_families > 0 && row.market_crosschecked &&
    row.pool !== null && row.reported_open_seconds !== null && row.reported_open_seconds > 0 && at / 1000 - row.reported_open_seconds >= 86400 && !prior.has(row.address));
  if (!selected) return null;
  const expected = await canonicalPool(selected.address, WSOL), curve = await curveAddress(selected.address);
  const body = { version: CANONICAL_ATTENTION_POLICY.version, scope: CANONICAL_ATTENTION_POLICY.scope, cutoff_at: queue.as_of,
    address: selected.address, canonical_pool: expected.pool, curve, market_pool_hint: selected.pool,
    original_position: queue.rows.indexOf(selected) + 1, source_queue_hash: await hashJson(queue), selected_row: selected,
    policy_hash: await hashJson(CANONICAL_ATTENTION_POLICY), historical_creation_proven: false, historical_migration_proven: false,
    candidate_admitted: false, scoring_effect: "none", evidence_gates_changed: false } as const;
  return { ...body, plan_hash: await hashJson(body) };
}
export async function planTargetedCanonicalIntake(raw: unknown, attempted: string[]) {
  const legacy = await planCanonicalAttentionIntake(raw, attempted);
  if (!legacy) return null;
  const { plan_hash: _hash, ...original } = legacy;
  const body = { ...original, version: TARGETED_CANONICAL_POLICY.version,
    policy_hash: await hashJson(TARGETED_CANONICAL_POLICY), history_targeting_policy_hash: await hashJson(TARGETED_HISTORY_POLICY) } as const;
  return { ...body, plan_hash: await hashJson(body) };
}
type Plan = NonNullable<Awaited<ReturnType<typeof planCanonicalAttentionIntake>>> | NonNullable<Awaited<ReturnType<typeof planTargetedCanonicalIntake>>>;
export async function canonicalIntakeAddresses(plan: Pick<Plan, "address" | "canonical_pool" | "curve">) {
  const vault = (program: string, mint: string) => findPda(ATA, [publicKey(plan.canonical_pool), publicKey(program), publicKey(mint)]);
  return [plan.address, plan.canonical_pool, plan.curve, await vault(TOKEN, plan.address), await vault(TOKEN_2022, plan.address), await vault(TOKEN, WSOL)];
}
export async function reviewCanonicalAttentionState(plan: Plan, raw: unknown, observedAt: string) {
  const { plan_hash, ...original } = plan;
  const policy = plan.version === TARGETED_CANONICAL_POLICY.version ? TARGETED_CANONICAL_POLICY : plan.version === CANONICAL_ATTENTION_POLICY.version ? CANONICAL_ATTENTION_POLICY : null;
  if (!policy || plan.version === TARGETED_CANONICAL_POLICY.version && plan.history_targeting_policy_hash !== await hashJson(TARGETED_HISTORY_POLICY)) throw Error("canonical_intake_policy_mismatch");
  if (await hashJson(original) !== plan_hash || plan.policy_hash !== await hashJson(policy) ||
    (await canonicalPool(plan.address, WSOL)).pool !== plan.canonical_pool || await curveAddress(plan.address) !== plan.curve) throw Error("canonical_intake_plan_mismatch");
  if (Date.parse(observedAt) < Date.parse(plan.cutoff_at)) throw Error("canonical_intake_observation_time");
  const accounts = AccountsSchema.parse(raw), addresses = await canonicalIntakeAddresses(plan);
  if (accounts.value.length !== 6 || accounts.context.slot <= 0) throw Error("canonical_intake_account_count_or_slot");
  if (plan.market_pool_hint !== plan.canonical_pool) throw Error("canonical_intake_market_pool_mismatch");
  const program = accounts.value[0]?.owner;
  if (program !== TOKEN && program !== TOKEN_2022) throw Error("canonical_intake_mint_program");
  const identity: CanonicalPoolStateIdentity = { address: plan.address, pool: plan.canonical_pool, curve: plan.curve, quote: WSOL,
    baseVault: addresses[program === TOKEN ? 3 : 4]!, quoteVault: addresses[5]!, baseProgram: program };
  const selected = { context: accounts.context, value: [accounts.value[0]!, accounts.value[1]!, accounts.value[program === TOKEN ? 3 : 4]!, accounts.value[5]!, accounts.value[2]!] };
  const risk = CandidateSchema.shape.risk.parse(await verifyState(identity, selected, observedAt, accounts.context.slot));
  const body = { version: "canonical-attention-receipt-v1", plan_hash: plan.plan_hash, address: plan.address, observed_at: observedAt,
    account_addresses: addresses, accounts, identity, risk, current_pool_verified: true,
    authority_checks: risk.mint_authority === "revoked" && risk.freeze_authority === "revoked" ? "revoked" : "adverse",
    historical_creation_proven: false, historical_migration_proven: false, holder_quality: "unknown", market_data_bound_to_pool: false,
    candidate_admitted: false, scoring_effect: "none", evidence_gates_changed: false } as const;
  return { ...body, receipt_hash: await hashJson(body) };
}

// Runs only inside an already owned ordinary quality lease and its remaining
// 18-call cycle budget. Separate immutable journal; never writes a candidate.
export async function collectCanonicalAttentionIntake(s: QualitySettings, owner: string, remainingCalls: number, clock: () => Date, quota: () => Promise<void>) {
  const db = s.db, now = clock(), at = now.toISOString(), day = at.slice(0, 10), hour = at.slice(0, 13), job = `canonical-intake-${hour}`;
  const held = (reason: string) => ({ state: "held", reason, rpc_calls: 0, scoring_effect: "none" });
  if (!s.qualityEnabled || s.qualityDailyLimit <= 0 || s.rpcDailyLimit <= 0 || remainingCalls < 2) return held("quality_disabled_or_cycle_budget");
  if (!await db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='tenx_canonical_intakes'").first()) return held("canonical_intake_migration_required");
  if (await db.prepare("SELECT 1 FROM tenx_jobs WHERE id=?1").bind(job).first()) return held("canonical_intake_hour_spent");
  const owned = async () => {
    const current = clock().toISOString();
    if (current.slice(0, 10) !== day || Date.parse(current) - now.getTime() > 120000) return false;
    return !!await db.prepare(`SELECT 1 FROM tenx_quality_control WHERE id=1 AND lease_owner=?1 AND lease_until>?2
      AND EXISTS(SELECT 1 FROM tenx_control WHERE id=1 AND paused=0 AND (retry_after IS NULL OR retry_after<=?2))`).bind(owner, current).first();
  };
  if (!await owned()) return held("quality_lease_pause_or_backoff");
  const queue = await readAttentionQueue(db, now, "review"), wanted = queue.rows.filter(r => r.chain === "solana").map(r => r.address);
  const previous = await db.prepare("SELECT address FROM tenx_canonical_intakes WHERE address IN (SELECT value FROM json_each(?1)) LIMIT 100").bind(JSON.stringify(wanted)).all<{ address: string }>();
  const plan = await planTargetedCanonicalIntake(queue, previous.results.map(r => r.address));
  if (!plan) return held("no_unattempted_reported_older_canonical_research_lead");
  const serialized = JSON.stringify(plan); if (new TextEncoder().encode(serialized).length > 32000) return held("canonical_intake_plan_bytes");
  if (!await owned()) return held("quality_lease_pause_or_backoff");
  const saved = await db.batch([
    db.prepare(`INSERT OR IGNORE INTO tenx_jobs(id,kind,state,started_at) SELECT ?1,'canonical_attention_intake','running',?2
      WHERE EXISTS(SELECT 1 FROM tenx_quality_control WHERE id=1 AND lease_owner=?3 AND lease_until>?2)
      AND EXISTS(SELECT 1 FROM tenx_control WHERE id=1 AND paused=0 AND (retry_after IS NULL OR retry_after<=?2))`).bind(job, at, owner),
    db.prepare(`INSERT OR IGNORE INTO tenx_canonical_intakes(address,utc_hour,job_id,plan_hash,plan,created_at)
      SELECT ?1,?2,?3,?4,?5,?6 WHERE EXISTS(SELECT 1 FROM tenx_jobs WHERE id=?3 AND state='running' AND started_at=?6)
      AND EXISTS(SELECT 1 FROM tenx_quality_control WHERE id=1 AND lease_owner=?7 AND lease_until>?6)`)
      .bind(plan.address, hour, job, plan.plan_hash, serialized, at, owner),
  ]);
  if (saved[0]!.meta.changes !== 1 || saved[1]!.meta.changes !== 1) {
    if (saved[0]!.meta.changes === 1) await db.prepare("UPDATE tenx_jobs SET state='failed',finished_at=?2,error_code='canonical_intake_plan_not_retained' WHERE id=?1 AND state='running'").bind(job, clock().toISOString()).run();
    return held("canonical_intake_original_job_or_mint_spent");
  }
  const transport = s.transport ?? fetch;
  const guard = async () => {
    if (!await owned() || !await db.prepare("SELECT 1 FROM tenx_jobs j JOIN tenx_canonical_intakes p ON p.job_id=j.id WHERE j.id=?1 AND j.state='running' AND p.plan_hash=?2").bind(job, plan.plan_hash).first()) throw new SourceError("canonical_intake_lease_day_or_pause");
  };
  const rpc = new RpcClient(s.rpcUrl, async () => { await guard(); await quota(); await guard(); }, async (input, init) => { await guard(); return transport(input, init); }, 2);
  let error: string | null = null, stored = 0;
  try {
    if (plan.market_pool_hint !== plan.canonical_pool) throw Error("canonical_intake_market_pool_mismatch");
    await rpc.checkCluster(); const accounts = await rpc.accounts(await canonicalIntakeAddresses(plan)); await guard();
    const receipt = await reviewCanonicalAttentionState(plan, accounts, clock().toISOString()), body = JSON.stringify(receipt);
    if (new TextEncoder().encode(body).length > 1800000) throw Error("canonical_intake_receipt_bytes");
    await guard();
    const result = await db.prepare(`INSERT INTO tenx_canonical_intake_receipts(address,receipt_hash,receipt,observed_at)
      SELECT ?1,?2,?3,?4 WHERE EXISTS(SELECT 1 FROM tenx_quality_control WHERE id=1 AND lease_owner=?5 AND lease_until>?4)
      AND EXISTS(SELECT 1 FROM tenx_control WHERE id=1 AND paused=0 AND (retry_after IS NULL OR retry_after<=?4))
      AND EXISTS(SELECT 1 FROM tenx_jobs WHERE id=?6 AND state='running')`).bind(plan.address, receipt.receipt_hash, body, clock().toISOString(), owner, job).run();
    if (result.meta.changes !== 1) throw Error("canonical_intake_receipt_not_retained"); stored = 1;
  } catch (cause) { error = cause instanceof SourceError ? cause.code : cause instanceof Error && /^[a-z0-9_]{1,100}$/.test(cause.message) ? cause.message : "canonical_intake_state_unusable"; await persistRpcBackoff(db, cause, clock()); }
  await db.prepare("UPDATE tenx_jobs SET state=?2,finished_at=?3,rpc_calls=?4,processed=?5,error_code=?6 WHERE id=?1 AND state='running'")
    .bind(job, error ? "failed" : "succeeded", clock().toISOString(), rpc.calls, stored, error).run();
  return { state: error ? "failed" : "collected", job, address: plan.address, rpc_calls: rpc.calls, receipt_saved: stored === 1, error,
    historical_creation_proven: false, historical_migration_proven: false, candidate_admitted: false, scoring_effect: "none" };
}
