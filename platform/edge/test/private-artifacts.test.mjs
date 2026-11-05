import test from 'node:test';
import assert from 'node:assert/strict';
import { Miniflare } from 'miniflare';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { sha256,MAX_PRIVATE_ARTIFACT_BYTES } from '../../artifacts/identity.mjs';

test('real workerd R2 private artifacts are create-once, verified, recoverable and excluded from public routes',async t=>{
 const bundle=async relative=>(await build({entryPoints:[fileURLToPath(new URL(relative,import.meta.url))],bundle:true,
   platform:'browser',format:'esm',write:false,target:'es2022'})).outputFiles[0].text;
 const artifactCode=await bundle('./fixtures/private-artifact-worker.ts'),appCode=await bundle('../src/worker.ts');
 const config=(name,code,env)=>({config:{name,type:'worker',compatibilityDate:'2026-08-25',
   manifest:{mainModule:'worker.mjs',modules:{'worker.mjs':{type:'esm',contents:code}}},env}});
 const mf=new Miniflare({workers:[
  config('private-test',artifactCode,{PRIVATE:{type:'r2',name:'tenx-private-fixture'}}),
  config('public-test',appCode,{DB:{type:'d1',id:'00000000-0000-4000-8000-000000000013'},MANIFESTS:{type:'r2',name:'tenx-private-fixture'}}),
 ]});
 t.after(()=>mf.dispose());
 const worker=await mf.getWorker('private-test'),publicWorker=await mf.getWorker('public-test');
 const bucket=await mf.getR2Bucket('PRIVATE','private-test');
 const db=await mf.getD1Database('DB','public-test');
 // Only the pre-existing public catalog is needed; no artifact code writes it.
 await db.prepare('CREATE TABLE manifest_catalog(byte_digest TEXT PRIMARY KEY,object_key TEXT,size_bytes INTEGER)').run();
 async function fixture(text){
  const bytes=new TextEncoder().encode(text),byteDigest=await sha256(bytes);
  return {bytes:[...bytes],identity:{key:'private/'+byteDigest+'.json',byteDigest,size:bytes.length,semanticDigest:null,
   visibility:'private',contentType:'application/json'}};
 }
 const call=async(action,f)=>worker.fetch('http://localhost/',{method:'POST',body:JSON.stringify({action,...f})});
 const result=async(action,f)=>{const response=await call(action,f);assert.equal(response.status,200);return response.json();};
 const f=await fixture('{"fixture":"private exact bytes"}');
 assert.equal((await result('get',f)).status,'missing');
 const concurrent=await Promise.all(Array.from({length:6},()=>result('put',f)));
 assert.equal(concurrent.filter(r=>r.status==='created').length,1);
 assert.equal(concurrent.filter(r=>r.status==='exists').length,5);
 assert.deepEqual((await result('get',f)).bytes,f.bytes);
 assert.equal((await result('put',f)).status,'exists');
 const lost=await fixture('{"fixture":"lost acknowledgement"}');
 const uncertain=await result('lost-put',lost);
 assert.equal(uncertain.status,'unknown');assert.deepEqual(uncertain.identity,lost.identity);
 assert.deepEqual((await result('get',lost)).bytes,lost.bytes);
 assert.equal((await result('put',lost)).status,'exists');
 assert.equal((await call('read-failure',lost)).status,409,'read transport failure is not missing');
 for(const identity of [{...f.identity,key:'../escape'},{...f.identity,visibility:'public'},
  {...f.identity,size:MAX_PRIVATE_ARTIFACT_BYTES+1},{...f.identity,size:f.identity.size+1}]){
  assert.equal((await call('put',{...f,identity})).status,409);
 }
 const bounded=await fixture('x'.repeat(MAX_PRIVATE_ARTIFACT_BYTES));
 assert.equal((await result('put',bounded)).status,'created');
 assert.equal((await result('get',bounded)).bytes.length,MAX_PRIVATE_ARTIFACT_BYTES);
 const empty=await fixture('');
 assert.equal((await result('put',empty)).status,'created');
 assert.deepEqual((await result('get',empty)).bytes,[]);
 const changed=[...f.bytes];changed[0]^=1;
 assert.equal((await call('put',{...f,bytes:changed})).status,409);
 // External corruption is a fixture injection, never an adapter overwrite.
 await bucket.put(f.identity.key,new Uint8Array(changed),{httpMetadata:{contentType:'application/json'}});
 assert.equal((await result('get',f)).status,'conflict');
 assert.equal((await call('put',f)).status,409);
 assert.deepEqual([...new Uint8Array(await (await bucket.get(f.identity.key)).arrayBuffer())],changed);
 await bucket.put(f.identity.key,new Uint8Array(changed.slice(1)),{httpMetadata:{contentType:'application/json'}});
 assert.equal((await result('get',f)).status,'conflict');
 assert.equal((await call('put',f)).status,409);
 assert.equal(await db.prepare('SELECT COUNT(*) AS n FROM manifest_catalog').first('n'),0);
 assert.equal((await publicWorker.fetch('http://localhost/api/v1/manifests/'+lost.identity.byteDigest)).status,404);
 assert.equal((await publicWorker.fetch('http://localhost/'+lost.identity.key)).status,404);
 // Even a corrupt catalog reference cannot publish bytes from the private prefix.
 await db.prepare('INSERT INTO manifest_catalog VALUES(?,?,?)').bind(lost.identity.byteDigest,lost.identity.key,lost.identity.size).run();
 const blocked=await publicWorker.fetch('http://localhost/api/v1/manifests/'+lost.identity.byteDigest);
 assert.equal(blocked.status,503);assert.ok(!(await blocked.text()).includes('lost acknowledgement'));
});
