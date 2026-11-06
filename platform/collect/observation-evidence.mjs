import {canonicalJson,utf8} from '../security/canonical.mjs';
import {validateSource,validateEnvelope,streamKey} from '../evidence/envelope.mjs';
import {decode58} from '../server/base58.mjs';
export const COLLECTION_OBSERVATION_DECODER='synthetic-collection-observation-v1';
export const MAX_COLLECTION_OBSERVATION_BYTES=16384;
const clone=v=>JSON.parse(canonicalJson(v));
const exact=(v,keys)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));
const id=v=>typeof v==='string'&&/^[A-Za-z0-9._:-]{1,128}$/.test(v);
const time=v=>Number.isSafeInteger(v)&&v>=0&&v<=8640000000000000;
const fail=(c,code)=>{if(!c){const e=new TypeError(code);e.code=code;throw e;}};
const wallet=v=>{fail(typeof v==='string','observation-wallet');try{decode58(v,32);}catch{fail(false,'observation-wallet');}return v;};
const freeze=v=>{if(v&&typeof v==='object'){for(const child of Object.values(v))freeze(child);Object.freeze(v);}return v;};
/** Synthetic event validation is not proof of chain ownership or history. */
export function inspectCollectionObservation(sourceInput,payloadInput,envelopeInput){
 const source=validateSource(sourceInput),envelope=validateEnvelope(envelopeInput),p=clone(payloadInput);
 fail(source.decoderVersion===COLLECTION_OBSERVATION_DECODER&&envelope.decoderVersion===COLLECTION_OBSERVATION_DECODER&&source.mode==='synthetic-fixture'&&envelope.mode==='synthetic-fixture','observation-synthetic-source-required');
 fail(exact(source.policy,['inventoryId','assetId'])&&id(source.policy.inventoryId)&&id(source.policy.assetId)&&source.subject.kind==='collection-asset'&&source.subject.id===source.policy.assetId,'observation-source-policy');
 fail(source.sourceId===envelope.sourceId&&source.sourceRevision===envelope.sourceRevision&&source.chainGenesis===envelope.chainGenesis&&canonicalJson(source.subject)===canonicalJson(envelope.subject),'observation-source-binding');
 fail(exact(p,['version','mode','inventoryId','assetId','kind','observedMs','from','to'])&&p.version===1&&p.mode==='synthetic-fixture'&&p.inventoryId===source.policy.inventoryId&&p.assetId===source.policy.assetId&&['reveal','transfer'].includes(p.kind),'observation-payload');
 fail(time(p.observedMs)&&envelope.requestedCutoffMs===null&&envelope.contextSlot!==null&&envelope.blockTimeMs===p.observedMs&&envelope.finality==='finalized'&&p.observedMs<=envelope.retrievedAtMs&&envelope.retrievedAtMs<=envelope.ingestedAtMs&&envelope.ingestedAtMs-p.observedMs<=source.maxAgeMs,'observation-recording-clock');
 if(p.kind==='transfer'){wallet(p.from);wallet(p.to);fail(p.from!==p.to&&p.observedMs%1000===0,'observation-transfer');}
 else fail(p.from===null&&p.to===null,'observation-reveal');
 return freeze({inventoryId:p.inventoryId,assetId:p.assetId,kind:p.kind,observedMs:p.observedMs,from:p.from,to:p.to});
}
export async function verifyCollectionObservationEvidence(value,crypto){
 const captured=clone({source:value.source,envelope:value.envelope,decision:value.decision,receiptDigest:value.receiptDigest});
 fail(value.bytes instanceof Uint8Array&&value.bytes.length>0&&value.bytes.length<=MAX_COLLECTION_OBSERVATION_BYTES,'observation-byte-bound');const bytes=Uint8Array.from(value.bytes);
 const {source,envelope,decision,receiptDigest}=captured;let payload;
 try{payload=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}catch{fail(false,'observation-json');}
 const event=inspectCollectionObservation(source,payload,envelope);
 fail(bytes.length<=source.maxBytes&&decision?.status==='verified'&&decision.reason==='synthetic-collection-event-validated'&&decision.scope==='synthetic-transcript'&&exact(decision.coverage,['complete','gaps'])&&decision.coverage.complete===false&&Array.isArray(decision.coverage.gaps)&&decision.coverage.gaps.length===0&&canonicalJson(decision.decoded)===canonicalJson(event),'observation-decision');
 const byteDigest=await crypto.sha256(bytes);fail(byteDigest===envelope.byteDigest,'observation-byte-digest');
 fail(await crypto.sha256(utf8(canonicalJson(['evidence-receipt-v1',envelope,decision])))===receiptDigest,'observation-receipt-digest');
 const sourceConfigDigest=await crypto.sha256(utf8(canonicalJson(source)));
 return freeze({event,source,envelope,receiptDigest,byteDigest,sourceConfigDigest,streamKey:streamKey(envelope)});
}
