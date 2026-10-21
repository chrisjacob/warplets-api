import {DISCOVERY_SCORE_POLICY_V2} from "./discovery-score-v2-model";
import {evaluateDiscoveryScoreV2} from "./discovery-score-v2";
import {DiscoveryScoreError} from "./discovery-score";
import {DISCOVERY_SCORE_POLICY_V3,ScoreInputV3Schema,ScoreResultV3Schema,ScoreRecordV3Schema,ScoreSummaryV3Schema,StaircaseReviewSchema,type ScoreInputV3} from "./discovery-score-v3-model";
import {hashJson} from "./solana";

const round=(n:number)=>Math.round(n*100)/100,clamp=(n:number)=>Math.max(0,Math.min(1,n));
export function staircaseReview(input:ScoreInputV3){
  const now=Date.parse(input.as_of),r=input.policy.staircase,gaps=new Set<string>(["sampled_prices_not_candles","pattern_not_wash_trading_proof"]),ordered=[...input.prices].sort((a,b)=>Date.parse(a.fetched_at)-Date.parse(b.fetched_at));
  const counts=new Map<number,number>();for(const p of ordered){const t=Date.parse(p.fetched_at);counts.set(t,(counts.get(t)??0)+1);}
  let run:typeof ordered=[];
  for(const p of ordered){const t=Date.parse(p.fetched_at),prior=run.at(-1);
    if(t>now||t<now-86400000||p.observed_at&&Date.parse(p.observed_at)>t||p.price_usd===null||p.price_usd<=0||counts.get(t)!>1){run=[];gaps.add("invalid_price_boundary");continue;}
    if(prior&&(p.source!==prior.source||t-Date.parse(prior.fetched_at)>r.max_gap_seconds*1000)){run=[];gaps.add("source_or_sampling_boundary");}run.push(p);
  }
  const first=run[0],last=run.at(-1),span=first&&last?(Date.parse(last.fetched_at)-Date.parse(first.fetched_at))/1000:0;
  const out={status:"insufficient" as "insufficient"|"not_flagged"|"review",samples:run.length,span_seconds:span,source:last?.source??null,first_at:first?.fetched_at??null,last_at:last?.fetched_at??null,return_pct:null as number|null,max_drawdown_pct:null as number|null,median_absolute_rate_pct_per_minute:null as number|null,qualifying_jumps:0,jump_log_return_share:null as number|null,gaps:[] as string[]};
  if(input.history_limited)gaps.add("price_history_sample_limited");
  if(input.history_limited||run.length<r.min_samples||span<r.min_span_seconds){gaps.add("staircase_history_insufficient");return StaircaseReviewSchema.parse({...out,gaps:[...gaps]});}
  const steps=run.slice(1).map((p,i)=>{const pct=(p.price_usd!/run[i]!.price_usd!-1)*100,minutes=(Date.parse(p.fetched_at)-Date.parse(run[i]!.fetched_at))/60000;return {pct,rate:pct/minutes,log:Math.log(p.price_usd!)-Math.log(run[i]!.price_usd!)};});
  const rates=steps.map(p=>Math.abs(p.rate)).sort((a,b)=>a-b),middle=Math.floor(rates.length/2),median=rates.length%2?rates[middle]!:(rates[middle-1]!+rates[middle]!)/2;
  let peak=first!.price_usd!,drawdown=0;for(const p of run){peak=Math.max(peak,p.price_usd!);drawdown=Math.max(drawdown,(1-p.price_usd!/peak)*100);}
  const change=(last!.price_usd!/first!.price_usd!-1)*100,netLog=Math.log(last!.price_usd!)-Math.log(first!.price_usd!);
  const jumps=steps.filter(p=>p.pct>=r.min_jump_pct&&p.rate>r.rate_multiple*median),share=netLog>0?jumps.reduce((n,p)=>n+p.log,0)/netLog:null;
  if([change,drawdown,median,...steps.flatMap(p=>[p.pct,p.rate,p.log]),...(share===null?[]:[share])].some(n=>!Number.isFinite(n))){gaps.add("staircase_numeric_range_unusable");return StaircaseReviewSchema.parse({...out,gaps:[...gaps]});}
  return StaircaseReviewSchema.parse({...out,status:change>=r.min_return_pct&&drawdown<=r.max_drawdown_pct&&jumps.length>=r.min_jumps&&share!==null&&share>=r.min_log_return_share?"review":"not_flagged",return_pct:round(change),max_drawdown_pct:round(drawdown),median_absolute_rate_pct_per_minute:median,qualifying_jumps:jumps.length,jump_log_return_share:share,gaps:[...gaps]});
}
export function evaluateDiscoveryScoreV3(raw:ScoreInputV3){
  const input=ScoreInputV3Schema.parse(raw),now=Date.parse(input.as_of),c=input.candidate,p=input.policy.launch_review;
  const base=evaluateDiscoveryScoreV2({version:"discovery-score-input-v2",as_of:input.as_of,candidate:c,policy:DISCOVERY_SCORE_POLICY_V2,prices:input.prices,history_limited:input.history_limited}),concerns=[...base.concerns],gaps=new Set<string>(["purchase_ratio_uses_later_observed_supply","current_common_control_unknown"]);
  const cap=(code:string,ceiling:number,at:string|null)=>concerns.push({code,ceiling:round(ceiling),observed_at:at});
  const h=c.holders,w=c.wallet_analysis,creation=c.creation;
  let amount:string|null=null,supply:string|null=null,pct:number|null=null;
  const dated=Boolean(creation&&Date.parse(creation.block_time)<=now&&Date.parse(creation.fetched_at)>=Date.parse(creation.block_time)&&Date.parse(creation.fetched_at)<=now&&h&&Date.parse(h.observed_at)>=Date.parse(creation.block_time)&&Date.parse(h.observed_at)<=now&&w&&Date.parse(w.observed_at)>=Date.parse(creation.block_time)&&Date.parse(w.observed_at)<=now);
  if(dated&&h!.version==="owners-v2"&&h!.status==="verified"&&h!.layout_certified&&h!.payload_hash&&w!.status!=="unavailable"&&w!.creation_slot===creation!.slot&&h!.context_slot!==null&&h!.context_slot>=creation!.slot&&!w!.gaps.some(g=>["trade_base_transfer_unverified","trade_token_owner_unverified","transaction_not_certified_for_trade_analysis"].includes(g))&&c.verification==="verified"&&c.risk.mint_authority==="revoked"&&c.risk.observed_at&&Date.parse(c.risk.observed_at)<=now&&/^\d{1,20}$/.test(h!.supply_raw)){
    const signed=new Set(w!.wallets.filter(v=>v.signed_creation&&v.wallet===h!.creator).map(v=>v.wallet));
    const trades=w!.trades.filter(t=>t.signature===creation!.signature),seen=new Set<string>();let duplicate=false;
    for(const t of trades){if(seen.has(t.instruction_index))duplicate=true;seen.add(t.instruction_index);}
    const buys=trades.filter(t=>signed.has(t.wallet)&&t.side==="buy"&&t.program===creation!.program&&t.slot===creation!.slot&&Date.parse(t.block_time)===Date.parse(creation!.block_time)&&BigInt(t.net_wallet_base_raw)>0n);
    const bought=buys.reduce((n,t)=>n+BigInt(t.base_amount_raw),0n),net=buys.reduce((n,t)=>BigInt(t.net_wallet_base_raw)>n?BigInt(t.net_wallet_base_raw):n,0n),acquired=bought<net?bought:net,denominator=BigInt(h!.supply_raw);
    const consistent=new Set(buys.map(t=>t.net_wallet_base_raw)).size===1&&new Set(buys.map(t=>t.transaction_hash)).size===1;
    if(!duplicate&&consistent&&buys.length&&denominator>0n&&denominator<=18446744073709551615n&&acquired>0n&&acquired<=denominator){amount=acquired.toString();supply=denominator.toString();pct=Number(acquired*100000000n/denominator)/1000000;}
    else gaps.add(duplicate?"creation_trade_identity_duplicated":!consistent?"creation_net_balance_inconsistent":acquired>denominator?"creation_purchase_exceeds_observed_supply":"creation_purchase_unavailable");
  }else gaps.add("creation_purchase_or_supply_uncertified");
  if(pct!==null&&pct>p.creation_reference_pct)cap("large_creation_purchase_relative_to_observed_supply",100-(100-p.creation_end_ceiling)*clamp((pct-p.creation_reference_pct)/(p.creation_end_pct-p.creation_reference_pct)),creation!.block_time);
  const first=input.first_market,delay=first&&creation?(Date.parse(first.fetched_at)-Date.parse(creation.block_time))/1000:null;
  const early=first&&creation&&delay!==null&&delay>=0&&delay<=p.early_window_seconds&&Date.parse(first.fetched_at)<=now&&Date.parse(creation.block_time)<=now&&Date.parse(creation.fetched_at)>=Date.parse(creation.block_time)&&Date.parse(creation.fetched_at)<=now&&c.verification==="verified"&&(!first.observed_at||Date.parse(first.observed_at)<=Date.parse(first.fetched_at)&&Date.parse(first.observed_at)>=Date.parse(creation.block_time))?first.market_cap_usd:null;
  if(early===null)gaps.add("opening_valuation_unverified_no_early_cap");
  if(early!==null&&early>=p.early_cap_usd)cap("high_early_reported_valuation",p.early_cap_ceiling,first!.fetched_at);
  const staircase=staircaseReview(input);if(staircase.status==="review")cap("quiet_staircase_price_rise_review",input.policy.staircase.ceiling,staircase.last_at);
  if(concerns.length>base.concerns.length){const momentum=base.criteria.find(x=>x.id==="sampled_performance")!;momentum.points=0;momentum.notes=[...momentum.notes,"launch_or_staircase_review_withholds_momentum"].slice(0,8);}
  const points=round(base.criteria.reduce((n,v)=>n+v.points,0)),ceiling=Math.min(100,...concerns.map(v=>v.ceiling));
  return ScoreResultV3Schema.parse({...base,version:"discovery-score-result-v3",base_points:points,ceiling,value:Math.max(0,Math.floor(Math.min(points,ceiling)+1e-8)),concerns,components:base.components.map(v=>({...v,points:round(base.criteria.filter(k=>k.category===v.category).reduce((n,k)=>n+k.points,0))})),launch_review:{creation_purchase_raw:amount,observed_supply_raw:supply,creation_purchase_observed_supply_pct:pct,creation_at:creation?.block_time??null,supply_at:h?.observed_at??null,first_quote_at:first?.fetched_at??null,first_quote_delay_seconds:delay,early_reported_cap_usd:early,gaps:[...gaps]},staircase});
}
export const defaultScoreInputV3=(candidate:ScoreInputV3["candidate"],at:Date,prices:ScoreInputV3["prices"]=[],history_limited=false,first_market:ScoreInputV3["first_market"]=null):ScoreInputV3=>({version:"discovery-score-input-v3",as_of:at.toISOString(),candidate,prices,history_limited,first_market,policy:DISCOVERY_SCORE_POLICY_V3});
export async function freezeDiscoveryScoreV3(raw:ScoreInputV3){const inputs=ScoreInputV3Schema.parse(raw);if(new TextEncoder().encode(JSON.stringify(inputs)).length>1_800_000)throw new DiscoveryScoreError("discovery_score_input_size_limit");const result=evaluateDiscoveryScoreV3(inputs),hashes={input_hash:await hashJson(inputs),policy_hash:await hashJson(inputs.policy),result_hash:await hashJson(result)};return ScoreRecordV3Schema.parse({version:"discovery-scorecard-v3",inputs,result,...hashes,record_hash:await hashJson({version:"discovery-scorecard-v3",...hashes})});}
export function scoreSummaryV3(r:Awaited<ReturnType<typeof freezeDiscoveryScoreV3>>){return ScoreSummaryV3Schema.parse({version:"discovery-score-v3",as_of:r.result.as_of,value:r.result.value,evidence_coverage:r.result.evidence_coverage,ceiling:r.result.ceiling,risk_flags:r.result.concerns,input_hash:r.input_hash,policy_hash:r.policy_hash,result_hash:r.result_hash,record_hash:r.record_hash});}
