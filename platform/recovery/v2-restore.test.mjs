import test from 'node:test';
import assert from 'node:assert/strict';
import {openDatabase} from '../storage/database.mjs';
import {createNodeAtomicDriver} from '../storage/node/atomic-driver.mjs';
import {recoveryFixture,memoryArtifacts} from './fixtures.mjs';
import {createRecoveryV2Codec} from './v2-codec.mjs';
import {createRecoveryV2Capture} from './v2-capture.mjs';
import {createRecoveryV2Restore} from './v2-restore.mjs';
import {measureBatch} from '../storage/atomic-driver.mjs';
test('continued private restore copies exact source graph and reconciles every row before target readiness',async t=>{
 const f=await recoveryFixture();t.after(()=>f.db.close());const v2Codec=createRecoveryV2Codec(f),capture=createRecoveryV2Capture({...f,v2Codec,artifacts:f.store});let captured=await capture.start({captureId:'synthetic-restore-source',sourceCommit:'a'.repeat(40)});
 for(let n=0;n<2000&&captured.kind!=='captured';n++){assert.ok(['progress','started','replayed'].includes(captured.kind),JSON.stringify(captured));captured=await capture.step({captureId:captured.captureId,expectedRevision:captured.revision});}assert.equal(captured.kind,'captured');
 const db=openDatabase();t.after(()=>db.close());const base=createNodeAtomicDriver(db),metrics=[],driver={...base,async batch(statements){metrics.push(measureBatch(statements));return base.batch(statements);}},store=memoryArtifacts(),restore=createRecoveryV2Restore({...f,driver,artifacts:store,sourceArtifacts:f.store,v2Codec}),input={root:captured.value,pinnedDigest:captured.digest};let result=await restore.start(input);
 assert.equal((await restore.finish({...input,expectedRevision:result.revision})).code,'recovery-reconciliation-incomplete');
 for(let n=0;n<3000&&result.kind!=='restored';n++){assert.ok(['started','progress','replayed'].includes(result.kind),JSON.stringify(result));assert.equal(db.prepare('SELECT status FROM app_recovery_state').get().status,'restoring');result=await restore.step({...input,expectedRevision:result.revision});}
 assert.equal(result.kind,'restored',JSON.stringify(result));assert.equal(db.prepare('SELECT COUNT(*) n FROM earn_awards').get().n,f.db.prepare('SELECT COUNT(*) n FROM earn_awards').get().n);assert.equal(store.objects.size,captured.value.totals.objects);assert.equal(db.prepare('SELECT status FROM app_recovery_state').get().status,'ready');assert.equal((await restore.finish(input)).kind,'restored');
 const run=db.prepare('SELECT checkpoint_json FROM app_recovery_runs').get(),checkpoint=JSON.parse(run.checkpoint_json);assert.equal(checkpoint.phase,'final-ready');assert.equal(checkpoint.targetWatermark,db.prepare('SELECT revision FROM app_recovery_watermark').get().revision);assert.ok(Buffer.byteLength(run.checkpoint_json)<=131072);assert.ok(metrics.every(m=>m.statements<=64&&m.batchBytes<=262144));t.diagnostic(JSON.stringify({steps:checkpoint.revision,checkpointBytes:Buffer.byteLength(run.checkpoint_json),maxSqlStatements:Math.max(...metrics.map(m=>m.statements)),maxBatchBytes:Math.max(...metrics.map(m=>m.batchBytes)),objects:store.objects.size,reconciliationComplete:true}));
});
