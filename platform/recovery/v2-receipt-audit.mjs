import {sql} from '../storage/atomic-driver.mjs';
import {canonicalJson,utf8} from '../security/canonical.mjs';
import {prepareConfigAudit} from '../storage/atomic-audit.mjs';
import {STAGE_COLLECTION_CUT_RECORD,BEGIN_COLLECTION_FREE_CUT,VALIDATE_COLLECTION_CUT_PAGE,SEAL_COLLECTION_FREE_CUT} from '../collect/free-cut-service.mjs';
import {PUBLISH_COLLECTION_STAGE} from '../collect/stage-service.mjs';
const need=(ok,message)=>{if(!ok)throw new TypeError('Recovery receipt audit '+message);};
const hash=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const exact=(value,keys)=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).length===keys.length&&keys.every(k=>Object.hasOwn(value,k));
const bounded=(column,size)=>`CASE WHEN length(CAST(${column} AS BLOB))<=${size} THEN ${column} ELSE NULL END ${column}`;
const sourceKinds=['collection.stage-record.v1','collection.seal-list.v1','collection.seal-source.v1','collection.materialize-eligibility-page.v1'];
const cutKinds=[STAGE_COLLECTION_CUT_RECORD,BEGIN_COLLECTION_FREE_CUT,VALIDATE_COLLECTION_CUT_PAGE,SEAL_COLLECTION_FREE_CUT];
/** Split only verified additive audit metadata. Plain historical receipts retain
 * their exact original business input. All SQL goes through the caller's meter. */
export async function verifiedRecoveryReceiptInput(receipt,read,crypto){
 const r=structuredClone(receipt),input=JSON.parse(r.input_json);
 need(input&&typeof input==='object'&&!Array.isArray(input)&&r.input_json===canonicalJson(input),'canonical input envelope.');
 if(!Object.hasOwn(input,'audit'))return input;
 need(sourceKinds.includes(r.operation_kind)||cutKinds.includes(r.operation_kind)||r.operation_kind===PUBLISH_COLLECTION_STAGE,'unsupported audited kind.');
 const {audit,...business}=input;
 need(exact(audit,['seq','previousHash','eventHash','payload','recordedMs'])&&Number.isSafeInteger(audit.seq)&&audit.seq>=1&&hash(audit.eventHash)&&(audit.seq===1?audit.previousHash===null:hash(audit.previousHash))&&typeof audit.payload==='string'&&utf8(audit.payload).length<=16384&&Number.isSafeInteger(audit.recordedMs)&&audit.recordedMs>=0&&audit.recordedMs===r.created_ms,'metadata.');
 need(typeof r.principal_key==='string'&&/^operator:[A-Za-z0-9._:-]{1,128}$/.test(r.principal_key),'principal.');
 const result=JSON.parse(r.result_json),isStage=r.operation_kind===PUBLISH_COLLECTION_STAGE;
 const event=isStage?{category:'collection-stage',entity:business.inventoryId,changeKey:r.business_key,atMs:r.created_ms,actor:r.principal_key.slice(9),evidenceRef:business.eligibilityListId??business.sourceKind,payload:{inventoryId:business.inventoryId,stageId:business.stageId,termsDigest:result.termsDigest,eligibility:result.eligibility,requestDigest:r.request_digest,priceLamports:business.priceLamports,costLamports:business.costLamports,sourceKind:business.sourceKind}}:
  {category:sourceKinds.includes(r.operation_kind)?'collection-source':'collection-free-cut',entity:r.business_key,changeKey:sourceKinds.includes(r.operation_kind)?canonicalJson([r.operation_kind,r.request_key]):r.request_key,atMs:r.created_ms,actor:r.principal_key.slice(9),evidenceRef:business.id??business.rootId??business.attemptId,payload:{operationKind:r.operation_kind,requestDigest:r.request_digest,resultRef:r.result_ref,resultDigest:r.output_digest}};
 const [rows]=await read([sql(`SELECT seq,${bounded('previous_hash',64)},${bounded('event_hash',64)},${bounded('category',64)},${bounded('entity',512)},${bounded('change_key',512)},recorded_ms,${bounded('actor',128)},${bounded('evidence_ref',256)},${bounded('payload',16384)} FROM ops_config_audit WHERE seq IN (?,?) ORDER BY seq`,audit.seq,audit.seq-1)]);
 const row=rows.find(v=>v.seq===audit.seq),previous=rows.find(v=>v.seq===audit.seq-1);
 need(rows.length===(audit.seq===1?1:2)&&row&&(audit.seq===1?!previous:previous&&hash(previous.event_hash)&&previous.event_hash===audit.previousHash),'row or predecessor.');
 const expected=await prepareConfigAudit(previous??null,event,crypto);
 need(canonicalJson(expected)===canonicalJson(audit),'historical event hash or payload.');
 need(row.previous_hash===expected.previousHash&&row.event_hash===expected.eventHash&&row.category===event.category&&row.entity===event.entity&&row.change_key===event.changeKey&&row.recorded_ms===event.atMs&&row.actor===event.actor&&row.evidence_ref===event.evidenceRef&&row.payload===expected.payload,'row binding.');
 return business;
}
