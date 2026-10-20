import {z} from "zod";
import {AuthorshipEvent,AuthorshipHistory,AuthorshipReviewRequest,AuthorshipSummary,AUTHORSHIP_REVIEW_DAILY_LIMIT} from "./content-authorship-model";
import {ContentSnapshot} from "./content-model";
import {contentRecord} from "./content";
import {ContentError,canonicalContentUrl} from "./content-url";
import {hashJson} from "./solana";
type Snapshot=z.infer<typeof ContentSnapshot>;
type Event=z.infer<typeof AuthorshipEvent>;
export type AuthorshipRow={id:string;submission_id:string;revision:number;created_at:string;decision:string;request_hash:string;event_hash:string;event:string};
export const AUTHORSHIP_SELECT="SELECT * FROM tenx_content_authorship_events WHERE submission_id=? ORDER BY revision LIMIT 11";
function fail(code="content_authorship_integrity_failed",status=503):never{throw new ContentError(code,status);}

export async function verifyAuthorshipHistory(raw:unknown,target:Snapshot){
  const value=AuthorshipHistory.parse(raw),targetHash=await hashJson(target.content);
  if(value.submission_id!==target.id||value.target_content_hash!==targetHash)fail();
  const ids=new Set<string>();let previous:Event|undefined;
  for(const event of value.events){
    const {hash,...unsigned}=event;
    if(ids.has(event.id)||event.submission_id!==target.id||event.revision!==(previous?previous.revision+1:0)||event.target_content_hash!==targetHash||event.author_claim!==target.content.author_claim||event.previous_hash!==(previous?.hash??null)||await hashJson(unsigned)!==hash||event.created_at<(previous?.created_at??target.created_at))fail();
    if(event.decision==="MANUAL_REVIEWED"){
      if(previous?.decision==="MANUAL_REVIEWED"||event.revision===9||!event.source_and_author_checked||!event.evidence_url||canonicalContentUrl(event.evidence_url).canonical_url!==event.evidence_url)fail();
    }else if(previous?.decision!=="MANUAL_REVIEWED"||event.source_and_author_checked||event.evidence_url!==null)fail();
    ids.add(event.id);previous=event;
  }
  return value;
}
export async function decodeAuthorshipRows(rows:AuthorshipRow[],target:Snapshot){
  if(rows.length>10)fail();
  const events=rows.map(row=>{
    const event=AuthorshipEvent.parse(JSON.parse(row.event));
    if(event.id!==row.id||event.submission_id!==row.submission_id||event.revision!==row.revision||event.created_at!==row.created_at||event.decision!==row.decision||event.request_hash!==row.request_hash||event.hash!==row.event_hash)fail();
    return event;
  });
  return verifyAuthorshipHistory({submission_id:target.id,target_content_hash:await hashJson(target.content),events,replay:"verified",source_requests:0,reward_eligible:false},target);
}
export async function contentAuthorship(db:D1Database,id:string){
  const target=await contentRecord(db,z.uuid().parse(id));if(!target)fail("content_not_found",404);
  const rows=await db.prepare(AUTHORSHIP_SELECT).bind(id).all<AuthorshipRow>();
  return decodeAuthorshipRows(rows.results,target.snapshot);
}
export async function publicAuthorship(db:D1Database,id:string){
  const target=await contentRecord(db,z.uuid().parse(id));
  if(!target||target.snapshot.status!=="VISIBLE"||target.visibility_held)fail("content_not_found",404);
  const history=await contentAuthorship(db,id),last=history.events.at(-1);
  // A review/hold can change while histories are read. Recheck publication
  // admission before returning even this deliberately small public summary.
  const current=await contentRecord(db,id);if(!current||current.snapshot.status!=="VISIBLE"||current.visibility_held)fail("content_not_found",404);
  return AuthorshipSummary.parse({submission_id:id,status:last?.decision??"UNVERIFIED",reviewed_at:last?.created_at??null,method:last?"manual_source_review":"none",external_account_control:"unverified",rights:"not_certified",rewards_enabled:false,source_requests:0});
}
export async function reviewAuthorship(db:D1Database,raw:unknown,at=new Date()){
  const parsed=AuthorshipReviewRequest.parse(raw),input={...parsed,evidence_url:parsed.evidence_url?canonicalContentUrl(parsed.evidence_url).canonical_url:null};
  const request_hash=await hashJson(input),old=await db.prepare("SELECT * FROM tenx_content_authorship_events WHERE id=?").bind(input.request_id).first<AuthorshipRow>();
  if(old){
    if(old.request_hash!==request_hash||old.submission_id!==input.submission_id)fail("content_authorship_request_conflict",409);
    const record=await contentAuthorship(db,input.submission_id),event=record.events.find(e=>e.id===input.request_id);
    if(!event||event.request_hash!==request_hash)fail();return {event,replay:"verified" as const};
  }
  const history=await contentAuthorship(db,input.submission_id),previous=history.events.at(-1),target=await contentRecord(db,input.submission_id);
  if(!target)fail("content_not_found",404);
  if(input.expected_revision!==(previous?.revision??-1))fail("content_authorship_revision_conflict",409);
  if(input.decision==="WITHDRAWN"?previous?.decision!=="MANUAL_REVIEWED":previous?.decision==="MANUAL_REVIEWED"||input.expected_revision===8)fail("content_authorship_invalid_transition",409);
  const now=at.toISOString();if(now<(previous?.created_at??target.snapshot.created_at))fail("content_authorship_time_conflict",409);
  const unsigned=AuthorshipEvent.omit({hash:true}).parse({id:input.request_id,submission_id:input.submission_id,revision:input.expected_revision+1,created_at:now,actor:"local_operator",decision:input.decision,method:"manual_source_review",target_content_hash:history.target_content_hash,author_claim:target.snapshot.content.author_claim,evidence_url:input.evidence_url,reason:input.reason,source_and_author_checked:input.source_and_author_checked,request_hash,previous_hash:previous?.hash??null});
  const event=AuthorshipEvent.parse({...unsigned,hash:await hashJson(unsigned)});
  const start=now.slice(0,10)+"T00:00:00.000Z",end=new Date(Date.parse(start)+86400000).toISOString();
  // One statement atomically admits a head extension and daily review quota.
  // Withdrawal is always available for an existing active review, even when
  // the new-review quota is full. The final revision is reserved for it.
  await db.prepare(`INSERT OR IGNORE INTO tenx_content_authorship_events(id,submission_id,revision,created_at,decision,request_hash,event_hash,event)
    SELECT ?,?,?,?,?,?,?,? WHERE (SELECT count(*) FROM tenx_content_authorship_events WHERE submission_id=?)=?
    AND coalesce((SELECT event_hash FROM tenx_content_authorship_events WHERE submission_id=? ORDER BY revision DESC LIMIT 1),'')=?
    AND (?='WITHDRAWN' OR (SELECT count(*) FROM tenx_content_authorship_events WHERE decision='MANUAL_REVIEWED' AND created_at>=? AND created_at<?)<${AUTHORSHIP_REVIEW_DAILY_LIMIT})`)
    .bind(event.id,event.submission_id,event.revision,now,event.decision,request_hash,event.hash,JSON.stringify(event),event.submission_id,event.revision,event.submission_id,event.previous_hash??"",event.decision,start,end).run();
  const saved=await contentAuthorship(db,input.submission_id),retained=saved.events.find(e=>e.id===event.id);
  if(!retained)fail("content_authorship_revision_or_daily_limit",409);
  if(retained.request_hash!==request_hash)fail("content_authorship_request_conflict",409);
  return {event:retained,replay:"verified" as const};
}
