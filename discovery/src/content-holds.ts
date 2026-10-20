import {z} from "zod";
import {HoldReviewEvent,HoldReviewPage,HoldReviewRecord,HoldReviewReply,HoldReviewRequest,HoldReviewSnapshot,HoldReviewStatus} from "./content-hold-model";
import {ContentSnapshot} from "./content-model";
import {contentRecord} from "./content";
import {contentHoldSet,contentVisibilityHeld} from "./content-reports";
import {canonicalContentUrl,ContentError} from "./content-url";
import type {requireContentIdentity} from "./identity";
import {hashJson} from "./solana";
import {CONTENT_LIMITS as limits} from "./content-limits";

type Principal=Awaited<ReturnType<typeof requireContentIdentity>>;
type Snapshot=z.infer<typeof HoldReviewSnapshot>;
type Event=z.infer<typeof HoldReviewEvent>;
type Row={id:string;submission_id:string;owner_identity_id:string;hold_set_hash:string;created_at:string;updated_at:string;status:string;revision:number;request_hash:string;snapshot:string;event_hash:string;history:string;content_snapshot:string};
function fail(code:string,status=409):never{throw new ContentError(code,status);}
const day=(at:Date)=>[at.toISOString().slice(0,10)+"T00:00:00.000Z",new Date(at.getTime()+86400000).toISOString().slice(0,10)+"T00:00:00.000Z"];
const sessionSql="EXISTS(SELECT 1 FROM tenx_identity_sessions WHERE token_hash=? AND identity_id=? AND origin=? AND expires_at>? AND revoked_at IS NULL)";
const sessionArgs=(p:Principal,at:string)=>[p.token_hash,p.identity_id,p.origin,at];
const holdGuardSql="(SELECT coalesce(group_concat(value,'|'),'') FROM (SELECT id||':'||event_hash AS value FROM tenx_content_reports WHERE submission_id=? AND status='UPHELD' ORDER BY id))";
const stable=({status:_s,revision:_r,updated_at:_u,...value}:Snapshot)=>value;
function transition(previous:Snapshot["status"],next:Snapshot["status"],owner:boolean){
  if(owner)return previous==="NEEDS_INFO"&&next==="RESUBMITTED";
  return previous==="OPEN"?next==="NEEDS_INFO"||next==="CLOSED":["NEEDS_INFO","RESUBMITTED"].includes(previous)&&next==="CLOSED";
}
const select=`SELECT r.*,s.snapshot AS content_snapshot,(SELECT json_group_array(json_object('id',id,'revision',revision,'created_at',created_at,'request_hash',request_hash,'event',event))
 FROM (SELECT * FROM tenx_content_hold_events WHERE review_id=r.id ORDER BY revision LIMIT 5)) AS history
 FROM tenx_content_hold_reviews r JOIN tenx_content_submissions s ON s.id=r.submission_id`;

async function decode(row:Row){
  const snapshot=HoldReviewSnapshot.parse(JSON.parse(row.snapshot)),target=ContentSnapshot.parse(JSON.parse(row.content_snapshot));
  if(snapshot.id!==row.id||snapshot.submission_id!==row.submission_id||snapshot.owner_identity_id!==row.owner_identity_id||snapshot.hold_set_hash!==row.hold_set_hash||snapshot.created_at!==row.created_at||snapshot.updated_at!==row.updated_at||snapshot.status!==row.status||snapshot.revision!==row.revision||target.id!==snapshot.submission_id||target.identity_id!==snapshot.owner_identity_id||target.content.canonical_url!==snapshot.target_url||await hashJson(target.content)!==snapshot.target_content_hash)fail("hold_review_integrity_failed",503);
  const rows=JSON.parse(row.history) as {id:string;revision:number;created_at:string;request_hash:string;event:string}[],events:Event[]=[];
  if(rows.length!==snapshot.revision+1)fail("hold_review_history_integrity_failed",503);
  for(const item of rows){
    const event=HoldReviewEvent.parse(JSON.parse(item.event)),previous=events.at(-1),{hash,...unsigned}=event;
    if(event.id!==item.id||event.review_id!==snapshot.id||event.revision!==item.revision||event.revision!==events.length||event.snapshot.revision!==event.revision||event.snapshot.id!==snapshot.id||event.created_at!==item.created_at||event.snapshot.updated_at!==event.created_at||event.request_hash!==item.request_hash||event.previous_hash!==(previous?.hash??null)||await hashJson(unsigned)!==hash)fail("hold_review_history_integrity_failed",503);
    if(previous){
      const owner=event.action==="respond";
      if(event.action==="request"||event.actor!==(owner?snapshot.owner_identity_id:"local_operator")||event.created_at<previous.created_at||!transition(previous.snapshot.status,event.snapshot.status,owner)||await hashJson(stable(previous.snapshot))!==await hashJson(stable(event.snapshot)))fail("hold_review_history_integrity_failed",503);
    }else if(event.action!=="request"||event.actor!==snapshot.owner_identity_id||event.snapshot.status!=="OPEN"||event.created_at!==snapshot.created_at)fail("hold_review_history_integrity_failed",503);
    events.push(event);
  }
  if(events.at(-1)!.hash!==row.event_hash||await hashJson(events.at(-1)!.snapshot)!==await hashJson(snapshot)||events[0]!.request_hash!==row.request_hash)fail("hold_review_history_integrity_failed",503);
  return {snapshot,events};
}
export async function holdReviewRecord(db:D1Database,id:string,owner?:string){
  const row=await db.prepare(`${select} WHERE r.id=?`).bind(z.uuid().parse(id)).first<Row>();
  if(!row||owner!==undefined&&row.owner_identity_id!==owner)return null;
  const record=await decode(row);
  return HoldReviewRecord.parse({...record,visibility_held:await contentVisibilityHeld(db,record.snapshot.submission_id),replay:"verified",source_requests:0});
}
async function makeEvent(id:string,snapshot:Snapshot,actor:string,action:Event["action"],note:string,reference_url:string|null,request_hash:string,previous_hash:string|null){
  const value=HoldReviewEvent.omit({hash:true}).parse({id,review_id:snapshot.id,revision:snapshot.revision,actor,action,note,reference_url,created_at:snapshot.updated_at,request_hash,previous_hash,snapshot});
  return HoldReviewEvent.parse({...value,hash:await hashJson(value)});
}

export async function requestHoldReview(db:D1Database,raw:unknown,p:Principal,at=new Date()){
  const input=HoldReviewRequest.parse(raw),reference_url=input.reference_url?canonicalContentUrl(input.reference_url).canonical_url:null;
  const request_hash=await hashJson({...input,reference_url,actor:p.identity_id}),old=await holdReviewRecord(db,input.request_id,p.identity_id);
  if(old){if(old.events[0]!.request_hash!==request_hash)fail("hold_review_request_conflict");return old;}
  if(await db.prepare("SELECT id FROM tenx_content_hold_events WHERE id=?").bind(input.request_id).first())fail("hold_review_request_conflict");
  const target=await contentRecord(db,input.submission_id,p.identity_id);
  if(!target||!target.visibility_held)fail("held_content_not_found",404);
  const holds=await contentHoldSet(db,input.submission_id),now=at.toISOString();
  if(!holds.guard)fail("held_content_not_found",404);
  if(now<target.snapshot.updated_at)fail("hold_review_time_conflict");
  const snapshot=HoldReviewSnapshot.parse({id:input.request_id,submission_id:input.submission_id,owner_identity_id:p.identity_id,target_url:target.snapshot.content.canonical_url,target_content_hash:await hashJson(target.snapshot.content),hold_set_hash:holds.hash,created_at:now,updated_at:now,revision:0,status:"OPEN"});
  const event=await makeEvent(input.request_id,snapshot,p.identity_id,"request",input.note,reference_url,request_hash,null);
  await db.batch([
    db.prepare(`INSERT OR IGNORE INTO tenx_content_hold_reviews(id,submission_id,owner_identity_id,hold_set_hash,created_at,updated_at,status,revision,request_hash,snapshot,event_hash)
     SELECT ?,?,?,?,?,?,'OPEN',0,?,?,? WHERE ${sessionSql}
     AND NOT EXISTS(SELECT 1 FROM tenx_content_hold_events WHERE id=?)
     AND EXISTS(SELECT 1 FROM tenx_content_submissions WHERE id=? AND identity_id=?) AND ${holdGuardSql}=?
     AND (SELECT count(*) FROM tenx_content_hold_reviews WHERE created_at>=? AND created_at<?)<${limits.hold_reviews_per_day}
     AND (SELECT count(*) FROM tenx_content_hold_reviews WHERE owner_identity_id=? AND created_at>=? AND created_at<?)<${limits.hold_reviews_per_identity_day}
     AND (SELECT count(*) FROM tenx_content_hold_events WHERE created_at>=? AND created_at<?)<${limits.hold_events_per_day}`)
     .bind(snapshot.id,snapshot.submission_id,p.identity_id,holds.hash,now,now,request_hash,JSON.stringify(snapshot),event.hash,...sessionArgs(p,now),event.id,snapshot.submission_id,p.identity_id,snapshot.submission_id,holds.guard,...day(at),p.identity_id,...day(at),...day(at)),
    db.prepare(`INSERT OR IGNORE INTO tenx_content_hold_events(id,review_id,revision,created_at,request_hash,event) SELECT ?,?,0,?,?,?
     WHERE EXISTS(SELECT 1 FROM tenx_content_hold_reviews WHERE id=? AND owner_identity_id=? AND request_hash=? AND event_hash=? AND revision=0)`)
     .bind(event.id,snapshot.id,now,request_hash,JSON.stringify(event),snapshot.id,p.identity_id,request_hash,event.hash),
  ]);
  const saved=await holdReviewRecord(db,snapshot.id,p.identity_id);
  if(!saved){
    if(await db.prepare("SELECT id FROM tenx_content_hold_reviews WHERE submission_id=? AND (status<>'CLOSED' OR hold_set_hash=?)").bind(snapshot.submission_id,holds.hash).first())fail("hold_review_already_requested");
    fail("hold_review_limit_session_or_hold_changed",429);
  }
  if(saved.events[0]!.request_hash!==request_hash)fail("hold_review_request_conflict");
  return saved;
}

// Communication only: this module never writes reports, content or reward state.
export async function replyHoldReview(db:D1Database,raw:unknown,p:Principal|null,at=new Date()){
  const input=HoldReviewReply.parse(raw),reference_url=input.reference_url?canonicalContentUrl(input.reference_url).canonical_url:null;
  const actor=p?.identity_id??"local_operator",request_hash=await hashJson({...input,reference_url,actor});
  // Check ownership before consulting a request ID, including idempotent retries.
  const record=await holdReviewRecord(db,input.review_id,p?.identity_id);
  if(!record)fail("hold_review_not_found",404);
  const prior=await db.prepare("SELECT review_id,request_hash FROM tenx_content_hold_events WHERE id=?").bind(input.request_id).first<{review_id:string;request_hash:string}>();
  if(prior){if(prior.review_id!==input.review_id||prior.request_hash!==request_hash)fail("hold_review_request_conflict");return record;}
  const previous=record.snapshot,now=at.toISOString();
  if(previous.revision!==input.expected_revision)fail("hold_review_revision_conflict");
  if(!transition(previous.status,input.decision,p!==null))fail("hold_review_invalid_transition");
  if(now<previous.updated_at)fail("hold_review_time_conflict");
  const snapshot=HoldReviewSnapshot.parse({...previous,status:input.decision,revision:previous.revision+1,updated_at:now});
  const event=await makeEvent(input.request_id,snapshot,actor,p?"respond":"review",input.note,reference_url,request_hash,record.events.at(-1)!.hash);
  await db.batch([
    db.prepare(`INSERT OR IGNORE INTO tenx_content_hold_events(id,review_id,revision,created_at,request_hash,event) SELECT ?,?,?,?,?,?
     WHERE EXISTS(SELECT 1 FROM tenx_content_hold_reviews WHERE id=? AND revision=? AND event_hash=?)
     ${p?`AND ${sessionSql}`:""}
     AND (SELECT count(*) FROM tenx_content_hold_events WHERE created_at>=? AND created_at<?)<${limits.hold_events_per_day}`)
     .bind(event.id,snapshot.id,snapshot.revision,now,request_hash,JSON.stringify(event),snapshot.id,previous.revision,event.previous_hash,...(p?sessionArgs(p,now):[]),...day(at)),
    db.prepare(`UPDATE tenx_content_hold_reviews SET snapshot=?,status=?,revision=?,updated_at=?,event_hash=? WHERE id=? AND revision=? AND event_hash=?
     AND EXISTS(SELECT 1 FROM tenx_content_hold_events WHERE id=? AND request_hash=? AND event=?)`)
     .bind(JSON.stringify(snapshot),snapshot.status,snapshot.revision,now,event.hash,snapshot.id,previous.revision,event.previous_hash,event.id,request_hash,JSON.stringify(event)),
  ]);
  const saved=(await holdReviewRecord(db,snapshot.id,p?.identity_id))!,retained=saved.events.find(e=>e.id===event.id);
  if(!retained)fail("hold_review_revision_session_or_daily_limit");
  if(retained.request_hash!==request_hash)fail("hold_review_request_conflict");
  return saved;
}

export async function holdReviews(db:D1Database,filter:{owner?:string;status?:string;cursor:string|null},at=new Date()){
  let cursor=["9999-12-31T23:59:59.999Z","ffffffff-ffff-ffff-ffff-ffffffffffff"];
  if(filter.cursor){if(filter.cursor.length>100)fail("hold_review_invalid_cursor",400);const pieces=filter.cursor.split("|");if(pieces.length!==2)fail("hold_review_invalid_cursor",400);cursor=[z.iso.datetime().parse(pieces[0]),z.uuid().parse(pieces[1])];}
  const clauses=["(r.updated_at<? OR (r.updated_at=? AND r.id<?))"],args=[cursor[0]!,cursor[0]!,cursor[1]!];
  if(filter.owner){clauses.push("r.owner_identity_id=?");args.push(z.uuid().parse(filter.owner));}
  if(filter.status){clauses.push("r.status=?");args.push(HoldReviewStatus.parse(filter.status));}
  const rows=await db.prepare(`${select} WHERE ${clauses.join(" AND ")} ORDER BY r.updated_at DESC,r.id DESC LIMIT 21`).bind(...args).all<Row>();
  const records=await Promise.all(rows.results.slice(0,20).map(decode)),last=rows.results[19];
  return HoldReviewPage.parse({as_of:at.toISOString(),reviews:records.map(r=>r.snapshot),next_cursor:rows.results.length>20?`${last!.updated_at}|${last!.id}`:null,source_requests:0});
}
