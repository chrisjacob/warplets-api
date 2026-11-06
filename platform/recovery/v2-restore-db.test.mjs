import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {openDatabase} from '../storage/database.mjs';
import {createNodeAtomicDriver} from '../storage/node/atomic-driver.mjs';
import {sql,measureBatch} from '../storage/atomic-driver.mjs';
import {createNodeCrypto} from '../security/node-crypto.mjs';
import {readInstalledRecoverySchema} from './node-schema.mjs';
import {readRecoveryV2SourceMetadata} from './v2-schema.mjs';
import {createRecoveryV2RestoreDatabase} from './v2-restore-db.mjs';
// Storage-only contracts. A complete graph importer/reconciler is required
// before this repository can ever be composed into a ready restore operation.
async function setup(t,{fault=null}={}){
 const db=openDatabase();t.after(()=>db.close());const base=createNodeAtomicDriver(db),crypto=createNodeCrypto(),schema=await readInstalledRecoverySchema(crypto),descriptor=await readRecoveryV2SourceMetadata(base,{schema,crypto}),metrics=[];let injected=false;
 const driver={...base,async batch(input){metrics.push(measureBatch(input));let selected=input;
  if(!injected&&fault==='omit-clear'&&input.some(s=>s.sql.startsWith('UPDATE app_recovery_state SET write_nonce=NULL'))){injected=true;selected=input.filter(s=>!s.sql.startsWith('UPDATE app_recovery_state SET write_nonce=NULL'));}
  if(!injected&&fault==='omit-check'&&input.some(s=>s.sql.startsWith('INSERT INTO app_recovery_reconcile_checks'))){injected=true;selected=input.filter(s=>!s.sql.startsWith('INSERT INTO app_recovery_reconcile_checks'));}
  const result=await base.batch(selected);if(!injected&&fault==='lost-ack'&&input.some(s=>s.sql.startsWith('UPDATE app_recovery_runs SET checkpoint_json='))){injected=true;throw Error('Synthetic lost restore acknowledgement.');}return result;
 }},repository=createRecoveryV2RestoreDatabase({driver,clock:{nowMs:()=>1},ids:{next:randomUUID}}),root={sourceCommit:'a'.repeat(40),schema,syntheticStorageOnly:true},pin='b'.repeat(64),started=await repository.start({root,pinnedDigest:pin,descriptor});assert.equal(started.kind,'started',JSON.stringify(started));return {db,repository,pin,root,metrics,injected:()=>injected};
}
const record={key:'synthetic-unit',digest:'c'.repeat(64),resultDigest:'d'.repeat(64),rowCount:1,tableName:'app_operator_scopes'};
test('restore database revokes ordinary mutation authority and patches only bounded progress fields under a cleared nonce',async t=>{
 const f=await setup(t),loaded=await f.repository.load(f.pin);assert.throws(()=>f.db.exec("INSERT INTO app_operator_scopes VALUES('outside','scope',0,1)"),/mutation-disabled/);
 const accepted=await f.repository.advance(loaded,{delta:{phase:'objects',objectCursor:'private/next'},records:[record],effects:[sql('INSERT INTO app_operator_scopes VALUES(?,?,0,1)','restored','scope')]});assert.equal(accepted.kind,'progress');assert.equal(accepted.revision,1);assert.equal(f.db.prepare('SELECT write_nonce FROM app_recovery_state').get().write_nonce,null);
 const saved=await f.repository.load(f.pin);assert.deepEqual(JSON.parse(saved.run.checkpoint_json).root,f.root);assert.equal(JSON.parse(saved.run.checkpoint_json).phase,'objects');assert.ok(f.metrics.every(m=>m.batchBytes<=262144&&m.statements<=64));await assert.rejects(f.repository.advance(saved,{delta:{root:{bad:true}}}),/restore patch/);
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
