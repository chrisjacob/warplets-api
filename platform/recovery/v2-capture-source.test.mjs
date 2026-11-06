import test from 'node:test';
import assert from 'node:assert/strict';
import {openDatabase} from '../storage/database.mjs';
import {createNodeAtomicDriver} from '../storage/node/atomic-driver.mjs';
import {createNodeCrypto} from '../security/node-crypto.mjs';
import {memoryArtifacts} from '../application/fixtures/memory-artifacts.mjs';
import {createRecoveryV2Codec} from './v2-codec.mjs';
import {createRecoveryV2CaptureSource} from './v2-capture-source.mjs';
import {readInstalledRecoverySchema} from './node-schema.mjs';
import {measureBatch} from '../storage/atomic-driver.mjs';
import {BUSINESS_TABLES} from './schema.mjs';
import {createCollection} from '../collect/store.mjs';
import {publishDrawPolicy} from '../randomness/selection.mjs';
import {governanceWallets} from '../governance/operator-test-fixture.mjs';
async function setup(t,{fault=null}={}){
 const db=openDatabase();t.after(()=>db.close());const baseCrypto=createNodeCrypto(),schema=await readInstalledRecoverySchema(baseCrypto);
 const metrics=[],store=memoryArtifacts(),base=createNodeAtomicDriver(db);let current=null,injected=false;
 const driver={...base,async batch(statements){if(current){const m=measureBatch(statements);current.sql+=statements.length;current.maxBatch=Math.max(current.maxBatch,m.batchBytes);current.maxParameters=Math.max(current.maxParameters,m.maxParameters);}let selected=statements;
  if(fault==='omit-page'&&!injected&&statements.some(s=>s.sql.startsWith('INSERT INTO app_recovery_capture_pages'))){injected=true;selected=statements.filter(s=>!s.sql.startsWith('INSERT INTO app_recovery_capture_pages'));}
  const result=await base.batch(selected);if(!injected&&(fault==='lost-ack'&&statements.some(s=>s.sql.startsWith('UPDATE app_recovery_captures SET checkpoint_json'))||fault==='lost-start'&&statements.some(s=>s.sql.includes('INSERT INTO app_recovery_captures')))){injected=true;throw Error('Synthetic lost capture acknowledgement.');}return result;
 }},crypto={...baseCrypto,async sha256(bytes){if(['source-in-hash','schema-in-hash'].includes(fault)&&!injected&&new TextDecoder().decode(bytes).includes('"format":"10x.local.recovery.rows.v2"')){injected=true;if(fault==='schema-in-hash')db.exec('DROP TRIGGER recovery_watermark_app_revisions_update; CREATE TRIGGER recovery_watermark_app_revisions_update AFTER UPDATE ON app_revisions BEGIN SELECT 1; END;');else db.exec("UPDATE app_revisions SET revision=revision+1 WHERE name='source'");}return baseCrypto.sha256(bytes);}},artifacts={...store,async getVerified(i){if(current)current.objectReads++;return store.getVerified(i);},async putIfAbsent(i,b){if(current)current.objectWrites++;return store.putIfAbsent(i,b);}},service=createRecoveryV2CaptureSource({driver,artifacts,crypto,clock:{nowMs:()=>1},schema,v2Codec:createRecoveryV2Codec({crypto})});
 const call=async(method,input)=>{current={method,sql:0,objectReads:0,objectWrites:0,maxBatch:0,maxParameters:0};try{return await service[method](input);}finally{metrics.push(current);current=null;}};
 const complete=async(captureId='synthetic-capture')=>{let result=await call('start',{captureId,sourceCommit:'a'.repeat(40)});for(let n=0;n<1000&&result.phase==='reading';n++)result=await call('step',{captureId,expectedRevision:result.revision});return result;};
 return {db,base,service,call,complete,metrics,store,injected:()=>injected};
}
test('source capture continues in bounded transactions, seals exact pages and never pauses source writes',async t=>{
 const f=await setup(t),result=await f.complete();assert.equal(result.phase,'verifying',JSON.stringify(result));const run=await f.service.load(result.captureId),checkpoint=JSON.parse(run.checkpoint_json);assert.equal(checkpoint.tables.length,BUSINESS_TABLES.length);assert.equal(checkpoint.tableCounts[checkpoint.tables.findIndex(t=>t.name==='app_revisions')],3);assert.equal(f.db.prepare('SELECT status FROM app_recovery_state').get().status,'live');
 const row=f.db.prepare("SELECT identity_json FROM app_recovery_capture_pages WHERE scope='rows:app_revisions'").get(),identity=JSON.parse(row.identity_json),page=JSON.parse(new TextDecoder().decode((await f.store.getVerified(identity)).bytes));assert.equal(page.rows.length,3);assert.equal(f.db.prepare('SELECT COUNT(*) n FROM app_recovery_capture_pages').get().n,1);
 f.db.exec("UPDATE app_revisions SET revision=revision+1 WHERE name='source'");assert.equal((await f.call('step',{captureId:result.captureId,expectedRevision:result.revision})).phase,'verifying');assert.equal((await f.service.load(result.captureId)).state,'verifying');
 assert.ok(f.metrics.every(m=>m.sql+m.objectReads+m.objectWrites<=64));t.diagnostic(JSON.stringify({steps:f.metrics.length,maxOperations:Math.max(...f.metrics.map(m=>m.sql+m.objectReads+m.objectWrites)),maxBatchBytes:Math.max(...f.metrics.map(m=>m.maxBatch)),maxParameters:Math.max(...f.metrics.map(m=>m.maxParameters)),dataSealedOnly:true}));
});
test('source mutation during page hashing holds and restart uses a new snapshot; accepted acknowledgements replay',async t=>{
 const f=await setup(t,{fault:'source-in-hash'}),held=await f.complete();assert.equal(held.kind,'held',JSON.stringify(held));assert.equal(held.reason,'capture-source-changed');assert.equal(f.injected(),true);assert.equal((await f.complete('synthetic-restart')).phase,'verifying');
 const lost=await setup(t,{fault:'lost-ack'}),done=await lost.complete();assert.equal(done.phase,'verifying');assert.equal(lost.injected(),true);assert.equal(lost.db.prepare('SELECT COUNT(*) n FROM app_recovery_capture_pages').get().n,1);
 const start=await setup(t,{fault:'lost-start'}),replayed=await start.call('start',{captureId:'synthetic-start',sourceCommit:'a'.repeat(40)});assert.equal(replayed.kind,'replayed');assert.equal(replayed.revision,0);assert.equal((await start.call('start',{captureId:'synthetic-start',sourceCommit:'b'.repeat(40)})).code,'capture-identity-conflict');
});
test('omitted page cannot advance a checkpoint; retry reconciles orphan metadata and concurrent steps have one winner',async t=>{
 const f=await setup(t,{fault:'omit-page'});let result=await f.call('start',{captureId:'synthetic-omitted',sourceCommit:'a'.repeat(40)}),before;
 for(let n=0;n<1000&&result.phase==='reading';n++){before=result;result=await f.call('step',{captureId:before.captureId,expectedRevision:before.revision});}
 assert.equal(result.kind,'conflict');assert.equal((await f.service.load(before.captureId)).revision,before.revision);assert.equal(f.db.prepare('SELECT COUNT(*) n FROM app_recovery_capture_pages').get().n,0);
 result=await f.call('step',{captureId:before.captureId,expectedRevision:before.revision});assert.equal(result.kind,'progress');assert.equal(f.db.prepare('SELECT COUNT(*) n FROM app_recovery_capture_pages').get().n,1);
 const g=await setup(t),start=await g.service.start({captureId:'synthetic-concurrent',sourceCommit:'a'.repeat(40)}),out=await Promise.all([g.service.step({captureId:start.captureId,expectedRevision:start.revision}),g.service.step({captureId:start.captureId,expectedRevision:start.revision})]);assert.ok(out.every(r=>r.revision===1));assert.equal((await g.service.load(start.captureId)).revision,1);
});
test('same-name tampered trigger cannot authorize capture startup',async t=>{
 const f=await setup(t);f.db.exec('DROP TRIGGER recovery_watermark_app_revisions_update; CREATE TRIGGER recovery_watermark_app_revisions_update AFTER UPDATE ON app_revisions BEGIN SELECT 1; END;');const result=await f.call('start',{captureId:'synthetic-tampered',sourceCommit:'a'.repeat(40)});assert.equal(result.kind,'conflict');assert.match(result.code,/trigger SQL mismatch/);assert.equal(f.store.objects.size,0);
});
test('installed migration inventory must exactly match trusted migration names',async t=>{
 const f=await setup(t);f.db.prepare('DELETE FROM schema_versions WHERE version=?').run('044-recovery-continuations.sql');
 f.db.prepare('INSERT INTO schema_versions VALUES(?)').run('999-synthetic-extra.sql');
 const result=await f.call('start',{captureId:'synthetic-migration-mismatch',sourceCommit:'a'.repeat(40)});assert.equal(result.kind,'conflict');assert.match(result.code,/installed migration inventory mismatch/);assert.equal(f.store.objects.size,0);
});
test('same-name schema substitution during asynchronous page hashing cannot pass the final SQL fence',async t=>{
 const f=await setup(t,{fault:'schema-in-hash'}),result=await f.complete();assert.equal(result.kind,'held');assert.equal(result.reason,'capture-source-changed');assert.equal(f.db.prepare('SELECT COUNT(*) n FROM app_recovery_capture_pages').get().n,0);assert.equal(f.db.prepare('SELECT revision FROM app_recovery_watermark').get().revision,0,'Exact SQL catches DDL without a business watermark change.');
});
test('a legal oversized trait policy seals sixteen fragments without a concurrent source mutation',async t=>{
 const f=await setup(t),now=Date.now(),traits=Object.fromEntries(['model','backdrop','symbol'].map(k=>[k,Array.from({length:256},(_,n)=>({name:'\u9fff'.repeat(124)+String(n).padStart(4,'0'),weight:1000000}))]));
 createCollection(f.db,{id:'synthetic-large-trait-policy',kind:'genesis',tranche:1});publishDrawPolicy(f.db,{inventoryId:'synthetic-large-trait-policy',assets:governanceWallets(1000),traitChoices:traits,at:now},now);const watermark=f.db.prepare('SELECT revision FROM app_recovery_watermark').get().revision,result=await f.complete('synthetic-large-traits');assert.equal(result.phase,'verifying',JSON.stringify(result));assert.equal(f.db.prepare("SELECT COUNT(*) n FROM app_recovery_capture_pages WHERE scope LIKE 'fragments:fair_inventories:%'").get().n,16);assert.equal(f.db.prepare('SELECT revision FROM app_recovery_watermark').get().revision,watermark);assert.equal(f.db.prepare('SELECT length(CAST(traits AS BLOB)) bytes FROM fair_inventories').get().bytes,311075);
});
test('an unrelated oversized legacy aggregate still reports a row bound and never truncates',async t=>{
 const f=await setup(t);createCollection(f.db,{id:'synthetic-oversized-legacy',kind:'genesis',tranche:1});f.db.prepare('UPDATE collect_inventories SET state=?').run(JSON.stringify({syntheticOversizedLegacy:'x'.repeat(200000)}));const watermark=f.db.prepare('SELECT revision FROM app_recovery_watermark').get().revision,result=await f.complete('synthetic-legacy-bound');assert.equal(result.kind,'held');assert.equal(result.reason,'capture-row-bound-or-invalid');assert.equal(f.db.prepare('SELECT revision FROM app_recovery_watermark').get().revision,watermark);
});
