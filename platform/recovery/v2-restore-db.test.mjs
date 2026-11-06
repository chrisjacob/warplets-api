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
