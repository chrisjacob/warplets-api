import {CandidateSchema} from "./model";
import {DISCOVERY_SCORE_POLICY_V4} from "./discovery-score-v4-model";
import {defaultScoreInputV4,freezeDiscoveryScoreV4} from "./discovery-score-v4";
import {DiscoveryScoreError} from "./discovery-score";
import {scoreFirstMarkets,scoreIntegrityPriceInputs} from "./discovery-score-store";
import {freezeScoreCohort,freezeScoreOutcome,replayScoreCohort,replayScoreOutcome,SCORE_OUTCOME_DELAY,ScoreResearchError,verifyScoreCohortSummary,verifyScoreOutcomeSummary} from "./score-research-analysis";
import {SCORE_RESEARCH_LIMITS as L,ScoreCohortSchema,ScoreCohortSummarySchema,ScoreEndpointSchema,ScoreOutcomeSchema,ScoreOutcomeSummarySchema,ScoreResearchDetailSchema,ScoreResearchSchema,type ScoreCohort,type ScoreCohortSummary,type ScoreOutcome,type ScoreModel} from "./score-research-model";

import {sharedResearchRecords,sharedResearchBytes,sharedResearchUsage} from "./research-budget";

import {researchLimits,type ResearchMode} from "./research-limits";

const currentModel=DISCOVERY_SCORE_POLICY_V4.version;
const guard="EXISTS(SELECT 1 FROM tenx_score_control WHERE id=1 AND lease_owner=?1 AND lease_until>?2) AND EXISTS(SELECT 1 FROM tenx_control WHERE id=1 AND paused=0)";
export async function scoreResearchDetail(db:D1Database,address:string,model:ScoreModel=currentModel){
  const row=await db.prepare("SELECT payload,cohort_hash FROM tenx_score_cohorts WHERE address=?1 AND model=?2").bind(address,model).first<{payload:string;cohort_hash:string}>();
  if(!row)return null;
  const cohort=await replayScoreCohort(ScoreCohortSchema.parse(JSON.parse(row.payload)));
  if(cohort.summary.score.version!==model||cohort.summary.address!==address||cohort.summary.cohort_hash!==row.cohort_hash)throw new ScoreResearchError("score_cohort_identity_mismatch");
  const saved=await db.prepare("SELECT payload FROM tenx_score_outcomes WHERE address=?1 AND model=?2").bind(address,model).first<{payload:string}>();
  const outcome=saved?await replayScoreOutcome(ScoreOutcomeSchema.parse(JSON.parse(saved.payload)),cohort.summary):null;
  return ScoreResearchDetailSchema.parse({cohort,outcome,replay:"verified",provider_requests:0});
}
export async function publishScoreCohort(db:D1Database,record:ScoreCohort,owner:string,now:Date,mode:ResearchMode="bounded"){
  const limits=researchLimits(mode);
  const r=await replayScoreCohort(record),payload=JSON.stringify(r),bytes=new TextEncoder().encode(payload).length,at=now.toISOString(),day=at.slice(0,10);
  if(bytes>L.record_bytes)throw new ScoreResearchError("score_cohort_size_limit");
  if(r.summary.captured_at>at||now.getTime()-Date.parse(r.summary.captured_at)>L.lease_ms||at.slice(0,10)!==r.summary.captured_at.slice(0,10))throw new ScoreResearchError("score_capture_time_mismatch");
  const results=await db.batch([
    db.prepare(`INSERT OR IGNORE INTO tenx_score_cohorts(address,model,captured_at,day,cohort_hash,bytes,payload)
      SELECT ?3,?4,?5,?6,?7,?8,?9 WHERE ${guard}
      AND (?10 IS NULL OR ${sharedResearchRecords}<?10)
      AND (?11 IS NULL OR ${sharedResearchBytes}+?8<=?11)`).bind(owner,at,r.summary.address,r.summary.score.version,r.summary.captured_at,day,r.summary.cohort_hash,bytes,payload,limits.daily_records,limits.daily_bytes),
    db.prepare("INSERT INTO tenx_audit(id,action,actor,reason,data_hash,created_at) SELECT ?1,'score_cohort','local-score-research','Prospective first score; observational, no policy activation',?2,?3 WHERE changes()=1").bind(`score-cohort:${r.summary.score.version}:${r.summary.address}`,r.summary.cohort_hash,at),
  ]);
  return results[0]!.meta.changes===1;
}
async function publishOutcome(db:D1Database,r:ScoreOutcome,owner:string,at:string){
  const c=r.inputs.cohort;
  const result=await db.prepare(`INSERT OR IGNORE INTO tenx_score_outcomes(address,model,cohort_hash,finalized_at,payload) SELECT ?3,?4,?5,?6,?7 WHERE ${guard} AND EXISTS(SELECT 1 FROM tenx_score_cohorts WHERE address=?3 AND model=?4 AND cohort_hash=?5)`).bind(owner,at,c.address,c.score.version,c.cohort_hash,r.result.finalized_at,JSON.stringify(r)).run();
  return result.meta.changes===1;
}
export async function runScoreResearch(db:D1Database,observedAt?:Date,captureAllowance:number=L.captures,mode:ResearchMode="bounded"){
  if(!Number.isInteger(captureAllowance)||captureAllowance<0||captureAllowance>L.captures)throw new ScoreResearchError("score_capture_allowance_invalid");
  const now=()=>observedAt??new Date(),started=now(),at=started.toISOString(),owner=crypto.randomUUID();
  if((await db.prepare("SELECT paused FROM tenx_control WHERE id=1").first<{paused:number}>())?.paused)return {state:"paused",provider_requests:0};
  const lease=await db.prepare(`UPDATE tenx_score_control SET lease_owner=?1,lease_until=?2,next_at=?3 WHERE id=1 AND (lease_until IS NULL OR lease_until<=?4) AND (next_at IS NULL OR next_at<=?4) AND EXISTS(SELECT 1 FROM tenx_control WHERE id=1 AND paused=0) RETURNING id`).bind(owner,new Date(started.getTime()+L.lease_ms).toISOString(),new Date(started.getTime()+L.interval_ms).toISOString(),at).first();
  if(!lease)return {state:"waiting",provider_requests:0};
  let captured=0,finalized=0,attempted=0;
  try{
    const mature=await db.prepare("SELECT c.address,c.model FROM tenx_score_cohorts c LEFT JOIN tenx_score_outcomes o ON o.address=c.address AND o.model=c.model WHERE o.address IS NULL AND c.captured_at<=?1 ORDER BY c.captured_at,c.address,c.model LIMIT 5").bind(new Date(started.getTime()-SCORE_OUTCOME_DELAY).toISOString()).all<{address:string;model:ScoreModel}>();
    for(const row of mature.results){
      const detail=(await scoreResearchDetail(db,row.address,row.model))!,cohort=detail.cohort.summary,target=Date.parse(cohort.captured_at)+86_400_000;
      const rows=await db.prepare(`SELECT fetched_at,json_extract(payload,'$.fetched_at') AS snapshot_at,json_extract(payload,'$.source') AS source,json_extract(payload,'$.observed_at') AS observed_at,json_extract(payload,'$.price_usd') AS price_usd,json_extract(payload,'$.liquidity_usd') AS liquidity_usd FROM tenx_market_history WHERE address=?1 AND fetched_at>=?2 AND fetched_at<=?3 ORDER BY fetched_at LIMIT 257`).bind(row.address,new Date(target-1800000).toISOString(),new Date(target+7200000).toISOString()).all<{fetched_at:string;snapshot_at:string;source:string;observed_at:string|null;price_usd:number|null;liquidity_usd:number|null}>();
      if(rows.results.some(p=>p.fetched_at!==p.snapshot_at))throw new ScoreResearchError("score_endpoint_identity_mismatch");
      const outcome=await freezeScoreOutcome({version:"score-outcome-input-v1",cohort,finalized_at:now().toISOString(),points:rows.results.slice(0,L.endpoint_samples).map(p=>ScoreEndpointSchema.parse({source:p.source,fetched_at:p.fetched_at,observed_at:p.observed_at,price_usd:p.price_usd,liquidity_usd:p.liquidity_usd})),history_limited:rows.results.length>L.endpoint_samples});
      if(await publishOutcome(db,outcome,owner,now().toISOString()))finalized++;
    }
    const rows=await db.prepare(`SELECT c.address,CASE WHEN length(CAST(c.payload AS BLOB))<=1600000 THEN c.payload ELSE NULL END AS payload
      FROM tenx_active_candidates c LEFT JOIN tenx_score_cohorts s ON s.address=c.address AND s.model=?1 LEFT JOIN tenx_score_attempts a ON a.address=c.address AND a.model=?1
      WHERE c.mode='live' AND s.address IS NULL AND julianday(json_extract(c.payload,'$.creation.block_time')) BETWEEN julianday(?2)-1 AND julianday(?2)
      ORDER BY COALESCE(a.attempted_at,''),json_extract(c.payload,'$.first_seen_at'),c.address LIMIT ?3`).bind(currentModel,at,captureAllowance).all<{address:string;payload:string|null}>();
    for(const row of rows.results){
      attempted++;let gap="";
      try{
        if(!row.payload)throw new ScoreResearchError("score_cohort_size_limit");
        const candidate=CandidateSchema.parse(JSON.parse(row.payload));
        if(candidate.address!==row.address)throw new ScoreResearchError("score_capture_identity_mismatch");
        const captureAt=now(),history=(await scoreIntegrityPriceInputs(db,[row.address],captureAt)).get(row.address);
        const firstMarket=(await scoreFirstMarkets(db,[row.address],captureAt)).get(row.address)??null;
        const cohort=await freezeScoreCohort(await freezeDiscoveryScoreV4(defaultScoreInputV4(candidate,captureAt,history?.prices??[],history?.history_limited??false,firstMarket)));
        if(await publishScoreCohort(db,cohort,owner,now(),mode))captured++;else gap="score_capture_paused_lease_lost_duplicate_or_daily_bound";
      }catch(error){if(error instanceof ScoreResearchError||error instanceof DiscoveryScoreError)gap=error.message;else throw error;}
      await db.prepare(`INSERT INTO tenx_score_attempts(address,model,attempted_at,gap) SELECT ?3,?5,?2,?4 WHERE ${guard} ON CONFLICT(address,model) DO UPDATE SET attempted_at=excluded.attempted_at,gap=excluded.gap`).bind(owner,now().toISOString(),row.address,gap,currentModel).run();
    }
    const finished=await db.prepare(`UPDATE tenx_score_control SET last_success=?2,last_error=NULL,lease_owner=NULL,lease_until=NULL WHERE id=1 AND ${guard}`).bind(owner,now().toISOString()).run();
    return {state:finished.meta.changes===1?"succeeded":"held",captured,finalized,attempted,provider_requests:0};
  }catch(error){
    const code=error instanceof ScoreResearchError||error instanceof DiscoveryScoreError?error.message:"score_research_unavailable";
    await db.prepare("UPDATE tenx_score_control SET last_error=?2,lease_owner=NULL,lease_until=NULL WHERE id=1 AND lease_owner=?1 AND lease_until>?3").bind(owner,code,now().toISOString()).run();
    return {state:"failed",error_code:code,provider_requests:0};
  }
}
export async function scoreResearch(db:D1Database,now=new Date(),model:ScoreModel=currentModel,mode:ResearchMode="bounded"){
  const limits=researchLimits(mode);
  const rows=await db.prepare("SELECT c.address,c.cohort_hash,json_extract(c.payload,'$.summary') AS summary,json_remove(o.payload,'$.inputs') AS outcome FROM tenx_score_cohorts c LEFT JOIN tenx_score_outcomes o ON o.address=c.address AND o.model=c.model WHERE c.model=?1 ORDER BY c.captured_at DESC,c.address LIMIT 501").bind(model).all<{address:string;cohort_hash:string;summary:string;outcome:string|null}>();
  const records:{cohort:ScoreCohortSummary;outcome:ScoreOutcome["result"]|null}[]=[];
  for(const row of rows.results.slice(0,L.summary_records)){
    const c=await verifyScoreCohortSummary(ScoreCohortSummarySchema.parse(JSON.parse(row.summary)));
    if(c.score.version!==model||c.address!==row.address||c.cohort_hash!==row.cohort_hash||Date.parse(c.captured_at)>now.getTime())throw new ScoreResearchError("score_summary_identity_mismatch");
    const outcome=row.outcome?await verifyScoreOutcomeSummary(ScoreOutcomeSummarySchema.parse(JSON.parse(row.outcome)),c):null;
    if(outcome&&Date.parse(outcome.result.finalized_at)>now.getTime())throw new ScoreResearchError("score_outcome_from_future");
    records.push({cohort:c,outcome:outcome?.result??null});
  }
  const counts=(xs:typeof records)=>({captured:xs.length,pending:xs.filter(r=>!r.outcome).length,measured:xs.filter(r=>r.outcome?.status==="measured").length,insufficient:xs.filter(r=>r.outcome?.status==="insufficient_data").length});
  const day=now.toISOString().slice(0,10),today=await sharedResearchUsage(db,day);
  const automation=await db.prepare("SELECT next_at,last_success,last_error FROM tenx_score_control WHERE id=1").first();
  const attempts=await db.prepare("SELECT address,attempted_at,gap FROM tenx_score_attempts WHERE model=?1 AND gap<>'' ORDER BY attempted_at DESC,address LIMIT 10").bind(model).all();
  return ScoreResearchSchema.parse({at:now.toISOString(),model,scope:"latest_500_score_cohorts",capped:rows.results.length>L.summary_records,automatic_policy_changes:false,provider_requests:0,limits:{daily_records:limits.daily_records,daily_bytes:limits.daily_bytes},today:{day,...today},automation,counts:counts(records),bands:[0,20,40,60,80].map(minimum=>{const maximum=minimum===80?100:minimum+19,items=records.filter(r=>r.cohort.score.value>=minimum&&r.cohort.score.value<=maximum);return {minimum,maximum,...counts(items),severe_declines:items.filter(r=>r.outcome?.severe_decline===true).length};}),recent:records.slice(0,20),attempts:attempts.results});
}
