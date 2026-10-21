import {DISCOVERY_SCORE_POLICY} from "./discovery-score-model";
import {evaluateDiscoveryScore,replayDiscoveryScore,DiscoveryScoreError} from "./discovery-score";
import {AnyScoreRecordSchema,DISCOVERY_SCORE_POLICY_V2,ScoreInputV2Schema,ScoreResultV2Schema,ScoreRecordV2Schema,ScoreSummaryV2Schema,type ScoreInputV2,type AnyScoreRecord} from "./discovery-score-v2-model";
import {hashJson} from "./solana";

const round=(n:number)=>Math.round(n*100)/100;
export function evaluateDiscoveryScoreV2(raw:ScoreInputV2){
  const input=ScoreInputV2Schema.parse(raw),now=Date.parse(input.as_of),c=input.candidate,r=input.policy.integrity;
  // Retain the original support calculation, limited to its declared 2h/64 points.
  const recent=input.prices.filter(p=>Date.parse(p.fetched_at)>=now-input.policy.performance.window_seconds*1000).sort((a,b)=>Date.parse(a.fetched_at)-Date.parse(b.fetched_at));
  const base=evaluateDiscoveryScore({...input,version:"discovery-score-input-v1",policy:DISCOVERY_SCORE_POLICY,prices:recent.slice(-64),history_limited:input.history_limited||recent.length>64});
  const gaps=new Set<string>(),concerns=[...base.concerns];
  const cap=(code:string,ceiling:number,observed_at:string|null)=>concerns.push({code,ceiling:round(ceiling),observed_at});
  const prices=[...input.prices].sort((a,b)=>Date.parse(a.fetched_at)-Date.parse(b.fetched_at));
  const counts=new Map<number,number>();for(const p of prices){const t=Date.parse(p.fetched_at);counts.set(t,(counts.get(t)??0)+1);}
  let previous:typeof prices[number]|null=null,pricePairs=0,largestJump:number|null=null,jumpAt:string|null=null;
  for(const p of prices){
    const t=Date.parse(p.fetched_at);
    if(t>now||p.observed_at&&Date.parse(p.observed_at)>now||t<now-r.history_seconds*1000||p.price_usd===null||p.price_usd<=0||counts.get(t)!>1){gaps.add("price_comparison_unavailable");previous=null;continue;}
    if(previous){
      const elapsed=t-Date.parse(previous.fetched_at);
      if(p.source!==previous.source||elapsed>r.jump_gap_seconds*1000){gaps.add("price_source_or_time_gap");}
      else {
        const ratio=p.price_usd/previous.price_usd!,step=(ratio-1)*100;
        if(Number.isFinite(step)&&ratio>0){
          pricePairs++;if(largestJump===null||Math.abs(step)>Math.abs(largestJump))largestJump=round(step);
          if(ratio>=r.jump_up_ratio||ratio<=r.jump_down_ratio)jumpAt=p.fetched_at;
        }else gaps.add("price_comparison_nonfinite");
      }
    }
    previous=p;
  }
  if(!pricePairs)gaps.add("price_pairs_unavailable");if(input.history_limited)gaps.add("price_history_sample_limited");
  if(jumpAt)cap("abrupt_sampled_price_move",r.jump_ceiling,jumpAt);
  const m=c.market,marketDated=Boolean(m&&Date.parse(m.fetched_at)<=now&&(!m.observed_at||Date.parse(m.observed_at)<=now));
  const rawRatio=marketDated&&m!.market_cap_usd!==null&&m!.market_cap_usd>0&&m!.liquidity_usd!==null?m!.liquidity_usd/m!.market_cap_usd:null;
  const depth=rawRatio!==null&&Number.isFinite(rawRatio)?rawRatio:null;
  if(depth!==null&&depth<r.depth_reference_ratio)cap("thin_reported_depth_relative_to_cap",100*Math.sqrt(Math.max(0,depth)/r.depth_reference_ratio),m!.fetched_at);
  if(depth===null)gaps.add("relative_depth_unknown");
  const w=c.wallet_analysis,usable=Boolean(w&&w.status!=="unavailable"&&Date.parse(w.observed_at)<=now);
  const after=c.creation?Date.parse(c.creation.block_time):null;
  const trades=usable?w!.trades:[],seen=new Set<string>(),duplicates=new Set<string>();
  for(const t of trades){const key=`${t.signature}:${t.instruction_index}`;if(seen.has(key))duplicates.add(key);seen.add(key);}
  const sample=trades.filter(t=>{
    const date=Date.parse(t.block_time);
    return after!==null&&date>after&&date<=now&&date<=Date.parse(w!.observed_at)&&!duplicates.has(`${t.signature}:${t.instruction_index}`)&&t.quote_amount_raw!==null;
  });
  if(duplicates.size)gaps.add("duplicate_trade_identity");
  if(!usable||after===null)gaps.add("trade_sample_unavailable");
  if(usable&&now-Date.parse(w!.observed_at)>input.policy.freshness_seconds.wallets*1000)gaps.add("wallet_sample_stale");
  if(trades.some(t=>t.quote_amount_raw===null))gaps.add("trade_quote_unknown");
  // Both supported quote kinds are canonical SOL/WSOL with nine decimals.
  // Exclude the initial creation buy; never mistake it for later participation.
  const buyers=new Map<string,bigint>();for(const t of sample)if(t.side==="buy")buyers.set(t.wallet,(buyers.get(t.wallet)??0n)+BigInt(t.quote_amount_raw!));
  const qualifying=[...buyers.values()].filter(q=>q>=BigInt(r.participation_quote_lamports)).length;
  const dust=sample.filter(t=>BigInt(t.quote_amount_raw!)<=BigInt(r.dust_quote_lamports)).length,distinct=new Set(sample.map(t=>t.wallet)).size;
  if(sample.length>=r.dust_min_trades&&distinct>=r.dust_min_wallets&&dust/sample.length>=r.dust_fraction)cap("dust_dominated_post_creation_trade_sample",r.dust_ceiling,w!.observed_at);
  gaps.add("non_exhaustive_trade_sample");gaps.add("organic_trading_unverified");
  // V1 counted every tiny buy as participation. Only observed, material buys
  // can now earn that credit; never increase credit beyond the v1 amount.
  const buyer=base.criteria.find(x=>x.id==="sampled_buyers")!;
  const oldBuyers=w?.metrics.distinct_buyers??0;
  buyer.points=round(buyer.points*Math.min(1,Math.min(1,qualifying/input.policy.targets.buyers)/Math.max(1e-12,Math.min(1,oldBuyers/input.policy.targets.buyers))));
  buyer.value=qualifying;buyer.notes=[...buyer.notes,"post_creation_buy_volume_at_least_0_01_sol"].slice(0,8);
  if(qualifying===0)buyer.points=0;
  // A positive chart move cannot earn momentum credit while any new market
  // integrity concern constrains the grade. Coverage is still shown separately.
  if(concerns.length>base.concerns.length){const performance=base.criteria.find(x=>x.id==="sampled_performance")!;performance.points=0;performance.notes=[...performance.notes,"market_integrity_concern_withholds_momentum"].slice(0,8);}
  const basePoints=round(base.criteria.reduce((n,x)=>n+x.points,0)),ceiling=Math.min(100,...concerns.map(x=>x.ceiling));
  return ScoreResultV2Schema.parse({...base,version:"discovery-score-result-v2",base_points:basePoints,ceiling,value:Math.max(0,Math.floor(Math.min(basePoints,ceiling)+1e-8)),concerns,
    components:base.components.map(x=>({...x,points:round(base.criteria.filter(k=>k.category===x.category).reduce((n,k)=>n+k.points,0))})),
    integrity:{scope:"cached_observations_not_fraud_verdict",history_limited:input.history_limited,price_pairs:pricePairs,largest_jump_pct:largestJump,jump_at:jumpAt,liquidity_cap_ratio:depth,sampled_trades:sample.length,dust_trades:dust,sampled_wallets:distinct,qualifying_buyers:qualifying,wallet_observed_at:usable?w!.observed_at:null,gaps:[...gaps]},
  });
}
export const defaultScoreInputV2=(candidate:ScoreInputV2["candidate"],at:Date,prices:ScoreInputV2["prices"]=[],history_limited=false):ScoreInputV2=>({version:"discovery-score-input-v2",as_of:at.toISOString(),candidate,prices,history_limited,policy:DISCOVERY_SCORE_POLICY_V2});
export async function freezeDiscoveryScoreV2(raw:ScoreInputV2){
  const inputs=ScoreInputV2Schema.parse(raw);if(new TextEncoder().encode(JSON.stringify(inputs)).length>1_800_000)throw new DiscoveryScoreError("discovery_score_input_size_limit");
  const result=evaluateDiscoveryScoreV2(inputs),hashes={input_hash:await hashJson(inputs),policy_hash:await hashJson(inputs.policy),result_hash:await hashJson(result)};
  return ScoreRecordV2Schema.parse({version:"discovery-scorecard-v2",inputs,result,...hashes,record_hash:await hashJson({version:"discovery-scorecard-v2",...hashes})});
}
export async function replayAnyDiscoveryScore(raw:AnyScoreRecord){
  const r=AnyScoreRecordSchema.parse(raw);if(r.version==="discovery-scorecard-v1")return replayDiscoveryScore(r);
  if(await hashJson(await freezeDiscoveryScoreV2(r.inputs))!==await hashJson(r))throw new DiscoveryScoreError("discovery_score_replay_mismatch");
  return {status:"verified" as const,provider_requests:0 as const};
}
export function scoreSummaryV2(r:Awaited<ReturnType<typeof freezeDiscoveryScoreV2>>){return ScoreSummaryV2Schema.parse({version:"discovery-score-v2",as_of:r.result.as_of,value:r.result.value,evidence_coverage:r.result.evidence_coverage,ceiling:r.result.ceiling,risk_flags:r.result.concerns,input_hash:r.input_hash,policy_hash:r.policy_hash,result_hash:r.result_hash,record_hash:r.record_hash});}
