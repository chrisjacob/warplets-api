import test from 'node:test';
import assert from 'node:assert/strict';
import {localRuntime} from './local-runtime.mjs';
import {governanceOperatorFixture,governanceWallets} from '../../governance/operator-test-fixture.mjs';
import {createCollection} from '../../collect/store.mjs';
import {createStagePublicationRepository} from '../../collect/stage-repository.mjs';
import {createStagePublicationService} from '../../collect/stage-service.mjs';
test('actual D1 normalized publication preserves10000-member list terms and atomic receipt effects',async t=>{
 const f=await governanceOperatorFixture(t,{holders:governanceWallets(10000),nextWhitelist:[]}),{mf,db}=await localRuntime(t,new URL('./fixtures/collection-stage-worker.ts',import.meta.url));
 const principal={kind:'operator',id:'synthetic-stage-publisher'},inventoryId='synthetic-d1-stage';f.db.prepare('INSERT INTO app_operator_scopes VALUES(?,?,0,1)').run(principal.id,'collection-publication');createCollection(f.db,{id:inventoryId,kind:'genesis',tranche:1});
 for(const table of ['app_operator_scopes','app_command_receipts','app_collection_records','app_collection_list_seals','app_collection_eligibility_pages','collect_inventories']){const rows=f.db.prepare('SELECT * FROM '+table).all();for(let offset=0;offset<rows.length;offset+=20)await db.batch(rows.slice(offset,offset+20).map(row=>{const keys=Object.keys(row);return db.prepare('INSERT INTO '+table+'('+keys.join(',')+') VALUES('+keys.map(()=>'?').join(',')+')').bind(...Object.values(row));}));}
 for(const row of f.db.prepare('SELECT * FROM app_revisions').all())await db.prepare('UPDATE app_revisions SET revision=? WHERE name=?').bind(row.revision,row.name).run();
 const input={inventoryId,stageId:'synthetic-first',type:'whitelist',publishedAt:f.getNow(),opensAt:f.getNow()+172800000,closesAt:f.getNow()+259200000,priceLamports:'100000000',costLamports:'500000',allocation:1000,walletLimit:null,founderApproved:false,approvedSpendLamports:null,ballotId:null,inventoryOverrideReason:null,eligibilityListId:f.groups[0].manifest.id,sourceKind:'synthetic-local-operator-fixture'};
 const call=async(fault,body=input,key='synthetic-publication')=>{const response=await mf.dispatchFetch('http://localhost/__fixture/stage',{method:'POST',body:JSON.stringify({input:body,requestKey:key,nowMs:f.getNow(),fault})});assert.equal(response.status,200);return response.json();};
 const before=await db.prepare('SELECT COUNT(*) n FROM app_command_receipts').first('n');
 for(const fault of ['omit-authority','omit-revision','omit-stage']){const failed=await call(fault);assert.equal(failed.status,500,JSON.stringify(failed));assert.equal(await db.prepare('SELECT COUNT(*) n FROM app_collection_stages').first('n'),0);assert.equal(await db.prepare('SELECT COUNT(*) n FROM app_command_receipts').first('n'),before);}
 assert.equal((await call('revoke')).result.code,'revision_conflict');await db.prepare("UPDATE app_operator_scopes SET enabled=1 WHERE operator=? AND scope='collection-publication'").bind(principal.id).run();
 const service=createStagePublicationService({...f.ports,repository:createStagePublicationRepository(f.base,f.ports)}),expected=await service.publishStage(principal,{input,requestKey:'synthetic-publication'}),actual=await call('lost-response');
 assert.equal(expected.kind,'committed');assert.equal(actual.result.kind,'replayed',JSON.stringify(actual));assert.deepEqual(actual.result.value,expected.value);assert.equal(actual.result.receipt.outputDigest,expected.receipt.outputDigest);
 assert.equal(await db.prepare('SELECT terms_json FROM app_collection_stages').first('terms_json'),f.db.prepare('SELECT terms_json FROM app_collection_stages').get().terms_json);assert.equal(actual.result.value.eligibility.count,10000);
 await db.prepare("UPDATE app_operator_scopes SET enabled=0 WHERE operator=?").bind(principal.id).run();assert.equal((await call()).result.kind,'replayed');assert.equal((await call(undefined,{...input,costLamports:'500001'})).result.code,'idempotency_conflict');
 await assert.rejects(db.prepare('UPDATE collect_inventories SET state=state WHERE id=?').bind(inventoryId).run(),/Normalized collection authority/);await assert.rejects(db.prepare('DELETE FROM app_collection_stages').run(),/Retain published/);
 assert.equal((await mf.dispatchFetch('http://localhost/api/v1/collect/inventories/'+inventoryId+'/stages/publish',{method:'POST'})).status,404);
 assert.equal(await db.prepare('SELECT COUNT(*) n FROM collect_operations').first('n'),0);assert.ok(actual.metrics.maxParameters<=100&&actual.metrics.maxBatchBytes<=32768);t.diagnostic(JSON.stringify({wallets:10000,...actual.metrics,legacyTermsParity:true,publicPublicationRoute:false,financialExecution:false,installedMigration:43}));
});
