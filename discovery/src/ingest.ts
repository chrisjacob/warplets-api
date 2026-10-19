import { CandidateSchema, type Candidate } from "./model";
import { ADAPTER_VERSION, creationProof, creationUser, graduationProof, migrationAuthority, migrations, PUMP, verifyState, WSOL, type Migration } from "./pump";
import { analyzeHolders, type HolderEvidence } from "./holders";
import { marketForPool } from "./market";
import { RpcClient, SourceError, TransactionSchema, type Transaction, type Accounts } from "./rpc";
import { acquire, candidates, control, reserveQuota, saveCandidate, type Lead } from "./store";
import { findPda, seed } from "./solana";

export type Settings = {
  db: D1Database; rpcUrl: string; rpcDailyLimit: number; marketDailyLimit: number; marketEnabled: boolean;
  transport?: typeof fetch;
  paced?: boolean;
  batchedMarket?: boolean;
};
export async function runCycle(settings: Settings, now = new Date()): Promise<Record<string, unknown>> {
  const db = settings.db, at = now.toISOString();
  const id = `refresh:${Math.floor(now.getTime() / 60_000)}`;
  const initial = await control(db);
  if (settings.paced && initial.next_refresh_at && initial.next_refresh_at > at) return { state: "waiting", next_refresh_at: initial.next_refresh_at };
  const prior = await db.prepare("SELECT id,state FROM tenx_jobs WHERE id=?1").bind(id).first();
  if (prior) return { state: "duplicate", job: prior };
  const reserve = reserveQuota(db, { rpc: settings.rpcDailyLimit, market: settings.marketDailyLimit }, now);
  const rpc = new RpcClient(settings.rpcUrl, reserve, settings.transport);
  if (!await acquire(db, id, at)) return { state: "skipped", reason: "paused_backoff_or_running" };
  let processed = 0;
  try {
    await db.prepare("INSERT INTO tenx_jobs(id,kind,state,started_at) VALUES(?1,'refresh','running',?2)").bind(id, at).run();
    if (settings.paced) {
    const usage = await db.prepare("SELECT used FROM tenx_usage WHERE provider='rpc' AND day=?1").bind(at.slice(0, 10)).first<{ used: number }>();
    const remaining = Math.max(1, settings.rpcDailyLimit - (usage?.used ?? 0));
    const secondsLeft = (Date.parse(`${new Date(now.getTime() + 86400000).toISOString().slice(0, 10)}T00:00:00Z`) - now.getTime()) / 1000;
    // Reserve room for a worst-case 24-call cycle throughout the remaining day.
    const spacing = Math.min(secondsLeft + 60, Math.max(300, Math.min(3600, Math.ceil(secondsLeft * 24 / remaining))));
    await db.prepare("UPDATE tenx_control SET next_refresh_at=?1 WHERE id=1").bind(new Date(now.getTime() + spacing * 1000).toISOString()).run();
    }
    await rpc.checkCluster();
    const state = await control(db);
    if (!state.last_harvest || now.getTime() - Date.parse(state.last_harvest) >= 300_000) {
      const global = await findPda(PUMP, [seed("global")]);
      const globalAccount = (await rpc.accounts([global])).value[0];
      if (!globalAccount) throw new SourceError("pump_global_unavailable");
      const authority = await migrationAuthority(globalAccount);
      const rows = await rpc.signatures(authority, 30, undefined, state.migration_cursor ?? undefined);
      // Durable inbox: persist all observed signatures before moving the cursor.
      // A full page is still a declared upstream coverage gap (no exhaustive claim).
      await db.batch([
        ...rows.filter(row => row.err === null && row.confirmationStatus === "finalized").map(row =>
          db.prepare("INSERT OR IGNORE INTO tenx_pending_signatures(signature,slot,queued_at) VALUES(?1,?2,?3)").bind(row.signature, row.slot, at)),
        db.prepare("UPDATE tenx_control SET last_harvest=?1,migration_cursor=?2 WHERE id=1 AND lease_owner=?3")
          .bind(at, rows[0]?.signature ?? state.migration_cursor, id),
      ]);
    }
    const pending = await db.prepare("SELECT signature FROM tenx_pending_signatures WHERE processed_at IS NULL ORDER BY slot DESC LIMIT 6").all<{ signature: string }>();
    for (const row of pending.results) {
      let tx;
      try { tx = await rpc.transaction(row.signature); }
      catch (error) {
        if (!(error instanceof SourceError) || error.code !== "unsupported_transaction_version") throw error;
        await db.prepare("UPDATE tenx_pending_signatures SET processed_at=?1,result='unsupported_transaction_version' WHERE signature=?2").bind(at, row.signature).run();
        continue;
      }
      if (!tx) continue; // archival miss stays retryable
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
      await db.prepare("UPDATE tenx_pending_signatures SET processed_at=?1,result=?2 WHERE signature=?3").bind(at, outcome, row.signature).run();
    }
    const leads = await db.prepare(`SELECT * FROM tenx_leads WHERE next_attempt_at IS NULL OR next_attempt_at<=?1
      ORDER BY CASE WHEN checked_at IS NULL THEN 0 ELSE 1 END,checked_at LIMIT 1`).bind(at).all<Lead>();
    for (const lead of leads.results) {
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
      let marketError: string | null = null;
      if (settings.marketEnabled && !settings.batchedMarket) {
        try { result.candidate.market = await marketForPool(lead.pool, lead.address, reserve, at, settings.transport); }
        catch (error) { marketError = error instanceof SourceError ? error.code : "market_schema_invalid"; }
      }
      if (marketError) result.candidate.verification_reasons.push(marketError);
      await saveCandidate(db, result.candidate, result.transactions, result.state, result.holderEvidence);
      await db.prepare("UPDATE tenx_leads SET checked_at=?1,attempts=attempts+1,next_attempt_at=?2 WHERE address=?3")
        .bind(at, new Date(now.getTime() + (result.candidate.creation ? 300_000 : 900_000)).toISOString(), lead.address).run();
      processed++;
    }
    await db.batch([
      db.prepare("UPDATE tenx_jobs SET state='succeeded',finished_at=?1,rpc_calls=?2,processed=?3 WHERE id=?4").bind(new Date().toISOString(), rpc.calls, processed, id),
      db.prepare("UPDATE tenx_control SET last_success=?1,last_error=NULL,retry_after=NULL,lease_owner=NULL,lease_until=NULL WHERE id=1 AND lease_owner=?2").bind(at, id),
    ]);
    return { state: "succeeded", id, rpc_calls: rpc.calls, processed, adapter_version: ADAPTER_VERSION };
  } catch (error) {
    const code = error instanceof SourceError ? error.code : "verification_or_schema_error";
    const retry = error instanceof SourceError ? error.retryAfterSeconds : 120;
    await db.batch([
      db.prepare("UPDATE tenx_jobs SET state='failed',finished_at=?1,rpc_calls=?2,processed=?3,error_code=?4 WHERE id=?5").bind(new Date().toISOString(), rpc.calls, processed, code, id),
      db.prepare("UPDATE tenx_control SET last_error=?1,retry_after=?2,lease_owner=NULL,lease_until=NULL WHERE id=1 AND lease_owner=?3")
        .bind(code, new Date(now.getTime() + retry * 1000).toISOString(), id),
    ]);
    console.warn(JSON.stringify({ event: "tenx_cycle_failed", job: id, code, rpc_calls: rpc.calls }));
    return { state: "failed", id, error_code: code, rpc_calls: rpc.calls };
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
        if (!(error instanceof SourceError) || error.code !== "unsupported_transaction_version") throw error;
        reasons.push("creation_transaction_version_unsupported"); continue;
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
    verification_reasons: reasons, risk, holders, market: existing?.market ?? null,
    first_seen_at: lead.first_seen_at, checked_at: at, mode: "live",
  });
  return { candidate, transactions, state, holderEvidence };
}
