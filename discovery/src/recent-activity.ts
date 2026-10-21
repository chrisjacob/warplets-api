import type {assembleGmgnWindowData} from "./gmgn-window";
import {activityFreshness} from "./activity-observation";
import {RecentActivity,RecentActivityInterval,RECENT_ACTIVITY_POLICY as P} from "./recent-activity-model";
import {hashJson} from "./solana";

type WindowData=Awaited<ReturnType<typeof assembleGmgnWindowData>>;
const boundaryGaps=["reported_candles_not_verified_economic_trades","participant_breadth_and_owner_independence_unknown","no_qualified_attention_or_scoring_credit"];
async function freeze(payload:Omit<RecentActivity,"report_hash">){
  // Schema order is part of the display checksum; old report schemas stay intact.
  const parsed=RecentActivity.parse({...payload,report_hash:"0".repeat(64)}),{report_hash:_,...canonical}=parsed;
  return RecentActivity.parse({...canonical,report_hash:await hashJson(canonical)});
}
export async function unavailableRecentActivity(address:string,at:Date,state:"missing"|"rejected"|"simulation",gap:string){
  return freeze({version:"recent-candle-activity-v1",address,cutoff_at:at.toISOString(),state,anchor_at:null,fetched_at:null,freshness:"unknown",receipt_span_ms:null,
    policy:P.version,policy_hash:await hashJson(P),parent_window_hash:null,usd_field:null,periods:[],references:[],gaps:[gap,...boundaryGaps],participant_breadth:null,
    qualified_attention_momentum:null,organic_demand_certified:false,canonical_pool_verified:false,scoring_effect:"none",provider_requests:0,database_writes:0});
}
export async function reviewRecentActivity(data:WindowData,at:Date,creationAt:string|null=null){
  const {report:r,candles}=data,cutoff=at.getTime(),end=Date.parse(r.window_end),start=Date.parse(r.window_start);
  if(!r.received_at||!r.receipt_refs.some(ref=>ref.receipt_hash))return unavailableRecentActivity(r.address,at,r.failed_parts?"rejected":"missing",r.failed_parts?"retained_candle_source_attempts_failed":"candle_receipts_unavailable_at_cutoff");
  if(end>cutoff||Date.parse(r.received_at)>cutoff||end-start!==360*60000)throw Error("recent_window_cutoff_or_duration");
  const skew=r.receipt_span_ms===null||r.receipt_span_ms>P.maximum_receipt_span_ms;
  const interval=(minutes:5|60|360,until:number):RecentActivityInterval=>{
    const since=until-minutes*60000,bars=candles.filter(b=>b.time*1000>=since&&b.time*1000<until),gaps:string[]=[];
    const complete=bars.length===minutes&&bars.every((b,i)=>b.time*1000===since+i*60000);
    if(!complete)gaps.push("closed_minute_coverage_incomplete");
    if(skew)gaps.push("receipt_span_exceeds_five_minutes");
    const preCreation=creationAt!==null&&since<Date.parse(creationAt);
    if(preCreation)gaps.push("window_starts_before_verified_creation");
    const held=skew||preCreation,usable=complete&&!held;
    // The full-window unit test is descriptive. Every target bar must also have
    // both flow fields; missing token amounts cannot turn a USD sum into a pass.
    const unitReady=r.units.usd_field!==null&&bars.every(b=>b.amount!==null);
    if(!unitReady)gaps.push("usd_unit_basis_or_flow_pairs_unavailable");
    const volume=usable&&unitReady?bars.reduce((sum,b)=>sum+b[r.units.usd_field!]!,0):null;
    const change=usable?(bars.at(-1)!.close/bars[0]!.open-1)*100:null;
    if(volume!==null&&!Number.isFinite(volume)||change!==null&&!Number.isFinite(change))throw Error("recent_metric_overflow");
    return RecentActivityInterval.parse({start_at:new Date(since).toISOString(),end_at:new Date(until).toISOString(),minutes,
      status:held?"held":complete?"complete":"partial",observed_minutes:bars.length,price_change_pct:change,reported_volume_usd:volume,
      positive_volume_minutes:usable&&unitReady?bars.filter(b=>b[r.units.usd_field!]!>0).length:null,gaps});
  };
  const periods=P.window_minutes.map(minutes=>{
    const recent=interval(minutes,end),previous=minutes===360?null:interval(minutes,end-minutes*60000),gaps:string[]=[];
    if(!previous)gaps.push("preceding_six_hours_not_in_retained_request");
    else if(previous.reported_volume_usd===0)gaps.push("zero_previous_volume_ratio_undefined");
    else if(previous.reported_volume_usd===null||recent.reported_volume_usd===null)gaps.push("comparable_complete_volume_windows_unavailable");
    const ratio=previous?.reported_volume_usd!==null&&previous?.reported_volume_usd!==undefined&&previous.reported_volume_usd>0&&recent.reported_volume_usd!==null?recent.reported_volume_usd/previous.reported_volume_usd:null;
    if(ratio!==null&&!Number.isFinite(ratio))throw Error("recent_ratio_overflow");
    return {minutes,recent,previous,reported_volume_ratio:ratio,gaps};
  });
  return freeze({version:"recent-candle-activity-v1",address:r.address,cutoff_at:at.toISOString(),state:"available",anchor_at:r.window_end,fetched_at:r.received_at,
    freshness:activityFreshness(at.toISOString(),r.received_at,r.window_end,P.freshness_seconds),receipt_span_ms:r.receipt_span_ms,
    policy:P.version,policy_hash:await hashJson(P),parent_window_hash:r.report_hash,usd_field:r.units.usd_field,periods,
    references:r.receipt_refs.filter((ref):ref is typeof ref&{receipt_hash:string}=>ref.receipt_hash!==null).map(({request_id,receipt_hash})=>({request_id,receipt_hash})),
    gaps:[...r.gaps,...boundaryGaps],participant_breadth:null,qualified_attention_momentum:null,organic_demand_certified:false,canonical_pool_verified:false,scoring_effect:"none",provider_requests:0,database_writes:0});
}
export async function verifyRecentActivity(raw:unknown){
  const report=RecentActivity.parse(raw),{report_hash,...payload}=report;
  if(await hashJson(payload)!==report_hash||await hashJson(P)!==report.policy_hash)throw Error("recent_activity_hash_or_policy_mismatch");
  return report;
}
