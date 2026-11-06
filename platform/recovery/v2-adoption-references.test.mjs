import test from 'node:test';
import assert from 'node:assert/strict';
import {adoptionAuthorityFixture} from '../collect/legacy-adoption-authority.fixtures.mjs';
import {createRecoveryV2Codec} from './v2-codec.mjs';
import {createRecoveryV2CaptureSource} from './v2-capture-source.mjs';
import {createRecoveryV2ReferenceCapture} from './v2-capture-references.mjs';
import {readInstalledRecoverySchema} from './node-schema.mjs';
import {createRecoveryExporter} from './export.mjs';
import {measureBatch} from '../storage/atomic-driver.mjs';

// Synthetic accepted import rows exercise retained-byte discovery only. They
// do not establish genuine preparation, activation or restored-ready authority.
async function setup(t){
 const f=await adoptionAuthorityFixture(t,{count:1,stageCount:1,retainObject:true}),schema=await readInstalledRecoverySchema(f.crypto),identity=JSON.parse(f.db.prepare('SELECT identity_json FROM app_collection_legacy_adoption_objects').get().identity_json),bytes=f.artifacts.objects.get(identity.key);
 assert.equal(f.db.prepare('SELECT COUNT(*) n FROM app_private_artifacts WHERE object_key=?').get(identity.key).n,0);
 const metrics=[];let active=null,omit=false;
 const driver={...f.driver,async batch(statements){if(active){active.sql+=statements.length;active.batchBytes=Math.max(active.batchBytes,measureBatch(statements).batchBytes);}if(omit&&statements.some(s=>s.sql.startsWith('INSERT INTO app_recovery_capture_objects')&&s.values.includes(identity.key))){omit=false;statements=statements.filter(s=>!s.sql.startsWith('INSERT INTO app_recovery_capture_objects'));}return f.driver.batch(statements);}};
 const artifacts={...f.artifacts,async getVerified(i){if(active)active.reads++;return f.artifacts.getVerified(i);},async putIfAbsent(i,b){if(active)active.writes++;return f.artifacts.putIfAbsent(i,b);}},ports={...f.ports,driver,artifacts,schema,v2Codec:createRecoveryV2Codec(f)},source=createRecoveryV2CaptureSource(ports),references=createRecoveryV2ReferenceCapture({...ports,source});
 let run=await source.start({captureId:'synthetic-adoption-reference',sourceCommit:'a'.repeat(40)});for(let n=0;n<2000&&run.phase==='reading';n++)run=await source.step({captureId:run.captureId,expectedRevision:run.revision});assert.equal(run.phase,'verifying',JSON.stringify(run));
 const step=async()=>{active={sql:0,reads:0,writes:0,batchBytes:0};try{return await references.step(await source.load(run.captureId));}finally{metrics.push(active);active=null;}};
 const finish=async()=>{for(let n=0;n<2000;n++){const r=await step();if(r.kind==='conflict'||r.kind==='held'||r.phase==='indexing')return r;}throw Error('Reference continuation limit');};
 return {...f,ports,identity,bytes,source,step,finish,metrics,captureId:run.captureId,omit:()=>{omit=true;}};
}
test('sealed adoption object rows retain private bytes absent from the general artifact catalog',async t=>{
 const f=await setup(t);assert.equal((await f.finish()).phase,'indexing');const rows=f.db.prepare('SELECT identity_json FROM app_recovery_capture_objects WHERE capture_id=? AND object_key=?').all(f.captureId,f.identity.key);assert.equal(rows.length,1);assert.deepEqual(JSON.parse(rows[0].identity_json),f.identity);assert.ok(f.metrics.every(m=>m.sql+m.reads+m.writes<=64&&m.batchBytes<=262144));t.diagnostic(JSON.stringify({source:'synthetic-accepted-import',steps:f.metrics.length,maxOperations:Math.max(...f.metrics.map(m=>m.sql+m.reads+m.writes)),maxBatchBytes:Math.max(...f.metrics.map(m=>m.batchBytes))}));
});
test('missing and corrupt adoption bytes retain cursor, and omitted object ledger writes cannot advance',async t=>{
 const f=await setup(t);f.artifacts.objects.delete(f.identity.key);assert.equal((await f.finish()).code,'recovery-object-missing');const revision=(await f.source.load(f.captureId)).revision;f.artifacts.objects.set(f.identity.key,new Uint8Array(f.bytes.length));assert.equal((await f.step()).code,'recovery-object-conflict');assert.equal((await f.source.load(f.captureId)).revision,revision);f.artifacts.objects.set(f.identity.key,f.bytes);f.omit();assert.equal((await f.step()).kind,'conflict');assert.equal((await f.source.load(f.captureId)).revision,revision);assert.equal((await f.finish()).phase,'indexing');
});
test('legacy private exporter also verifies retained adoption bytes rather than producing an incomplete pin',async t=>{
 const f=await setup(t),exporter=createRecoveryExporter({...f.ports,sourceCommit:'a'.repeat(40)});f.artifacts.objects.delete(f.identity.key);assert.equal((await exporter.capturePrivate()).reason,'recovery-object-missing');f.artifacts.objects.set(f.identity.key,f.bytes);const result=await exporter.capturePrivate();assert.equal(result.kind,'captured',JSON.stringify(result));assert.ok(result.inventory.objects.some(i=>i.key===f.identity.key));
});
