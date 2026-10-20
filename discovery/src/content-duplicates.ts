import {z} from "zod";
import {contentRecord,decodeContentSnapshotRow,type ContentRow} from "./content";
import {hashJson} from "./solana";
import {DuplicateRequest,DuplicateEvidence,DuplicateEvent,DUPLICATE_DAILY_LIMIT,DUPLICATE_SAMPLE_LIMIT} from "./content-duplicates-model";
import {verifyDuplicateEvidence,excerptGrams,duplicateFail as fail,duplicateSize,makeDuplicateReport} from "./content-duplicates-math";
type Event=z.infer<typeof DuplicateEvent>;
type EventRow={id:string;submission_id:string;revision:number;created_at:string;action:string;request_hash:string;event_hash:string;event:string};
type Row=ContentRow&{duplicate_history:string};
const history=`(SELECT json_group_array(json_object('id',id,'submission_id',submission_id,'revision',revision,'created_at',created_at,'action',action,'request_hash',request_hash,'event_hash',event_hash,'event',event))
  FROM (SELECT * FROM tenx_content_duplicate_events WHERE submission_id=s.id ORDER BY revision LIMIT 7)) AS duplicate_history`;
const subjectSelect=`SELECT s.*,${history} FROM tenx_content_submissions s WHERE s.id=?`;
const activeWhere="h.action='RECORD' AND NOT EXISTS(SELECT 1 FROM tenx_content_duplicate_events newer WHERE newer.submission_id=h.submission_id AND newer.revision>h.revision) AND h.submission_id<>?";
async function decode(row:Row){
  const snapshot=await decodeContentSnapshotRow(row),rows=JSON.parse(row.duplicate_history) as EventRow[];
  if(rows.length>6)fail();
  const events=rows.map(item=>{
    const event=DuplicateEvent.parse(JSON.parse(item.event));
    if(event.id!==item.id||event.submission_id!==item.submission_id||event.revision!==item.revision||event.created_at!==item.created_at||event.action!==item.action||event.request_hash!==item.request_hash||event.hash!==item.event_hash||event.created_at<snapshot.created_at)fail();
    return event;
  });
  return verifyDuplicateEvidence({version:"operator-excerpt-evidence-v1",target:{submission_id:snapshot.id,source_url:snapshot.content.canonical_url,target_content_hash:await hashJson(snapshot.content)},events,replay:"verified",source_requests:0,reward_eligible:false});
}
export {decode as decodeDuplicateEvidenceRow};
export async function duplicateEvidence(db:D1Database,id:string){
  const row=await db.prepare(subjectSelect).bind(z.uuid().parse(id)).first<Row>();if(!row)fail("content_not_found",404);
  return decode(row);
}
export async function recordDuplicateEvidence(db:D1Database,raw:unknown,at=new Date()){
  const input=DuplicateRequest.parse(raw),request_hash=await hashJson(input);
  if(input.excerpt!==null)excerptGrams(input.excerpt);
  const old=await db.prepare("SELECT submission_id,request_hash FROM tenx_content_duplicate_events WHERE id=?").bind(input.request_id).first<{submission_id:string;request_hash:string}>();
  if(old){
    if(old.submission_id!==input.submission_id||old.request_hash!==request_hash)fail("content_duplicate_request_conflict",409);
    const history=await duplicateEvidence(db,input.submission_id),event=history.events.find(e=>e.id===input.request_id);
    if(!event||event.request_hash!==request_hash)fail();return {event,replay:"verified" as const};
  }
  // New evidence admission verifies the original submission's full retained
  // history. Comparison reads check projections plus complete excerpt chains.
  const target=await contentRecord(db,input.submission_id);if(!target)fail("content_not_found",404);
  const history=await duplicateEvidence(db,input.submission_id),previous=history.events.at(-1);
  if(input.expected_revision!==(previous?.revision??-1))fail("content_duplicate_revision_conflict",409);
  if(input.action==="WITHDRAW"?previous?.action!=="RECORD":previous?.action==="RECORD"||input.expected_revision===4)fail("content_duplicate_invalid_transition",409);
  const now=at.toISOString();if(now<(previous?.created_at??target.snapshot.created_at))fail("content_duplicate_time_conflict",409);
  const unsigned=DuplicateEvent.omit({hash:true}).parse({id:input.request_id,submission_id:input.submission_id,revision:input.expected_revision+1,created_at:now,actor:"local_operator",action:input.action,source_url:history.target.source_url,target_content_hash:history.target.target_content_hash,excerpt:input.excerpt,
    normalized_excerpt_hash:input.excerpt===null?null:await hashJson(excerptGrams(input.excerpt).normalized),source_inspected:input.source_inspected,reason:input.reason,request_hash,previous_hash:previous?.hash??null});
  const event=DuplicateEvent.parse({...unsigned,hash:await hashJson(unsigned)}),start=now.slice(0,10)+"T00:00:00.000Z",end=new Date(Date.parse(start)+86400000).toISOString();
  await db.prepare(`INSERT OR IGNORE INTO tenx_content_duplicate_events(id,submission_id,revision,created_at,action,request_hash,event_hash,event)
    SELECT ?,?,?,?,?,?,?,? WHERE (SELECT count(*) FROM tenx_content_duplicate_events WHERE submission_id=?)=?
    AND coalesce((SELECT event_hash FROM tenx_content_duplicate_events WHERE submission_id=? ORDER BY revision DESC LIMIT 1),'')=?
    AND (?='WITHDRAW' OR (SELECT count(*) FROM tenx_content_duplicate_events WHERE action='RECORD' AND created_at>=? AND created_at<?)<${DUPLICATE_DAILY_LIMIT})`)
    .bind(event.id,event.submission_id,event.revision,now,event.action,request_hash,event.hash,JSON.stringify(event),event.submission_id,event.revision,event.submission_id,event.previous_hash??"",event.action,start,end).run();
  const saved=await duplicateEvidence(db,input.submission_id),retained=saved.events.find(e=>e.id===event.id);
  if(!retained)fail("content_duplicate_revision_or_daily_limit",409);
  if(retained.request_hash!==request_hash)fail("content_duplicate_request_conflict",409);
  return {event:retained,replay:"verified" as const};
}
export async function contentDuplicates(db:D1Database,id:string){
  const targetId=z.uuid().parse(id);
  // Subject, latest active sample and its available count share one D1 batch
  // transaction. Hidden/held submissions are included only in this private view.
  const result=await db.batch([
    db.prepare(subjectSelect).bind(targetId),
    db.prepare(`SELECT s.*,${history} FROM tenx_content_duplicate_events h JOIN tenx_content_submissions s ON s.id=h.submission_id WHERE ${activeWhere} ORDER BY h.created_at DESC,h.id DESC LIMIT ${DUPLICATE_SAMPLE_LIMIT}`).bind(targetId),
    db.prepare(`SELECT count(*) AS available FROM tenx_content_duplicate_events h WHERE ${activeWhere}`).bind(targetId),
  ]);
  if(result.some(r=>!r.success))fail();duplicateSize(result.map(r=>r.results));
  const subjectRows=result[0]!.results as Row[],sample=result[1]!.results as Row[],counts=result[2]!.results as {available:number}[];
  if(!subjectRows.length)fail("content_not_found",404);
  if(subjectRows.length!==1||counts.length!==1)fail();
  const captured_at=new Date().toISOString(),subject=await decode(subjectRows[0]!),candidates=await Promise.all(sample.map(decode));
  return makeDuplicateReport(subject,candidates,counts[0]!.available,captured_at);
}
