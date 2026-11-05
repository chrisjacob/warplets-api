import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp,readFile,writeFile,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { nodeArtifactStore } from './node.mjs';
import { sha256,MAX_PRIVATE_ARTIFACT_BYTES } from './identity.mjs';

async function fixture(t,text='{"fixture":"private-evidence"}'){
 const root=await mkdtemp(join(tmpdir(),'10x-private-artifact-'));
 t.after(()=>rm(root,{recursive:true,force:true}));
 const bytes=new TextEncoder().encode(text),byteDigest=await sha256(bytes);
 const identity={key:'private/'+byteDigest+'.json',byteDigest,size:bytes.length,semanticDigest:null,visibility:'private',contentType:'application/json'};
 return {root,bytes,identity,store:nodeArtifactStore(root)};
}
test('Node private store creates raw bytes once, verifies replay and recovers unlisted objects after restart',async t=>{
 const {root,bytes,identity,store}=await fixture(t);
 assert.equal((await store.getVerified(identity)).status,'missing');
 assert.equal((await store.putIfAbsent(identity,bytes)).status,'created');
 assert.deepEqual(new Uint8Array(await readFile(join(root,identity.key))),bytes);
 assert.equal((await store.putIfAbsent(identity,bytes)).status,'exists');
 const restarted=nodeArtifactStore(root);
 assert.deepEqual((await restarted.getVerified(identity)).bytes,bytes);
 assert.equal((await restarted.putIfAbsent(identity,bytes)).status,'exists');
});
test('Node concurrent same-key creation is one created object and verified identical replays',async t=>{
 const {root,bytes,identity,store}=await fixture(t);
 const results=await Promise.all(Array.from({length:8},()=>store.putIfAbsent(identity,bytes)));
 assert.equal(results.filter(result=>result.status==='created').length,1);
 assert.equal(results.filter(result=>result.status==='exists').length,7);
 assert.deepEqual(new Uint8Array(await readFile(join(root,identity.key))),bytes);
});
test('Node refuses malformed identity, oversized input and mismatched bytes before publication',async t=>{
 const {bytes,identity,store}=await fixture(t);
 for(const bad of [{...identity,key:'../escape'},{...identity,key:'public/'+identity.byteDigest+'.json',visibility:'public'},
   {...identity,size:identity.size+1},{...identity,size:MAX_PRIVATE_ARTIFACT_BYTES+1},{...identity,semanticDigest:'not-a-digest'},
   {...identity,byteDigest:'a'.repeat(64)}])await assert.rejects(store.putIfAbsent(bad,bytes),TypeError);
 const changed=new Uint8Array(bytes);changed[0]^=1;
 await assert.rejects(store.putIfAbsent(identity,changed),/digest mismatch/);
 assert.equal((await store.getVerified(identity)).status,'missing');
});
test('Node preserves a colliding or truncated immutable file and never reports successful replay',async t=>{
 const {root,bytes,identity,store}=await fixture(t);
 await store.putIfAbsent(identity,bytes);
 const corrupt=new Uint8Array(bytes);corrupt[0]^=1;
 await writeFile(join(root,identity.key),corrupt); // deliberate external-corruption fixture
 assert.equal((await store.getVerified(identity)).status,'conflict');
 await assert.rejects(store.putIfAbsent(identity,bytes),{code:'artifact_conflict'});
 assert.deepEqual(new Uint8Array(await readFile(join(root,identity.key))),corrupt);
 await writeFile(join(root,identity.key),bytes.slice(0,1));
 assert.equal((await store.getVerified(identity)).status,'conflict');
 await assert.rejects(store.putIfAbsent(identity,bytes),{code:'artifact_conflict'});
});
test('Node snapshots caller-owned input before asynchronous hashing or storage',async t=>{
 const {bytes,identity,store}=await fixture(t);
 const original=new Uint8Array(bytes),promise=store.putIfAbsent(identity,bytes);
 bytes.fill(0);identity.key='private/'+'0'.repeat(64)+'.json';
 const result=await promise;
 assert.equal(result.status,'created');
 assert.deepEqual((await store.getVerified(result.identity)).bytes,original);
 assert.equal(Object.isFrozen(result.identity),true);
});

test('Node supports empty and maximum-sized bounded binary artifacts',async t=>{
 const {store}=await fixture(t);
 for(const size of [0,MAX_PRIVATE_ARTIFACT_BYTES]){
  const bytes=new Uint8Array(size),byteDigest=await sha256(bytes);
  const identity={key:'private/'+byteDigest+'.bin',byteDigest,size,semanticDigest:'a'.repeat(64),visibility:'private',contentType:'application/octet-stream'};
  assert.equal((await store.putIfAbsent(identity,bytes)).status,'created');
  assert.deepEqual((await store.getVerified(identity)).bytes,bytes);
 }
});
