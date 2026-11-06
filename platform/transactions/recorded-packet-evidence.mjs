import {canonicalJson,utf8} from '../security/canonical.mjs';
import {validateSource,validateEnvelope,streamKey} from '../evidence/envelope.mjs';
import {decode58} from '../server/base58.mjs';
import {LOCAL_REHEARSAL_GENESIS} from './recorded-outcome-evidence.mjs';
export const RECORDED_PACKET_DECODER='synthetic-transaction-packet-v1';
export const RECORDED_PACKET_MAX_BYTES=32768;
const clone=v=>JSON.parse(canonicalJson(v)),freeze=v=>{if(v&&typeof v==='object'){Object.values(v).forEach(freeze);Object.freeze(v);}return v;};
const exact=(v,keys)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));
const id=v=>typeof v==='string'&&/^[A-Za-z0-9:_./-]{1,128}$/.test(v),digest=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v),need=(v,r)=>{if(!v)throw new TypeError(r);};
/** A retained local fixture unsigned packet, never a chain/RPC authenticity claim. */
export function inspectRecordedTransactionPacket(sourceInput,payloadInput,envelopeInput){
 const source=validateSource(sourceInput),envelope=validateEnvelope(envelopeInput),p=clone(payloadInput),policy=source.policy;
 need(source.mode==='synthetic-fixture'&&envelope.mode==='synthetic-fixture'&&source.decoderVersion===RECORDED_PACKET_DECODER&&envelope.decoderVersion===RECORDED_PACKET_DECODER&&source.maxBytes<=RECORDED_PACKET_MAX_BYTES,'packet-synthetic-source');
 need(exact(policy,['intentId','attemptId','owner','planHash','messageHash'])&&id(policy.intentId)&&id(policy.attemptId)&&digest(policy.planHash)&&digest(policy.messageHash)&&source.subject.kind==='transaction-attempt'&&source.subject.id===policy.attemptId,'packet-source-policy');decode58(policy.owner,32);
 need(exact(p,['version','mode','eventId','intentId','owner','planHash','packet','simulation','observedMs'])&&p.version===1&&p.mode==='synthetic-fixture'&&id(p.eventId),'packet-payload');
 const packet=p.packet,sim=p.simulation;
 need(exact(packet,['version','network','attemptId','planHash','genesisHash','messageBase64','messageHash','lifetime','lookupTables'])&&packet.version===1&&packet.network==='solana-local'&&id(packet.attemptId)&&digest(packet.messageHash)&&typeof packet.messageBase64==='string'&&packet.messageBase64.length<=1644,'packet-wire-shape');
 need(exact(packet.lifetime,['kind','blockhash','lastValidBlockHeight','contextSlot','observedAt'])&&packet.lifetime.kind==='recent-blockhash'&&Number.isSafeInteger(packet.lifetime.lastValidBlockHeight)&&packet.lifetime.lastValidBlockHeight>0&&Number.isSafeInteger(packet.lifetime.contextSlot)&&packet.lifetime.contextSlot>0&&Number.isSafeInteger(packet.lifetime.observedAt)&&packet.lifetime.observedAt>=0&&packet.lifetime.observedAt===p.observedMs,'packet-lifetime');decode58(packet.lifetime.blockhash,32);
 need(Array.isArray(packet.lookupTables)&&packet.lookupTables.length<=8,'packet-lookups');
 need(exact(sim,['genesisHash','ok','messageHash','blockhash','height','contextSlot','observedAt','lookupTables','feeUnits','outputUnits','ref'])&&sim.ok===true&&id(sim.ref)&&Number.isSafeInteger(sim.height)&&sim.height>=0&&sim.height<=packet.lifetime.lastValidBlockHeight,'packet-simulation');
 for(const amount of [sim.feeUnits,sim.outputUnits])need(typeof amount==='string'&&/^(0|[1-9][0-9]{0,19})$/.test(amount)&&BigInt(amount)<=(1n<<64n)-1n,'packet-amount');
 need(sim.messageHash===packet.messageHash&&sim.blockhash===packet.lifetime.blockhash&&sim.contextSlot===packet.lifetime.contextSlot&&sim.observedAt===packet.lifetime.observedAt&&canonicalJson(sim.lookupTables)===canonicalJson(packet.lookupTables),'packet-simulation-binding');
 need(p.intentId===policy.intentId&&packet.attemptId===policy.attemptId&&p.owner===policy.owner&&p.planHash===policy.planHash&&packet.planHash===policy.planHash&&packet.messageHash===policy.messageHash,'packet-policy-binding');
 need(source.chainGenesis===LOCAL_REHEARSAL_GENESIS&&envelope.chainGenesis===source.chainGenesis&&packet.genesisHash===source.chainGenesis&&sim.genesisHash===source.chainGenesis&&source.sourceId===envelope.sourceId&&source.sourceRevision===envelope.sourceRevision&&canonicalJson(source.subject)===canonicalJson(envelope.subject),'packet-source-binding');
 need(Number.isSafeInteger(p.observedMs)&&p.observedMs>=0&&p.observedMs<=8640000000000000&&envelope.blockTimeMs===p.observedMs&&envelope.requestedCutoffMs===null&&envelope.contextSlot===String(packet.lifetime.contextSlot)&&envelope.finality==='finalized'&&p.observedMs<=envelope.retrievedAtMs&&envelope.retrievedAtMs<=envelope.ingestedAtMs&&envelope.ingestedAtMs-p.observedMs<=source.maxAgeMs,'packet-recording-clock');
 const {version,mode,...event}=p;return freeze(event);
}
export async function verifyRecordedTransactionPacket(value,crypto){
 const c=clone({source:value.source,envelope:value.envelope,decision:value.decision,receiptDigest:value.receiptDigest});need(value.bytes instanceof Uint8Array&&value.bytes.length>0&&value.bytes.length<=RECORDED_PACKET_MAX_BYTES,'packet-byte-bound');
 const bytes=Uint8Array.from(value.bytes),text=new TextDecoder('utf-8',{fatal:true}).decode(bytes),payload=JSON.parse(text);need(text===canonicalJson(payload),'packet-canonical-bytes');const event=inspectRecordedTransactionPacket(c.source,payload,c.envelope),d=c.decision;
 need(bytes.length<=c.source.maxBytes&&exact(d,['status','reason','scope','coverage','decoded'])&&d.status==='verified'&&d.reason==='synthetic-transaction-packet-validated'&&d.scope==='synthetic-transcript'&&exact(d.coverage,['complete','gaps'])&&d.coverage.complete===false&&Array.isArray(d.coverage.gaps)&&d.coverage.gaps.length===0&&canonicalJson(d.decoded)===canonicalJson(event),'packet-decoder-decision');
 const byteDigest=await crypto.sha256(bytes);need(byteDigest===c.envelope.byteDigest,'packet-byte-digest');need(await crypto.sha256(utf8(canonicalJson(['evidence-receipt-v1',c.envelope,d])))===c.receiptDigest,'packet-receipt-digest');
 return freeze({...c,event,byteDigest,sourceConfigDigest:await crypto.sha256(utf8(canonicalJson(c.source))),streamKey:streamKey(c.envelope)});
}
