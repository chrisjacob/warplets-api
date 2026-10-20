import {z} from "zod";
import {ContentReportPage,ContentReportRecord,ContentReportRequest,ContentReportReviewRequest,ReportEvent,ReportSnapshot,ReportStatus} from "./content-report-model";
import {ContentSnapshot} from "./content-model";
import {canonicalContentUrl,ContentError} from "./content-url";
import {hashJson} from "./solana";
import type {requireContentIdentity} from "./identity";
import {contentRecord} from "./content";
import {CONTENT_LIMITS as limits} from "./content-limits";
type Principal=Awaited<ReturnType<typeof requireContentIdentity>>;
type Snapshot=z.infer<typeof ReportSnapshot>;type Event=z.infer<typeof ReportEvent>;
type Row={id:string;submission_id:string;reporter_identity_id:string;created_at:string;updated_at:string;status:string;revision:number;request_hash:string;snapshot:string;event_hash:string;history:string;content_snapshot:string};
const day=(at:Date)=>[at.toISOString().slice(0,10)+"T00:00:00.000Z",new Date(at.getTime()+86400000).toISOString().slice(0,10)+"T00:00:00.000Z"];
function fail(code:string,status=409):never{throw new ContentError(code,status);}
const sessionSql="EXISTS(SELECT 1 FROM tenx_identity_sessions WHERE token_hash=? AND identity_id=? AND origin=? AND expires_at>? AND revoked_at IS NULL)";
const sessionArgs=(p:Principal,at:string)=>[p.token_hash,p.identity_id,p.origin,at];
const transition=(previous:string,next:string)=>previous==="OPEN"?["UPHELD","DISMISSED"].includes(next):previous==="UPHELD"&&next==="RELEASED";
const stable=({status:_s,revision:_r,updated_at:_u,...value}:Snapshot)=>value;
const eventHash=({hash:_h,...value}:Event)=>hashJson(value);
const select=`SELECT r.*,s.snapshot AS content_snapshot,(SELECT json_group_array(json_object('id',id,'revision',revision,'created_at',created_at,'request_hash',request_hash,'event',event))
  FROM (SELECT * FROM tenx_content_report_events WHERE report_id=r.id ORDER BY revision LIMIT 4)) AS history
  FROM tenx_content_reports r JOIN tenx_content_submissions s ON s.id=r.submission_id`;
async function decode(row:Row){
  const snapshot=ReportSnapshot.parse(JSON.parse(row.snapshot)),target=ContentSnapshot.parse(JSON.parse(row.content_snapshot));
  if(snapshot.id!==row.id||snapshot.submission_id!==row.submission_id||snapshot.reporter_identity_id!==row.reporter_identity_id||snapshot.created_at!==row.created_at||snapshot.updated_at!==row.updated_at||snapshot.status!==row.status||snapshot.revision!==row.revision||target.id!==snapshot.submission_id||target.content.canonical_url!==snapshot.target_url||await hashJson(target.content)!==snapshot.target_content_hash)fail("content_report_integrity_failed",503);
  const rows=JSON.parse(row.history) as {id:string;revision:number;created_at:string;request_hash:string;event:string}[],events:Event[]=[];
  if(rows.length!==snapshot.revision+1)fail("content_report_history_integrity_failed",503);
  for(const item of rows){
    const event=ReportEvent.parse(JSON.parse(item.event)),previous=events.at(-1);
    if(event.id!==item.id||event.report_id!==snapshot.id||event.revision!==item.revision||event.revision!==events.length||event.snapshot.revision!==event.revision||event.snapshot.id!==snapshot.id||event.snapshot.updated_at!==event.created_at||event.created_at!==item.created_at||event.request_hash!==item.request_hash||event.previous_hash!==(previous?.hash??null)||await eventHash(event)!==event.hash)fail("content_report_history_integrity_failed",503);
    if(previous?(event.action!=="review"||event.actor!=="local_operator"||event.created_at<previous.created_at||!transition(previous.snapshot.status,event.snapshot.status)||await hashJson(stable(previous.snapshot))!==await hashJson(stable(event.snapshot))):(event.action!=="report"||event.actor!==snapshot.reporter_identity_id||event.snapshot.status!=="OPEN"))fail("content_report_history_integrity_failed",503);
    events.push(event);
  }
  if(events.at(-1)!.hash!==row.event_hash||await hashJson(events.at(-1)!.snapshot)!==await hashJson(snapshot)||events[0]!.request_hash!==row.request_hash)fail("content_report_history_integrity_failed",503);
  return ContentReportRecord.parse({snapshot,events,replay:"verified",source_requests:0});
}
export async function contentReportRecord(db:D1Database,id:string,owner?:string){
  const row=await db.prepare(`${select} WHERE r.id=?`).bind(z.uuid().parse(id)).first<Row>();
  if(!row||owner!==undefined&&row.reporter_identity_id!==owner)return null;
  return decode(row);
}
// Only a verified upheld report creates a hold. Pending allegations confer no
// takedown power; public reads fail closed on a corrupted report projection.
export async function contentVisibilityHeld(db:D1Database,id:string):Promise<boolean>{
  return (await contentHoldSet(db,id)).guard.length>0;
}
// Internal admission guard only: never return report IDs or complaint details to contributors.
export async function contentHoldSet(db:D1Database,id:string){
  const rows=await db.prepare(`${select} WHERE r.submission_id=? LIMIT 11`).bind(id).all<Row>();
  if(rows.results.length>10)fail("content_report_bound_exceeded",503);
  const records=await Promise.all(rows.results.map(decode));
  const guard=records.filter(r=>r.snapshot.status==="UPHELD").map(r=>`${r.snapshot.id}:${r.events.at(-1)!.hash}`).sort().join("|");
  return {guard,hash:await hashJson(guard)};
}
async function makeEvent(id:string,snapshot:Snapshot,actor:string,action:Event["action"],reason:string,request_hash:string,previous_hash:string|null){
  const value=ReportEvent.omit({hash:true}).parse({id,report_id:snapshot.id,revision:snapshot.revision,actor,action,reason,created_at:snapshot.updated_at,request_hash,previous_hash,snapshot});return ReportEvent.parse({...value,hash:await hashJson(value)});
}
export async function submitContentReport(db:D1Database,raw:unknown,p:Principal,at=new Date()){
  const input=ContentReportRequest.parse(raw),evidence_url=input.evidence_url?canonicalContentUrl(input.evidence_url).canonical_url:null;
  const request_hash=await hashJson({...input,evidence_url,reporter_identity_id:p.identity_id}),old=await contentReportRecord(db,input.request_id,p.identity_id);
  if(old){if(old.events[0]!.request_hash!==request_hash)fail("content_report_request_conflict");return old;}
  const visible=await db.prepare("SELECT id FROM tenx_content_submissions WHERE id=? AND status='VISIBLE' AND NOT EXISTS(SELECT 1 FROM tenx_content_reports WHERE submission_id=? AND status='UPHELD')").bind(input.submission_id,input.submission_id).first();
  if(!visible)fail("content_not_found",404);
  const target=await contentRecord(db,input.submission_id);if(!target||target.visibility_held||target.snapshot.status!=="VISIBLE")fail("content_not_found",404);
  const now=at.toISOString();if(now<target.snapshot.updated_at)fail("content_report_time_conflict");
  const snapshot=ReportSnapshot.parse({id:input.request_id,submission_id:input.submission_id,reporter_identity_id:p.identity_id,category:input.category,reason:input.reason,evidence_url,target_url:target.snapshot.content.canonical_url,target_content_hash:await hashJson(target.snapshot.content),good_faith:true,created_at:now,updated_at:now,revision:0,status:"OPEN"});
  const event=await makeEvent(input.request_id,snapshot,p.identity_id,"report",input.reason,request_hash,null);
  await db.batch([
    db.prepare(`INSERT OR IGNORE INTO tenx_content_reports(id,submission_id,reporter_identity_id,created_at,updated_at,status,revision,request_hash,snapshot,event_hash)
      SELECT ?,?,?,?,?,'OPEN',0,?,?,? WHERE ${sessionSql}
      AND EXISTS(SELECT 1 FROM tenx_content_submissions WHERE id=? AND status='VISIBLE')
      AND NOT EXISTS(SELECT 1 FROM tenx_content_reports WHERE submission_id=? AND status='UPHELD')
      AND (SELECT count(*) FROM tenx_content_reports WHERE created_at>=? AND created_at<?)<${limits.reports_per_day}
      AND (SELECT count(*) FROM tenx_content_reports WHERE reporter_identity_id=? AND created_at>=? AND created_at<?)<${limits.reports_per_identity_day}
      AND (SELECT count(*) FROM tenx_content_reports WHERE submission_id=?)<${limits.reports_per_submission}
      AND (SELECT count(*) FROM tenx_content_report_events WHERE created_at>=? AND created_at<?)<${limits.report_events_per_day}`)
      .bind(snapshot.id,snapshot.submission_id,p.identity_id,now,now,request_hash,JSON.stringify(snapshot),event.hash,...sessionArgs(p,now),snapshot.submission_id,snapshot.submission_id,...day(at),p.identity_id,...day(at),snapshot.submission_id,...day(at)),
    db.prepare(`INSERT OR IGNORE INTO tenx_content_report_events(id,report_id,revision,created_at,request_hash,event) SELECT ?,?,0,?,?,?
      WHERE EXISTS(SELECT 1 FROM tenx_content_reports WHERE id=? AND reporter_identity_id=? AND request_hash=? AND event_hash=? AND revision=0)`)
      .bind(event.id,snapshot.id,now,request_hash,JSON.stringify(event),snapshot.id,p.identity_id,request_hash,event.hash),
  ]);
  const saved=await contentReportRecord(db,input.request_id,p.identity_id);
  if(!saved){if(await db.prepare("SELECT id FROM tenx_content_reports WHERE submission_id=? AND reporter_identity_id=?").bind(input.submission_id,p.identity_id).first())fail("content_already_reported");fail("content_report_limit_or_session_changed",429);}
  if(saved.events[0]!.request_hash!==request_hash)fail("content_report_request_conflict");return saved;
}
export async function reviewContentReport(db:D1Database,raw:unknown,at=new Date()){
  const input=ContentReportReviewRequest.parse(raw),request_hash=await hashJson({...input,actor:"local_operator"});
  const priorEvent=await db.prepare("SELECT report_id,request_hash FROM tenx_content_report_events WHERE id=?").bind(input.request_id).first<{report_id:string;request_hash:string}>();
  if(priorEvent){if(priorEvent.request_hash!==request_hash||priorEvent.report_id!==input.report_id)fail("content_report_request_conflict");const saved=await contentReportRecord(db,input.report_id);if(!saved)fail("content_report_not_found",404);return saved;}
  const record=await contentReportRecord(db,input.report_id);if(!record)fail("content_report_not_found",404);
  const previous=record.snapshot,now=at.toISOString();if(previous.revision!==input.expected_revision)fail("content_report_revision_conflict");if(!transition(previous.status,input.decision))fail("content_report_invalid_transition");if(now<previous.updated_at)fail("content_report_time_conflict");
  const snapshot=ReportSnapshot.parse({...previous,status:input.decision,revision:previous.revision+1,updated_at:now});
  const event=await makeEvent(input.request_id,snapshot,"local_operator","review",input.reason,request_hash,record.events.at(-1)!.hash);
  await db.batch([
    db.prepare(`INSERT OR IGNORE INTO tenx_content_report_events(id,report_id,revision,created_at,request_hash,event) SELECT ?,?,?,?,?,?
      WHERE EXISTS(SELECT 1 FROM tenx_content_reports WHERE id=? AND revision=? AND event_hash=?)
      AND (SELECT count(*) FROM tenx_content_report_events WHERE created_at>=? AND created_at<?)<${limits.report_events_per_day}`)
      .bind(event.id,snapshot.id,snapshot.revision,now,request_hash,JSON.stringify(event),snapshot.id,previous.revision,event.previous_hash,...day(at)),
    db.prepare(`UPDATE tenx_content_reports SET snapshot=?,status=?,revision=?,updated_at=?,event_hash=? WHERE id=? AND revision=? AND event_hash=?
      AND EXISTS(SELECT 1 FROM tenx_content_report_events WHERE id=? AND request_hash=? AND event=?)`)
      .bind(JSON.stringify(snapshot),snapshot.status,snapshot.revision,now,event.hash,snapshot.id,previous.revision,event.previous_hash,event.id,request_hash,JSON.stringify(event)),
  ]);
  const saved=(await contentReportRecord(db,snapshot.id))!,retained=saved.events.find(e=>e.id===event.id);
  if(!retained)fail("content_report_revision_or_daily_limit");if(retained.request_hash!==request_hash)fail("content_report_request_conflict");return saved;
}
export async function contentReports(db:D1Database,filter:{owner?:string;status?:string;cursor:string|null},at=new Date()){
  let cursor=["9999-12-31T23:59:59.999Z","ffffffff-ffff-ffff-ffff-ffffffffffff"];
  if(filter.cursor){if(filter.cursor.length>100)fail("content_report_invalid_cursor",400);const pieces=filter.cursor.split("|");if(pieces.length!==2)fail("content_report_invalid_cursor",400);cursor=[z.iso.datetime().parse(pieces[0]),z.uuid().parse(pieces[1])];}
  const clauses=["(r.updated_at<? OR (r.updated_at=? AND r.id<?))"],args=[cursor[0]!,cursor[0]!,cursor[1]!];
  if(filter.owner){clauses.push("r.reporter_identity_id=?");args.push(z.uuid().parse(filter.owner));}if(filter.status){clauses.push("r.status=?");args.push(ReportStatus.parse(filter.status));}
  const rows=await db.prepare(`${select} WHERE ${clauses.join(" AND ")} ORDER BY r.updated_at DESC,r.id DESC LIMIT 21`).bind(...args).all<Row>();
  const records=await Promise.all(rows.results.slice(0,20).map(decode)),last=rows.results[19];return ContentReportPage.parse({as_of:at.toISOString(),reports:records.map(r=>r.snapshot),next_cursor:rows.results.length>20?`${last!.updated_at}|${last!.id}`:null,source_requests:0});
}
