import { fundingRows, fundingTask, loadFundingCheckpoints, recoverCachedFunding, type FundingScan } from "./funding-history";
import type { Candidate } from "./model";
import { analyzeWalletEvidence, type WalletEvidence } from "./wallet-analysis";
import { keys, walletTransaction, WalletTransactionSchema, type WalletTransaction } from "./wallet-rpc";
import { validWalletTransaction } from "./wallet-trades";
import { hashJson } from "./solana";
import { RpcClient, SourceError } from "./rpc";
import { TRANSACTION_READER_VERSION } from "./inbox-recovery-model";
import { FUNDING_RECOVERY_DAILY_LIMIT, FUNDING_RECOVERY_PER_TURN, FundingRecoveryStatusSchema } from "./funding-recovery-model";

export type FundingRecovery = {
  signature: string; slot: number; blockTime: number; hop: "direct" | "second";
  wallet: string; anchor_key: string; checkpoint_hash: string;
};
const table = (hop: FundingRecovery["hop"]) => hop === "direct" ? "tenx_funding_scans" : "tenx_second_hop_scans";
const day = (now: Date) => `${now.toISOString().slice(0, 10)}T00:00:00.000Z`;
const irreparable = (scan: FundingScan) => fundingTask(scan).gaps.some(g => g !== "funding_transaction_missing_or_unsupported");

// Read-only admission estimate. Only otherwise complete, bounded windows merit
// format-upgrade reads. Missing archives, null bodies and oversized scans stay blocked.
async function fundingRecoveryPlan(db: D1Database, c: Candidate, prior: WalletEvidence, now: Date): Promise<{rows:FundingRecovery[];retainedBytes:number}> {
  const empty={rows:[],retainedBytes:0};
  if (prior.version !== "wallet-input-v4" || !prior.funding_scans?.length || prior.gaps.some(g => ["funding_wallet_limit", "funding_output_limit", "wallet_transaction_sample_limit"].includes(g))) return empty;
  const direct = await loadFundingCheckpoints(db, c.address, prior.funding_scans.map(s => s.anchor));
  const projected = await recoverCachedFunding(db, direct, now);
  // Do not spend on second-hop enrichment while an unrelated direct gate is
  // impossible to finish under the current evidence bounds.
  if (projected.scans.some(irreparable)) return empty;
  const second = await loadFundingCheckpoints(db, c.address, (prior.second_hop_scans ?? []).map(s => s.anchor), true);
  const secondProjected = await recoverCachedFunding(db, second, now);
  const groups = [{ hop: "direct" as const, original: direct, scans: projected.scans },
    { hop: "second" as const, original: second, scans: secondProjected.scans }];
  const used = await db.prepare("SELECT COUNT(*) AS n FROM tenx_funding_reads WHERE is_recovery=1 AND started_at>=?").bind(day(now)).first<{ n: number }>();
  const limit = Math.min(FUNDING_RECOVERY_PER_TURN, Math.max(0, FUNDING_RECOVERY_DAILY_LIMIT - (used?.n ?? 0)));
  if(!limit) return empty;
  const result: FundingRecovery[] = [];
  windows: for (const group of groups) for (const [i, scan] of group.scans.entries()) {
    if(group.hop==="second"&&projected.scans.some(s=>fundingTask(s).coverage.status!=="window_examined"))continue;
    if (irreparable(scan)) continue;
    for (const entry of scan.examined.filter(e => e.status === "unsupported")) {
      if (result.length >= limit) break windows;
      if (result.some(r => r.signature === entry.signature)) continue;
      if (prior.records.length + result.filter(r => !prior.records.some(p => p.signature === r.signature)).length + Number(!prior.records.some(r => r.signature === entry.signature)) > 64) continue;
      const seen = await db.prepare("SELECT 1 FROM tenx_funding_reads WHERE signature=? AND reader_version=?").bind(entry.signature, TRANSACTION_READER_VERSION).first();
      if (seen) continue;
      const row = fundingRows(scan).find(r => r.signature === entry.signature)!;
      const key=group.hop === "direct" ? scan.anchor.signature : `${scan.anchor.signature}:${scan.anchor.instruction_index}`;
      const saved=await db.prepare(`SELECT anchor_signature FROM ${table(group.hop)} WHERE address=? AND wallet=? AND anchor_signature IN (?,?) AND payload_hash=? ORDER BY CASE WHEN anchor_signature=? THEN 0 ELSE 1 END LIMIT 1`)
        .bind(c.address,scan.wallet,key,scan.anchor.signature,await hashJson(group.original[i]!),key).first<{anchor_signature:string}>();
      if(!saved) continue;
      result.push({ signature: entry.signature, slot: row.slot, blockTime: row.blockTime!, hop: group.hop, wallet: scan.wallet,
        anchor_key: saved.anchor_signature, checkpoint_hash: await hashJson(group.original[i]!) });
    }
  }
  let retainedBytes=0;
  if(result.length){
    // Replay every available retained body before scheduling a paid-in-quota
    // read. A marker, poisoned cache or stale second-hop anchor is not proof.
    const records=structuredClone(prior.records);
    for(const record of [...projected.records,...secondProjected.records]){
      const index=records.findIndex(r=>r.signature===record.signature);
      const replacement={...record,purposes:index<0?["wallet" as const]:records[index]!.purposes};
      if(index<0)records.push(replacement);else records[index]=replacement;
    }
    for(const group of groups)for(const scan of group.scans)for(const entry of scan.examined.filter(e=>e.status==="available")){
      let record=records.find(r=>r.signature===entry.signature&&r.status==="available");
      if(!record){
        const saved=await db.prepare("SELECT payload,payload_hash,fetched_at FROM tenx_wallet_transactions WHERE signature=?").bind(entry.signature).first<{payload:string;payload_hash:string;fetched_at:string}>();
        if(!saved)throw new Error("wallet_checkpoint_body_missing");
        if(new TextEncoder().encode(saved.payload).length>250000)throw new Error("wallet_transaction_too_large");
        const tx=WalletTransactionSchema.parse(JSON.parse(saved.payload));
        if(await hashJson(tx)!==saved.payload_hash)throw new Error("wallet_cache_hash_or_identity_mismatch");
        record={signature:entry.signature,status:"available",transaction:tx,fetched_at:saved.fetched_at,purposes:["wallet"]};
        const index=records.findIndex(r=>r.signature===entry.signature);if(index<0)records.push(record);else records[index]=record;
      }
      const row=fundingRows(scan).find(r=>r.signature===entry.signature)!;
      if(!record.transaction||record.transaction.transaction.signatures[0]!==entry.signature||record.transaction.slot!==row.slot||record.transaction.blockTime!==row.blockTime||!keys(record.transaction).includes(scan.wallet))throw new Error("funding_recovery_identity_mismatch");
      validWalletTransaction(record.transaction);
    }
    retainedBytes=records.reduce((n,r)=>n+new TextEncoder().encode(JSON.stringify(r.transaction)).length,0);
    if(records.length+result.filter(r=>!records.some(p=>p.signature===r.signature)).length>64||retainedBytes>900000)throw new Error("funding_recovery_sample_bound");
    await analyzeWalletEvidence({...prior,observed_at:now.toISOString(),records,funding_scans:projected.scans,second_hop_scans:secondProjected.scans});
  }
  return {rows:result,retainedBytes};
}
export async function fundingRecoveryCandidates(db:D1Database,c:Candidate,prior:WalletEvidence,now:Date):Promise<FundingRecovery[]> {
  return (await fundingRecoveryPlan(db,c,prior,now)).rows;
}

// Ordinary terminal reads tag the actual reader without altering evidence JSON
// or historical hashes. They are not upgrade-recovery allowance consumption.
export async function recordUnsupportedFundingRead(db: D1Database, signature: string, slot: number, outcome: string, now = new Date()) {
  await db.prepare(`INSERT OR IGNORE INTO tenx_funding_reads(signature,reader_version,expected_slot,is_recovery,started_at,finished_at,state,outcome)
    VALUES(?,?,?,0,?,?,'finished',?)`).bind(signature, TRANSACTION_READER_VERSION, slot, now.toISOString(), now.toISOString(), outcome).run();
}

export async function claimFundingRecovery(db: D1Database, c: Candidate, row: FundingRecovery, job: string, now: Date): Promise<boolean> {
  const at = now.toISOString();
  const saved = await db.prepare(`INSERT OR IGNORE INTO tenx_funding_reads(signature,reader_version,expected_slot,is_recovery,job_id,address,source_evidence_hash,hop,wallet,anchor_key,checkpoint_hash,started_at,state)
    SELECT ?1,?2,?3,1,?4,?5,?6,?7,?8,?9,?10,?11,'reading'
    WHERE EXISTS(SELECT 1 FROM ${table(row.hop)} s WHERE address=?5 AND wallet=?8 AND anchor_signature=?9 AND payload_hash=?10
      AND EXISTS(SELECT 1 FROM json_each(s.payload,'$.examined') WHERE json_extract(value,'$.signature')=?1 AND json_extract(value,'$.status')='unsupported')
      AND EXISTS(SELECT 1 FROM json_each(s.payload,'$.pages') p, json_each(p.value,'$.rows') b
        WHERE json_extract(b.value,'$.signature')=?1 AND json_extract(b.value,'$.slot')=?3 AND json_extract(b.value,'$.blockTime')=?15))
      AND EXISTS(SELECT 1 FROM tenx_wallet_control WHERE id=1 AND lease_owner=?4 AND lease_until>=?11)
      AND EXISTS(SELECT 1 FROM tenx_control WHERE id=1 AND paused=0 AND (retry_after IS NULL OR retry_after<=?11 OR last_error NOT LIKE 'rpc_%'))
      AND EXISTS(SELECT 1 FROM tenx_candidates WHERE address=?5 AND mode='live' AND json_extract(payload,'$.wallet_analysis.evidence_hash')=?6)
      AND NOT EXISTS(SELECT 1 FROM tenx_wallet_transactions WHERE signature=?1)
      AND (SELECT COUNT(*) FROM tenx_funding_reads WHERE is_recovery=1 AND started_at>=?12)<?13
      AND (SELECT COUNT(*) FROM tenx_funding_reads WHERE is_recovery=1 AND job_id=?4)<?14
    RETURNING signature`).bind(row.signature, TRANSACTION_READER_VERSION, row.slot, job, c.address, c.wallet_analysis!.evidence_hash, row.hop, row.wallet, row.anchor_key, row.checkpoint_hash, at, day(now), FUNDING_RECOVERY_DAILY_LIMIT, FUNDING_RECOVERY_PER_TURN,row.blockTime).first();
  return Boolean(saved);
}

export async function finishFundingRecovery(db: D1Database, row: FundingRecovery, job: string, outcome: string, tx: WalletTransaction | null, now: Date) {
  if(tx){
    validWalletTransaction(tx);
    if(outcome!=="available"||tx.transaction.signatures[0]!==row.signature||tx.slot!==row.slot||tx.blockTime!==row.blockTime||!keys(tx).includes(row.wallet)||tx.blockTime!*1000>now.getTime()) throw new Error("funding_recovery_identity_mismatch");
    if(new TextEncoder().encode(JSON.stringify(tx)).length>250000) throw new Error("wallet_transaction_too_large");
  }
  const at = now.toISOString(), hash = tx ? await hashJson(tx) : null;
  const admitted = `SELECT 1 FROM tenx_funding_reads r WHERE r.signature=?1 AND r.reader_version=?2 AND r.job_id=?3 AND r.state='reading'
    AND r.expected_slot=?7 AND r.hop=?8 AND r.wallet=?9 AND r.anchor_key=?10 AND r.checkpoint_hash=?11
    AND EXISTS(SELECT 1 FROM tenx_wallet_control WHERE id=1 AND lease_owner=?3 AND lease_until>=?4)
    AND EXISTS(SELECT 1 FROM tenx_control WHERE id=1 AND paused=0)
    AND EXISTS(SELECT 1 FROM ${table(row.hop)} s WHERE address=r.address AND wallet=r.wallet AND anchor_signature=r.anchor_key AND payload_hash=r.checkpoint_hash
      AND EXISTS(SELECT 1 FROM json_each(s.payload,'$.pages') p,json_each(p.value,'$.rows') b WHERE json_extract(b.value,'$.signature')=?1 AND json_extract(b.value,'$.slot')=?7 AND json_extract(b.value,'$.blockTime')=?12))
    AND EXISTS(SELECT 1 FROM tenx_candidates WHERE address=r.address AND mode='live' AND json_extract(payload,'$.wallet_analysis.evidence_hash')=r.source_evidence_hash)`;
  const statements: D1PreparedStatement[] = [];
  if (tx) statements.push(db.prepare(`INSERT OR IGNORE INTO tenx_wallet_transactions(signature,payload_hash,payload,fetched_at)
    SELECT ?1,?5,?6,?4 WHERE EXISTS(${admitted})`).bind(row.signature, TRANSACTION_READER_VERSION, job, at, hash, JSON.stringify(tx),row.slot,row.hop,row.wallet,row.anchor_key,row.checkpoint_hash,row.blockTime));
  statements.push(db.prepare(`UPDATE tenx_funding_reads SET state='finished',finished_at=?4,outcome=?5,payload_hash=?6
    WHERE signature=?1 AND reader_version=?2 AND job_id=?3 AND state='reading' AND EXISTS(${admitted})
    AND (?6 IS NULL OR EXISTS(SELECT 1 FROM tenx_wallet_transactions WHERE signature=?1 AND payload_hash=?6))`)
    .bind(row.signature, TRANSACTION_READER_VERSION, job, at, outcome, hash,row.slot,row.hop,row.wallet,row.anchor_key,row.checkpoint_hash,row.blockTime));
  const result = await db.batch(statements);
  return result.at(-1)!.meta.changes === 1;
}

// Called only inside the existing wallet lease/pacing/budget lane. Bodies enter
// the verified cache; checkpoint adoption and fresh snapshots occur separately.
export async function recoverFundingBodies(db: D1Database, c: Candidate, prior: WalletEvidence, rpc: RpcClient, job: string, now: Date) {
  const plan=await fundingRecoveryPlan(db,c,prior,now),rows=plan.rows;
  let attempted = 0, recovered = 0;
  if (!rows.length) return { attempted, recovered };
  await rpc.checkCluster();
  let bytes = plan.retainedBytes;
  for (const row of rows) {
    if (rpc.calls >= 18 || !await claimFundingRecovery(db, c, row, job, now)) continue;
    attempted++;
    try {
      const tx = await walletTransaction(rpc, row.signature);
      if (tx) {
        validWalletTransaction(tx);
        if (tx.slot !== row.slot || tx.blockTime !== row.blockTime || !keys(tx).includes(row.wallet) || tx.blockTime! * 1000 > now.getTime()) throw new Error("funding_recovery_identity_mismatch");
        const size = new TextEncoder().encode(JSON.stringify(tx)).length;
        if (size > 250000 || bytes + size > 900000) throw new Error("funding_recovery_sample_bound");
        bytes += size;
      }
      if (await finishFundingRecovery(db, row, job, tx ? "available" : "missing", tx, new Date())) recovered += Number(Boolean(tx));
    } catch (error) {
      const code = error instanceof SourceError ? error.code : error instanceof Error && /^[a-z0-9_]{1,80}$/.test(error.message) ? error.message : "funding_recovery_not_certified";
      await finishFundingRecovery(db, row, job, code, null, new Date());
      if (!(error instanceof SourceError) || !["unsupported_transaction_version", "wallet_transaction_layout_unsupported"].includes(code)) throw error;
    }
  }
  return { attempted, recovered };
}

export async function fundingRecoveryStatus(db: D1Database, now = new Date()) {
  const used = await db.prepare("SELECT COUNT(*) AS n FROM tenx_funding_reads WHERE is_recovery=1 AND started_at>=?").bind(day(now)).first<{ n: number }>();
  const recent = await db.prepare(`SELECT signature,address,hop,reader_version,expected_slot,started_at,finished_at,state,outcome,payload_hash
    FROM tenx_funding_reads WHERE is_recovery=1 ORDER BY started_at DESC,signature LIMIT 10`).all();
  return FundingRecoveryStatusSchema.parse({ reader_version: TRANSACTION_READER_VERSION, daily_limit: FUNDING_RECOVERY_DAILY_LIMIT, per_turn_limit: FUNDING_RECOVERY_PER_TURN,
    used_today: used?.n ?? 0, remaining_today: Math.max(0, FUNDING_RECOVERY_DAILY_LIMIT - (used?.n ?? 0)), recent: recent.results, provider_requests: 0, evidence_gates_changed: false });
}
