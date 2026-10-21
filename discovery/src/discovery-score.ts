import {DISCOVERY_SCORE_POLICY,SCORE_CATEGORIES,ScoreInputSchema,ScoreRecordSchema,ScoreResultSchema,ScoreSummarySchema,type ScoreInput,type ScoreResult,type ScoreRecord} from "./discovery-score-model";
import {hashJson} from "./solana";

export class DiscoveryScoreError extends Error {}
const clamp=(n:number)=>Math.max(0,Math.min(1,n)),round=(n:number)=>Math.round(n*100)/100;
const health=(n:number,reference:number)=>clamp((100-Math.min(n,100))/(100-reference));
export function scoreFreshness(at:string|null,now:number,ttl:number) {
  if(!at)return 0;const age=(now-Date.parse(at))/1000;
  return !Number.isFinite(age)||age<0?0:age<=ttl?1:clamp((4*ttl-age)/(3*ttl));
}
// Preserve this v1 evaluator when adding calibrated versions. Missing inputs
// never shrink the denominator, and positive evidence never erases a risk cap.
export function evaluateDiscoveryScore(raw:ScoreInput):ScoreResult {
  const input=ScoreInputSchema.parse(raw),c=input.candidate,p=input.policy,now=Date.parse(input.as_of),t=p.targets;
  const criteria:ScoreResult["criteria"]=[],concerns:ScoreResult["concerns"]=[];
  const factor=(at:string|null,ttl:number)=>scoreFreshness(at,now,ttl);
  const add=(id:string,label:string,category:typeof SCORE_CATEGORIES[number],maximum:number,value:number|boolean|null,quality:number|null,available:number,at:string|null,fresh=1,notes:string[]=[])=>{
    const future=at!==null&&Date.parse(at)>now;
    const status=future?"future":!available?"unknown":fresh<1?"stale":available<1?"partial":"observed";
    criteria.push({id,label,category,maximum,value,points:round(maximum*clamp(quality??0)*fresh),evidence_points:round(maximum*clamp(available)*fresh),status,observed_at:at,notes:[...notes,...(status==="unknown"?["evidence_unavailable"]:status==="future"?["observation_from_future"]:status==="stale"?["positive_credit_decayed"]:[])].slice(0,8)});
  };
  const cap=(code:string,ceiling:number,at:string|null)=>concerns.push({code,ceiling:round(ceiling),observed_at:at});
  const chronology=Boolean(c.creation&&c.graduation&&Date.parse(c.creation.block_time)>Date.parse(c.graduation.block_time));
  const originBad=c.verification==="rejected"||chronology;
  const proofGood=(kind:"creation"|"graduation")=>{const proof=c[kind];return Boolean(proof&&proof.kind===kind&&Date.parse(proof.block_time)<=now&&Date.parse(proof.fetched_at)<=now&&!originBad);};
  add("creation","Finalized creation","origin",6,proofGood("creation"),proofGood("creation")?1:null,proofGood("creation")?1:0,c.creation?.block_time??null);
  add("graduation","Finalized graduation","origin",4,proofGood("graduation"),proofGood("graduation")?1:null,proofGood("graduation")?1:0,c.graduation?.block_time??null);
  if(originBad)cap(chronology?"origin_chronology_contradicted":"origin_rejected",0,c.checked_at);
  const rf=factor(c.risk.observed_at,p.freshness_seconds.controls);
  for(const [id,label,weight] of [["mint_authority","Mint authority revoked",6],["freeze_authority","Freeze authority revoked",4]] as const){
    const state=c.risk[id];add(id,label,"controls",weight,state==="unknown"?null:state==="revoked",state==="unknown"?null:state==="revoked"?1:0,state==="unknown"?0:1,c.risk.observed_at,rf);
    if(state==="active")cap(`${id}_active`,40,c.risk.observed_at);
  }
  add("pool_reserves","Pool reserves verified","controls",5,c.risk.pool_reserves_verified,c.risk.pool_reserves_verified?1:null,c.risk.pool_reserves_verified?1:0,c.risk.observed_at,rf);
  const m=c.market,mf=m&&(!m.observed_at||Date.parse(m.observed_at)<=now)?factor(m.fetched_at,p.freshness_seconds.market):0;
  const marketAt=m?.observed_at&&Date.parse(m.observed_at)>now?m.observed_at:m?.fetched_at??null;
  add("reported_cap","Reported market cap","market",5,m?.market_cap_usd??null,m?.market_cap_usd==null?null:clamp(m.market_cap_usd/t.market_cap_usd),m?.market_cap_usd==null?0:1,marketAt,mf,["provider_report_not_independent_supply","fdv_not_substituted"]);
  add("liquidity","Reported liquidity","market",10,m?.liquidity_usd??null,m?.liquidity_usd==null?null:clamp(m.liquidity_usd/t.liquidity_usd),m?.liquidity_usd==null?0:1,marketAt,mf);
  if(m?.liquidity_usd!==null&&m?.liquidity_usd!==undefined&&m.liquidity_usd<t.liquidity_usd)cap("reported_liquidity_below_reference",100*clamp(m.liquidity_usd/t.liquidity_usd),marketAt);
  const rawRatio=m&&m.market_cap_usd!==null&&m.market_cap_usd>0&&m.liquidity_usd!==null?m.liquidity_usd/m.market_cap_usd:null;
  const ratio=rawRatio!==null&&Number.isFinite(rawRatio)?rawRatio:null;
  add("liquidity_ratio","Liquidity / reported cap","market",5,ratio,ratio===null?null:clamp(ratio/t.liquidity_cap_ratio),ratio===null?0:1,marketAt,mf,["not_executable_exit_liquidity"]);
  const h=c.holders,hf=h?factor(h.observed_at,p.freshness_seconds.holders):0;
  const holderVerified=Boolean(h&&h.status==="verified"&&h.version==="owners-v2"&&h.layout_certified&&h.payload_hash);
  add("holders","Non-vault owner count","holders",5,h?.holder_count??null,holderVerified?clamp(h!.holder_count/t.holders):null,holderVerified?1:0,h?.observed_at??null,hf);
  for(const [id,label,weight,reference] of [["top1_pct","Largest owner concentration",8,t.top1_pct],["top10_pct","Top ten concentration",8,t.top10_pct],["creator_pct","Creation-user concentration",4,t.creator_pct]] as const){
    const value=h?.[id]??null;
    add(id,label,"holders",weight,value,holderVerified&&value!==null?health(value,reference):null,holderVerified&&value!==null?1:0,h?.observed_at??null,hf,h&&!holderVerified?["partial_inventory_cannot_earn_health_credit"]:[]);
    if(value!==null&&value>reference)cap(id==="creator_pct"?"creator_concentration":id==="top1_pct"?"largest_owner_concentration":"top10_concentration",100-(id==="top10_pct"?70:90)*clamp((value-reference)/(100-reference)),h?.observed_at??null);
  }
  const w=c.wallet_analysis,wf=w?factor(w.observed_at,p.freshness_seconds.wallets):0,usable=Boolean(w&&w.status!=="unavailable");
  const signed=usable?w!.wallets.filter(v=>v.signed_creation):[],buyers=usable?Math.max(0,w!.metrics.distinct_buyers):null;
  const expected=new Set([...(usable?w!.wallets.filter(v=>v.signed_creation||v.buys>0).map(v=>v.wallet):[])]);
  const signedBuyers=signed.filter(v=>v.buys>0).length;
  const funding=usable?(w!.funding_coverage??[]).filter(f=>f.anchor_kind!=="funding_transfer"):[];
  const denominator=Math.max(funding.length,expected.size,(buyers??0)+signed.length-signedBuyers,1);
  const examined=new Set(funding.filter(f=>expected.has(f.wallet)&&f.status==="window_examined"&&f.boundary_reached&&!f.gaps.length&&f.transactions_examined>=f.transactions_in_window&&Date.parse(f.anchor_at)<=now&&Date.parse(f.window_start)<=Date.parse(f.anchor_at)).map(f=>f.wallet));
  const omittedFunding=Boolean(w?.gaps.some(g=>["funding_wallet_limit","funding_output_limit"].includes(g)));
  const omittedTrades=Boolean(w?.gaps.some(g=>["wallet_output_limit","trade_output_limit","wallet_transaction_sample_limit","trade_base_transfer_unverified","trade_token_owner_unverified","quote_trade_accounts_unverified","transaction_not_certified_for_trade_analysis"].includes(g)));
  const fundFraction=omittedFunding?0:clamp(examined.size/denominator);
  const sample=usable&&w!.scope.early_window_reached&&!omittedTrades?clamp(Math.max(0,w!.scope.transactions_examined)/Math.max(1,w!.scope.transactions_examined+Math.max(0,w!.scope.unsupported_or_missing_transactions))):0;
  add("signed_creation_wallet","Signed creation wallet","wallets",5,signed.length>0,signed.length?1:null,signed.length?1:0,w?.observed_at??null,wf,["bounded_wallet_sample"]);
  add("sampled_buyers","Verified buyer sample","wallets",5,buyers,buyers===null?null:clamp(buyers/t.buyers)*sample,buyers===null?0:sample,w?.observed_at??null,wf);
  add("funding_windows","Examined pre-buy funding windows","wallets",10,usable&&!omittedFunding?fundFraction:null,usable&&!omittedFunding?fundFraction:null,usable&&!omittedFunding?fundFraction:0,w?.observed_at??null,wf,[omittedFunding?"funding_sample_omitted_wallets_unknown_denominator":"examined_windows_not_complete_lifetime_funding"]);
  for(const [id,label,reference,complete] of [["dev_funded_supply_pct","Sampled dev-funded exposure",t.dev_funded_pct,fundFraction],["dev_sold_supply_pct","Sampled creation-wallet sales",t.dev_sold_pct,sample]] as const){
    const value=w?.metrics[id]??null;
    add(id,label,"wallets",2.5,value,!usable||value===null?null:health(value,reference)*complete,!usable||value===null?0:complete,w?.observed_at??null,wf,["sample_only_not_lifetime_exposure"]);
    if(value!==null&&value>reference)cap(id==="dev_funded_supply_pct"?"creation_funded_exposure":"sampled_creation_sales",100-80*clamp((value-reference)/(100-reference)),w?.observed_at??null);
  }
  const prices=[...input.prices].sort((a,b)=>a.fetched_at<b.fetched_at?-1:a.fetched_at>b.fetched_at?1:0),first=prices[0],last=prices.at(-1);
  const times=prices.map(v=>Date.parse(v.fetched_at));
  const historyGaps=[...(input.history_limited?["price_history_sample_limited"]:[]),...(prices.length<p.performance.min_samples?["price_history_too_few_samples"]:[]),...(new Set(times).size!==times.length?["price_history_duplicate_times"]:[]),...(new Set(prices.map(v=>v.source)).size>1?["price_history_sources_mixed"]:[]),...(prices.some(v=>v.price_usd===null||v.price_usd<=0)?["price_history_price_unknown"]:[]),...(prices.some(v=>Date.parse(v.fetched_at)>now||v.observed_at&&Date.parse(v.observed_at)>now)?["price_history_from_future"]:[]),...(times.some(t=>t<now-p.performance.window_seconds*1000)?["price_history_outside_window"]:[]),...(!times.length||times.at(-1)!-times[0]!<p.performance.min_span_seconds*1000?["price_history_span_too_short"]:[]),...(times.slice(1).some((v,i)=>v-times[i]!>p.performance.max_gap_seconds*1000)?["price_history_gap_too_large"]:[])];
  const historyGood=historyGaps.length===0;
  const rawChange=historyGood?last!.price_usd!/first!.price_usd!-1:null;
  const change=rawChange!==null&&Number.isFinite(rawChange)?rawChange:null;
  if(rawChange!==null&&!Number.isFinite(rawChange))historyGaps.push("price_return_nonfinite");
  add("sampled_performance","Sampled price performance","performance",5,change,change===null?null:clamp(.5+change/(2*p.performance.return_band)),change===null?0:1,last?.fetched_at??null,last?factor(last.fetched_at,p.freshness_seconds.market):0,historyGaps.length?historyGaps:["sampled_return_not_organic_demand"]);
  const base=round(criteria.reduce((n,r)=>n+r.points,0)),ceiling=Math.min(100,...concerns.map(r=>r.ceiling));
  return ScoreResultSchema.parse({version:"discovery-score-result-v1",as_of:input.as_of,value:Math.max(0,Math.floor(Math.min(base,ceiling)+1e-8)),evidence_coverage:Math.min(100,Math.floor(criteria.reduce((n,r)=>n+r.evidence_points,0)+1e-8)),base_points:base,ceiling,criteria,concerns,components:SCORE_CATEGORIES.map(category=>({category,maximum:p.weights[category],points:round(criteria.filter(r=>r.category===category).reduce((n,r)=>n+r.points,0)),evidence_points:round(criteria.filter(r=>r.category===category).reduce((n,r)=>n+r.evidence_points,0))}))});
}
const metadata=(r:{input_hash:string;policy_hash:string;result_hash:string})=>({version:"discovery-scorecard-v1",input_hash:r.input_hash,policy_hash:r.policy_hash,result_hash:r.result_hash});
export async function freezeDiscoveryScore(raw:ScoreInput):Promise<ScoreRecord> {
  const inputs=ScoreInputSchema.parse(raw);
  if(new TextEncoder().encode(JSON.stringify(inputs)).length>1_800_000)throw new DiscoveryScoreError("discovery_score_input_size_limit");
  const result=evaluateDiscoveryScore(inputs),hashes={input_hash:await hashJson(inputs),policy_hash:await hashJson(inputs.policy),result_hash:await hashJson(result)};
  return ScoreRecordSchema.parse({version:"discovery-scorecard-v1",inputs,result,...hashes,record_hash:await hashJson(metadata(hashes))});
}
export async function replayDiscoveryScore(raw:ScoreRecord) {
  const r=ScoreRecordSchema.parse(raw),replayed=await freezeDiscoveryScore(r.inputs);
  if(await hashJson(replayed)!==await hashJson(r))throw new DiscoveryScoreError("discovery_score_replay_mismatch");
  return {status:"verified" as const,provider_requests:0 as const};
}
export function scoreSummary(r:ScoreRecord) {return ScoreSummarySchema.parse({version:"discovery-score-v1",as_of:r.result.as_of,value:r.result.value,evidence_coverage:r.result.evidence_coverage,ceiling:r.result.ceiling,input_hash:r.input_hash,policy_hash:r.policy_hash,result_hash:r.result_hash,record_hash:r.record_hash});}
export const defaultScoreInput=(candidate:ScoreInput["candidate"],at:Date,prices:ScoreInput["prices"]=[],history_limited=false):ScoreInput=>({version:"discovery-score-input-v1",as_of:at.toISOString(),candidate,prices,history_limited,policy:DISCOVERY_SCORE_POLICY});
