import { assess, DEFAULT_POLICY, type Candidate } from "./model";
import { fundingTask, loadFundingCheckpoints,recoverCachedFunding } from "./funding-history";
import { priorWalletEvidence } from "./wallet-work";
import { WalletTransactionSchema } from "./wallet-rpc";
import { hashJson } from "./solana";
import { comparePotential, potential } from "./priority";
import { candidates } from "./store";
import { WalletPlanSchema, WalletPlansResponseSchema, WalletYieldSchema, type WalletPlan } from "./wallet-plan-model";
import { analyzeWalletEvidence } from "./wallet-analysis";

// Read-only planning: estimates describe the known remaining work, never a
// guarantee of completion or a substitute for a fresh eligibility snapshot.
export async function walletPlan(db: D1Database, c: Candidate, now = new Date()): Promise<WalletPlan> {
  const base = {address:c.address,symbol:c.symbol,source_evidence_hash:c.wallet_analysis?.evidence_hash ?? null,snapshot_at:c.wallet_analysis?.observed_at ?? null,windows:0,examined_windows:0,blocked_windows:0,pending_bodies:0,cached_pending_bodies:0,cached_recoverable_markers:0,minimum_rpc_calls:null,gaps:[] as string[]};
  try {
    const prior = await priorWalletEvidence(db,c);
    if (!prior?.funding_scans?.length || c.wallet_analysis?.version !== "wallet-signals-v4") return WalletPlanSchema.parse({...base,stage:"new_snapshot"});
    const loaded = await loadFundingCheckpoints(db,c.address,prior.funding_scans.map(s=>s.anchor));
    const recovery=await recoverCachedFunding(db,loaded,now),scans=recovery.scans;
    base.cached_recoverable_markers=recovery.recovered.length;
    if (scans.some(s=>Date.parse(s.attempted_at)>now.getTime() || s.pages.some(p=>Date.parse(p.fetched_at)>now.getTime()))) throw new Error("funding_checkpoint_from_future");
    const tasks = scans.map(fundingTask), pending = new Map(tasks.flatMap(t=>t.pending).map(r=>[r.signature,r]));
    const gaps = [...new Set(tasks.flatMap(t=>t.gaps))];
    const inputBlocked = prior.gaps.some(g=>["funding_wallet_limit","funding_output_limit","wallet_transaction_sample_limit"].includes(g)) || prior.records.length+[...pending.keys()].filter(s=>!prior.records.some(r=>r.signature===s)).length>64;
    if (inputBlocked) gaps.push("wallet_snapshot_sample_bound");
    const blocked = tasks.filter(t=>t.blocked).length, examined = tasks.filter(t=>t.coverage.status==="window_examined").length;
    if (blocked || inputBlocked) return WalletPlanSchema.parse({...base,stage:"source_limited",windows:scans.length,examined_windows:examined,blocked_windows:blocked,pending_bodies:pending.size,cached_pending_bodies:null,gaps});
    // A checkpoint's "available" marker alone cannot certify a completed
    // window. Replay every retained body before scheduling more provider work.
    const records=structuredClone(prior.records);
    for(const record of recovery.records){const previous=records.findIndex(r=>r.signature===record.signature);if(previous>=0)records[previous]={...record,purposes:records[previous]!.purposes};else records.push({...record,purposes:["wallet"]});}
    for (const scan of scans) for (const entry of scan.examined) {
      if (records.some(r=>r.signature===entry.signature)) continue;
      const saved=await db.prepare("SELECT payload,payload_hash,fetched_at FROM tenx_wallet_transactions WHERE signature=?1").bind(entry.signature).first<{payload:string;payload_hash:string;fetched_at:string}>();
      if (!saved) throw new Error("wallet_checkpoint_body_missing");
      const tx=WalletTransactionSchema.parse(JSON.parse(saved.payload));
      if (await hashJson(tx)!==saved.payload_hash) throw new Error("wallet_cache_hash_or_identity_mismatch");
      records.push({signature:entry.signature,transaction:tx,status:"available",fetched_at:saved.fetched_at,purposes:["wallet"]});
    }
    if (records.length+[...pending.keys()].filter(s=>!records.some(r=>r.signature===s)).length>64 || records.reduce((n,r)=>n+new TextEncoder().encode(JSON.stringify(r.transaction)).length,0)>900000) return WalletPlanSchema.parse({...base,stage:"source_limited",windows:scans.length,examined_windows:examined,blocked_windows:blocked,pending_bodies:pending.size,cached_pending_bodies:null,gaps:[...gaps,"wallet_snapshot_sample_bound"]});
    await analyzeWalletEvidence({...prior,observed_at:now.toISOString(),records,funding_scans:scans});
    let cached = 0;
    for (const row of pending.values()) {
      if (prior.records.some(r=>r.signature===row.signature && r.status==="available" && r.transaction?.slot===row.slot)) { cached++; continue; }
      const saved = await db.prepare("SELECT payload,payload_hash,fetched_at FROM tenx_wallet_transactions WHERE signature=?1").bind(row.signature).first<{payload:string;payload_hash:string;fetched_at:string}>();
      if (!saved) continue;
      const tx = WalletTransactionSchema.parse(JSON.parse(saved.payload));
      if (await hashJson(tx)!==saved.payload_hash || tx.slot!==row.slot || tx.transaction.signatures[0]!==row.signature || Date.parse(saved.fetched_at)>now.getTime()) throw new Error("wallet_cache_hash_or_identity_mismatch");
      cached++;
    }
    return WalletPlanSchema.parse({...base,windows:scans.length,examined_windows:examined,blocked_windows:blocked,pending_bodies:pending.size,cached_pending_bodies:cached,
      stage: examined===scans.length ? "refresh_required" : "direct_funding",
      minimum_rpc_calls: examined===scans.length ? null : 1+pending.size-cached+tasks.filter(t=>t.coverage.gaps.includes("funding_paging_pending")).length,
      gaps});
  } catch (error) {
    return WalletPlanSchema.parse({...base,stage:"cache_invalid",gaps:[error instanceof Error && /^[a-z0-9_]{1,90}$/.test(error.message) ? error.message : "wallet_plan_replay_failed"]});
  }
}
export function compareWalletPlans(a: {candidate:Candidate;plan:WalletPlan}, b: {candidate:Candidate;plan:WalletPlan}, now: Date) {
  const tier = (p:WalletPlan) => p.stage==="refresh_required"?0:p.stage==="direct_funding"?1:p.stage==="new_snapshot"?2:3;
  const other = (c:Candidate) => assess(c,{...DEFAULT_POLICY,require_wallet_analysis:false},now).eligibility==="eligible" ? 0 : 1;
  return Number(tier(a.plan)===3)-Number(tier(b.plan)===3) || other(a.candidate)-other(b.candidate) || tier(a.plan)-tier(b.plan) || (a.plan.minimum_rpc_calls ?? 19)-(b.plan.minimum_rpc_calls ?? 19);
}
export async function walletPlans(db: D1Database, now = new Date()) {
  const all=(await candidates(db)).filter(c=>potential(c,DEFAULT_POLICY,now)).sort((a,b)=>comparePotential(a,b,DEFAULT_POLICY,now));
  const planned=[];
  for(const candidate of all.slice(0,20)) planned.push({candidate,plan:await walletPlan(db,candidate,now)});
  planned.sort((a,b)=>compareWalletPlans(a,b,now) || comparePotential(a.candidate,b.candidate,DEFAULT_POLICY,now));
  const since=new Date(now.getTime()-86_400_000).toISOString();
  const stats=await db.prepare(`SELECT COUNT(*) AS turns,COALESCE(SUM(rpc_calls),0) AS rpc_calls,COALESCE(SUM(completed_windows),0) AS completed_windows,
    COALESCE(SUM(new_buyers),0) AS new_buyer_observations,COALESCE(SUM(kind='snapshot' AND state='succeeded'),0) AS snapshots,COALESCE(SUM(state='failed'),0) AS failed_turns
    FROM tenx_wallet_runs WHERE finished_at>=?1 AND finished_at<=?2`).bind(since,now.toISOString()).first<{turns:number;rpc_calls:number;completed_windows:number;new_buyer_observations:number;snapshots:number;failed_turns:number}>();
  const result=WalletYieldSchema.parse({...stats,since,rpc_per_completed_window:stats?.completed_windows ? stats.rpc_calls/stats.completed_windows : null});
  return WalletPlansResponseSchema.shape.data.parse({at:now.toISOString(),scope:"up_to_20_current_contenders",capped:all.length>20,plans:planned.map(p=>p.plan),yield:result,provider_requests:0,evidence_gates_changed:false});
}
