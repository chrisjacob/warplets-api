import {assess,PolicySchema} from "./model";
import {replayDiscoveryScore,scoreSummary} from "./discovery-score";
import type {ScoreRecord} from "./discovery-score-model";
import {ScoreCohortHeaderSchema,ScoreCohortSchema,ScoreCohortSummarySchema,ScoreEndpointSchema,ScoreOutcomeInputSchema,ScoreOutcomeResultSchema,ScoreOutcomeSchema,ScoreOutcomeSummarySchema,type ScoreCohort,type ScoreCohortSummary,type ScoreOutcome} from "./score-research-model";
import type {z} from "zod";
import {hashJson} from "./solana";

export class ScoreResearchError extends Error {}
export const SCORE_OUTCOME_DELAY=26*3_600_000;
// Frozen with score-cohort-v1. Never follow a later DEFAULT_POLICY here.
const ACTION_POLICY_V1=Object.freeze(PolicySchema.parse({version:"discovery-local-v3",max_candidates:100,max_age_hours:24,min_market_cap_usd:100000,min_liquidity_usd:25000,max_market_age_seconds:180,max_risk_age_seconds:600,require_holder_evidence:true,min_holders:100,max_top1_pct:10,max_top10_pct:35,max_creator_pct:5,max_holder_age_seconds:1800,require_wallet_analysis:true,min_sampled_buyers:3,max_wallet_age_seconds:3600,max_dev_funded_supply_pct:20,max_dev_sold_supply_pct:5}));
export async function verifyScoreCohortSummary(raw:ScoreCohortSummary){
  const r=ScoreCohortSummarySchema.parse(raw),{cohort_hash,...header}=r;
  if(r.captured_at!==r.score.as_of||await hashJson(header)!==cohort_hash)throw new ScoreResearchError("score_cohort_summary_mismatch");
  return r;
}
export async function freezeScoreCohort(scorecard:ScoreRecord,includeActionPolicy=true):Promise<ScoreCohort>{
  await replayDiscoveryScore(scorecard);
  const c=scorecard.inputs.candidate,at=new Date(scorecard.result.as_of),now=at.getTime();
  if(c.mode!=="live"||!c.creation||Date.parse(c.creation.block_time)>now||now-Date.parse(c.creation.block_time)>86_400_000)throw new ScoreResearchError("recent_live_creation_required");
  const times=[c.checked_at,c.first_seen_at,c.creation.fetched_at,c.graduation?.fetched_at,c.graduation?.block_time,c.risk.observed_at,c.holders?.observed_at,c.wallet_analysis?.observed_at,c.market?.fetched_at,c.market?.observed_at];
  if(times.some(t=>t&&Date.parse(t)>now)||scorecard.inputs.prices.some(p=>Date.parse(p.fetched_at)>now||p.observed_at&&Date.parse(p.observed_at)>now))throw new ScoreResearchError("future_score_evidence_not_captured");
  const m=c.market,baseline=m&&now-Date.parse(m.fetched_at)<=180000&&(!m.observed_at||Date.parse(m.observed_at)<=Date.parse(m.fetched_at))?ScoreEndpointSchema.parse({source:m.source,fetched_at:m.fetched_at,observed_at:m.observed_at,price_usd:m.price_usd,liquidity_usd:m.liquidity_usd}):null;
  const header=ScoreCohortHeaderSchema.parse({version:"score-cohort-v1",address:c.address,symbol:c.symbol,captured_at:at.toISOString(),score:scoreSummary(scorecard),action_status:assess(c,ACTION_POLICY_V1,at).eligibility,baseline});
  return ScoreCohortSchema.parse({summary:{...header,cohort_hash:await hashJson(header)},scorecard,...(includeActionPolicy?{action_policy:ACTION_POLICY_V1}:{})});
}
export async function replayScoreCohort(raw:ScoreCohort){
  const r=ScoreCohortSchema.parse(raw),expected=await freezeScoreCohort(r.scorecard,r.action_policy!==undefined);
  if(await hashJson(r)!==await hashJson(expected))throw new ScoreResearchError("score_cohort_replay_mismatch");
  return r;
}
export function deriveScoreOutcome(raw:ScoreOutcome["inputs"]){
  const input=ScoreOutcomeInputSchema.parse(raw),c=input.cohort,baseline=c.baseline,captured=Date.parse(c.captured_at),target=captured+86_400_000,end=captured+SCORE_OUTCOME_DELAY;
  if(Date.parse(input.finalized_at)<end)throw new ScoreResearchError("score_outcome_not_mature");
  const times=new Map<number,number>();for(const p of input.points){const time=Date.parse(p.fetched_at);times.set(time,(times.get(time)??0)+1);}
  const usable=input.points.filter(p=>Date.parse(p.fetched_at)>=target-1800000&&Date.parse(p.fetched_at)<=end&&Date.parse(p.fetched_at)<=Date.parse(input.finalized_at)&&(!p.observed_at||Date.parse(p.observed_at)<=Date.parse(p.fetched_at))&&times.get(Date.parse(p.fetched_at))===1&&p.source===baseline?.source&&p.price_usd!==null&&p.liquidity_usd!==null);
  const endpoint=!input.history_limited&&baseline?usable.sort((a,b)=>Math.abs(Date.parse(a.fetched_at)-target)-Math.abs(Date.parse(b.fetched_at)-target)||(a.fetched_at<b.fetched_at?-1:a.fetched_at>b.fetched_at?1:0))[0]??null:null;
  const change=(start:number|null|undefined,finish:number|null|undefined)=>{const v=start!=null&&start>0&&finish!=null?(finish/start-1)*100:null;return v!==null&&Number.isFinite(v)?v:null;};
  const price=change(baseline?.price_usd,endpoint?.price_usd),liquidity=change(baseline?.liquidity_usd,endpoint?.liquidity_usd),measured=price!==null&&liquidity!==null;
  return ScoreOutcomeResultSchema.parse({version:"score-outcome-result-v1",cohort_hash:c.cohort_hash,target_at:new Date(target).toISOString(),window_end:new Date(end).toISOString(),finalized_at:input.finalized_at,status:measured?"measured":"insufficient_data",endpoint,price_return_pct:price,liquidity_change_pct:liquidity,severe_decline:measured?price<=-80||liquidity<=-80:null,gaps:["provider_samples_not_continuous","observational_selection_and_missingness_bias","decline_not_proof_of_fraud",...(baseline?[]:["fresh_baseline_unavailable"]),...(input.history_limited?["endpoint_sample_limit"]:[]),...(input.points.some(p=>(times.get(Date.parse(p.fetched_at))??0)>1)?["duplicate_endpoint_times_excluded"]:[]),...(input.points.some(p=>baseline&&p.source!==baseline.source)?["endpoint_source_mismatch_excluded"]:[]),...(input.points.some(p=>p.observed_at&&Date.parse(p.observed_at)>Date.parse(p.fetched_at))?["endpoint_future_observation_excluded"]:[]),...(input.points.some(p=>Date.parse(p.fetched_at)<target-1800000||Date.parse(p.fetched_at)>end)?["endpoint_outside_window_excluded"]:[]),...(endpoint?[]:["comparable_24h_endpoint_missing"]),...(price===null?["price_comparison_unavailable"]:[]),...(liquidity===null?["liquidity_comparison_unavailable"]:[])]});
}
export async function freezeScoreOutcome(raw:ScoreOutcome["inputs"]):Promise<ScoreOutcome>{
  const inputs=ScoreOutcomeInputSchema.parse(raw);await verifyScoreCohortSummary(inputs.cohort);
  const result=deriveScoreOutcome(inputs),metadata={version:"score-outcome-v1" as const,input_hash:await hashJson(inputs),result_hash:await hashJson(result)};
  return ScoreOutcomeSchema.parse({...metadata,inputs,result,outcome_hash:await hashJson(metadata)});
}
export async function verifyScoreOutcomeSummary(raw:z.infer<typeof ScoreOutcomeSummarySchema>,cohort:ScoreCohortSummary){
  const r=ScoreOutcomeSummarySchema.parse(raw),{result,outcome_hash,...metadata}=r;
  if(result.cohort_hash!==cohort.cohort_hash||Date.parse(result.target_at)!==Date.parse(cohort.captured_at)+86400000||Date.parse(result.window_end)!==Date.parse(cohort.captured_at)+SCORE_OUTCOME_DELAY||Date.parse(result.finalized_at)<Date.parse(result.window_end)||await hashJson(result)!==r.result_hash||await hashJson(metadata)!==outcome_hash)throw new ScoreResearchError("score_outcome_summary_mismatch");
  return r;
}
export async function replayScoreOutcome(raw:ScoreOutcome,cohort:ScoreCohortSummary){
  const r=ScoreOutcomeSchema.parse(raw);await verifyScoreCohortSummary(cohort);
  if(await hashJson(r.inputs.cohort)!==await hashJson(cohort)||await hashJson(await freezeScoreOutcome(r.inputs))!==await hashJson(r))throw new ScoreResearchError("score_outcome_replay_mismatch");
  return r;
}
