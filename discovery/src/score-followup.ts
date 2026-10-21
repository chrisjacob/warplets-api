import {Address} from "./model";
import {ScoreCohortSummarySchema} from "./score-research-model";
import {scoreResearchDetail} from "./score-research";
import {verifyScoreCohortSummary,ScoreResearchError} from "./score-research-analysis";
import {SCORE_FOLLOWUP_LIMITS as L,ScoreFollowupSchema,type ScoreFollowupRowSchema} from "./score-followup-model";
import type {z} from "zod";

// The source quote must be compatible with the frozen baseline; zero endpoint
// values are valid observations. No fabricated endpoint, new RPC or retry job.
const validQuote=`h.fetched_at=json_extract(h.payload,'$.fetched_at')
  AND json_extract(h.payload,'$.source')=json_extract(s.payload,'$.summary.baseline.source')
  AND json_type(h.payload,'$.price_usd') IN ('integer','real') AND json_extract(h.payload,'$.price_usd')>=0
  AND json_type(h.payload,'$.liquidity_usd') IN ('integer','real') AND json_extract(h.payload,'$.liquidity_usd')>=0
  AND NOT EXISTS(SELECT 1 FROM tenx_market_history duplicate WHERE duplicate.address=h.address AND duplicate.fetched_at<>h.fetched_at AND julianday(duplicate.fetched_at)=julianday(h.fetched_at))
  AND (json_extract(h.payload,'$.observed_at') IS NULL OR julianday(json_extract(h.payload,'$.observed_at'))<=julianday(h.fetched_at))`;
export async function scoreFollowupPlan(db:D1Database,provider:"geckoterminal"|"dexscreener",enabled:boolean,now=new Date(),excluded:ReadonlySet<string>=new Set()){
  const at=now.toISOString(),state=await db.prepare("SELECT paused FROM tenx_control WHERE id=1").first<{paused:number}>();
  const source=await db.prepare("SELECT next_refresh_at,last_error FROM tenx_market_control WHERE id=1").first<{next_refresh_at:string|null;last_error:string|null}>();
  const rows=await db.prepare(`SELECT s.address,s.captured_at,s.cohort_hash,json_extract(s.payload,'$.summary') AS summary,
    json_extract(s.payload,'$.scorecard.inputs.candidate.pool') AS frozen_pool,
    json_extract(s.payload,'$.scorecard.inputs.candidate.address') AS frozen_address,
    json_extract(s.payload,'$.scorecard.inputs.candidate.mode') AS frozen_mode,
    c.pool,json_extract(c.payload,'$.pool') AS payload_pool,json_extract(c.payload,'$.address') AS payload_address,
    a.attempted_at,
    CASE WHEN julianday(?1)>=julianday(s.captured_at)+23.5/24 THEN EXISTS(SELECT 1 FROM tenx_market_history h WHERE h.address=s.address
      AND h.fetched_at>=strftime('%Y-%m-%dT%H:%M:%fZ',s.captured_at,'+23 hours','+30 minutes') AND h.fetched_at<strftime('%Y-%m-%dT%H:%M:%fZ',s.captured_at,'+24 hours') AND h.fetched_at<=?1 AND ${validQuote}) ELSE 0 END AS before_saved,
    CASE WHEN julianday(?1)>=julianday(s.captured_at)+1 THEN EXISTS(SELECT 1 FROM tenx_market_history h WHERE h.address=s.address
      AND h.fetched_at>=strftime('%Y-%m-%dT%H:%M:%fZ',s.captured_at,'+24 hours') AND h.fetched_at<=strftime('%Y-%m-%dT%H:%M:%fZ',s.captured_at,'+26 hours') AND h.fetched_at<=?1 AND ${validQuote}) ELSE 0 END AS after_saved
    FROM tenx_score_cohorts s LEFT JOIN tenx_score_outcomes o ON o.address=s.address AND o.model=s.model
    LEFT JOIN tenx_candidates c ON c.address=s.address AND c.mode='live' LEFT JOIN tenx_market_attempts a ON a.address=s.address
    WHERE s.model='discovery-score-v1' AND o.address IS NULL ORDER BY s.captured_at DESC,s.address LIMIT 501`).bind(at).all<{address:string;captured_at:string;cohort_hash:string;summary:string;frozen_pool:string|null;frozen_address:string|null;frozen_mode:string|null;pool:string|null;payload_pool:string|null;payload_address:string|null;attempted_at:string|null;before_saved:number;after_saved:number}>();
  const counts={pending:0,baseline_unavailable:0,provider_mismatch:0,identity_unavailable:0,awaiting_window:0,awaiting_target:0,window_closed:0,endpoint_saved:0,cooling_down:0,ready:0};
  const ready:z.infer<typeof ScoreFollowupRowSchema>[]=[],opportunities:number[]=[];
  for(const row of rows.results.slice(0,L.cohorts)){
    const c=await verifyScoreCohortSummary(ScoreCohortSummarySchema.parse(JSON.parse(row.summary)));
    if(c.address!==row.address||c.captured_at!==row.captured_at||c.cohort_hash!==row.cohort_hash||Date.parse(c.captured_at)>now.getTime())throw new ScoreResearchError("score_followup_cohort_identity_mismatch");
    counts.pending++;const baseline=c.baseline,target=Date.parse(c.captured_at)+86400000,start=target-L.before_ms,end=target+L.after_ms;
    if(!baseline||baseline.price_usd===null||baseline.price_usd<=0||baseline.liquidity_usd===null||baseline.liquidity_usd<=0){counts.baseline_unavailable++;continue;}
    if(baseline.source!==provider){counts.provider_mismatch++;continue;}
    if(!Address.safeParse(row.pool).success||row.pool!==row.payload_pool||row.pool!==row.frozen_pool||row.payload_address!==row.address||row.frozen_address!==row.address||row.frozen_mode!=="live"){counts.identity_unavailable++;continue;}
    if(now.getTime()<start){counts.awaiting_window++;opportunities.push(start);continue;}
    if(now.getTime()>end){counts.window_closed++;continue;}
    if(row.after_saved){counts.endpoint_saved++;continue;}
    if(now.getTime()<target&&row.before_saved){counts.awaiting_target++;opportunities.push(target);continue;}
    const next=row.attempted_at?Date.parse(row.attempted_at)+L.cooldown_ms:0;
    if(next>now.getTime()){counts.cooling_down++;if(next<=end)opportunities.push(next);continue;}
    counts.ready++;ready.push({address:row.address,pool:row.pool!,cohort_hash:c.cohort_hash,captured_at:c.captured_at,target_at:new Date(target).toISOString(),window_end:new Date(end).toISOString(),phase:now.getTime()<target?"pre_target":"post_target",last_attempt:row.attempted_at});
  }
  ready.sort((a,b)=>(a.phase==="post_target"?0:1)-(b.phase==="post_target"?0:1)||a.window_end.localeCompare(b.window_end)||(a.last_attempt??"").localeCompare(b.last_attempt??"")||a.address.localeCompare(b.address));
  return ScoreFollowupSchema.parse({policy:"score-endpoint-followup-v1",at,provider,state:!enabled?"disabled":state?.paused?"paused":counts.ready&&(!source?.next_refresh_at||source.next_refresh_at<=at)?"ready":counts.ready||opportunities.length?"waiting":"no_work",scope:"latest_500_pending_score_cohorts",capped:rows.results.length>L.cohorts,max_batch_slots:L.slots,cooldown_seconds:L.cooldown_ms/1000,next_window_at:opportunities.length?new Date(Math.min(...opportunities)).toISOString():null,market_next_at:source?.next_refresh_at??null,market_error:source?.last_error??null,counts,ready:ready.filter(r=>!excluded.has(r.address)).slice(0,L.slots),provider_requests:0});
}
export async function verifyScoreFollowup(db:D1Database,row:z.infer<typeof ScoreFollowupRowSchema>,provider:string){
  const detail=await scoreResearchDetail(db,row.address);
  if(!detail||detail.outcome||detail.cohort.summary.cohort_hash!==row.cohort_hash||detail.cohort.scorecard.inputs.candidate.pool!==row.pool||detail.cohort.summary.baseline?.source!==provider)throw new ScoreResearchError("score_followup_snapshot_changed");
}
