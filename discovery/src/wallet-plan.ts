import { assess, DEFAULT_POLICY, type Candidate } from "./model";
import { fundingTask, loadFundingCheckpoints } from "./funding-history";
import { priorWalletEvidence } from "./wallet-work";
import { comparePotential, potential } from "./priority";
import { candidates } from "./store";
import { WalletPlanSchema, WalletPlansResponseSchema, WalletYieldSchema, type WalletPlan } from "./wallet-plan-model";
import { fundingRecoveryCandidates, fundingRecoveryStatus } from "./funding-recovery";
import {currentWalletReader,directFundingLimit,expandedFundingScope} from "./wallet-funding-scope";
import { FundingCacheCapacityError, projectCachedFunding } from "./funding-cache-work";

// Read-only planning: estimates describe the known remaining work, never a
// guarantee of completion or a substitute for a fresh eligibility snapshot.
export async function walletPlan(db: D1Database, c: Candidate, now = new Date()): Promise<WalletPlan> {
  const base = {address:c.address,symbol:c.symbol,source_evidence_hash:c.wallet_analysis?.evidence_hash ?? null,snapshot_at:c.wallet_analysis?.observed_at ?? null,windows:0,examined_windows:0,blocked_windows:0,pending_bodies:0,cached_pending_bodies:0,cached_recoverable_markers:0,source_recoverable_markers:0,direct_wallet_limit:8 as 8|20,additional_windows:0,minimum_rpc_calls:null,gaps:[] as string[]};
  try {
    const retained = await priorWalletEvidence(db,c);
    if (!retained?.funding_scans?.length || !currentWalletReader(c.wallet_analysis?.version??"")) return WalletPlanSchema.parse({...base,stage:"new_snapshot"});
    const prior=await expandedFundingScope(db,retained),limit=directFundingLimit(prior);
    base.direct_wallet_limit=limit;base.additional_windows=Math.max(0,(prior.funding_scans?.length??0)-retained.funding_scans.length);
    const loaded = await loadFundingCheckpoints(db,c.address,prior.funding_scans!.map(s=>s.anchor),false,limit);
    const tasks = loaded.map(fundingTask);
    base.windows = loaded.length;
    base.examined_windows = tasks.filter(t => t.coverage.status === "window_examined").length;
    base.blocked_windows = tasks.filter(t => t.blocked).length;
    base.pending_bodies = new Set(tasks.flatMap(t => t.pending.map(r => r.signature))).size;
    base.gaps = [...new Set(tasks.flatMap(t => t.gaps))];
    const cache = await projectCachedFunding(db, prior, loaded, now);
    if (cache.changes.length) return WalletPlanSchema.parse({...base,stage:"cached_funding",cached_pending_bodies:cache.added,cached_recoverable_markers:cache.recovered,minimum_rpc_calls:0});
    const sourceRecovery = await fundingRecoveryCandidates(db,c,retained,now);
    base.source_recoverable_markers = sourceRecovery.length;
    if (sourceRecovery.length) return WalletPlanSchema.parse({...base,stage:"reader_recovery",cached_pending_bodies:null,minimum_rpc_calls:1+sourceRecovery.length});
    if (base.blocked_windows) return WalletPlanSchema.parse({...base,stage:"source_limited",cached_pending_bodies:null});
    const complete = base.examined_windows === base.windows;
    return WalletPlanSchema.parse({...base,stage:complete?"refresh_required":"direct_funding",
      // Unprobed bodies may already be cached; only known misses contribute
      // to this lower bound. It never promises the sample can be completed.
      minimum_rpc_calls:complete?null:1+cache.known_missing+tasks.filter(t=>t.coverage.gaps.includes("funding_paging_pending")).length});
  } catch (error) {
    if (error instanceof FundingCacheCapacityError) return WalletPlanSchema.parse({...base,stage:"source_limited",gaps:[...new Set([...base.gaps,error.message])]});
    return WalletPlanSchema.parse({...base,stage:"cache_invalid",gaps:[error instanceof Error && /^[a-z0-9_]{1,90}$/.test(error.message) ? error.message : "wallet_plan_replay_failed"]});
  }
}
export function compareWalletPlans(a: {candidate:Candidate;plan:WalletPlan}, b: {candidate:Candidate;plan:WalletPlan}, now: Date) {
  const tier = (p:WalletPlan) => p.stage==="cached_funding"?-1:p.stage==="refresh_required"?0:p.stage==="direct_funding"||p.stage==="reader_recovery"?1:p.stage==="new_snapshot"?2:3;
  const other = (c:Candidate) => assess(c,{...DEFAULT_POLICY,require_wallet_analysis:false},now).eligibility==="eligible" ? 0 : 1;
  return Number(tier(a.plan)===3)-Number(tier(b.plan)===3) || Number(a.plan.stage!=="cached_funding")-Number(b.plan.stage!=="cached_funding") || other(a.candidate)-other(b.candidate) || tier(a.plan)-tier(b.plan) || (a.plan.minimum_rpc_calls ?? 19)-(b.plan.minimum_rpc_calls ?? 19);
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
  return WalletPlansResponseSchema.shape.data.parse({at:now.toISOString(),scope:"up_to_20_current_contenders",capped:all.length>20,plans:planned.map(p=>p.plan),yield:result,reader_recovery:await fundingRecoveryStatus(db,now),provider_requests:0,evidence_gates_changed:false});
}
