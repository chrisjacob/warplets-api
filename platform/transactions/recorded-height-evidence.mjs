import {canonicalJson,utf8} from '../security/canonical.mjs';
import {validateSource,validateEnvelope,streamKey} from '../evidence/envelope.mjs';
import {decode58} from '../server/base58.mjs';
import {LOCAL_REHEARSAL_GENESIS} from './recorded-outcome-evidence.mjs';
export const RECORDED_HEIGHT_DECODER='synthetic-transaction-height-v1';
export const RECORDED_HEIGHT_MAX_BYTES=4096;
const clone=v=>JSON.parse(canonicalJson(v)),freeze=v=>{if(v&&typeof v==='object'){Object.values(v).forEach(freeze);Object.freeze(v);}return v;};
const exact=(v,keys)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));
const id=v=>typeof v==='string'&&/^[A-Za-z0-9:_./-]{1,128}$/.test(v),digest=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v),need=(v,r)=>{if(!v)throw new TypeError(r);};
/** A retained local fixture height, never a chain/RPC authenticity claim. */
export function inspectRecordedTransactionHeight(sourceInput,payloadInput,envelopeInput){
 const source=validateSource(sourceInput),envelope=validateEnvelope(envelopeInput),p=clone(payloadInput),policy=source.policy;
 need(source.mode==='synthetic-fixture'&&envelope.mode==='synthetic-fixture'&&source.decoderVersion===RECORDED_HEIGHT_DECODER&&envelope.decoderVersion===RECORDED_HEIGHT_DECODER&&source.maxBytes<=RECORDED_HEIGHT_MAX_BYTES,'height-synthetic-source');
 need(exact(policy,['intentId','attemptId','owner','planHash','messageHash'])&&id(policy.intentId)&&id(policy.attemptId)&&digest(policy.planHash)&&digest(policy.messageHash)&&source.subject.kind==='transaction-attempt'&&source.subject.id===policy.attemptId,'height-source-policy');decode58(policy.owner,32);
 need(exact(p,['version','mode','eventId','intentId','attemptId','owner','planHash','messageHash','genesisHash','blockHeight','observedMs'])&&p.version===1&&p.mode==='synthetic-fixture'&&id(p.eventId)&&Number.isSafeInteger(p.blockHeight)&&p.blockHeight>=0,'height-payload');
 need(p.intentId===policy.intentId&&p.attemptId===policy.attemptId&&p.owner===policy.owner&&p.planHash===policy.planHash&&p.messageHash===policy.messageHash,'height-policy-binding');
 need(source.chainGenesis===LOCAL_REHEARSAL_GENESIS&&envelope.chainGenesis===source.chainGenesis&&p.genesisHash===source.chainGenesis&&source.sourceId===envelope.sourceId&&source.sourceRevision===envelope.sourceRevision&&canonicalJson(source.subject)===canonicalJson(envelope.subject),'height-source-binding');
 need(Number.isSafeInteger(p.observedMs)&&p.observedMs>=0&&p.observedMs<=8640000000000000&&envelope.blockTimeMs===p.observedMs&&envelope.requestedCutoffMs===null&&envelope.contextSlot!==null&&envelope.finality==='finalized'&&p.observedMs<=envelope.retrievedAtMs&&envelope.retrievedAtMs<=envelope.ingestedAtMs&&envelope.ingestedAtMs-p.observedMs<=source.maxAgeMs,'height-recording-clock');
 const {version,mode,...event}=p;return freeze(event);
}
export async function verifyRecordedTransactionHeight(value,crypto){
 const c=clone({source:value.source,envelope:value.envelope,decision:value.decision,receiptDigest:value.receiptDigest});need(value.bytes instanceof Uint8Array&&value.bytes.length>0&&value.bytes.length<=RECORDED_HEIGHT_MAX_BYTES,'height-byte-bound');
 const bytes=Uint8Array.from(value.bytes),text=new TextDecoder('utf-8',{fatal:true}).decode(bytes),payload=JSON.parse(text);need(text===canonicalJson(payload),'height-canonical-bytes');const event=inspectRecordedTransactionHeight(c.source,payload,c.envelope),d=c.decision;
 need(bytes.length<=c.source.maxBytes&&exact(d,['status','reason','scope','coverage','decoded'])&&d.status==='verified'&&d.reason==='synthetic-transaction-height-validated'&&d.scope==='synthetic-transcript'&&exact(d.coverage,['complete','gaps'])&&d.coverage.complete===false&&Array.isArray(d.coverage.gaps)&&d.coverage.gaps.length===0&&canonicalJson(d.decoded)===canonicalJson(event),'height-decoder-decision');
 const byteDigest=await crypto.sha256(bytes);need(byteDigest===c.envelope.byteDigest,'height-byte-digest');need(await crypto.sha256(utf8(canonicalJson(['evidence-receipt-v1',c.envelope,d])))===c.receiptDigest,'height-receipt-digest');
 return freeze({...c,event,byteDigest,sourceConfigDigest:await crypto.sha256(utf8(canonicalJson(c.source))),streamKey:streamKey(c.envelope)});
}
