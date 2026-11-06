import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createNodeCrypto} from '../security/node-crypto.mjs';
import {canonicalJson,utf8} from '../security/canonical.mjs';
import {roundTime} from '../randomness/request-plan.mjs';
import {mintFulfillmentFixture} from './mint-fulfillment-fixture.mjs';
import {inspectCollectionMintFulfillment,verifyCollectionMintFulfillmentEvidence} from './mint-fulfillment-evidence.mjs';
import {createMintFulfillmentService} from './mint-fulfillment-service.mjs';
const crypto=createNodeCrypto(),signed=JSON.parse(readFileSync(new URL('../beacon/fixtures/round-30000000.json',import.meta.url)));
async function fixture(configured=false){
 const event={inventoryId:'synthetic-mint-inventory',operationId:'synthetic-mint-operation',kind:'mint',commitment:'synthetic-commitment',provenance:configured?'configured-offline-beacon':'manual-fixture',atMs:configured?roundTime(signed.round):1771113600000,proof:configured?signed:{proofId:'synthetic-proof',assetId:'synthetic-asset',ticket:999,traits:{model:'Synthetic model',backdrop:'Synthetic backdrop',symbol:'Synthetic symbol'}}},f=await mintFulfillmentFixture({crypto,event}),source=f.source,record=await [...f.readers.values()][0].read('result'),envelope={version:1,evidenceId:'b'.repeat(64),mode:source.mode,chainGenesis:source.chainGenesis,sourceId:source.sourceId,sourceRevision:source.sourceRevision,subject:source.subject,requestedCutoffMs:null,contextSlot:'1',blockTimeMs:event.atMs,retrievedAtMs:event.atMs,ingestedAtMs:event.atMs+1000,finality:'finalized',decoderVersion:source.decoderVersion,byteDigest:record.byteDigest,objectRef:'private/'+record.byteDigest+'.json',supersedes:null};
 const payload=JSON.parse(new TextDecoder().decode(record.bytes)),decision={status:'verified',reason:'synthetic-mint-event-validated',scope:'synthetic-transcript',coverage:{complete:false,gaps:[]},decoded:inspectCollectionMintFulfillment(source,payload,envelope)},receiptDigest=await crypto.sha256(utf8(canonicalJson(['evidence-receipt-v1',envelope,decision])));return {source,envelope,decision,receiptDigest,bytes:record.bytes,payload};
}
test('mint decoder binds only strict synthetic observation bytes, whole-second event time and incomplete coverage',async()=>{
 const f=await fixture(),r=await verifyCollectionMintFulfillmentEvidence(f,crypto);assert.equal(r.event.kind,'mint');assert.equal(r.event.proof.ticket,999);assert.ok(Object.isFrozen(r.event.proof));
 for(const patch of [{kind:'upgrade'},{operationId:'other'},{paid:true},{finalized:true},{proof:{...f.payload.proof,level:10}},{proof:{...f.payload.proof,ticket:1000}},{proof:{...f.payload.proof,assetId:null}},{proof:{...f.payload.proof,traits:{...f.payload.proof.traits,level:10}}},{atMs:f.payload.atMs+1}])assert.throws(()=>inspectCollectionMintFulfillment(f.source,{...f.payload,...patch},f.envelope));
 for(const patch of [{finality:'confirmed'},{blockTimeMs:f.payload.atMs+1},{requestedCutoffMs:f.payload.atMs},{ingestedAtMs:f.payload.atMs-1}])assert.throws(()=>inspectCollectionMintFulfillment(f.source,f.payload,{...f.envelope,...patch}));
 await assert.rejects(verifyCollectionMintFulfillmentEvidence({...f,decision:{...f.decision,coverage:{complete:true,gaps:[]}}},crypto),/mint-decision/);await assert.rejects(verifyCollectionMintFulfillmentEvidence({...f,receiptDigest:'0'.repeat(64)},crypto),/receipt-digest/);await assert.rejects(verifyCollectionMintFulfillmentEvidence({...f,bytes:new Uint8Array(16385)},crypto),/byte-bound/);
});
test('configured capture cannot smuggle a chosen asset, ticket or traits beside the retained beacon',async()=>{
 const f=await fixture(true),r=await verifyCollectionMintFulfillmentEvidence(f,crypto);assert.equal(r.event.atMs,roundTime(signed.round));assert.equal(r.event.proof.round,signed.round);
 for(const extra of [{assetId:'chosen'},{ticket:999},{traits:{model:'chosen',backdrop:'chosen',symbol:'chosen'}}])assert.throws(()=>inspectCollectionMintFulfillment(f.source,{...f.payload,proof:{...signed,...extra}},f.envelope));
 assert.throws(()=>inspectCollectionMintFulfillment(f.source,{...f.payload,atMs:f.payload.atMs+3000},{...f.envelope,blockTimeMs:f.payload.atMs+3000,retrievedAtMs:f.payload.atMs+3000,ingestedAtMs:f.payload.atMs+3000}),/mint-beacon-time/);
});
test('mint evidence and frozen shared fulfillment command capture before asynchronous hashes',async()=>{
 const f=await fixture();let changed=false;const r=await verifyCollectionMintFulfillmentEvidence(f,{...crypto,async sha256(bytes){if(!changed){changed=true;f.bytes.fill(0);f.source.policy.operationId='changed';f.envelope.subject.id='changed';f.decision.decoded={...f.decision.decoded,proof:{...f.payload.proof,ticket:0}};}return crypto.sha256(bytes);}});assert.equal(r.event.operationId,'synthetic-mint-operation');assert.equal(r.event.proof.ticket,999);
 let command;const service=createMintFulfillmentService({crypto,repository:{async fulfillMint(c){command=c;return {kind:'pending',reason:'synthetic-unimplemented-repository',dependencyIds:[]};}}}),input={requestKey:'synthetic-key',operationId:'synthetic-mint-operation',evidenceReceiptId:'a'.repeat(64),evidenceDigest:'b'.repeat(64)};await service.fulfillMint({kind:'operator',id:'synthetic-operator'},input);assert.equal(command.operationKind,'collection.fulfill-operation.v1');assert.equal(command.businessIdentity,input.operationId);assert.ok(Object.isFrozen(command.input));await assert.rejects(service.fulfillMint({kind:'operator',id:'synthetic-operator'},{...input,ticket:999}),e=>e.status===400);
});
