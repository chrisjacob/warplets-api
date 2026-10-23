import { DEFAULT_POLICY, type Candidate } from "./model";
import { candidates, control, reserveQuota, saveCandidate } from "./store";
import { RpcClient, SourceError, TransactionSchema, persistRpcBackoff, type Inventory, type Accounts } from "./rpc";
import { creationUser, migrations, verifyState, type Migration } from "./pump";
import { analyzeHolders, type HolderEvidence } from "./holders";
import { compareCollectionPotential, createdWithinWindow } from "./priority";
import type { Settings } from "./ingest";
import { collectCanonicalAttentionIntake } from "./canonical-attention-intake";

export type QualitySettings = Settings & { qualityEnabled: boolean; qualityDailyLimit: number };
export async function qualityStatus(db: D1Database, limit: number, enabled: boolean) {
  const state = await db.prepare("SELECT * FROM tenx_quality_control WHERE id=1").first();
  const usage = await db.prepare("SELECT used FROM tenx_quality_usage WHERE day=?1").bind(new Date().toISOString().slice(0, 10)).first<{ used: number }>();
  return { enabled, daily_limit: limit, daily_used: usage?.used ?? 0, ...state };
}
export function reserveQualityQuota(db: D1Database, s: QualitySettings, now: Date) {
  const reserve = reserveQuota(db, { rpc: s.rpcDailyLimit, market: s.marketDailyLimit }, now);
  return async () => {
    const used = await db.prepare("INSERT INTO tenx_quality_usage(day,used) VALUES(?1,1) ON CONFLICT(day) DO UPDATE SET used=used+1 WHERE used<?2 RETURNING used").bind(now.toISOString().slice(0, 10), s.qualityDailyLimit).first();
    if (!used) throw new SourceError("quality_daily_budget_exhausted", Math.max(60, Math.ceil((Date.parse(`${new Date(now.getTime() + 86400000).toISOString().slice(0, 10)}T00:00:00Z`) - now.getTime()) / 1000)));
    await reserve("rpc");
  };
}
type Target = { candidate: Candidate; migration: Migration; creator: string | null };
export async function runQualityCycle(s: QualitySettings, now = new Date()): Promise<Record<string, unknown>> {
  if (!s.qualityEnabled) return { state: "disabled" };
  const started = Date.now(), clock = () => new Date(now.getTime() + Date.now() - started);
  const db = s.db, at = now.toISOString(), initial = await control(db), owner = crypto.randomUUID();
  if (initial.paused) return { state: "paused" };
  if (initial.retry_after && initial.retry_after > at && initial.last_error?.startsWith("rpc_")) return { state: "waiting", reason: "shared_rpc_backoff" };
  const lease = await db.prepare(`UPDATE tenx_quality_control SET lease_owner=?1,lease_until=?2,next_refresh_at=?3 WHERE id=1 AND (lease_until IS NULL OR lease_until<?4) AND (next_refresh_at IS NULL OR next_refresh_at<=?4) RETURNING id`).bind(owner, new Date(now.getTime() + 360000).toISOString(), new Date(now.getTime() + 300000).toISOString(), at).first();
  if (!lease) return { state: "waiting" };
  const rpc = new RpcClient(s.rpcUrl, reserveQualityQuota(db, s, now), s.transport, 18);
  try {
    const focus = (await candidates(db)).filter(c => createdWithinWindow(c, now) && c.creation && c.graduation && c.verification !== "rejected" && (c.market?.liquidity_usd ?? 0) >= DEFAULT_POLICY.min_liquidity_usd && (c.market?.market_cap_usd == null || c.market.market_cap_usd >= DEFAULT_POLICY.min_market_cap_usd)).sort((a, b) => compareCollectionPotential(a, b, DEFAULT_POLICY, now)).slice(0, 10);
    const targets: Target[] = [];
    for (const candidate of focus) {
      const lead = await db.prepare("SELECT migration_tx FROM tenx_leads WHERE address=?1").bind(candidate.address).first<{ migration_tx: string }>();
      if (!lead) continue;
      const migration = (await migrations(TransactionSchema.parse(JSON.parse(lead.migration_tx)))).find(m => m.address === candidate.address && m.pool === candidate.pool);
      if (!migration) throw new Error("stored_migration_invalid");
      let creator = candidate.holders?.creator ?? null;
      if (!creator) {
        const origin = await db.prepare("SELECT payload FROM tenx_evidence WHERE signature=?1").bind(candidate.creation!.signature).first<{ payload: string }>();
        if (origin) creator = await creationUser(TransactionSchema.parse(JSON.parse(origin.payload)), candidate.address);
      }
      targets.push({ candidate, migration, creator });
    }
    if (!targets.length) {
      const intake = await collectCanonicalAttentionIntake(s, owner, rpc.maxCalls - rpc.calls, clock, reserveQualityQuota(db, s, now));
      rpc.calls += intake.rpc_calls;
      await db.prepare("UPDATE tenx_quality_control SET lease_owner=NULL,lease_until=NULL,targets=0 WHERE id=1 AND lease_owner=?1").bind(owner).run();
      return intake.state === "held" ? { state: "empty", rpc_calls: 0 } : { state: intake.state === "collected" ? "succeeded" : "failed", rpc_calls: rpc.calls, targets: 0, canonical_intake: intake };
    }
    await rpc.checkCluster();
    const accounts = await rpc.accounts(targets.flatMap(t => [t.candidate.address, t.candidate.pool, t.migration.baseVault, t.migration.quoteVault, t.migration.curve]), Math.max(...targets.map(t => t.candidate.graduation!.slot)));
    const valid: Target[] = [];
    for (let i = 0; i < targets.length; i++) {
      const t = targets[i]!, snapshot: Accounts = { context: accounts.context, value: accounts.value.slice(i * 5, i * 5 + 5) };
      try {
        const risk = await verifyState(t.migration, snapshot, at, t.candidate.graduation!.slot);
        t.candidate = { ...t.candidate, risk, checked_at: at, verification: "verified", verification_reasons: t.candidate.verification_reasons.filter(r => !["wrong_or_missing_account_owner", "state_verification_failed", "stale_account_context"].includes(r)) };
        await saveCandidate(db, t.candidate, [], snapshot); valid.push(t);
      } catch (error) {
        const reason = error instanceof Error && /^[a-z0-9_]{1,80}$/.test(error.message) ? error.message : "state_verification_failed";
        await saveCandidate(db, { ...t.candidate, verification: "provisional", verification_reasons: [...new Set([...t.candidate.verification_reasons, reason])].slice(0, 32), checked_at: at });
      }
      await db.prepare("INSERT INTO tenx_quality_attempts(address,state_at) VALUES(?1,?2) ON CONFLICT(address) DO UPDATE SET state_at=excluded.state_at").bind(t.candidate.address, at).run();
    }
    const attempts = await db.prepare("SELECT address,holder_at FROM tenx_quality_attempts").all<{ address: string; holder_at: string | null }>(), tried = new Map(attempts.results.map(r => [r.address, r.holder_at]));
    const due = valid.filter(t => !t.candidate.holders || now.getTime() - Date.parse(t.candidate.holders.observed_at) >= 20 * 60000).sort((a, b) => (tried.get(a.candidate.address) ?? "").localeCompare(tried.get(b.candidate.address) ?? "") || compareCollectionPotential(a.candidate, b.candidate, DEFAULT_POLICY, now));
    // Bootstrap missing inventories; steady state rotates two owners per five
    // minutes, using one shared mint read after the finalized inventories.
    const count = due.filter(t => !tried.get(t.candidate.address)).length >= 2 ? 8 : 2;
    const inventories: { target: Target; inventory: Inventory }[] = [];
    for (const t of due.slice(0, count)) {
      await db.prepare("INSERT INTO tenx_quality_attempts(address,holder_at) VALUES(?1,?2) ON CONFLICT(address) DO UPDATE SET holder_at=excluded.holder_at").bind(t.candidate.address, at).run();
      try { inventories.push({ target: t, inventory: await rpc.inventory(t.migration.baseProgram, t.candidate.address, accounts.context.slot) }); }
      catch (error) {
        if (error instanceof SourceError) throw error;
        await db.prepare("UPDATE tenx_quality_attempts SET holder_error='holder_inventory_unverified' WHERE address=?1").bind(t.candidate.address).run();
      }
    }
    let holders = 0;
    if (inventories.length) {
      const mintState = await rpc.accounts(inventories.map(t => t.target.candidate.address), Math.max(...inventories.map(t => t.inventory.context.slot)));
      for (let i = 0; i < inventories.length; i++) {
        const { target: t, inventory } = inventories[i]!;
        try {
          const evidence: HolderEvidence = { mint: t.candidate.address, pool: t.candidate.pool, program: t.migration.baseProgram, creator: t.creator, inventory, mint_state: { context: mintState.context, value: [mintState.value[i]!] } };
          const analysis = await analyzeHolders(evidence, at);
          await saveCandidate(db, { ...t.candidate, holders: analysis, risk: { ...t.candidate.risk, holder_concentration: analysis.status === "verified" ? "verified" : "partial" }, verification_reasons: t.candidate.verification_reasons.filter(r => !r.startsWith("holder_")) }, [], undefined, evidence);
          await db.prepare("UPDATE tenx_quality_attempts SET holder_error=NULL WHERE address=?1").bind(t.candidate.address).run(); holders++;
        } catch (error) {
          const reason = error instanceof Error && /^[a-z0-9_]{1,80}$/.test(error.message) ? error.message : "holder_inventory_unverified";
          await db.prepare("UPDATE tenx_quality_attempts SET holder_error=?1 WHERE address=?2").bind(reason, t.candidate.address).run();
        }
      }
    }
    const intake = await collectCanonicalAttentionIntake(s, owner, rpc.maxCalls - rpc.calls, clock, reserveQualityQuota(db, s, now));
    rpc.calls += intake.rpc_calls;
    await db.prepare("UPDATE tenx_quality_control SET lease_owner=NULL,lease_until=NULL,last_success=?1,last_error=NULL,targets=?2 WHERE id=1 AND lease_owner=?3").bind(at, valid.length, owner).run();
    return { state: "succeeded", targets: valid.length, holder_inventories: holders, rpc_calls: rpc.calls, ...(intake.state === "held" ? {} : { canonical_intake: intake }) };
  } catch (error) {
    await persistRpcBackoff(db, error, now);
    const code = error instanceof SourceError ? error.code : error instanceof Error && /^[a-z0-9_]{1,80}$/.test(error.message) ? error.message : "quality_evidence_invalid";
    const retry = error instanceof SourceError ? error.retryAfterSeconds : 300;
    await db.prepare("UPDATE tenx_quality_control SET lease_owner=NULL,lease_until=NULL,next_refresh_at=?1,last_error=?2 WHERE id=1 AND lease_owner=?3").bind(new Date(now.getTime() + retry * 1000).toISOString(), code, owner).run();
    return { state: "failed", error_code: code, rpc_calls: rpc.calls };
  }
}
