import test from 'node:test';
import assert from 'node:assert/strict';
import {recoveryFixture} from './fixtures.mjs';
import {createRecoveryV2Capture} from './v2-capture.mjs';
import {createRecoveryV2Codec,verifyRecoveryV2IndexChild} from './v2-codec.mjs';
import {measureBatch} from '../storage/atomic-driver.mjs';
import {BUSINESS_TABLES} from './schema.mjs';
async function fixture(t,{faults=false}={}){
 const f=await recoveryFixture();t.after(()=>f.db.close());let current=null,omitted=false,lost=false;const metrics=[],driver={...f.driver,async batch(statements){if(current){current.sql+=statements.length;current.maxBatchBytes=Math.max(current.maxBatchBytes,measureBatch(statements).batchBytes);}let selected=statements;if(faults&&!omitted&&statements.some(s=>s.sql.startsWith('INSERT INTO app_recovery_capture_pages')&&s.values[3]==='index')){omitted=true;selected=statements.filter(s=>!s.sql.startsWith('INSERT INTO app_recovery_capture_pages'));}const result=await f.driver.batch(selected);if(faults&&!lost&&statements.some(s=>s.sql.startsWith("UPDATE app_recovery_captures SET state='ready'"))){lost=true;throw Error('Synthetic lost final capture acknowledgement.');}if(current)current.returnedBytes+=new TextEncoder().encode(JSON.stringify(result)).length;return result;}},artifacts={...f.store,async getVerified(identity){const r=await f.store.getVerified(identity);if(current){current.reads++;if(r.status==='verified')current.objectBytes+=r.bytes.length;}return r;},async putIfAbsent(identity,bytes){if(current){current.writes++;current.objectBytes+=bytes.length;}return f.store.putIfAbsent(identity,bytes);}},v2Codec=createRecoveryV2Codec(f),capture=createRecoveryV2Capture({...f,driver,artifacts,v2Codec});
 const call=async(method,input)=>{current={sql:0,reads:0,writes:0,maxBatchBytes:0,returnedBytes:0,objectBytes:0};try{return await capture[method](input);}finally{metrics.push(current);current=null;}};
 const complete=async(captureId='synthetic-v2-complete')=>{let result=await call('start',{captureId,sourceCommit:'a'.repeat(40)});for(let n=0;n<5000&&['started','progress','replayed'].includes(result.kind);n++)result=await call('step',{captureId,expectedRevision:result.revision});return result;};
 return {...f,capture,call,complete,metrics,v2Codec,faults:()=>({omitted,lost})};
}
async function inspectGraph(f,root){
 const objects=new Map(),tables=[],publications=[],catalog=[];
 const read=async identity=>{objects.set(identity.key,identity);const result=await f.store.getVerified(identity);assert.equal(result.status,'verified');return result.bytes;};
 async function walk(pointer,kind){if(!pointer.identity){assert.equal(pointer.count,0);return [];}const bytes=await read(pointer.identity),node=await f.v2Codec.verifyIndex(bytes,pointer.identity);assert.equal(node.kind,kind);let values=[];
  if(node.level===0)values=node.entries.map(e=>e.value);
  else for(const entry of node.entries){const child=await f.v2Codec.verifyIndex(await read(entry.identity),entry.identity);verifyRecoveryV2IndexChild(node,entry,child,entry.identity);values.push(...await walk({identity:entry.identity,count:entry.count},kind));}
  assert.equal(values.length,pointer.count);return values;
 }
 tables.push(...await walk(root.tables,'tables'));publications.push(...await walk(root.publications,'publications'));catalog.push(...await walk(root.objects,'objects'));
 for(const table of tables){await f.v2Codec.verifyTableDescriptor(table);const pages=await walk(table.pages,'table-pages');let rows=0,after=null;for(const entry of pages){assert.deepEqual(entry.after,after);const page=await f.v2Codec.verifyRows(await read(entry.identity),entry.identity);assert.equal(page.table,table.name);assert.deepEqual(page.after,after);assert.equal(page.rows.length,entry.rowCount);rows+=page.rows.length;after=entry.last;}assert.equal(rows,table.rowCount);}
 for(const identity of catalog)await read(identity);await read(root.checkpoints);assert.equal(objects.size,root.totals.objects);assert.equal([...objects.values()].reduce((n,i)=>n+i.size,0),root.totals.bytes);assert.equal(tables.reduce((n,t)=>n+t.rowCount,0),root.totals.rows);return {objects,tables,publications};
}
test('continued capture seals an independently pinned complete hierarchical graph with bounded calls and unchanged live source',async t=>{
 const f=await fixture(t),result=await f.complete();assert.equal(result.kind,'captured',JSON.stringify(result));const root=await f.v2Codec.verifyRoot(result.bytes,result.digest),graph=await inspectGraph(f,root);assert.equal(graph.tables.length,BUSINESS_TABLES.length);assert.equal(graph.publications.length,1);assert.equal(graph.publications[0].boardId,f.artifact.boardId);assert.equal(f.db.prepare('SELECT status FROM app_recovery_state').get().status,'live');
 assert.deepEqual((await f.capture.finish({captureId:result.captureId,expectedRevision:0})).bytes,result.bytes);await assert.rejects(f.v2Codec.verifyRoot(result.bytes,'f'.repeat(64)),/independently pinned/);
 assert.ok(f.metrics.every(m=>m.sql+m.reads+m.writes<=64));assert.ok(f.metrics.every(m=>m.returnedBytes+m.objectBytes+m.maxBatchBytes<=1024*1024));t.diagnostic(JSON.stringify({calls:f.metrics.length,objects:root.totals.objects,bytes:root.totals.bytes,maxOperations:Math.max(...f.metrics.map(m=>m.sql+m.reads+m.writes)),maxBatchBytes:Math.max(...f.metrics.map(m=>m.maxBatchBytes)),maxSerializedWorkingBytes:Math.max(...f.metrics.map(m=>m.returnedBytes+m.objectBytes+m.maxBatchBytes))}));
});
test('omitted index metadata blocks the cursor, lost root acknowledgements replay and ready pins remain immutable',async t=>{
 const f=await fixture(t,{faults:true}),held=await f.complete();assert.equal(held.kind,'conflict');assert.equal(f.faults().omitted,true);const result=await f.complete();assert.equal(result.kind,'captured');assert.equal(f.faults().lost,true);await inspectGraph(f,result.value);
 assert.throws(()=>f.db.prepare('UPDATE app_recovery_captures SET root_digest=? WHERE id=?').run('f'.repeat(64),result.captureId),/immutable|identity or revision/);assert.equal((await f.capture.start({captureId:result.captureId,sourceCommit:'a'.repeat(40)})).digest,result.digest);
});
test('final object verification cannot seal a missing publication and resumes after exact bytes return',async t=>{
 const f=await fixture(t);let result=await f.call('start',{captureId:'synthetic-missing-final-object',sourceCommit:'a'.repeat(40)});
 for(let n=0;n<1000;n++){const run=f.db.prepare('SELECT checkpoint_json FROM app_recovery_captures WHERE id=?').get(result.captureId);if(JSON.parse(run.checkpoint_json).phase==='verify-objects')break;result=await f.call('step',{captureId:result.captureId,expectedRevision:result.revision});assert.ok(['progress','replayed'].includes(result.kind));}
 const bytes=f.objects.get(f.artifact.identity.key);f.objects.delete(f.artifact.identity.key);
 for(let n=0;n<1000&&result.kind!=='conflict';n++)result=await f.call('step',{captureId:'synthetic-missing-final-object',expectedRevision:result.revision});assert.equal(result.code,'recovery-object-missing');assert.equal(f.db.prepare("SELECT root_digest FROM app_recovery_captures WHERE id='synthetic-missing-final-object'").get().root_digest,null);
 f.objects.set(f.artifact.identity.key,bytes);assert.equal((await f.complete('synthetic-missing-final-object')).kind,'captured');
});
test('publication trees sort content keys across leaves and parent ranges independently of catalog insertion order',async t=>{
 const f=await fixture(t),bundles=[];
 for(let n=0;n<17;n++)bundles.push(await f.codec.build({board:f.golden.bundle.manifest.board,allocations:f.golden.bundle.manifest.allocations.map(a=>({...a,tokenId:'synthetic-archive-'+n}))}));
 bundles.sort((a,b)=>a.identity.key>b.identity.key?-1:1);
 for(const bundle of bundles){await f.store.putIfAbsent(bundle.identity,bundle.bytes);f.db.prepare('INSERT INTO manifest_catalog VALUES(?,?,?,?,?)').run(bundle.byteDigest,bundle.identity.key,bundle.bytes.length,'earn-archive-v1',1);}
 const result=await f.complete();assert.equal(result.kind,'captured',JSON.stringify(result));const graph=await inspectGraph(f,result.value);assert.equal(graph.publications.length,18);assert.deepEqual(graph.publications.map(p=>p.identity.key),[...graph.publications.map(p=>p.identity.key)].sort());
 for(const pin of graph.publications){const object=await f.store.getVerified(pin.identity),verified=await f.codec.verify(object.bytes,{byteDigest:pin.identity.byteDigest,semanticDigest:pin.semanticDigest});assert.equal(verified.boardId,pin.boardId);}
 const index=await f.v2Codec.verifyIndex((await f.store.getVerified(result.value.publications.identity)).bytes,result.value.publications.identity);assert.equal(index.level,1);assert.equal(index.entries.length,2);
});
