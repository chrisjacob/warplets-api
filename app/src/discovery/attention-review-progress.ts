import {parseAttentionReviews,type ReviewLedger,type ReviewRecord} from "./attention-review-store";

export const ATTENTION_FOLLOW_UP_MS=24*60*60*1000;
type Outcome=Exclude<ReviewRecord["labels"]["outcome"],"not_followed_up">;
const outcomes=():Record<Outcome,number>=>({still_active:0,attention_faded:0,adverse_reported:0,unknown:0});
export async function attentionReviewProgress(ledger:ReviewLedger,now=new Date()) {
  const verified=await parseAttentionReviews(JSON.stringify(ledger)),at=now.getTime();
  if(!Number.isFinite(at)||verified.records.some(r=>Date.parse(r.recorded_at)>at))throw Error("review_progress_clock_invalid");
  const subjects=new Map<string,{first:ReviewRecord;latest:ReviewRecord}>();
  for(const record of verified.records){const key=`${record.context.token.chain}:${record.context.token.address}`,previous=subjects.get(key);subjects.set(key,{first:previous?.first??record,latest:record});}
  const rows=[...subjects.values()].map(({first,latest})=>{
    const due=Date.parse(first.recorded_at)+ATTENTION_FOLLOW_UP_MS,hasOutcome=latest.labels.outcome!=="not_followed_up";
    const state=at<due?"awaiting_24h" as const:hasOutcome&&Date.parse(latest.recorded_at)>=due?"reported" as const:"due" as const;
    return{first,latest,follow_up_at:new Date(due).toISOString(),state,early_outcome:hasOutcome&&Date.parse(latest.recorded_at)<due};
  }).sort((a,b)=>Date.parse(a.first.recorded_at)-Date.parse(b.first.recorded_at)||a.first.id.localeCompare(b.first.id));
  const cohorts=new Map<string,{day:string;tokens:number;awaiting_24h:number;due:number;reported:number;early_outcomes:number;outcomes:Record<Outcome,number>}>();
  for(const row of rows){const day=row.first.review_day,cohort=cohorts.get(day)??{day,tokens:0,awaiting_24h:0,due:0,reported:0,early_outcomes:0,outcomes:outcomes()};
    cohort.tokens++;cohort[row.state]++;if(row.early_outcome)cohort.early_outcomes++;
    if(row.state==="reported"&&row.latest.labels.outcome!=="not_followed_up")cohort.outcomes[row.latest.labels.outcome]++;
    cohorts.set(day,cohort);
  }
  return{version:"attention-personal-review-progress-v1" as const,as_of:now.toISOString(),tokens:rows.length,revisions:verified.records.length,
    awaiting_24h:rows.filter(r=>r.state==="awaiting_24h").length,due:rows.filter(r=>r.state==="due").length,reported:rows.filter(r=>r.state==="reported").length,
    early_outcomes:rows.filter(r=>r.early_outcome).length,cohorts:[...cohorts.values()].sort((a,b)=>b.day.localeCompare(a.day)),rows,
    provider_requests:0 as const,scoring_effect:"none" as const,evidence_gates_changed:false as const};
}
export type AttentionReviewProgressReport=Awaited<ReturnType<typeof attentionReviewProgress>>;
