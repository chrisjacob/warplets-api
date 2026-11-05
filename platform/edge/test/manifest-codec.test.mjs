import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {localRuntime} from './local-runtime.mjs';
import {createManifestCodec} from '../../artifacts/manifest-codec.mjs';
import {createNodeCrypto} from '../../security/node-crypto.mjs';
import {MAX_PUBLIC_ARTIFACT_BYTES} from '../../artifacts/identity.mjs';
const golden=JSON.parse(readFileSync(new URL('../../application/fixtures/earn-golden.json',import.meta.url)));

test('actual workerd codec preserves pinned bundle/proof bytes and R2 public writes are bounded, create-once and recoverable',async t=>{
 const {mf,db}=await localRuntime(t,new URL('./fixtures/manifest-codec-worker.ts',import.meta.url)),bucket=await mf.getR2Bucket('MANIFESTS');
 const call=async(method,args={})=>{const response=await mf.dispatchFetch('http://localhost/',{method:'POST',body:JSON.stringify({method,...args})});return {status:response.status,value:await response.json()};};
 const ok=async(method,args={})=>{const result=await call(method,args);assert.equal(result.status,200,JSON.stringify(result.value));return result.value;};
 const input={board:golden.bundle.manifest.board,allocations:golden.bundle.manifest.allocations},node=await createManifestCodec({crypto:createNodeCrypto()}).build(input);
 const worker=await ok('build',{input});assert.deepEqual(worker.bundle,golden.bundle);assert.deepEqual(worker.bytes,[...node.bytes]);assert.equal(worker.semanticDigest,node.semanticDigest);assert.equal(worker.byteDigest,node.byteDigest);
 const pins={semanticDigest:node.semanticDigest,byteDigest:node.byteDigest};assert.deepEqual((await ok('verify',{bytes:worker.bytes,pins})).bundle,golden.bundle);
 for(const expected of golden.proofs){const result=await ok('proof',{allocation:worker.manifest.allocations[0],wallet:expected.proof.award.wallet});assert.deepEqual(result.proof,expected.proof);assert.equal(result.verified,true);}
 assert.equal((await call('verify',{bytes:worker.bytes,pins:{semanticDigest:node.byteDigest,byteDigest:node.semanticDigest}})).status,409);
 const object={identity:worker.identity,bytes:worker.bytes},writes=await Promise.all(Array.from({length:6},()=>ok('put',object)));
 assert.equal(writes.filter(r=>r.status==='created').length,1);assert.equal(writes.filter(r=>r.status==='exists').length,5);
 assert.deepEqual((await ok('get',object)).bytes,worker.bytes);
 const newer=await ok('build',{input:{board:input.board,allocations:[]}}),lost={identity:newer.identity,bytes:newer.bytes};
 assert.equal((await ok('lost-put',lost)).status,'unknown');assert.equal((await ok('get',lost)).status,'verified');assert.equal((await ok('put',lost)).status,'exists');
 const bounded=await ok('bound',{size:MAX_PUBLIC_ARTIFACT_BYTES});assert.equal(bounded.put.status,'created');assert.equal(bounded.readSize,MAX_PUBLIC_ARTIFACT_BYTES);
 assert.equal((await ok('bound',{size:MAX_PUBLIC_ARTIFACT_BYTES})).put.status,'exists');assert.equal((await call('bound',{size:MAX_PUBLIC_ARTIFACT_BYTES+1})).status,409);
 const corrupt=new Uint8Array(worker.bytes);corrupt[0]^=1;await bucket.put(worker.identity.key,corrupt,{httpMetadata:{contentType:'application/json'}});
 assert.equal((await ok('get',object)).status,'conflict');assert.equal((await call('put',object)).status,409);
 assert.deepEqual([...new Uint8Array(await (await bucket.get(worker.identity.key)).arrayBuffer())],[...corrupt]);
 assert.equal(await db.prepare('SELECT COUNT(*) n FROM manifest_catalog').first('n'),0,'storage never publishes a catalog reference');
});
