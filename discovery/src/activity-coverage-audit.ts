import {z} from "zod";
import {Address,CandidateSchema} from "./model";
import {ActivityMetric,ActivityObservation} from "./activity-observation";
import {commonActivity} from "./activity-observation-store";
import {hashJson} from "./solana";

const Hash=z.string().regex(/^[a-f0-9]{64}$/);
const METRICS_V1:z.infer<typeof ActivityMetric>[]=["pool_reported_volume_24h","token_reported_volume_24h","token_reported_volume_1h","token_reported_holders",
  "candle_window_volume","candle_max_adjacent_move","candle_longest_rising_run","raw_owner_net_change","wallet_reported_buy_usd","wallet_reported_sell_usd",
  "organic_volume_24h","meaningful_holder_growth_24h","attention_momentum"];
const Row=z.object({address:Address,candidate_hash:Hash.nullable(),age_band:z.enum(["first_day","older","unknown"]),
  state:z.enum(["available","held"]),observations:z.array(ActivityObservation).max(13),gaps:z.array(z.string().max(100)).max(4)}).strict();
export const CoverageAuditInput=z.object({version:z.literal("activity-coverage-input-v1"),cutoff_at:z.string().datetime(),
  scope:z.literal("all_retained_live_candidates"),rows:z.array(Row).max(500)}).strict().superRefine((input,ctx)=>{
  const seen=new Set<string>();
  for(const row of input.rows){
    if(seen.has(row.address)||row.observations.some(o=>o.address!==row.address||o.cutoff_at!==input.cutoff_at)||
      (row.state==="available"?row.candidate_hash===null||row.observations.length!==13||new Set(row.observations.map(o=>o.metric)).size!==13||!METRICS_V1.every(m=>row.observations.some(o=>o.metric===m)):
        row.candidate_hash!==null||row.observations.length!==0||row.age_band!=="unknown"||row.gaps.length===0))ctx.addIssue({code:"custom",message:"coverage_row_identity_or_partition"});
    seen.add(row.address);
  }
});
export type CoverageAuditInput=z.infer<typeof CoverageAuditInput>;
// Pinned for v1 replay. Extending a later collection's reference set must not
// silently reclassify this audit or change its original population denominator.
const REGRESSION_MINTS_V1=["ZyGXWijSJEgcCDb8CeSJ4Vj33iceATGoeKGidnfpump","AMK8R8NqJ18VQnxsoGgv75pZVLyAG24BafFfp3Zpump","CSocnzcRpgSCr1naKcNTieWZUxb6rABe45j844m7pump"];
const regression=(address:string)=>REGRESSION_MINTS_V1.includes(address);

/** Descriptive coverage only. Every metric keeps the full stratum denominator. */
export function summarizeActivityCoverage(raw:CoverageAuditInput){
  const input=CoverageAuditInput.parse(raw);
  const strata=[
    {id:"all_retained",rows:input.rows},
    {id:"coverage_population",rows:input.rows.filter(r=>!regression(r.address))},
    {id:"regression_references",rows:input.rows.filter(r=>regression(r.address))},
    ...(["first_day","older","unknown"] as const).map(age=>({id:`age_${age}`,rows:input.rows.filter(r=>r.age_band===age)})),
  ];
  return {version:"activity-coverage-summary-v1" as const,cutoff_at:input.cutoff_at,scope:input.scope,
    strata:strata.map(({id,rows})=>({id,candidates:rows.length,available_candidates:rows.filter(r=>r.state==="available").length,
      held_candidates:rows.filter(r=>r.state==="held").length,metrics:METRICS_V1.map(metric=>{
        const counts={reported_only:0,supported_sample:0,held:0,missing:0,rejected:0,candidate_held:0};
        const freshness={fresh:0,stale:0,unknown:0,candidate_held:0};
        let numeric=0,fresh_numeric=0,numeric_with_explicit_bounds=0,numeric_with_archived_hash_references=0;
        for(const row of rows){
          if(row.state==="held"){counts.candidate_held++;freshness.candidate_held++;continue;}
          const observation=row.observations.find(o=>o.metric===metric)!;
          counts[observation.qualification]++;freshness[observation.freshness]++;
          // Zero is a measured number. Never replace absence by zero or discard
          // held/rejected rows from the denominator to improve apparent coverage.
          if(observation.value!==null){
            numeric++;if(observation.freshness==="fresh")fresh_numeric++;
            if(observation.window.start_at&&observation.window.end_at)numeric_with_explicit_bounds++;
            if(observation.references.length&&observation.references.every(r=>r.integrity==="archived_hash_verified"))numeric_with_archived_hash_references++;
          }
        }
        return {metric,denominator:rows.length,qualification:counts,freshness,numeric,fresh_numeric,numeric_with_explicit_bounds,numeric_with_archived_hash_references};
      })})),
    provider_requests:0 as const,database_writes:0 as const,scoring_effect:"none" as const,
    organic_demand_certified:false as const,prospective_study_enrollment:false as const,
    limitations:["retained_inventory_not_whole_market","shared_cutoff_source_windows_differ","archive_hash_not_independent_authenticity",
      "regression_references_not_holdout","coverage_not_quality_or_model_validation","qualified_daily_metrics_remain_held"]};
}

export async function freezeActivityCoverage(raw:CoverageAuditInput){
  const inputs=CoverageAuditInput.parse(raw),summary=summarizeActivityCoverage(inputs);
  return {version:"activity-coverage-audit-v1" as const,inputs,summary,input_hash:await hashJson(inputs),summary_hash:await hashJson(summary)};
}
export async function verifyActivityCoverage(raw:unknown){
  const parsed=z.object({version:z.literal("activity-coverage-audit-v1"),inputs:CoverageAuditInput,summary:z.unknown(),input_hash:Hash,summary_hash:Hash}).strict().parse(raw);
  const expected=await freezeActivityCoverage(parsed.inputs);
  if(await hashJson(parsed)!==await hashJson(expected))throw Error("activity_coverage_replay_mismatch");
  return expected;
}

export async function activityCoverageAudit(db:D1Database,at=new Date(),deadline=Infinity){
  const saved=await db.prepare(`SELECT address,CASE WHEN count(*) OVER()>500 OR sum(length(CAST(payload AS BLOB))) OVER()>4000000
    OR max(length(CAST(payload AS BLOB))) OVER()>1600000 THEN NULL ELSE payload END AS payload
    FROM tenx_candidates WHERE mode='live' ORDER BY address LIMIT 501`).all<{address:string;payload:string|null}>();
  if(saved.results.length>500||saved.results.some(row=>row.payload===null))throw Error("activity_coverage_inventory_bound");
  const rows:CoverageAuditInput["rows"]=[];
  for(const savedRow of saved.results){
    if(performance.now()>deadline)throw Error("activity_coverage_time_bound");
    const address=Address.parse(savedRow.address);
    try{
      const candidate=CandidateSchema.parse(JSON.parse(savedRow.payload!));
      if(candidate.address!==address||candidate.mode!=="live"||Date.parse(candidate.checked_at)>at.getTime()||Date.parse(candidate.first_seen_at)>at.getTime())throw Error("candidate_identity_or_cutoff");
      const elapsed=candidate.creation?at.getTime()-Date.parse(candidate.creation.block_time):null;
      const observations=await commonActivity(db,candidate,at);
      rows.push({address,candidate_hash:await hashJson(candidate),age_band:elapsed===null||elapsed<0?"unknown":elapsed<=86400000?"first_day":"older",state:"available",observations,gaps:[]});
    }catch{rows.push({address,candidate_hash:null,age_band:"unknown",state:"held",observations:[],gaps:["candidate_or_activity_unusable_at_cutoff"]});}
  }
  if(performance.now()>deadline)throw Error("activity_coverage_time_bound");
  return freezeActivityCoverage({version:"activity-coverage-input-v1",cutoff_at:at.toISOString(),scope:"all_retained_live_candidates",rows});
}
