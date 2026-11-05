import test from 'node:test';
import assert from 'node:assert/strict';
import {localRuntime} from './local-runtime.mjs';
import {recoveryFixture} from '../../recovery/fixtures.mjs';
import {createPrivateRecovery} from '../../recovery/restore.mjs';
import {createNodeAtomicDriver} from '../../storage/node/atomic-driver.mjs';
import {openDatabase} from '../../storage/database.mjs';
import {createJobRepository} from '../../jobs/repository.mjs';
import {createJobCommand} from '../../jobs/model.mjs';

async function setup(t,mode){
 const source=await recoveryFixture();t.after(()=>source.db.close());
 let oldLease;
 if(mode==='private'){
  source.db.prepare('INSERT INTO sessions VALUES(?,?,?,?)').run('synthetic-old-session','w1','http://localhost',999999999999);
  source.db.prepare('INSERT INTO auth_challenges VALUES(?,?,?,?,?,?)').run('synthetic-old-nonce','w1','http://localhost','synthetic-old-message',999999999999,null);
  const principal={kind:'operator',id:'synthetic-recovery'};source.db.prepare('INSERT INTO app_operator_scopes VALUES(?,?,0,1)').run(principal.id,'jobs-runner');
  const jobs=createJobRepository(source.driver,{...source,principal});await jobs.enqueue(await createJobCommand({principal,requestKey:'synthetic-pending-restore',nowMs:source.clock.nowMs(),input:{businessKey:'synthetic-pending-restore',sourceKey:'synthetic-pending-restore',type:'retention-maintenance',payload:{synthetic:true},readyMs:source.clock.nowMs(),maxAttempts:5}},source.crypto));
  oldLease=(await jobs.acquireJob()).job.lease;
 }
 const captured=await source.exporter[mode==='public'?'capturePublic':'capturePrivate']();assert.equal(captured.kind,'captured');
 // This pin is retained outside the database/object storage being destroyed or
 // restored. Later checks never derive their expected root from damaged bytes.
 const independentPin=captured.digest,input={inventory:captured.inventory,pinnedDigest:independentPin};
 const {mf,db}=await localRuntime(t,new URL('./fixtures/recovery-worker.ts',import.meta.url)),r2=await mf.getR2Bucket('MANIFESTS');
 for(const identity of captured.inventory.objects)await r2.put(identity.key,source.objects.get(identity.key),{httpMetadata:{contentType:identity.contentType}});
 const call=async(method,extra={})=>{const response=await mf.dispatchFetch('http://localhost/synthetic-recovery',{method:'POST',body:JSON.stringify({method,mode,input,schema:source.schema,nowMs:source.clock.nowMs(),...extra})});const body=await response.json();assert.equal(response.status,200,JSON.stringify(body));return body;};
 return {source,captured,independentPin,input,mf,db,r2,call,oldLease};
}

test('fresh workerd public recovery preserves pinned proofs/years-later claims and rejects all normal mutations',async t=>{
 const f=await setup(t,'public');const started=await f.call('start');assert.equal(started.result.kind,'started');
 const omitted=await f.call('step',{fault:'omit-nonce-clear'});assert.equal(omitted.result.kind,'held');assert.equal(await f.db.prepare('SELECT write_nonce FROM app_recovery_state').first('write_nonce'),null);
 assert.equal(await f.db.prepare('SELECT COUNT(*) n FROM app_recovery_pages').first('n'),0,'omitted nonce clear rolls back the entire metadata/data batch');
 await f.call('start');
 let result;for(let n=0;n<=started.result.units;n++){result=await f.call('step',{fault:n===0?'lost-step-response':undefined});if(result.result.kind==='imported')break;assert.ok(['progress','replayed'].includes(result.result.kind),JSON.stringify(result));}
 assert.equal(result.result.kind,'imported');assert.equal((await f.call('finish')).result.kind,'restored');assert.equal((await f.call('restore')).result.kind,'replayed');
 const claims=await f.call('claims',{query:{wallet:'w1',nowMs:f.source.golden.start+730*86400000}});assert.equal(claims.result.items[0].awardUnits,claims.result.items[0].vestedUnits);
 await assert.rejects(()=>f.db.prepare('INSERT INTO earn_fixture_campaigns VALUES(?,?,?)').bind('forbidden',0,'1000000').run(),/mutation-disabled|read-only/);
 await assert.rejects(()=>f.db.prepare('INSERT INTO sessions VALUES(?,?,?,?)').bind('forbidden','w1','http://localhost',999999999999).run(),/mutation-disabled/);
 assert.equal(await f.db.prepare('SELECT COUNT(*) n FROM earn_submissions').first('n'),0);
 const artifact=f.captured.inventory.objects[0],bytes=new Uint8Array(await (await f.r2.get(artifact.key)).arrayBuffer());
 assert.equal(await f.source.crypto.sha256(bytes),artifact.byteDigest);assert.equal((await f.source.codec.verify(bytes,{semanticDigest:artifact.semanticDigest,byteDigest:artifact.byteDigest})).boardId,f.captured.inventory.publications[0].boardId);
});

test('fresh D1 private restore and its bounded single-transaction re-export recover into independent Node storage',async t=>{
 const f=await setup(t,'private'),started=await f.call('start');assert.equal(started.result.kind,'started');
 let progress,maxStep=0;for(let n=0;n<=started.result.units;n++){progress=await f.call('step',{fault:n===1?'lost-step-response':undefined});maxStep=Math.max(maxStep,progress.measurements.statements);if(progress.result.kind==='imported')break;assert.ok(['progress','replayed'].includes(progress.result.kind),JSON.stringify(progress));}
 assert.equal(progress.result.kind,'imported');const finished=await f.call('finish');assert.equal(finished.result.kind,'restored',JSON.stringify(finished));
 assert.equal(await f.db.prepare('SELECT COUNT(*) n FROM sessions').first('n'),0);assert.equal(await f.db.prepare('SELECT COUNT(*) n FROM earn_boards').first('n'),1);
 assert.equal(await f.db.prepare('SELECT COUNT(*) n FROM auth_challenges').first('n'),0);
 const job=await f.db.prepare('SELECT state,lease_token,revision FROM app_jobs WHERE id=?').bind(f.oldLease.jobId).first();assert.equal(job.state,'held');assert.equal(job.lease_token,null);assert.equal(job.revision,Number(f.oldLease.revision)+1);
 assert.equal((await f.call('stale-finish',{query:f.oldLease})).result.kind,'conflict');assert.equal(f.source.db.prepare('SELECT COUNT(*) n FROM sessions').get().n,1);
 const exported=await f.call('capture-private');assert.equal(exported.result.kind,'captured',JSON.stringify(exported));assert.ok(exported.measurements.maxBatchStatements>150,'private source rows are captured in one transaction');assert.ok(exported.measurements.statements<1000);
 const target=openDatabase();t.after(()=>target.close());
 const sourceArtifacts={async getVerified(identity){const object=await f.r2.get(identity.key);return object?{status:'verified',identity,bytes:new Uint8Array(await object.arrayBuffer())}:{status:'missing',identity};}};
 const {memoryArtifacts}=await import('../../recovery/fixtures.mjs'),artifacts=memoryArtifacts();
 const restored=await createPrivateRecovery({...f.source,driver:createNodeAtomicDriver(target),artifacts,sourceArtifacts}).restore({inventory:exported.result.inventory,pinnedDigest:exported.result.digest});
 assert.equal(restored.kind,'restored',JSON.stringify(restored));
 assert.deepEqual(target.prepare('SELECT * FROM earn_awards ORDER BY wallet').all().map(r=>({...r})),(await f.db.prepare('SELECT * FROM earn_awards ORDER BY wallet').all()).results);
 console.log('Local recovery measurements',JSON.stringify({units:started.result.units,maxStepStatements:maxStep,exportStatements:exported.measurements.statements,captureBatchStatements:exported.measurements.maxBatchStatements}));
});
