import type { Candidate } from "./model";
import { analyzeWalletEvidence, WalletEvidenceSchema, type WalletEvidence } from "./wallet-analysis";
import { hashJson } from "./solana";
import { collectFundingHistories, fundingTask, FundingScanSchema, type FundingAnchor } from "./funding-history";
import { walletTransaction, WalletTransactionSchema } from "./wallet-rpc";
import { RpcClient, SourceError } from "./rpc";
import { WalletWorkSchema, type WalletWork } from "./wallet-work-model";
import { candidates } from "./store";
import { creationRoles, verifiedTrades } from "./wallet-trades";
import { fundingSourceLimited } from "./priority";

export const catchupLimit = (dailyLimit: number) => Math.min(180, Math.floor(dailyLimit / 4 / 18) * 18);
export async function priorWalletEvidence(db: D1Database, candidate: Candidate): Promise<WalletEvidence | null> {
  const w = candidate.wallet_analysis; if (!w) return null;
  const row = await db.prepare("SELECT payload FROM tenx_wallet_evidence WHERE payload_hash=?1 AND address=?2").bind(w.evidence_hash, candidate.address).first<{ payload: string }>();
  if (!row) throw new Error("wallet_evidence_cache_missing");
  const prior = WalletEvidenceSchema.parse(JSON.parse(row.payload));
  if (await hashJson(prior) !== w.evidence_hash) throw new Error("wallet_evidence_cache_hash_mismatch");
  if (prior.asset.address !== candidate.address || prior.asset.pool !== candidate.pool || prior.asset.creation?.payload_hash !== candidate.creation?.payload_hash || prior.asset.creation?.signature !== candidate.creation?.signature) throw new Error("wallet_evidence_cache_asset_mismatch");
  if (await hashJson(await analyzeWalletEvidence(prior)) !== await hashJson(w)) throw new Error("wallet_analysis_cache_replay_mismatch");
  return prior;
}
export async function walletWork(db: D1Database): Promise<WalletWork[]> {
  const rows = await db.prepare("SELECT w.payload FROM tenx_wallet_work w JOIN tenx_candidates c ON c.address=w.address AND c.mode='live' WHERE w.source_evidence_hash=json_extract(c.payload,'$.wallet_analysis.evidence_hash') ORDER BY w.attempted_at DESC LIMIT 20").all<{payload:string}>();
  return rows.results.map(r => { const work=WalletWorkSchema.parse(JSON.parse(r.payload)); return fundingSourceLimited(work.gaps)?{...work,stage:"source_limited" as const}:work; });
}
export const canContinueFunding = (c: Candidate, work?: WalletWork) => c.wallet_analysis?.version === "wallet-signals-v4" && !c.wallet_analysis.funding_coverage?.some(f=>fundingSourceLimited(f.gaps)) && (work ? work.stage === "direct_funding" : Boolean(c.wallet_analysis?.funding_coverage?.some(f => f.gaps.some(g => ["funding_paging_pending", "funding_transactions_pending"].includes(g)))));

// Reinterpret cached legacy evidence with the already-certified v4 decoder.
// This is not a new source observation: all original timestamps survive.
export async function replayLegacyWallets(db: D1Database): Promise<Record<string, unknown>> {
  const upgraded: { address: string; buyers_before: number; buyers_after: number; observed_at: string }[] = [], errors: { address: string; code: string }[] = [];
  for (const c of (await candidates(db)).filter(c => c.wallet_analysis && c.wallet_analysis.version !== "wallet-signals-v4").slice(0, 10)) {
    try {
      const prior = (await priorWalletEvidence(db,c))!, records = structuredClone(prior.records);
      const trades = (await Promise.all(records.flatMap(r => r.transaction ? [r.transaction] : []).map(async tx => { try { return (await verifiedTrades(tx,c.address,c.pool,{temporaryWsol:true})).trades; } catch { return []; } }))).flat().sort((a,b)=>a.slot-b.slot || a.signature.localeCompare(b.signature));
      const origin=records.find(r=>r.signature===c.creation?.signature)?.transaction, roles=origin?await creationRoles(origin,c.address):[], anchors: FundingAnchor[]=[];
      if(c.creation)for(const role of roles.filter(r=>r.signed))if(!anchors.some(a=>a.wallet===role.wallet))anchors.push({wallet:role.wallet,signature:c.creation.signature,slot:c.creation.slot,block_time:c.creation.block_time,kind:"signed_creation"});
      for(const trade of trades.filter(t=>t.side==="buy"))if(!anchors.some(a=>a.wallet===trade.wallet))anchors.push({wallet:trade.wallet,signature:trade.signature,slot:trade.slot,block_time:trade.block_time,kind:"sampled_buy"});
      // No provider call is possible on this path, including checkpoint loading.
      const offline = new RpcClient("https://offline.invalid",async()=>{throw new Error("offline_replay_network_forbidden");},async()=>{throw new Error("offline_replay_network_forbidden");},0);
      const scans=await collectFundingHistories(db,offline,c.address,anchors,async(signature,slot,status)=>{
        const old=records.find(r=>r.signature===signature);if(old)return old;
        const cached=await db.prepare("SELECT payload,payload_hash,fetched_at FROM tenx_wallet_transactions WHERE signature=?1").bind(signature).first<{payload:string;payload_hash:string;fetched_at:string}>();
        if(!cached)return status?{transaction:null,status}:null;
        const tx=WalletTransactionSchema.parse(JSON.parse(cached.payload));if(await hashJson(tx)!==cached.payload_hash||tx.slot!==slot)throw new Error("wallet_cache_hash_mismatch");
        // Future checkpoint reads do not belong to the historical observation.
        if(Date.parse(cached.fetched_at)>Date.parse(prior.observed_at))return null;
        if(records.length>=64)throw new Error("wallet_transaction_sample_limit");
        const record={signature,status:"available" as const,transaction:tx,fetched_at:cached.fetched_at,purposes:["wallet" as const]};records.push(record);return record;
      },{rpcCeiling:0});
      // Historical replay must not adopt checkpoints collected after its cutoff.
      const historical=scans.map(scan=>{
        const pages=scan.pages.filter(p=>Date.parse(p.fetched_at)<=Date.parse(prior.observed_at));
        return FundingScanSchema.parse({ ...scan, pages, examined:scan.examined.filter(e=>pages.some(p=>p.rows.some(r=>r.signature===e.signature))&&records.some(r=>r.signature===e.signature)), attempted_at:prior.observed_at });
      });
      const input=WalletEvidenceSchema.parse({...prior,version:"wallet-input-v4",records,funding_scans:historical,second_hop_scans:prior.second_hop_scans??[],gaps:[...new Set(prior.gaps.concat(anchors.length>8?["funding_wallet_limit"]:[]))]});
      const analysis=await analyzeWalletEvidence(input), payload=JSON.stringify(input);
      if(new TextEncoder().encode(payload).length>1800000)throw new Error("wallet_evidence_size_limit");
      const statements=[
        db.prepare("INSERT OR IGNORE INTO tenx_wallet_evidence(payload_hash,address,payload,observed_at) VALUES(?1,?2,?3,?4)").bind(analysis.evidence_hash,c.address,payload,analysis.observed_at),
        db.prepare("UPDATE tenx_candidates SET payload=json_set(payload,'$.wallet_analysis',json(?1)) WHERE address=?2 AND mode='live' AND json_extract(payload,'$.wallet_analysis.evidence_hash')=?3").bind(JSON.stringify(analysis),c.address,c.wallet_analysis!.evidence_hash),
        db.prepare("DELETE FROM tenx_wallet_work WHERE address=?1 AND source_evidence_hash=?2").bind(c.address,c.wallet_analysis!.evidence_hash),
      ];
      for(const wallet of analysis.wallets)statements.push(db.prepare("INSERT INTO tenx_wallet_profiles(address,wallet,payload_hash,payload,observed_at) SELECT ?1,?2,?3,?4,?5 WHERE EXISTS(SELECT 1 FROM tenx_candidates WHERE address=?1 AND mode='live' AND json_extract(payload,'$.wallet_analysis.evidence_hash')=?3) ON CONFLICT(address,wallet) DO UPDATE SET payload_hash=excluded.payload_hash,payload=excluded.payload,observed_at=excluded.observed_at").bind(c.address,wallet.wallet,analysis.evidence_hash,JSON.stringify(wallet),analysis.observed_at));
      const saved=await db.batch(statements);
      if(saved[1]!.meta.changes!==1){errors.push({address:c.address,code:"wallet_snapshot_changed_during_replay"});continue;}
      upgraded.push({address:c.address,buyers_before:c.wallet_analysis!.metrics.distinct_buyers,buyers_after:analysis.metrics.distinct_buyers,observed_at:analysis.observed_at});
    }catch(e){errors.push({address:c.address,code:e instanceof Error&&/^[a-z0-9_]{1,80}$/.test(e.message)?e.message:"cached_replay_not_certified"});}
  }
  return {provider_requests:0,upgraded,errors};
}

// Advances checkpoints only. No candidate timestamp, eligibility snapshot,
// research baseline or wallet profile is updated by a continuation.
export async function continueFunding(db: D1Database, candidate: Candidate, rpc: RpcClient): Promise<WalletWork> {
  const prior = await priorWalletEvidence(db, candidate);
  if (!prior?.funding_scans?.length) throw new Error("funding_continuation_unavailable");
  const records = structuredClone(prior.records), gaps = new Set(prior.gaps);
  let bytes = records.reduce((n, r) => n + new TextEncoder().encode(JSON.stringify(r.transaction)).length, 0);
  await rpc.checkCluster();
  const read = async (signature: string, slot: number, status?: "missing" | "unsupported") => {
    const existing = records.find(r => r.signature === signature); if (existing?.status==="available") return existing;
    if (!existing&&records.length >= 64) { gaps.add("wallet_transaction_sample_limit"); return null; }
    const cached = await db.prepare("SELECT payload,payload_hash,fetched_at FROM tenx_wallet_transactions WHERE signature=?1").bind(signature).first<{payload:string;payload_hash:string;fetched_at:string}>();
    if(!cached&&existing)return existing;
    if (status&&!cached) { const record = { signature, status, transaction: null, purposes: ["wallet" as const], fetched_at: new Date().toISOString() }; records.push(record); return record; }
    if (!cached && rpc.calls >= 18) return null;
    let transaction;
    try { transaction = cached ? WalletTransactionSchema.parse(JSON.parse(cached.payload)) : await walletTransaction(rpc, signature); }
    catch (error) {
      // A terminal source/layout gap must be retained in this exact window,
      // rather than failing the turn and purchasing the same body repeatedly.
      // Corrupt caches, mismatched signatures/slots and transient RPC errors
      // still fail closed and keep their existing backoff behavior.
      if (!cached && error instanceof SourceError && ["unsupported_transaction_version", "wallet_transaction_layout_unsupported"].includes(error.code)) {
        const record = { signature, status: "unsupported" as const, transaction: null, purposes: ["wallet" as const], fetched_at: new Date().toISOString() };
        records.push(record); return record;
      }
      throw error;
    }
    if (transaction && (transaction.slot !== slot || transaction.transaction.signatures[0] !== signature)) throw new Error("wallet_signature_slot_mismatch");
    if (transaction && cached && await hashJson(transaction) !== cached.payload_hash) throw new Error("wallet_cache_hash_mismatch");
    const payload = JSON.stringify(transaction), size = new TextEncoder().encode(payload).length, fetched = cached?.fetched_at ?? new Date().toISOString();
    if (size > 250000) throw new Error("wallet_transaction_too_large");
    if (transaction && !cached) await db.prepare("INSERT OR IGNORE INTO tenx_wallet_transactions(signature,payload_hash,payload,fetched_at) VALUES(?1,?2,?3,?4)").bind(signature, await hashJson(transaction), payload, fetched).run();
    if (bytes + size > 900000) { gaps.add("wallet_transaction_sample_limit"); return null; } bytes += size;
    const record = { signature, status: transaction ? "available" as const : "missing" as const, transaction, purposes:existing?.purposes??["wallet" as const], fetched_at: fetched };
    if(existing)records[records.indexOf(existing)]=record;else records.push(record);return record;
  };
  const scans = await collectFundingHistories(db, rpc, candidate.address, prior.funding_scans.map(s => s.anchor), read,{cacheRecovery:true});
  // Replay all old/new bodies and exact anchors before describing progress.
  // This temporary replay cannot become a fresh eligibility observation.
  const replay = await analyzeWalletEvidence({ ...prior, observed_at: new Date().toISOString(), records, funding_scans: scans, gaps: [...gaps] });
  const coverage = replay.funding_coverage ?? [], allGaps = [...new Set(scans.flatMap(s=>fundingTask(s).gaps).concat([...gaps].filter(g => g === "wallet_transaction_sample_limit")))];
  const pending = allGaps.some(g => ["funding_paging_pending", "funding_transactions_pending"].includes(g)) && !fundingSourceLimited(allGaps);
  const work = WalletWorkSchema.parse({ address: candidate.address, symbol: candidate.symbol, source_evidence_hash: candidate.wallet_analysis!.evidence_hash, snapshot_at: candidate.wallet_analysis!.observed_at, attempted_at: new Date().toISOString(), stage: pending ? "direct_funding" : coverage.length && coverage.every(c => c.status === "window_examined") ? "refresh_required" : "source_limited", windows: coverage.length, examined_windows: coverage.filter(c => c.status === "window_examined").length, pending_transactions: coverage.reduce((n, c) => n + Math.max(0, c.transactions_in_window - c.transactions_examined), 0), decoded_transactions: coverage.reduce((n, c) => n + c.transactions_examined, 0), rpc_calls: rpc.calls, gaps: allGaps });
  await db.prepare("INSERT INTO tenx_wallet_work(address,source_evidence_hash,payload,attempted_at) VALUES(?1,?2,?3,?4) ON CONFLICT(address) DO UPDATE SET source_evidence_hash=excluded.source_evidence_hash,payload=excluded.payload,attempted_at=excluded.attempted_at").bind(candidate.address, work.source_evidence_hash, JSON.stringify(work), work.attempted_at).run();
  return work;
}
