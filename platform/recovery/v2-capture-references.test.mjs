import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {recoveryFixture} from './fixtures.mjs';
import {createRecoveryV2Codec} from './v2-codec.mjs';
import {createRecoveryV2CaptureSource} from './v2-capture-source.mjs';
import {createRecoveryV2ReferenceCapture} from './v2-capture-references.mjs';
import {createPrivateReferenceService} from '../artifacts/reference-service.mjs';
import {createArtifactReferenceRepository} from '../storage/atomic-artifacts.mjs';
import {measureBatch} from '../storage/atomic-driver.mjs';
async function setup(t,{omitObject=false}={}){
 const f=await recoveryFixture();t.after(()=>f.db.close());const bytes=new TextEncoder().encode('Synthetic retained private recovery evidence.'),byteDigest=await f.crypto.sha256(bytes),identity={key:'private/'+byteDigest+'.bin',byteDigest,size:bytes.length,visibility:'private',semanticDigest:null,contentType:'application/octet-stream'};
 f.db.exec("INSERT INTO app_operator_scopes VALUES('recovery-reference','evidence-ingest',0,1)");
 const reference=createPrivateReferenceService({store:f.store,repository:createArtifactReferenceRepository(f.driver,{crypto:f.crypto,ids:{next:randomUUID}}),crypto:f.crypto,clock:f.clock});assert.equal((await reference.persist({kind:'operator',id:'recovery-reference'},{identity,bytes,requestKey:'private-evidence'})).kind,'committed');
 const metrics=[];let current=null,omitted=false;const driver={...f.driver,async batch(statements){if(current){current.sql+=statements.length;current.batchBytes=Math.max(current.batchBytes,measureBatch(statements).batchBytes);}if(omitObject&&!omitted&&statements.some(s=>s.sql.startsWith('INSERT INTO app_recovery_capture_objects')&&s.values.includes(identity.key))){omitted=true;statements=statements.filter(s=>!s.sql.startsWith('INSERT INTO app_recovery_capture_objects'));}return f.driver.batch(statements);}},artifacts={...f.store,async getVerified(i){if(current)current.reads++;return f.store.getVerified(i);},async putIfAbsent(i,b){if(current)current.writes++;return f.store.putIfAbsent(i,b);}},v2Codec=createRecoveryV2Codec(f),source=createRecoveryV2CaptureSource({...f,driver,artifacts,v2Codec}),refs=createRecoveryV2ReferenceCapture({...f,driver,artifacts,v2Codec,source});
 let result=await source.start({captureId:'synthetic-reference-capture',sourceCommit:'a'.repeat(40)});for(let n=0;n<1000&&result.phase==='reading';n++)result=await source.step({captureId:result.captureId,expectedRevision:result.revision});assert.equal(result.phase,'verifying',JSON.stringify(result));
 const step=async()=>{current={sql:0,reads:0,writes:0,batchBytes:0};try{return await refs.step(await source.load(result.captureId));}finally{metrics.push(current);current=null;}};
 const complete=async()=>{let outcome;for(let n=0;n<1000;n++){outcome=await step();if(outcome.kind==='conflict'||outcome.kind==='held'||outcome.phase==='indexing')return outcome;}throw Error('Reference continuation bound.');};
 return {...f,identity,bytes,source,step,complete,metrics,captureId:result.captureId,omitted:()=>omitted};
}
test('sealed reference capture retains exact private bytes and semantic public pins without reading mutable source tables',async t=>{
 const f=await setup(t);f.db.exec("UPDATE app_revisions SET revision=revision+1 WHERE name='source'");const result=await f.complete();assert.equal(result.phase,'indexing',JSON.stringify(result));
 const objects=f.db.prepare('SELECT * FROM app_recovery_capture_objects WHERE capture_id=?').all(f.captureId);assert.ok(objects.some(r=>r.object_key===f.identity.key&&r.verified===1));const published=objects.find(r=>r.object_key===f.artifact.identity.key);assert.deepEqual(JSON.parse(published.identity_json),f.artifact.identity);
 const pins=f.db.prepare("SELECT identity_json FROM app_recovery_capture_pages WHERE scope='publications'").all();assert.equal(pins.length,1);const metadata=JSON.parse(pins[0].identity_json),pin=JSON.parse(new TextDecoder().decode((await f.store.getVerified(metadata)).bytes));assert.equal(pin.semanticDigest,f.artifact.semanticDigest);assert.equal(pin.boardId,f.artifact.boardId);
 assert.ok(f.metrics.every(m=>m.sql+m.reads+m.writes<=64));assert.ok(f.metrics.every(m=>m.reads<=3&&m.writes<=1));t.diagnostic(JSON.stringify({steps:f.metrics.length,maxOperations:Math.max(...f.metrics.map(m=>m.sql+m.reads+m.writes)),maxBatchBytes:Math.max(...f.metrics.map(m=>m.batchBytes)),oneReferencedObjectPerStep:true}));
});
test('missing and corrupt retained objects cannot advance, while restored exact bytes reconcile the same cursor',async t=>{
 const f=await setup(t);f.objects.delete(f.identity.key);let result=await f.complete();assert.equal(result.code,'recovery-object-missing');const revision=(await f.source.load(f.captureId)).revision;
 f.objects.set(f.identity.key,new Uint8Array(f.bytes.length));result=await f.step();assert.equal(result.code,'recovery-object-conflict');assert.equal((await f.source.load(f.captureId)).revision,revision);
 f.objects.set(f.identity.key,f.bytes);assert.equal((await f.complete()).phase,'indexing');
});
test('omitted reference ledger child cannot advance; exact immutable object retries reconcile',async t=>{
 const f=await setup(t,{omitObject:true});const result=await f.complete();assert.equal(f.omitted(),true);assert.equal(result.kind,'conflict');assert.equal(f.db.prepare('SELECT COUNT(*) n FROM app_recovery_capture_objects WHERE object_key=?').get(f.identity.key).n,0);assert.equal((await f.complete()).phase,'indexing');
});
