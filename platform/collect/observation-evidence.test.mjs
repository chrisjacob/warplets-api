import test from 'node:test';
import assert from 'node:assert/strict';
import {createNodeCrypto} from '../security/node-crypto.mjs';
import {canonicalJson,utf8} from '../security/canonical.mjs';
import {encode58} from '../server/base58.mjs';
import {inspectCollectionObservation,verifyCollectionObservationEvidence} from './observation-evidence.mjs';
import {buildCollectionObservationCommand} from './observation-service.mjs';
const crypto=createNodeCrypto(),from=encode58(new Uint8Array(32).fill(7)),to=encode58(new Uint8Array(32).fill(8));
async function fixture(){
 const payload={version:1,mode:'synthetic-fixture',inventoryId:'synthetic-season',assetId:'synthetic-asset',kind:'transfer',observedMs:1771113600000,from,to},bytes=utf8(canonicalJson(payload)),byteDigest=await crypto.sha256(bytes);
 const source={version:1,sourceId:'synthetic-observer',sourceRevision:'1',mode:'synthetic-fixture',chainGenesis:'synthetic-local-solana',decoderVersion:'synthetic-collection-observation-v1',subject:{kind:'collection-asset',id:payload.assetId},policy:{inventoryId:payload.inventoryId,assetId:payload.assetId},recordingDigest:'a'.repeat(64),maxBytes:16384,maxAgeMs:86400000};
 const envelope={version:1,evidenceId:'b'.repeat(64),mode:source.mode,chainGenesis:source.chainGenesis,sourceId:source.sourceId,sourceRevision:source.sourceRevision,subject:source.subject,requestedCutoffMs:null,contextSlot:'1',blockTimeMs:payload.observedMs,retrievedAtMs:payload.observedMs+1000,ingestedAtMs:payload.observedMs+2000,finality:'finalized',decoderVersion:source.decoderVersion,byteDigest,objectRef:'private/'+byteDigest+'.json',supersedes:null};
 const decision={status:'verified',reason:'synthetic-collection-event-validated',scope:'synthetic-transcript',coverage:{complete:false,gaps:[]},decoded:inspectCollectionObservation(source,payload,envelope)},receiptDigest=await crypto.sha256(utf8(canonicalJson(['evidence-receipt-v1',envelope,decision])));
 return {source,envelope,decision,receiptDigest,bytes,payload};
}
test('observation evidence binds exact source, raw event, clocks and synthetic receipt without claiming complete chain history',async()=>{
 const f=await fixture(),verified=await verifyCollectionObservationEvidence(f,crypto);assert.equal(verified.event.to,to);assert.equal(verified.event.observedMs,f.payload.observedMs);assert.ok(Object.isFrozen(verified.event));assert.equal(verified.envelope.mode,'synthetic-fixture');
 for(const patch of [{assetId:'another'},{from:to},{kind:'mint'},{observedMs:f.payload.observedMs+1},{finalized:true}])assert.throws(()=>inspectCollectionObservation(f.source,{...f.payload,...patch},f.envelope));
 for(const patch of [{finality:'confirmed'},{requestedCutoffMs:f.payload.observedMs},{blockTimeMs:f.payload.observedMs+1000},{retrievedAtMs:f.payload.observedMs-1},{ingestedAtMs:f.payload.observedMs-1}])assert.throws(()=>inspectCollectionObservation(f.source,f.payload,{...f.envelope,...patch}));
 await assert.rejects(verifyCollectionObservationEvidence({...f,bytes:utf8('{}')},crypto));await assert.rejects(verifyCollectionObservationEvidence({...f,receiptDigest:'0'.repeat(64)},crypto),/receipt-digest/);
 await assert.rejects(verifyCollectionObservationEvidence({...f,decision:{...f.decision,coverage:{complete:true,gaps:[]}}},crypto),/observation-decision/);
 assert.throws(()=>inspectCollectionObservation({...f.source,mode:'recorded-public'},f.payload,f.envelope),/source-collection-observation-policy/);
 assert.throws(()=>inspectCollectionObservation({...f.source,policy:{...f.source.policy,complete:true}},f.payload,f.envelope),/source-collection-observation-policy/);
 const reveal={...f.payload,kind:'reveal',from:null,to:null};assert.equal(inspectCollectionObservation(f.source,reveal,f.envelope).kind,'reveal');
});
test('raw bytes, source metadata and principal cannot change after asynchronous verification starts',async()=>{
 const f=await fixture();let changed=false;const verified=await verifyCollectionObservationEvidence(f,{...crypto,async sha256(bytes){if(!changed){changed=true;f.bytes.fill(0);f.source.policy.assetId='changed';f.envelope.subject.id='changed';f.decision.decoded={...f.decision.decoded,to:from};}return crypto.sha256(bytes);}});assert.equal(verified.event.assetId,'synthetic-asset');assert.equal(verified.event.to,to);
 const good=await fixture(),input={requestKey:'synthetic-observation',assetId:good.payload.assetId,kind:'transfer',from,to,observedMs:good.payload.observedMs,expectedAssetVersion:1,evidenceReceiptId:good.receiptDigest,evidenceDigest:good.envelope.byteDigest},p={kind:'operator',id:'synthetic-observer'};
 const command=await buildCollectionObservationCommand(p,input,{...crypto,async sha256(bytes){p.id='changed';input.to=from;return crypto.sha256(bytes);}});assert.equal(command.principal.id,'synthetic-observer');assert.equal(command.input.to,to);
 for(const patch of [{finalized:true},{evidenceReceiptId:'unbound'},{kind:'mint'},{expectedAssetVersion:Infinity},{asset:{owner:to}}])await assert.rejects(buildCollectionObservationCommand({kind:'operator',id:'synthetic'}, {...input,to,...patch},crypto),e=>e.status===400);
 await assert.rejects(buildCollectionObservationCommand({kind:'wallet',wallet:from},{...input,to},crypto),/operator-required/);
});
