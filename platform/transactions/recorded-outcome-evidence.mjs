import {canonicalJson,utf8} from '../security/canonical.mjs';
import {validateSource,validateEnvelope,streamKey} from '../evidence/envelope.mjs';
import {decode58} from '../server/base58.mjs';
export const RECORDED_OUTCOME_DECODER='synthetic-transaction-outcome-v1';
export const RECORDED_OUTCOME_MAX_BYTES=4096;
export const LOCAL_REHEARSAL_GENESIS='8CBzMMmYAECcNqRdJvjM3N43pPYT1ez9yVdxdbDjwzv8';
const clone=v=>JSON.parse(canonicalJson(v)),freeze=v=>{if(v&&typeof v==='object'){Object.values(v).forEach(freeze);Object.freeze(v);}return v;};
const exact=(v,keys)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));
const id=v=>typeof v==='string'&&/^[A-Za-z0-9:_./-]{1,128}$/.test(v),digest=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
const need=(v,reason)=>{if(!v)throw new TypeError(reason);};
const key=(value,size)=>{need(typeof value==='string'&&value.length<=88,'outcome-key');decode58(value,size);};
/** Finalized envelope means the retained synthetic transcript is fixed. It is
 * never evidence of actual chain finality, submission or payment. */
export function inspectRecordedTransactionOutcome(sourceInput,payloadInput,envelopeInput){
 const source=validateSource(sourceInput),envelope=validateEnvelope(envelopeInput),p=clone(payloadInput),policy=source.policy;
 need(source.mode==='synthetic-fixture'&&envelope.mode==='synthetic-fixture'&&source.decoderVersion===RECORDED_OUTCOME_DECODER&&envelope.decoderVersion===RECORDED_OUTCOME_DECODER&&source.maxBytes<=RECORDED_OUTCOME_MAX_BYTES,'outcome-synthetic-source');
 need(exact(policy,['intentId','attemptId','owner','planHash','messageHash'])&&id(policy.intentId)&&id(policy.attemptId)&&digest(policy.planHash)&&digest(policy.messageHash)&&source.subject.kind==='transaction-attempt'&&source.subject.id===policy.attemptId,'outcome-source-policy');key(policy.owner,32);
 need(exact(p,['version','mode','eventId','intentId','attemptId','owner','planHash','signature','state','genesisHash','messageHash','observedMs'])&&p.version===1&&p.mode==='synthetic-fixture'&&id(p.eventId)&&['unknown','confirmed','failed','finalized'].includes(p.state),'outcome-payload');key(p.signature,64);
 need(p.intentId===policy.intentId&&p.attemptId===policy.attemptId&&p.owner===policy.owner&&p.planHash===policy.planHash&&p.messageHash===policy.messageHash,'outcome-policy-binding');
 need(source.chainGenesis===LOCAL_REHEARSAL_GENESIS&&envelope.chainGenesis===source.chainGenesis&&p.genesisHash===source.chainGenesis&&source.sourceId===envelope.sourceId&&source.sourceRevision===envelope.sourceRevision&&canonicalJson(source.subject)===canonicalJson(envelope.subject),'outcome-source-binding');
 need(Number.isSafeInteger(p.observedMs)&&p.observedMs>=0&&p.observedMs<=8640000000000000&&envelope.blockTimeMs===p.observedMs&&envelope.requestedCutoffMs===null&&envelope.contextSlot!==null&&envelope.finality==='finalized'&&p.observedMs<=envelope.retrievedAtMs&&envelope.retrievedAtMs<=envelope.ingestedAtMs&&envelope.ingestedAtMs-p.observedMs<=source.maxAgeMs,'outcome-recording-clock');
 const {version,mode,...event}=p;return freeze(event);
}
export async function verifyRecordedTransactionOutcome(value,crypto){
 const c=clone({source:value.source,envelope:value.envelope,decision:value.decision,receiptDigest:value.receiptDigest});
 need(value.bytes instanceof Uint8Array&&value.bytes.length>0&&value.bytes.length<=RECORDED_OUTCOME_MAX_BYTES,'outcome-byte-bound');const bytes=Uint8Array.from(value.bytes),text=new TextDecoder('utf-8',{fatal:true}).decode(bytes),payload=JSON.parse(text);
 need(text===canonicalJson(payload),'outcome-canonical-bytes');const event=inspectRecordedTransactionOutcome(c.source,payload,c.envelope),d=c.decision;
 need(bytes.length<=c.source.maxBytes&&exact(d,['status','reason','scope','coverage','decoded'])&&d.status==='verified'&&d.reason==='synthetic-transaction-outcome-validated'&&d.scope==='synthetic-transcript'&&exact(d.coverage,['complete','gaps'])&&d.coverage.complete===false&&Array.isArray(d.coverage.gaps)&&d.coverage.gaps.length===0&&canonicalJson(d.decoded)===canonicalJson(event),'outcome-decoder-decision');
 const byteDigest=await crypto.sha256(bytes);need(byteDigest===c.envelope.byteDigest,'outcome-byte-digest');need(await crypto.sha256(utf8(canonicalJson(['evidence-receipt-v1',c.envelope,d])))===c.receiptDigest,'outcome-receipt-digest');
 const observationJson=canonicalJson({attemptId:event.attemptId,signature:event.signature,state:event.state,genesisHash:event.genesisHash,messageHash:event.messageHash});
 return freeze({...c,event,byteDigest,sourceConfigDigest:await crypto.sha256(utf8(canonicalJson(c.source))),streamKey:streamKey(c.envelope),observationJson,observationDigest:await crypto.sha256(utf8(observationJson))});
}
