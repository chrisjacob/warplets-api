import test from 'node:test';
import assert from 'node:assert/strict';
import {localRuntime} from './local-runtime.mjs';
import {readInstalledRecoverySchema} from '../../recovery/node-schema.mjs';
import {createNodeCrypto} from '../../security/node-crypto.mjs';
import {createRecoveryV2Codec} from '../../recovery/v2-codec.mjs';
import {BUSINESS_TABLES} from '../../recovery/schema.mjs';
import {canonicalJson,utf8} from '../../security/canonical.mjs';
import {recoveryFixture} from '../../recovery/fixtures.mjs';
test('actual D1/R2 continued source capture seals bounded pages, replays lost acknowledgements and detects changed sources',async t=>{
 const {mf,db}=await localRuntime(t,new URL('./fixtures/recovery-v2-worker.ts',import.meta.url)),crypto=createNodeCrypto(),schema=await readInstalledRecoverySchema(crypto),metrics=[];
 await db.exec('CREATE TABLE schema_versions(version TEXT PRIMARY KEY) STRICT');await db.batch(schema.migrations.map(m=>db.prepare('INSERT INTO schema_versions VALUES(?)').bind(m.file)));
 const fixture=await recoveryFixture();t.after(()=>fixture.db.close());const archives=[],bucket=await mf.getR2Bucket('MANIFESTS');
 for(let n=0;n<17;n++)archives.push(await fixture.codec.build({board:fixture.golden.bundle.manifest.board,allocations:fixture.golden.bundle.manifest.allocations.map(a=>({...a,tokenId:'synthetic-d1-archive-'+n}))}));
 archives.sort((a,b)=>a.identity.key>b.identity.key?-1:1);
 for(const archive of archives){await bucket.put(archive.identity.key,archive.bytes,{httpMetadata:{contentType:'application/json'}});await db.prepare('INSERT INTO manifest_catalog VALUES(?,?,?,?,?)').bind(archive.byteDigest,archive.identity.key,archive.bytes.length,'earn-archive-v1',1).run();}
 const sourceWatermark=await db.prepare('SELECT revision FROM app_recovery_watermark WHERE id=1').first('revision');
 const call=async(method,input,fault)=>{const response=await mf.dispatchFetch('http://localhost/__fixture',{method:'POST',body:JSON.stringify({method,input,schema,fault})});assert.equal(response.status,200,await response.clone().text());const output=await response.json();metrics.push(output.metrics);return output;};
 let output=await call('start',{captureId:'synthetic-d1-source',sourceCommit:'a'.repeat(40)});assert.equal(output.result.kind,'started',JSON.stringify(output));
 output=await call('step',{captureId:output.result.captureId,expectedRevision:output.result.revision},'lost-ack');assert.equal(output.faulted,true);assert.equal(output.result.kind,'replayed');
 let omitted=false;
 for(let n=0;n<1000&&output.result.phase==='reading';n++){
  const before=output.result,attempt=await call('step',{captureId:before.captureId,expectedRevision:before.revision},omitted?undefined:'omit-page');
  if(attempt.faulted){omitted=true;assert.equal(attempt.result.kind,'conflict');output=await call('step',{captureId:before.captureId,expectedRevision:before.revision});}else output=attempt;
 }
 assert.equal(omitted,true);assert.equal(output.result.phase,'verifying',JSON.stringify(output));
 const saved=await db.prepare('SELECT checkpoint_json FROM app_recovery_captures WHERE id=?').bind(output.result.captureId).first();assert.equal(JSON.parse(saved.checkpoint_json).tables.length,BUSINESS_TABLES.length);
 const page=await db.prepare("SELECT identity_json FROM app_recovery_capture_pages WHERE scope='rows:app_revisions'").first(),identity=JSON.parse(page.identity_json),bytes=new Uint8Array(await (await bucket.get(identity.key)).arrayBuffer());assert.equal((await createRecoveryV2Codec({crypto}).verifyRows(bytes,identity)).rows.length,3);
 await db.prepare("UPDATE app_revisions SET revision=revision+1 WHERE name='source'").run();
 while(output.result.phase==='verifying')output=await call('references',{captureId:output.result.captureId});assert.equal(output.result.phase,'indexing');
 for(let n=0;n<2000&&output.result.kind!=='captured';n++){output=await call('capture',{captureId:output.result.captureId,expectedRevision:output.result.revision});assert.ok(['progress','replayed','captured'].includes(output.result.kind),JSON.stringify(output));}
 assert.equal(output.result.kind,'captured');const v2Codec=createRecoveryV2Codec({crypto}),root=await v2Codec.verifyRoot(utf8(canonicalJson(output.result.value)),output.result.digest);assert.equal(root.tables.count,BUSINESS_TABLES.length);assert.equal(root.snapshot.watermark,String(sourceWatermark));assert.equal(root.totals.rows,20);assert.equal(root.publications.count,17);
 const publicIndex=await v2Codec.verifyIndex(new Uint8Array(await (await bucket.get(root.publications.identity.key)).arrayBuffer()),root.publications.identity);assert.equal(publicIndex.level,1);const keys=[];for(const branch of publicIndex.entries){const leaf=await v2Codec.verifyIndex(new Uint8Array(await (await bucket.get(branch.identity.key)).arrayBuffer()),branch.identity);keys.push(...leaf.entries.map(e=>e.key));}assert.deepEqual(keys,archives.map(a=>a.identity.key).sort());
 const next=await call('start',{captureId:'synthetic-d1-changed',sourceCommit:'a'.repeat(40)});await db.prepare("UPDATE app_revisions SET revision=revision+1 WHERE name='source'").run();assert.equal((await call('step',{captureId:next.result.captureId,expectedRevision:0})).result.reason,'capture-source-changed');
 assert.ok(metrics.every(m=>m.sql+m.reads+m.writes<=64));assert.ok(metrics.every(m=>m.returnedBytes+m.objectBytes+m.maxBatchBytes<=1024*1024));
 t.diagnostic(JSON.stringify({steps:metrics.length,maxOperations:Math.max(...metrics.map(m=>m.sql+m.reads+m.writes)),maxBatchBytes:Math.max(...metrics.map(m=>m.maxBatchBytes)),maxParameters:Math.max(...metrics.map(m=>m.maxParameters)),maxSerializedWorkingBytes:Math.max(...metrics.map(m=>m.returnedBytes+m.objectBytes+m.maxBatchBytes)),capturedObjects:root.totals.objects,readyCapture:true,restoreImplemented:false}));
});
