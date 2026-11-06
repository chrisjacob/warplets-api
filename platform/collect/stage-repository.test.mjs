import test from 'node:test';
import assert from 'node:assert/strict';
import {openDatabase} from '../storage/database.mjs';
import {createCollection,publishCollectionStage} from './store.mjs';
import {governanceOperatorFixture,governanceWallets} from '../governance/operator-test-fixture.mjs';
import {createStagePublicationRepository} from './stage-repository.mjs';
import {createStagePublicationService} from './stage-service.mjs';
import {measureBatch} from '../storage/atomic-driver.mjs';
const principal={kind:'operator',id:'synthetic-stage-publisher'};
async function setup(t,{kind='genesis',fault=null,large=false}={}){
 const f=await governanceOperatorFixture(t,large?{holders:governanceWallets(10000),nextWhitelist:[]}:{});
 f.db.prepare('INSERT INTO app_operator_scopes VALUES(?,?,0,1)').run(principal.id,'collection-publication');
 const inventoryId='synthetic-stage-'+kind;createCollection(f.db,{id:inventoryId,kind,...(kind==='genesis'?{tranche:1}:{seasonStart:f.getNow()})});
 const input={inventoryId,stageId:'synthetic-first',type:'whitelist',publishedAt:f.getNow(),opensAt:f.getNow()+172800000,closesAt:f.getNow()+259200000,priceLamports:'100000000',costLamports:'500000',allocation:1000,walletLimit:kind==='genesis'?null:2,founderApproved:false,approvedSpendLamports:null,ballotId:null,inventoryOverrideReason:null,eligibilityListId:f.groups[0].manifest.id,sourceKind:'synthetic-local-operator-fixture'};
 const metrics=[];let fired=false;
 const driver={...f.base,async batch(statements){
  if(!fired&&statements.some(s=>s.sql.startsWith('INSERT INTO app_collection_stages'))){fired=true;
   if(fault?.startsWith('omit-')){const needle={'omit-authority':'INSERT INTO app_collection_authorities','omit-revision':'UPDATE app_collection_authorities','omit-stage':'INSERT INTO app_collection_stages'}[fault];statements=statements.filter(s=>!s.sql.startsWith(needle));}
   if(fault==='revoke')f.db.prepare("UPDATE app_operator_scopes SET enabled=0 WHERE operator=? AND scope='collection-publication'").run(principal.id);
  }
  metrics.push(measureBatch(statements));const result=await f.base.batch(statements);if(fault==='lost-response'&&statements.some(s=>s.sql.startsWith('INSERT INTO app_collection_stages')))throw Error('Synthetic acknowledgement loss.');return result;
 }};
 const service=createStagePublicationService({...f.ports,repository:createStagePublicationRepository(driver,f.ports)});
 return {...f,input,metrics,publish:(changes={},key='synthetic-publication')=>service.publishStage(principal,{input:{...input,...changes},requestKey:key})};
}
test('normalized private publication stores compact exact legacy terms and preserves accepted replay after scope revocation',async t=>{
 const f=await setup(t),reference=openDatabase();t.after(()=>reference.close());createCollection(reference,{id:f.input.inventoryId,kind:'genesis',tranche:1});
 const {inventoryId,stageId,eligibilityListId,sourceKind,...terms}=f.input;publishCollectionStage(reference,{inventoryId,stage:{...terms,id:stageId,wallets:f.holders}},f.getNow());
 const expected=JSON.parse(reference.prepare('SELECT state FROM collect_inventories').get().state).stages[0],{wallets:ignored,...expectedTerms}=expected;
 const result=await f.publish();assert.equal(result.kind,'committed',JSON.stringify(result));const stage=f.db.prepare('SELECT * FROM app_collection_stages').get();assert.deepEqual(JSON.parse(stage.terms_json),expectedTerms);assert.equal(result.value.termsDigest,expected.termsDigest);assert.equal(result.value.eligibility.count,f.holders.length);
 assert.equal(f.db.prepare('SELECT revision FROM app_collection_authorities').get().revision,1);assert.throws(()=>publishCollectionStage(f.db,{inventoryId,stage:{...terms,id:'legacy-bypass',wallets:f.holders}},f.getNow()),/Normalized collection authority/);
 f.db.prepare("UPDATE app_operator_scopes SET enabled=0 WHERE operator=?").run(principal.id);const replay=await f.publish();assert.equal(replay.kind,'replayed');assert.deepEqual(replay.value,result.value);assert.deepEqual(replay.receipt,result.receipt);
 assert.equal((await f.publish({costLamports:'500001'})).code,'idempotency_conflict');assert.throws(()=>f.db.prepare('UPDATE app_collection_stages SET opens_ms=opens_ms').run(),/immutable/);
});
test('every omitted authority, revision or publication child aborts the command receipt and all effects',async t=>{
 for(const fault of ['omit-authority','omit-revision','omit-stage']){const f=await setup(t,{fault}),before=f.db.prepare('SELECT COUNT(*) n FROM app_command_receipts').get().n;await assert.rejects(f.publish());
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM app_collection_authorities').get().n,0);assert.equal(f.db.prepare('SELECT COUNT(*) n FROM app_collection_stages').get().n,0);assert.equal(f.db.prepare('SELECT COUNT(*) n FROM app_command_receipts').get().n,before);
 }
});
test('current scoped authority is rechecked and unknown commit acknowledgements recover the original publication',async t=>{
 const revoked=await setup(t,{fault:'revoke'});assert.equal((await revoked.publish()).code,'revision_conflict');assert.equal(revoked.db.prepare('SELECT COUNT(*) n FROM app_collection_stages').get().n,0);
 const unknown=await setup(t,{fault:'lost-response'}),accepted=await unknown.publish();assert.equal(accepted.kind,'replayed');assert.equal(unknown.db.prepare('SELECT COUNT(*) n FROM app_collection_stages').get().n,1);
 const raced=await setup(t),results=await Promise.all([raced.publish(),raced.publish()]);assert.deepEqual(results.map(r=>r.kind).sort(),['committed','replayed']);assert.deepEqual(results[0].value,results[1].value);
});
test('full10000-wallet verified list stays a compact stage binding and SQL batch',async t=>{
 const f=await setup(t,{large:true}),result=await f.publish();assert.equal(result.kind,'committed');assert.equal(result.value.eligibility.count,10000);const stage=f.db.prepare('SELECT terms_json FROM app_collection_stages').get();assert.ok(Buffer.byteLength(stage.terms_json)<2048);
 assert.ok(f.metrics.every(m=>m.maxParameters<=100&&m.batchBytes<=32768));assert.doesNotMatch(JSON.stringify(result),new RegExp(f.holders[0]));t.diagnostic(JSON.stringify({wallets:10000,maxBatchBytes:Math.max(...f.metrics.map(m=>m.batchBytes)),maxParameters:Math.max(...f.metrics.map(m=>m.maxParameters)),source:'synthetic-local-operator-fixture'}));
});
test('free publication waits for paid phase schedule and founder/public records require the separate founder scope',async t=>{
 const f=await setup(t,{kind:'season'}),base=f.getNow(),free={stageId:'synthetic-free',type:'free',priceLamports:'0',eligibilityListId:null,walletLimit:null,opensAt:base+5*86400000,closesAt:base+6*86400000};
 assert.equal((await f.publish(free,'free')).reason,'paid_stages_incomplete');assert.equal((await f.publish()).kind,'committed');assert.equal((await f.publish({stageId:'synthetic-expanded',opensAt:base+3*86400000,closesAt:base+4*86400000},'expanded')).kind,'committed');
 const accepted=await f.publish(free,'free');assert.equal(accepted.kind,'committed');assert.deepEqual(accepted.value.eligibility,{kind:'pending',listId:null,count:null});
 const publicStage={stageId:'synthetic-public',type:'public',eligibilityListId:null,founderApproved:true,opensAt:base+6*86400000,closesAt:base+7*86400000};assert.equal((await f.publish(publicStage,'public')).code,'operator_scope_required');
 f.db.prepare('INSERT INTO app_operator_scopes VALUES(?,?,0,1)').run(principal.id,'collection-founder');assert.equal((await f.publish(publicStage,'public')).kind,'committed');
});
test('populated legacy inventory is explicitly held instead of silently creating a second admission authority',async t=>{
 const f=await setup(t),{inventoryId,stageId,eligibilityListId,sourceKind,...terms}=f.input;publishCollectionStage(f.db,{inventoryId,stage:{...terms,id:stageId,wallets:f.holders}},f.getNow());
 assert.equal((await f.publish()).reason,'stage-populated-reference-adoption-required');assert.equal(f.db.prepare('SELECT COUNT(*) n FROM app_collection_authorities').get().n,0);
});
