import {ContentOperations} from "./content-operations-model";
import {CONTENT_LIMITS as limits} from "./content-limits";
import {ContentError} from "./content-url";

// This registry is code-owned. No request value becomes an identifier or SQL.
const storage=[
  {id:"campaigns",table:"tenx_content_campaigns",payload:"record"},
  {id:"submissions",table:"tenx_content_submissions",payload:"snapshot"},
  {id:"content_events",table:"tenx_content_events",payload:"event"},
  {id:"reports",table:"tenx_content_reports",payload:"snapshot"},
  {id:"report_events",table:"tenx_content_report_events",payload:"event"},
  {id:"hold_reviews",table:"tenx_content_hold_reviews",payload:"snapshot"},
  {id:"hold_events",table:"tenx_content_hold_events",payload:"event"},
] as const;
const queues=[
  {id:"pending",table:"tenx_content_submissions",status:"PENDING",waiting_on:"moderator"},
  {id:"flagged",table:"tenx_content_submissions",status:"FLAGGED",waiting_on:"moderator"},
  {id:"appealed",table:"tenx_content_submissions",status:"APPEALED",waiting_on:"moderator"},
  {id:"open_reports",table:"tenx_content_reports",status:"OPEN",waiting_on:"moderator"},
  {id:"open_hold_reviews",table:"tenx_content_hold_reviews",status:"OPEN",waiting_on:"moderator"},
  {id:"resubmitted_hold_reviews",table:"tenx_content_hold_reviews",status:"RESUBMITTED",waiting_on:"moderator"},
  {id:"contributor_response",table:"tenx_content_hold_reviews",status:"NEEDS_INFO",waiting_on:"contributor"},
] as const;
const quotaLimits={campaigns:limits.campaigns_per_day,submissions:limits.submissions_per_day,content_events:limits.content_events_per_day,reports:limits.reports_per_day,report_events:limits.report_events_per_day,hold_reviews:limits.hold_reviews_per_day,hold_events:limits.hold_events_per_day};

export async function contentOperations(db:D1Database,at=new Date()){
  const now=at.toISOString(),day_start=now.slice(0,10)+"T00:00:00.000Z",day_end=new Date(Date.parse(day_start)+86400000).toISOString(),dayAgo=new Date(at.getTime()-86400000).toISOString();
  // One statement observes every counter at the same SQLite read snapshot.
  // History payloads stay in SQL; only bounded aggregate sizes leave the DB.
  const queueSql=queues.map(q=>`(SELECT json_object('id','${q.id}','waiting_on','${q.waiting_on}','count',count(*),'waiting_24h',coalesce(sum(updated_at<=(SELECT day_ago FROM clock)),0),'oldest_updated_at',min(updated_at)) FROM ${q.table} WHERE status='${q.status}')`);
  const quotaSql=storage.map(s=>`json_object('id','${s.id}','used',(SELECT count(*) FROM ${s.table} WHERE created_at>=(SELECT day_start FROM clock) AND created_at<(SELECT day_end FROM clock)),'limit',${quotaLimits[s.id]})`);
  const storageSql=storage.map(s=>`json_object('id','${s.id}','total_rows',(SELECT count(*) FROM ${s.table}),'oldest_created_at',(SELECT min(created_at) FROM ${s.table}),'sampled_rows',(SELECT count(*) FROM (SELECT 1 FROM ${s.table} ORDER BY created_at DESC LIMIT 200)),'sampled_bytes',(SELECT coalesce(sum(bytes),0) FROM (SELECT length(CAST(${s.payload} AS BLOB)) AS bytes FROM ${s.table} ORDER BY created_at DESC LIMIT 200)))`);
  const row=await db.prepare(`WITH clock(as_of,day_start,day_end,day_ago) AS (SELECT ?,?,?,?) SELECT json_object(
    'queues',json_array(${queueSql.join(",")}),
    'quotas',json_array(json_object('id','open_campaigns','used',(SELECT count(*) FROM tenx_content_campaigns WHERE ends_at>(SELECT as_of FROM clock)),'limit',${limits.open_campaigns}),${quotaSql.join(",")}),
    'holds',json_object('upheld_reports',(SELECT count(*) FROM tenx_content_reports WHERE status='UPHELD'),'held_submissions',(SELECT count(DISTINCT submission_id) FROM tenx_content_reports WHERE status='UPHELD'),'visible_but_held',(SELECT count(*) FROM tenx_content_submissions s WHERE s.status='VISIBLE' AND EXISTS(SELECT 1 FROM tenx_content_reports r WHERE r.submission_id=s.id AND r.status='UPHELD'))),
    'tables',json_array(${storageSql.join(",")})
  ) AS payload`).bind(now,day_start,day_end,dayAgo).first<{payload:string}>();
  if(!row)throw new ContentError("content_operations_unavailable",503);
  const value=JSON.parse(row.payload) as {
    queues:{id:string;waiting_on:string;count:number;waiting_24h:number;oldest_updated_at:string|null}[];
    quotas:{id:string;used:number;limit:number}[];holds:{upheld_reports:number;held_submissions:number;visible_but_held:number};
    tables:{id:string;total_rows:number;sampled_rows:number;sampled_bytes:number;oldest_created_at:string|null}[];
  };
  return ContentOperations.parse({scope:"local_content_operations",as_of:now,day_start,day_end,integrity:"projection_counts_only",source_requests:0,rewards_enabled:false,
    queues:value.queues.map(q=>({...q,oldest_wait_seconds:q.oldest_updated_at?Math.max(0,Math.floor((at.getTime()-Date.parse(q.oldest_updated_at))/1000)):null})),
    quotas:value.quotas.map(q=>({...q,remaining:Math.max(0,q.limit-q.used),resets_at:q.id==="open_campaigns"?null:day_end})),
    identity_daily_limits:{submissions:limits.submissions_per_identity_day,reports:limits.reports_per_identity_day,hold_reviews:limits.hold_reviews_per_identity_day},
    holds:value.holds,storage:{sample_limit:200,measurement:"serialized_payload_bytes_only",tables:value.tables.map(t=>({...t,complete:t.sampled_rows===t.total_rows}))},
    retention:{automatic_deletion:false,archive_policy:"not_configured",remote_capacity:"uncertified"},
  });
}
