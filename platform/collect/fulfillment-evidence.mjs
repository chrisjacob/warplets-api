import {canonicalJson,utf8} from '../security/canonical.mjs';
import {validateSource,validateEnvelope,streamKey} from '../evidence/envelope.mjs';
import {captureBeaconProof} from '../beacon/protocol.mjs';
import {roundTime} from '../randomness/request-plan.mjs';
export const COLLECTION_PROGRESSION_DECODER='synthetic-collection-progression-v1';
export const MAX_COLLECTION_PROGRESSION_BYTES=16384;
const clone=v=>JSON.parse(canonicalJson(v));
const exact=(v,keys)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));
const id=v=>typeof v==='string'&&/^[A-Za-z0-9._:-]{1,128}$/.test(v);
const time=v=>Number.isSafeInteger(v)&&v>=0&&v<=8640000000000000;
const fail=(c,code)=>{if(!c){const e=new TypeError(code);e.code=code;throw e;}};
const freeze=v=>{if(v&&typeof v==='object'){for(const child of Object.values(v))freeze(child);Object.freeze(v);}return v;};
/** Structural capture validation only. A configured round is cryptographically
 * checked and deterministically materialized again by the fulfillment planner. */
export function inspectCollectionProgression(sourceInput,payloadInput,envelopeInput){
 const source=validateSource(sourceInput),envelope=validateEnvelope(envelopeInput),p=clone(payloadInput);
 fail(source.decoderVersion===COLLECTION_PROGRESSION_DECODER&&envelope.decoderVersion===COLLECTION_PROGRESSION_DECODER&&source.mode==='synthetic-fixture'&&envelope.mode==='synthetic-fixture','progression-synthetic-source-required');
 fail(exact(source.policy,['inventoryId','operationId'])&&id(source.policy.inventoryId)&&id(source.policy.operationId)&&source.subject.kind==='collection-operation'&&source.subject.id===source.policy.operationId,'progression-source-policy');
 fail(source.sourceId===envelope.sourceId&&source.sourceRevision===envelope.sourceRevision&&source.chainGenesis===envelope.chainGenesis&&canonicalJson(source.subject)===canonicalJson(envelope.subject),'progression-source-binding');
 fail(exact(p,['version','mode','inventoryId','operationId','kind','commitment','provenance','atMs','proof'])&&p.version===1&&p.mode==='synthetic-fixture'&&p.inventoryId===source.policy.inventoryId&&p.operationId===source.policy.operationId&&id(p.commitment)&&['upgrade','visual'].includes(p.kind)&&['manual-fixture','configured-offline-beacon'].includes(p.provenance),'progression-payload');
 fail(time(p.atMs)&&envelope.requestedCutoffMs===null&&envelope.contextSlot!==null&&envelope.blockTimeMs===p.atMs&&envelope.finality==='finalized'&&p.atMs<=envelope.retrievedAtMs&&envelope.retrievedAtMs<=envelope.ingestedAtMs&&envelope.ingestedAtMs-p.atMs<=source.maxAgeMs,'progression-recording-clock');
 if(p.provenance==='configured-offline-beacon'){captureBeaconProof(p.proof,p.proof?.round);fail(p.atMs===roundTime(p.proof.round),'progression-beacon-time');}
 else{
  fail(exact(p.proof,['proofId','ticket','traits'])&&id(p.proof.proofId),'progression-manual-proof');
  if(p.kind==='upgrade')fail(Number.isInteger(p.proof.ticket)&&p.proof.ticket>=0&&p.proof.ticket<1000&&p.proof.traits===null,'progression-upgrade-ticket');
  else fail(p.proof.ticket===null&&exact(p.proof.traits,['model','backdrop','symbol'])&&Object.values(p.proof.traits).every(v=>typeof v==='string'&&v.length>0&&v.length<=128&&v.trim()===v),'progression-visual-traits');
 }
 return freeze({inventoryId:p.inventoryId,operationId:p.operationId,kind:p.kind,commitment:p.commitment,provenance:p.provenance,atMs:p.atMs,proof:p.proof});
}
export async function verifyCollectionProgressionEvidence(value,crypto){
 const captured=clone({source:value.source,envelope:value.envelope,decision:value.decision,receiptDigest:value.receiptDigest});
 fail(value.bytes instanceof Uint8Array&&value.bytes.length>0&&value.bytes.length<=MAX_COLLECTION_PROGRESSION_BYTES,'progression-byte-bound');const bytes=Uint8Array.from(value.bytes);
 const {source,envelope,decision,receiptDigest}=captured;let payload;try{payload=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}catch{fail(false,'progression-json');}
 const event=inspectCollectionProgression(source,payload,envelope);
 fail(bytes.length<=source.maxBytes&&decision?.status==='verified'&&decision.reason==='synthetic-progression-event-validated'&&decision.scope==='synthetic-transcript'&&exact(decision.coverage,['complete','gaps'])&&decision.coverage.complete===false&&Array.isArray(decision.coverage.gaps)&&decision.coverage.gaps.length===0&&canonicalJson(decision.decoded)===canonicalJson(event),'progression-decision');
 const byteDigest=await crypto.sha256(bytes);fail(byteDigest===envelope.byteDigest,'progression-byte-digest');fail(await crypto.sha256(utf8(canonicalJson(['evidence-receipt-v1',envelope,decision])))===receiptDigest,'progression-receipt-digest');
 return freeze({event,source,envelope,receiptDigest,byteDigest,sourceConfigDigest:await crypto.sha256(utf8(canonicalJson(source))),streamKey:streamKey(envelope)});
}
