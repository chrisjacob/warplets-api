import { CandidateSchema, MarketSchema, type Candidate } from "./model";
import { dueLeads } from "./lead-queue";
import { ADAPTER_VERSION, creationProof, creationUser, graduationProof, migrationAuthority, migrations, PUMP, verifyState, WSOL, type Migration } from "./pump";
import { analyzeHolders, type HolderEvidence } from "./holders";
import { marketForPool } from "./market";
import { RpcClient, SourceError, TransactionSchema, type Transaction, type Accounts } from "./rpc";
import { acquire, candidates, control, reserveQuota, saveCandidate, type Lead } from "./store";
import { findPda, seed } from "./solana";
import { claimRecovery, finishRecovery, recordUnsupportedRead, recoveryCandidates, type InboxEntry } from "./inbox-recovery";
import { advanceMintReview } from "./mint-review";
import { assertHarvestAuthority, commitMigrationHarvest, migrationHarvestRequest, readHarvestCheckpoint, type MigrationHarvestResult } from "./migration-harvest";

export type Settings = {
  db: D1Database; rpcUrl: string; rpcDailyLimit: number; marketDailyLimit: number; marketEnabled: boolean;
  transport?: typeof fetch;
  paced?: boolean;
  batchedMarket?: boolean;
  marketProvider?: "geckoterminal" | "dexscreener";
  qualityEnabled?: boolean; qualityDailyLimit?: number;
  walletEnabled?: boolean; walletDailyLimit?: number;
};
export async function runCycle(settings: Settings, now = new Date()): Promise<Record<string, unknown>> {
  const started=Date.now(),clock=()=>new Date(now.getTime()+Date.now()-started);
  const db = settings.db, at = now.toISOString();
  const id = `refresh:${Math.floor(now.getTime() / 60_000)}`;
  const initial = await control(db);
  if (settings.paced && initial.next_refresh_at && initial.next_refresh_at > at) return { state: "waiting", next_refresh_at: initial.next_refresh_at };
  const prior = await db.prepare("SELECT id,state FROM tenx_jobs WHERE id=?1").bind(id).first();
  if (prior) return { state: "duplicate", job: prior };
  const reserve = reserveQuota(db, { rpc: settings.rpcDailyLimit, market: settings.marketDailyLimit }, now);
  const rpc = new RpcClient(settings.rpcUrl, reserve, settings.transport);
  if (!await acquire(db, id, at)) return { state: "skipped", reason: "paused_backoff_or_running" };
  const assertOwner=async()=>{if(!await db.prepare("SELECT id FROM tenx_control WHERE id=1 AND lease_owner=?1").bind(id).first())throw new SourceError("discovery_lease_lost");};
  let processed = 0, harvest: MigrationHarvestResult = { state: "not_due", exhaustive: false };
  const inspections = { selected_first: 0, selected_retry: 0, completed_first: 0, completed_retry: 0, deferred_by_cycle_budget: 0 };
  try {
    // A new lease owner can close abandoned refresh attempts after restart.
    // Their evidence remains retained; expiry is not a successful completion.
    await db.prepare("UPDATE tenx_jobs SET state='failed',finished_at=?1,error_code='lease_expired_without_completion' WHERE state='running' AND id<>?2 AND started_at<?3 AND EXISTS(SELECT 1 FROM tenx_control WHERE id=1 AND lease_owner=?2)").bind(at,id,new Date(now.getTime()-600000).toISOString()).run();
    await db.prepare("INSERT INTO tenx_jobs(id,kind,state,started_at) VALUES(?1,'refresh','running',?2)").bind(id, at).run();
    if (settings.paced) {
    const usage = await db.prepare("SELECT used FROM tenx_usage WHERE provider='rpc' AND day=?1").bind(at.slice(0, 10)).first<{ used: number }>();
    const quality = settings.qualityEnabled ? await db.prepare("SELECT used FROM tenx_quality_usage WHERE day=?1").bind(at.slice(0, 10)).first<{ used: number }>() : null;
    const wallets = settings.walletEnabled ? await db.prepare("SELECT used FROM tenx_wallet_usage WHERE day=?1").bind(at.slice(0, 10)).first<{ used: number }>() : null;
    const reserved = (settings.qualityEnabled ? Math.max(0, (settings.qualityDailyLimit ?? 0) - (quality?.used ?? 0)) : 0) + (settings.walletEnabled ? Math.max(0, (settings.walletDailyLimit ?? 0) - (wallets?.used ?? 0)) : 0);
    const remaining = settings.rpcDailyLimit - (usage?.used ?? 0) - reserved;
    if (remaining <= 0) {
      const next = `${new Date(now.getTime() + 86400000).toISOString().slice(0, 10)}T00:00:00.000Z`;
      await db.batch([
        db.prepare("UPDATE tenx_jobs SET state='skipped',finished_at=?1,error_code='rpc_budget_reserved_for_contenders' WHERE id=?2").bind(at, id),
        db.prepare("UPDATE tenx_control SET next_refresh_at=?1,lease_owner=NULL,lease_until=NULL WHERE id=1 AND lease_owner=?2").bind(next, id),
      ]);
      return { state: "waiting", reason: "rpc_budget_reserved_for_contenders", next_refresh_at: next };
    }
    const secondsLeft = (Date.parse(`${new Date(now.getTime() + 86400000).toISOString().slice(0, 10)}T00:00:00Z`) - now.getTime()) / 1000;
    // Reserve room for a worst-case 24-call cycle throughout the remaining day.
    const spacing = Math.min(secondsLeft + 60, Math.max(300, Math.min(3600, Math.ceil(secondsLeft * 24 / remaining))));
    await db.prepare("UPDATE tenx_control SET next_refresh_at=?1 WHERE id=1").bind(new Date(now.getTime() + spacing * 1000).toISOString()).run();
    }
    await rpc.checkCluster();
    await assertOwner();
    const state = await control(db);
    if (!state.last_harvest || now.getTime() - Date.parse(state.last_harvest) >= 300_000) {
      const checkpoint = readHarvestCheckpoint(state);
      if (!checkpoint) harvest = { state: "migration_required", exhaustive: false };
      else {
        const global = await findPda(PUMP, [seed("global")]);
        const globalAccount = (await rpc.accounts([global])).value[0];
        if (!globalAccount) throw new SourceError("pump_global_unavailable");
        const authority = await migrationAuthority(globalAccount);
        assertHarvestAuthority(checkpoint, authority);
        const request = migrationHarvestRequest(checkpoint);
        const rows = await rpc.signatures(authority, request.limit, request.before, request.until);
        await assertOwner();
        harvest = await commitMigrationHarvest(db, id, checkpoint, rows, clock(), authority);
      }
    }
    // Explicit refreshes must not turn an intake request into unpaced work.
    const mintReviewBodies=settings.paced?await advanceMintReview(db,rpc,id,clock):0;
    const recovery = await recoveryCandidates(db,now);
    const pending = await db.prepare("SELECT signature,slot,processed_at,result FROM tenx_pending_signatures WHERE processed_at IS NULL ORDER BY slot DESC LIMIT ?1").bind(6-recovery.length-mintReviewBodies).all<InboxEntry>();
    for (const row of [...pending.results,...recovery]) {
      const recovering=row.processed_at!==null;
      if(recovering&&!await claimRecovery(db,row,id,now))continue;
      let tx;
      try { tx = await rpc.transaction(row.signature); }
      catch (error) {
        if(recovering) {
          const code=error instanceof SourceError?error.code:"transaction_read_failed";
          await finishRecovery(db,row,id,code,null,new Date());
          if(error instanceof SourceError&&["unsupported_transaction_version","transaction_layout_unsupported"].includes(error.code))continue;
          throw error;
        }
        if (!(error instanceof SourceError) || !["unsupported_transaction_version", "transaction_layout_unsupported"].includes(error.code)) throw error;
        await assertOwner();
        await recordUnsupportedRead(db,row,id,error.code,now);
        continue;
      }
      await assertOwner();
      if (!tx) {
        if(recovering)await finishRecovery(db,row,id,"recovery_archival_missing",null,new Date());
        continue; // Ordinary archival misses retain their existing retry behavior.
      }
      if(recovering&&(tx.slot!==row.slot||tx.blockTime===null||tx.blockTime*1000>now.getTime())) {
        await finishRecovery(db,row,id,"recovery_transaction_identity_or_time_mismatch",null,new Date());
        throw new SourceError("recovery_transaction_identity_or_time_mismatch");
      }
      let outcome = "not_a_migration";
      try {
        for (const migration of await migrations(tx)) {
          if (migration.quote !== WSOL) { outcome = "unsupported_quote"; continue; }
          await db.prepare(`INSERT INTO tenx_leads(address,pool,migration_tx,migration_signature,first_seen_at)
            VALUES(?1,?2,?3,?4,?5) ON CONFLICT(address) DO NOTHING`)
            .bind(migration.address, migration.pool, JSON.stringify(tx), row.signature, at).run();
          outcome = "migration_verified";
        }
      } catch { outcome = "unsupported_or_invalid_transaction"; }
      if(recovering)await finishRecovery(db,row,id,outcome,tx,new Date());
      else await db.prepare("UPDATE tenx_pending_signatures SET processed_at=?1,result=?2 WHERE signature=?3").bind(at, outcome, row.signature).run();
    }
    const due = await dueLeads(db, at);
    inspections.selected_first = due.filter(lead => lead.checked_at === null).length;
    inspections.selected_retry = due.length - inspections.selected_first;
    for (let index = 0; index < due.length; index++) {
      const lead = due[index]!;
      if (rpc.calls > 14) { inspections.deferred_by_cycle_budget = due.length - index; break; } // Reserve the same worst-case nine calls.
      const tx = TransactionSchema.parse(JSON.parse(lead.migration_tx));
      const migration = (await migrations(tx)).find(m => m.address === lead.address && m.pool === lead.pool);
      if (!migration) throw new SourceError("stored_migration_invalid");
      const existing = (await candidates(db)).find(c => c.address === lead.address);
      let knownCreator = existing?.holders?.creator ?? null;
      if (!knownCreator && existing?.creation) {
        const saved = await db.prepare("SELECT payload FROM tenx_evidence WHERE signature=?1").bind(existing.creation.signature).first<{ payload: string }>();
        if (saved) knownCreator = await creationUser(TransactionSchema.parse(JSON.parse(saved.payload)), lead.address);
      }
      const result = await inspectLead(rpc, migration, tx, lead, existing, at, knownCreator);
      if (lead.market_payload) {
        const market = MarketSchema.parse(JSON.parse(lead.market_payload));
        if (!result.candidate.market || market.fetched_at > result.candidate.market.fetched_at) result.candidate.market = market;
      }
      let marketError: string | null = null;
      if (settings.marketEnabled && !settings.batchedMarket) {
        try { result.candidate.market = await marketForPool(lead.pool, lead.address, reserve, at, settings.transport); }
        catch (error) { marketError = error instanceof SourceError ? error.code : "market_schema_invalid"; }
      }
      if (marketError) result.candidate.verification_reasons.push(marketError);
      await assertOwner();
      await saveCandidate(db, result.candidate, result.transactions, result.state, result.holderEvidence);
      await db.prepare("UPDATE tenx_leads SET checked_at=?1,attempts=attempts+1,next_attempt_at=?2 WHERE address=?3")
        .bind(at, new Date(now.getTime() + (result.candidate.creation ? 300_000 : 900_000)).toISOString(), lead.address).run();
      processed++;
      if (lead.checked_at === null) inspections.completed_first++; else inspections.completed_retry++;
    }
    await assertOwner();
    await db.batch([
      db.prepare("UPDATE tenx_jobs SET state='succeeded',finished_at=?1,rpc_calls=?2,processed=?3 WHERE id=?4 AND state='running' AND EXISTS(SELECT 1 FROM tenx_control WHERE id=1 AND lease_owner=?4)").bind(new Date().toISOString(), rpc.calls, processed, id),
      db.prepare("UPDATE tenx_control SET last_success=?1,last_error=NULL,retry_after=NULL,lease_owner=NULL,lease_until=NULL WHERE id=1 AND lease_owner=?2").bind(at, id),
    ]);
    return { state: "succeeded", id, rpc_calls: rpc.calls, processed, harvest, inspections, adapter_version: ADAPTER_VERSION };
  } catch (error) {
    const code = error instanceof SourceError ? error.code : error instanceof Error && /^[a-z0-9_]{1,80}$/.test(error.message) ? error.message : "verification_or_schema_error";
    const retry = error instanceof SourceError ? error.retryAfterSeconds : 120;
    await db.batch([
      db.prepare("UPDATE tenx_jobs SET state='failed',finished_at=?1,rpc_calls=?2,processed=?3,error_code=?4 WHERE id=?5 AND state='running' AND EXISTS(SELECT 1 FROM tenx_control WHERE id=1 AND lease_owner=?5)").bind(new Date().toISOString(), rpc.calls, processed, code, id),
      db.prepare("UPDATE tenx_control SET last_error=?1,retry_after=?2,lease_owner=NULL,lease_until=NULL WHERE id=1 AND lease_owner=?3")
        .bind(code, new Date(now.getTime() + retry * 1000).toISOString(), id),
    ]);
    console.warn(JSON.stringify({ event: "tenx_cycle_failed", job: id, code, rpc_calls: rpc.calls,
      ...(error && typeof error === "object" && "issues" in error && Array.isArray(error.issues) ? { schema_paths: error.issues.slice(0, 5).map(issue => ({ path: issue.path, code: issue.code })) } : {}),
    }));
    return { state: "failed", id, error_code: code, rpc_calls: rpc.calls, inspections };
  }
}
async function inspectLead(rpc: RpcClient, migration: Migration, tx: Transaction, lead: Lead, existing: Candidate | undefined, at: string, knownCreator: string | null): Promise<{ candidate: Candidate; transactions: Transaction[]; state?: Accounts; holderEvidence?: HolderEvidence }> {
  const reasons: string[] = [];
  let creation = existing?.creation ?? null, name = existing?.name ?? "Unknown token", symbol = existing?.symbol ?? "OG";
  const transactions: Transaction[] = [tx];
  let creator = knownCreator;
  if (!creation) {
    let signatures = await rpc.signatures(migration.curve, 1000);
    for (let page = 1; page < 3 && signatures.length === 1000; page++) {
      const older = await rpc.signatures(migration.curve, 1000, signatures[signatures.length - 1]!.signature);
      if (older.length === 0) break;
      signatures = older;
    }
    // Bounded archival search. Missing history is provisional, never an age estimate.
    for (const row of signatures.filter(r => r.err === null && r.confirmationStatus === "finalized").slice(-3).reverse()) {
      let origin;
      try { origin = await rpc.transaction(row.signature); }
      catch (error) {
        if (!(error instanceof SourceError) || !["unsupported_transaction_version", "transaction_layout_unsupported"].includes(error.code)) throw error;
        reasons.push(error.code === "transaction_layout_unsupported" ? "creation_transaction_layout_unsupported" : "creation_transaction_version_unsupported"); continue;
      }
      if (!origin || origin.meta?.err !== null) continue;
      const result = await creationProof(origin, lead.address, at);
      if (result) { creation = result.proof; name = result.name; symbol = result.symbol; creator = await creationUser(origin, lead.address); transactions.push(origin); break; }
    }
    if (!creation) reasons.push(signatures.length === 1000 ? "creation_history_scan_limit" : "creation_history_unavailable");
  }
  let risk: Candidate["risk"] = {
    mint_authority: "unknown", freeze_authority: "unknown", token_program: migration.baseProgram,
    mint_extensions: [], holder_concentration: "unknown", pool_reserves_verified: false, observed_at: null,
    context_slot: null, payload_hash: null,
  };
  let rejected = false;
  let state: Accounts | undefined;
  try {
    state = await rpc.accounts([lead.address, lead.pool, migration.baseVault, migration.quoteVault, migration.curve], tx.slot);
    risk = await verifyState(migration, state, at, tx.slot);
  } catch (error) {
    if (error instanceof SourceError) throw error;
    // Account layout/unsupported extensions need adapter review, not an invented pass.
    reasons.push(error instanceof Error && /^[a-z0-9_]+$/.test(error.message) ? error.message : "state_verification_failed");
    rejected = reasons.some(reason => ["pool_identity_mismatch", "noncanonical_vault", "wrong_pool_discriminator", "invalid_or_empty_pool_vault"].includes(reason));
  }
  let holders = existing?.holders ?? null;
  let holderEvidence: HolderEvidence | undefined;
  if (risk.pool_reserves_verified) {
    try {
      const inventory = await rpc.inventory(migration.baseProgram, lead.address, tx.slot);
      const mintState = await rpc.accounts([lead.address], inventory.context.slot);
      holderEvidence = { mint: lead.address, pool: lead.pool, program: migration.baseProgram, creator, inventory, mint_state: mintState };
      holders = await analyzeHolders(holderEvidence, at);
      risk.holder_concentration = holders.status === "verified" ? "verified" : "partial";
    } catch (error) {
      holderEvidence = undefined;
      reasons.push(error instanceof SourceError ? error.code : "holder_inventory_unverified");
    }
  }
  const candidate = CandidateSchema.parse({
    chain: "solana", address: lead.address, pool: lead.pool, name, symbol, creation,
    graduation: await graduationProof(tx, migration, at),
    verification: rejected ? "rejected" : creation && risk.pool_reserves_verified ? "verified" : "provisional",
    verification_reasons: reasons, risk, holders, wallet_analysis: existing?.wallet_analysis ?? null, market: existing?.market ?? null,
    first_seen_at: lead.first_seen_at, checked_at: at, mode: "live",
  });
  return { candidate, transactions, state, holderEvidence };
}
