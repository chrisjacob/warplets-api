import test from 'node:test';
import assert from 'node:assert/strict';
import {createNodeCrypto} from '../security/node-crypto.mjs';
import {canonicalJson,utf8} from '../security/canonical.mjs';
import {collectionFulfillmentFixture} from '../application/fixtures/collection-fulfillment.mjs';
import {inspectCollectionProgression,verifyCollectionProgressionEvidence} from './fulfillment-evidence.mjs';
import {buildCollectionFulfillmentCommand} from './fulfillment-service.mjs';
const crypto=createNodeCrypto();
async function fixture(){
 const event={inventoryId:'synthetic-season',operationId:'synthetic-operation',kind:'upgrade',commitment:'synthetic-commitment',provenance:'manual-fixture',atMs:1771113600000,proof:{proofId:'synthetic-proof',ticket:999,traits:null}},f=await collectionFulfillmentFixture({crypto,event}),source=f.source,record=await [...f.readers.values()][0].read('result'),envelope={version:1,evidenceId:'b'.repeat(64),mode:source.mode,chainGenesis:source.chainGenesis,sourceId:source.sourceId,sourceRevision:source.sourceRevision,subject:source.subject,requestedCutoffMs:null,contextSlot:'1',blockTimeMs:event.atMs,retrievedAtMs:event.atMs,ingestedAtMs:event.atMs+1000,finality:'finalized',decoderVersion:source.decoderVersion,byteDigest:record.byteDigest,objectRef:'private/'+record.byteDigest+'.json',supersedes:null};
 const payload=JSON.parse(new TextDecoder().decode(record.bytes)),decision={status:'verified',reason:'synthetic-progression-event-validated',scope:'synthetic-transcript',coverage:{complete:false,gaps:[]},decoded:inspectCollectionProgression(source,payload,envelope)},receiptDigest=await crypto.sha256(utf8(canonicalJson(['evidence-receipt-v1',envelope,decision])));return {source,envelope,decision,receiptDigest,bytes:record.bytes,payload};
}
test('progression capture binds only exact synthetic transcript and cannot smuggle chosen configured outcomes or finality authority',async()=>{
 const f=await fixture(),verified=await verifyCollectionProgressionEvidence(f,crypto);assert.equal(verified.event.proof.ticket,999);assert.ok(Object.isFrozen(verified.event.proof));
 for(const patch of [{operationId:'other'},{kind:'mint'},{finalized:true},{provenance:'configured-offline-beacon'},{proof:{proofId:'synthetic',ticket:1000,traits:null}},{proof:{proofId:'synthetic',ticket:999,traits:null,approved:true}}])assert.throws(()=>inspectCollectionProgression(f.source,{...f.payload,...patch},f.envelope));
 for(const patch of [{blockTimeMs:f.envelope.blockTimeMs+1},{finality:'confirmed'},{ingestedAtMs:f.envelope.blockTimeMs-1},{requestedCutoffMs:f.envelope.blockTimeMs}])assert.throws(()=>inspectCollectionProgression(f.source,f.payload,{...f.envelope,...patch}));
 await assert.rejects(verifyCollectionProgressionEvidence({...f,decision:{...f.decision,coverage:{complete:true,gaps:[]}}},crypto),/progression-decision/);await assert.rejects(verifyCollectionProgressionEvidence({...f,receiptDigest:'0'.repeat(64)},crypto),/receipt-digest/);
});
test('capture bytes and compact operator command remain stable across asynchronous hash boundaries',async()=>{
 const f=await fixture();let changed=false;const result=await verifyCollectionProgressionEvidence(f,{...crypto,async sha256(bytes){if(!changed){changed=true;f.bytes.fill(0);f.source.policy.operationId='changed';f.envelope.subject.id='changed';f.decision.decoded={...f.decision.decoded,proof:{proofId:'changed',ticket:0,traits:null}};}return crypto.sha256(bytes);}});assert.equal(result.event.operationId,'synthetic-operation');assert.equal(result.event.proof.ticket,999);
 const principal={kind:'operator',id:'synthetic-operator'},input={requestKey:'synthetic-request',operationId:'synthetic-operation',evidenceReceiptId:'a'.repeat(64),evidenceDigest:'b'.repeat(64)},command=await buildCollectionFulfillmentCommand(principal,input,{...crypto,async sha256(bytes){principal.id='changed';input.operationId='changed';return crypto.sha256(bytes);}});assert.equal(command.operationKind,'collection.fulfill-operation.v1');assert.equal(command.principal.id,'synthetic-operator');assert.equal(command.input.operationId,'synthetic-operation');
 for(const patch of [{finalized:true},{ticket:999},{proofId:'supplied'},{evidenceReceiptId:'unknown'},{evidenceDigest:Infinity}])await assert.rejects(buildCollectionFulfillmentCommand({kind:'operator',id:'synthetic'},{...input,...patch},crypto),e=>e.status===400);
});
