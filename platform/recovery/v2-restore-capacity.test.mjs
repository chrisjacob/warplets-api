import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {governanceCapacityFixture,castCapacityVotes,maximumSourceBundle} from './capacity-fixtures.mjs';
import {openDatabase} from '../storage/database.mjs';
import {createNodeAtomicDriver} from '../storage/node/atomic-driver.mjs';
import {createCollectionSourceIntake} from '../collect/source-intake.mjs';
import {createCollectionSourceRepository} from '../collect/source-repository.mjs';
import {createEligibilityIndexService} from '../collect/eligibility-index-service.mjs';
import {createEligibilityIndexRepository} from '../collect/eligibility-index-repository.mjs';
import {createRecoveryV2Capture} from './v2-capture.mjs';
import {createRecoveryV2Codec} from './v2-codec.mjs';
import {createManifestCodec} from '../artifacts/manifest-codec.mjs';
import {readInstalledRecoverySchema} from './node-schema.mjs';
import {memoryArtifacts} from './fixtures.mjs';
import {v2RestoreTarget} from './v2-restore-fixtures.mjs';
async function roundtrip(t,{db,base,ports,label,expected}){
 const store=memoryArtifacts(),schema=await readInstalledRecoverySchema(ports.crypto),v2Codec=createRecoveryV2Codec(ports),codec=createManifestCodec(ports),capture=createRecoveryV2Capture({...ports,driver:base,artifacts:store,schema,v2Codec,codec});let captured=await capture.start({captureId:label,sourceCommit:'a'.repeat(40)});
 for(let n=0;n<10000&&['started','progress','replayed'].includes(captured.kind);n++)captured=await capture.step({captureId:label,expectedRevision:captured.revision});assert.equal(captured.kind,'captured',JSON.stringify(captured));
 const target=v2RestoreTarget(t,{...ports,schema,v2Codec,codec,store,captured,now:ports.clock.nowMs()}),restored=await target.drive();assert.equal(restored.kind,'restored',JSON.stringify(restored));
 for(const [table,count] of expected){assert.equal(target.db.prepare('SELECT COUNT(*) n FROM '+table).get().n,count,table);assert.equal(db.prepare('SELECT COUNT(*) n FROM '+table).get().n,count);}
 assert.equal(target.store.objects.size,captured.value.totals.objects);assert.equal(target.db.prepare('SELECT status FROM app_recovery_state').get().status,'ready');const metrics=target.metrics,maxOperations=Math.max(...metrics.map(m=>m.sql+m.objectReads+m.objectWrites)),maxBytes=Math.max(...metrics.map(m=>m.returnedBytes+m.objectBytes+m.maxBatchBytes));assert.ok(maxOperations<=64);assert.ok(maxBytes<=1048576,String(maxBytes));assert.ok(metrics.every(m=>m.maxBatchBytes<=262144));
 t.diagnostic(JSON.stringify({label,tables:restored.report.tables,rows:captured.value.totals.rows,objects:target.store.objects.size,retainedBytes:captured.value.totals.bytes,restoreSteps:metrics.length,maxOperations,maxSerializedWorkingBytes:maxBytes,maxBatchBytes:Math.max(...metrics.map(m=>m.maxBatchBytes)),checkpointBytes:Buffer.byteLength(JSON.stringify(target.checkpoint())),exactCountAndRowReconciliation:true,financialExecution:false}));return target;
}
test('v2 restores the complete10000-voter/full-turnout private graph into a fresh target',async t=>{
 const f=await governanceCapacityFixture(t);await castCapacityVotes(f);await roundtrip(t,{...f,label:'synthetic-restored-full-turnout',expected:[['genesis_voters',10000],['genesis_votes',10000],['app_command_receipts',10327]]});
});
test('v2 restores all3245 records and3200 indexes of32 distinct10000-member lists plus1000 declared admissions',async t=>{
 const {crypto,codec,bundle,records}=await maximumSourceBundle(),db=openDatabase();t.after(()=>db.close());const base=createNodeAtomicDriver(db),ports={crypto,ids:{next:randomUUID},clock:{nowMs:()=>1}},principal={kind:'operator',id:'synthetic-max-restored-source'};
 db.prepare('INSERT INTO app_operator_scopes VALUES(?,?,0,1)').run(principal.id,'collection-import');const intake=createCollectionSourceIntake({...ports,repository:createCollectionSourceRepository(base,ports)}),indexer=createEligibilityIndexService({...ports,repository:createEligibilityIndexRepository(base,ports)});
 for(const record of records.values())assert.equal((await intake.stageRecord(principal,{record,requestKey:record.id})).kind,'committed');for(const list of bundle.listManifests)assert.equal((await intake.sealList(principal,{id:list.id,requestKey:list.id})).kind,'committed');
 for(const page of bundle.pages)if((await codec.verifyRecord(page)).kind==='eligibility')assert.equal((await indexer.materializePage(principal,{id:page.id,requestKey:page.id})).kind,'committed');const sealed=await intake.sealSource(principal,{id:bundle.root.id,requestKey:bundle.root.id});assert.equal(sealed.kind,'committed');assert.equal(sealed.value.admissionCount,1000);
 const target=await roundtrip(t,{db,base,ports,label:'synthetic-restored-max-source',expected:[['app_collection_records',3245],['app_collection_eligibility_pages',3200],['app_collection_list_seals',32],['app_collection_source_seals',1],['app_command_receipts',6478]]});
 assert.equal(target.db.prepare('SELECT body_base64 FROM app_collection_records WHERE id=?').get(bundle.root.id).body_base64,Buffer.from(bundle.root.bytes).toString('base64'));assert.equal(target.db.prepare('SELECT COUNT(*) n FROM collect_inventories').get().n,0,'Restoring sealed source closure does not activate economic inventory.');
});
