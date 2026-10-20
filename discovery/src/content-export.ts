import {z} from "zod";
import {ContentCaseExport,ContentCasePayload,CONTENT_EXPORT_MAX_BYTES,CONTENT_EXPORT_REPORT_LIMIT,CONTENT_EXPORT_HOLD_LIMIT} from "./content-export-model";
import {CONTENT_RECORD_SELECT,decodeContentHistoryRow,decodeContentCampaignRow,type ContentRow} from "./content";
import {CONTENT_REPORT_SELECT,decodeContentReportRow,type ContentReportRow} from "./content-reports";
import {CONTENT_HOLD_SELECT,decodeContentHoldRow,type ContentHoldRow} from "./content-holds";
import {ContentError} from "./content-url";
import {hashJson} from "./solana";

type Payload=z.infer<typeof ContentCasePayload>;
type CampaignRow=Parameters<typeof decodeContentCampaignRow>[0];
function fail():never{throw new ContentError("content_case_export_integrity_failed",503);}
export function checkContentExportSize(text:string){
  if(new TextEncoder().encode(text).byteLength>CONTENT_EXPORT_MAX_BYTES)throw new ContentError("content_case_export_size_exceeded",413);
}
async function manifest(value:Pick<Payload,"campaign"|"content"|"reports"|"hold_reviews">){
  return {reports:value.reports.length,hold_reviews:value.hold_reviews.length,
    events:value.content.events.length+value.reports.reduce((n,r)=>n+r.events.length,0)+value.hold_reviews.reduce((n,r)=>n+r.events.length,0),
    campaign_hash:await hashJson(value.campaign),content_hash:await hashJson(value.content),reports_hash:await hashJson(value.reports),hold_reviews_hash:await hashJson(value.hold_reviews)};
}
// Recreate only SQL metadata required by the existing pure history decoders.
// No live database or network access is used by offline verification.
function historyRow(record:Payload["content"]|Payload["reports"][number]|Payload["hold_reviews"][number]){
  return {...record.snapshot,snapshot:JSON.stringify(record.snapshot),request_hash:record.events[0]!.request_hash,event_hash:record.events.at(-1)!.hash,
    history:JSON.stringify(record.events.map(event=>({id:event.id,submission_id:record.snapshot.id,revision:event.revision,created_at:event.created_at,request_hash:event.request_hash,event:JSON.stringify(event)})))};
}
function orderedUnique(ids:string[]){return ids.every((id,i)=>i===0||ids[i-1]!<id);}

export async function verifyContentCaseExport(raw:unknown,expectedHash?:string){
  checkContentExportSize(JSON.stringify(raw));
  const value=ContentCaseExport.parse(raw),{export_hash,...payload}=value;
  if(expectedHash!==undefined&&z.string().regex(/^[a-f0-9]{64}$/).parse(expectedHash)!==export_hash)fail();
  if(await hashJson(payload)!==export_hash||await hashJson(await manifest(payload))!==await hashJson(payload.manifest))fail();
  const {campaign,content,reports,hold_reviews}=payload,s=content.snapshot;
  await decodeContentCampaignRow({id:campaign.id,created_at:campaign.starts_at,ends_at:campaign.ends_at,request_hash:campaign.request_hash,record:JSON.stringify(campaign)});
  await decodeContentHistoryRow({...historyRow(content),canonical_url:s.content.canonical_url} as ContentRow&{history:string});
  if(campaign.id!==s.campaign_id||s.created_at<campaign.starts_at||s.created_at>=campaign.ends_at||s.updated_at>payload.captured_at)fail();
  if(!orderedUnique(reports.map(r=>r.snapshot.id))||!orderedUnique(hold_reviews.map(r=>r.snapshot.id)))fail();
  const target=JSON.stringify(s);
  for(const report of reports){
    if(report.snapshot.submission_id!==s.id||report.snapshot.created_at<s.created_at||report.snapshot.updated_at>payload.captured_at)fail();
    await decodeContentReportRow({...historyRow(report),content_snapshot:target} as ContentReportRow);
  }
  for(const review of hold_reviews){
    if(review.snapshot.submission_id!==s.id||review.snapshot.created_at<s.created_at||review.snapshot.updated_at>payload.captured_at)fail();
    await decodeContentHoldRow({...historyRow(review),content_snapshot:target} as ContentHoldRow);
  }
  if(payload.visibility_held!==reports.some(r=>r.snapshot.status==="UPHELD"))fail();
  return value;
}

export async function contentCaseExport(db:D1Database,id:string){
  const submissionId=z.uuid().parse(id);
  // D1 batch reads execute transactionally. No related history can advance
  // between these four reads. Each SQL history has its own revision bound.
  const result=await db.batch([
    db.prepare(CONTENT_RECORD_SELECT).bind(submissionId),
    db.prepare("SELECT c.* FROM tenx_content_campaigns c JOIN tenx_content_submissions s ON s.campaign_id=c.id WHERE s.id=?").bind(submissionId),
    db.prepare(`${CONTENT_REPORT_SELECT} WHERE r.submission_id=? ORDER BY r.id LIMIT ${CONTENT_EXPORT_REPORT_LIMIT+1}`).bind(submissionId),
    db.prepare(`${CONTENT_HOLD_SELECT} WHERE r.submission_id=? ORDER BY r.id LIMIT ${CONTENT_EXPORT_HOLD_LIMIT+1}`).bind(submissionId),
  ]);
  if(result.some(r=>!r.success))throw new ContentError("content_case_export_unavailable",503);
  const contentRows=result[0]!.results as (ContentRow&{history:string})[],campaignRows=result[1]!.results as CampaignRow[];
  if(!contentRows.length)throw new ContentError("content_not_found",404);
  const reportRows=result[2]!.results as ContentReportRow[],holdRows=result[3]!.results as ContentHoldRow[];
  if(reportRows.length>CONTENT_EXPORT_REPORT_LIMIT||holdRows.length>CONTENT_EXPORT_HOLD_LIMIT)throw new ContentError("content_case_export_bound_exceeded",413);
  checkContentExportSize(JSON.stringify(result.map(r=>r.results)));
  if(contentRows.length!==1||campaignRows.length!==1)fail();
  const captured_at=new Date().toISOString();
  const campaign=await decodeContentCampaignRow(campaignRows[0]!),content=await decodeContentHistoryRow(contentRows[0]!);
  const reports=await Promise.all(reportRows.map(decodeContentReportRow));
  const hold_reviews=(await Promise.all(holdRows.map(decodeContentHoldRow))).map(r=>({...r,replay:"verified" as const,source_requests:0 as const}));
  const records={campaign,content,reports,hold_reviews};
  const payload=ContentCasePayload.parse({version:"content-case-export-v1",scope:"private_local_moderation_case",captured_at,authority:"local_database_history_only",...records,
    visibility_held:reports.some(r=>r.snapshot.status==="UPHELD"),manifest:await manifest(records),source_requests:0,rewards_enabled:false});
  // Replay again through the portable artifact format before releasing it.
  return verifyContentCaseExport({...payload,export_hash:await hashJson(payload)});
}
