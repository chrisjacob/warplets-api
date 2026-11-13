import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {canonicalJson} from '../security/canonical.mjs';
import {openDatabase} from '../storage/database.mjs';
import {createNodeAtomicDriver} from '../storage/node/atomic-driver.mjs';
import {sql,measureBatch} from '../storage/atomic-driver.mjs';
import {createNodeCrypto} from '../security/node-crypto.mjs';
import {readInstalledRecoverySchema} from './node-schema.mjs';
import {readRecoveryV2SourceMetadata} from './v2-schema.mjs';
import {createRecoveryV2RestoreDatabase} from './v2-restore-db.mjs';
import {parseRecoveryV2Checkpoint} from './v2-checkpoint.mjs';
// Storage-only contracts. A complete graph importer/reconciler is required
// before this repository can ever be composed into a ready restore operation.
async function setup(t,{fault=null,descriptorTransform=value=>value}={}){
 const db=openDatabase();t.after(()=>db.close());const base=createNodeAtomicDriver(db),crypto=createNodeCrypto(),schema=await readInstalledRecoverySchema(crypto),descriptor=await readRecoveryV2SourceMetadata(base,{schema,crypto}),metrics=[];let injected=false;
 const driver={...base,async batch(input){metrics.push(measureBatch(input));let selected=input;
  if(!injected&&fault==='omit-clear'&&input.some(s=>s.sql.startsWith('UPDATE app_recovery_state SET write_nonce=NULL'))){injected=true;selected=input.filter(s=>!s.sql.startsWith('UPDATE app_recovery_state SET write_nonce=NULL'));}
  if(!injected&&fault==='omit-check'&&input.some(s=>s.sql.startsWith('INSERT INTO app_recovery_reconcile_checks'))){injected=true;selected=input.filter(s=>!s.sql.startsWith('INSERT INTO app_recovery_reconcile_checks'));}
  const result=await base.batch(selected);if(!injected&&fault==='lost-ack'&&input.some(s=>s.sql.startsWith('UPDATE app_recovery_runs SET checkpoint_json='))){injected=true;throw Error('Synthetic lost restore acknowledgement.');}return result;
 }},repository=createRecoveryV2RestoreDatabase({driver,clock:{nowMs:()=>1},ids:{next:randomUUID}}),root={sourceCommit:'a'.repeat(40),schema,syntheticStorageOnly:true},pin='b'.repeat(64),started=await repository.start({root,pinnedDigest:pin,descriptor:descriptorTransform(descriptor)});assert.equal(started.kind,'started',JSON.stringify(started));return {db,repository,pin,root,metrics,injected:()=>injected};
}
const record={key:'synthetic-unit',digest:'c'.repeat(64),resultDigest:'d'.repeat(64),rowCount:1,tableName:'app_operator_scopes'};
test('restore database revokes ordinary mutation authority and patches only bounded progress fields under a cleared nonce',async t=>{
 const f=await setup(t),loaded=await f.repository.load(f.pin);assert.throws(()=>f.db.exec("INSERT INTO app_operator_scopes VALUES('outside','scope',0,1)"),/mutation-disabled/);
 const accepted=await f.repository.advance(loaded,{delta:{phase:'objects',objectCursor:'private/next'},records:[record],effects:[sql('INSERT INTO app_operator_scopes VALUES(?,?,0,1)','restored','scope')]});assert.equal(accepted.kind,'progress');assert.equal(accepted.revision,1);assert.equal(f.db.prepare('SELECT write_nonce FROM app_recovery_state').get().write_nonce,null);
 const saved=await f.repository.load(f.pin);assert.deepEqual(JSON.parse(saved.run.checkpoint_json).root,f.root);assert.equal(JSON.parse(saved.run.checkpoint_json).phase,'objects');assert.ok(f.metrics.every(m=>m.batchBytes<=262144&&m.statements<=64));await assert.rejects(f.repository.advance(saved,{delta:{root:{bad:true}}}),/restore patch/);
});

test('restore stores one exact schema inventory while preserving old checkpoint and migration fences',async t=>{
 await assert.rejects(setup(t,{descriptorTransform:d=>({...d,schema:{...d.schema,fingerprint:'0'.repeat(64)}})}),/schema identity mismatch/);
 const f=await setup(t);let loaded=await f.repository.load(f.pin),checkpoint=JSON.parse(loaded.run.checkpoint_json);
 assert.equal(Object.hasOwn(checkpoint.descriptor,'schema'),false);assert.deepEqual(checkpoint.root.schema,f.root.schema);
 const compactBytes=Buffer.byteLength(loaded.run.checkpoint_json);checkpoint.descriptor.schema=checkpoint.root.schema;assert.ok(Buffer.byteLength(JSON.stringify(checkpoint))-compactBytes>5000);
 f.db.prepare('UPDATE app_recovery_runs SET checkpoint_json=? WHERE id=?').run(canonicalJson(checkpoint),f.pin);
 assert.equal((await f.repository.advance(await f.repository.load(f.pin),{delta:{phase:'objects'}})).kind,'progress');
 checkpoint=JSON.parse((await f.repository.load(f.pin)).run.checkpoint_json);checkpoint.descriptor.schema.fingerprint='0'.repeat(64);f.db.prepare('UPDATE app_recovery_runs SET checkpoint_json=? WHERE id=?').run(canonicalJson(checkpoint),f.pin);
 assert.equal((await f.repository.advance(await f.repository.load(f.pin),{delta:{phase:'publications'},effects:[sql("INSERT INTO app_operator_scopes VALUES('bad-duplicate','scope',0,1)")]})).kind,'conflict');assert.equal(f.db.prepare('SELECT COUNT(*) n FROM app_operator_scopes').get().n,0);
 const other=await setup(t);other.db.prepare('DELETE FROM schema_versions WHERE version=?').run(other.root.schema.migrations.at(-1).file);
 assert.equal((await other.repository.advance(await other.repository.load(other.pin),{delta:{phase:'objects'},effects:[sql("INSERT INTO app_operator_scopes VALUES('bad-migration','scope',0,1)")]})).kind,'conflict');assert.equal(other.db.prepare('SELECT COUNT(*) n FROM app_operator_scopes').get().n,0);
});
test('lost restore acknowledgement replays accepted progress and omitted nonce clear rolls all data back',async t=>{
 const lost=await setup(t,{fault:'lost-ack'});assert.equal((await lost.repository.advance(await lost.repository.load(lost.pin),{delta:{phase:'objects'},records:[record]})).kind,'replayed');assert.equal(lost.injected(),true);
 const omitted=await setup(t,{fault:'omit-clear'}),result=await omitted.repository.advance(await omitted.repository.load(omitted.pin),{delta:{phase:'objects'},records:[record],effects:[sql('INSERT INTO app_operator_scopes VALUES(?,?,0,1)','restored','scope')]});assert.equal(result.kind,'conflict');assert.equal(omitted.db.prepare('SELECT COUNT(*) n FROM app_operator_scopes').get().n,0);assert.equal(omitted.db.prepare('SELECT write_nonce FROM app_recovery_state').get().write_nonce,null);
});
test('every durable reconciliation check requires its pinned target watermark and exact child before cursor progress',async t=>{
 const f=await setup(t,{fault:'omit-check'}),watermark=f.db.prepare('SELECT revision FROM app_recovery_watermark').get().revision;await f.repository.advance(await f.repository.load(f.pin),{delta:{phase:'reconcile-tables',targetWatermark:watermark}});
 const check={phase:'tables',scope:'synthetic',ordinal:0,targetWatermark:watermark,resultDigest:'e'.repeat(64),itemCount:0},before=await f.repository.load(f.pin),request={delta:{checkedTables:1},targetWatermark:watermark,check};assert.equal((await f.repository.advance(before,request)).kind,'conflict');assert.equal(JSON.parse((await f.repository.load(f.pin)).run.checkpoint_json).revision,1);
 assert.equal((await f.repository.advance(await f.repository.load(f.pin),request)).kind,'progress');assert.equal(f.db.prepare('SELECT COUNT(*) n FROM app_recovery_reconcile_checks').get().n,1);
 f.db.exec("BEGIN;UPDATE app_recovery_state SET write_nonce='synthetic-outside-change';INSERT INTO app_operator_scopes VALUES('changed','scope',0,1);UPDATE app_recovery_state SET write_nonce=NULL;COMMIT;");const changed=await f.repository.advance(await f.repository.load(f.pin),{delta:{checkedTables:2},targetWatermark:watermark,check:{...check,ordinal:1}});assert.equal(changed.kind,'held');assert.equal(changed.reason,'recovery-target-changed');assert.equal(f.db.prepare('SELECT COUNT(*) n FROM app_recovery_reconcile_checks').get().n,1);
});

test('private checkpoint packing resumes legacy objects, retains exact raw CAS input and clears on retirement',async t=>{
 const f=await setup(t),table={name:'app_revisions',columns:['name','revision'],primaryKey:['name'],hasRowid:true,rowCount:0,pages:{identity:null,count:0},tableDigest:'f'.repeat(64)};
 let loaded=await f.repository.load(f.pin),old=JSON.parse(loaded.run.checkpoint_json);delete old.tablesPackedV1;old.tables=[table];f.db.prepare('UPDATE app_recovery_runs SET checkpoint_json=? WHERE id=?').run(canonicalJson(old),f.pin);
 loaded=await f.repository.load(f.pin);const raw=loaded.run.checkpoint_json;assert.equal((await f.repository.advance(loaded,{delta:{tables:[table]}})).kind,'progress');assert.equal(loaded.run.checkpoint_json,raw);
 const packed=JSON.parse((await f.repository.load(f.pin)).run.checkpoint_json);assert.equal(packed.tables,null);assert.equal(packed.tablesPackedV1.length,1);assert.equal((await f.repository.advance(loaded,{delta:{phase:'wrong-stale'}})).kind,'replayed');assert.notEqual(JSON.parse((await f.repository.load(f.pin)).run.checkpoint_json).phase,'wrong-stale');
 await assert.rejects(f.repository.advance(await f.repository.load(f.pin),{delta:{tablesPackedV1:[]}}),/direct packed/);
 assert.equal((await f.repository.advance(await f.repository.load(f.pin),{delta:{tables:null}})).kind,'progress');const retired=JSON.parse((await f.repository.load(f.pin)).run.checkpoint_json);assert.equal(retired.tables,null);assert.equal(retired.tablesPackedV1,null);
});

test('within-limit legacy schema checkpoints compact during guarded advance without relaxing size, schema or rollback fences',async t=>{
 const size=value=>Buffer.byteLength(canonicalJson(value)),save=(f,c)=>f.db.prepare('UPDATE app_recovery_runs SET checkpoint_json=? WHERE id=?').run(canonicalJson(c),f.pin);
 const f=await setup(t),legacy=parseRecoveryV2Checkpoint((await f.repository.load(f.pin)).run.checkpoint_json);
 legacy.legacyPadding='';legacy.legacyPadding='x'.repeat(131000-size(legacy));assert.equal(size(legacy),131000);save(f,legacy);
 const loaded=await f.repository.load(f.pin),delta={phase:'objects',objectCursor:'y'.repeat(300)};assert.ok(size({...legacy,...delta,revision:1})>131072,'The old expanded representation cannot fit the next valid step.');
 assert.equal((await f.repository.advance(loaded,{delta})).kind,'progress');const accepted=await f.repository.load(f.pin),packed=JSON.parse(accepted.run.checkpoint_json);
 assert.ok(Buffer.byteLength(accepted.run.checkpoint_json)<=131072);assert.ok(packed.descriptor.schemaInventoryPackedV1);assert.equal(packed.descriptor.schemaInventory,undefined);assert.deepEqual(parseRecoveryV2Checkpoint(accepted.run.checkpoint_json),{...legacy,...delta,revision:1});assert.ok(f.metrics.every(m=>m.batchBytes<=262144&&m.statements<=64));
 assert.equal((await f.repository.advance(loaded,{delta:{phase:'stale'}})).kind,'replayed');assert.equal((await f.repository.load(f.pin)).run.checkpoint_json,accepted.run.checkpoint_json);
 await assert.rejects(f.repository.advance(accepted,{delta:{extraPadding:'z'.repeat(131072)}}),/checkpoint bound/);assert.equal((await f.repository.load(f.pin)).run.checkpoint_json,accepted.run.checkpoint_json);

 const invalid=await setup(t),changed=parseRecoveryV2Checkpoint((await invalid.repository.load(invalid.pin)).run.checkpoint_json);changed.descriptor.schemaInventory[0].sql+=' ';save(invalid,changed);const before=await invalid.repository.load(invalid.pin);
 assert.equal((await invalid.repository.advance(before,{delta:{phase:'objects'},effects:[sql("INSERT INTO app_operator_scopes VALUES('forged','scope',0,1)")]})).kind,'conflict');assert.equal((await invalid.repository.load(invalid.pin)).run.checkpoint_json,before.run.checkpoint_json);assert.equal(invalid.db.prepare('SELECT COUNT(*) n FROM app_operator_scopes').get().n,0);
 const omitted=await setup(t,{fault:'omit-clear'}),old=parseRecoveryV2Checkpoint((await omitted.repository.load(omitted.pin)).run.checkpoint_json);save(omitted,old);const raw=(await omitted.repository.load(omitted.pin)).run.checkpoint_json;
 assert.equal((await omitted.repository.advance(await omitted.repository.load(omitted.pin),{delta:{phase:'objects'},records:[record]})).kind,'conflict');assert.equal((await omitted.repository.load(omitted.pin)).run.checkpoint_json,raw);assert.equal(omitted.db.prepare('SELECT COUNT(*) n FROM app_recovery_pages').get().n,0);assert.equal(omitted.db.prepare('SELECT write_nonce FROM app_recovery_state').get().write_nonce,null);
});
