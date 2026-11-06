import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {nodeArtifactStore} from '../artifacts/node.mjs';
import {createNodeCrypto} from '../security/node-crypto.mjs';
import {metadataFromCollect} from './metadata-schema.mjs';
import {createRefreshWorkflow} from './refresh-workflow.mjs';
import {createRefreshCheckpoints} from './refresh-checkpoint.mjs';
const crypto=createNodeCrypto(),owner='11111111111111111111111111111111',at=Date.UTC(2026,10,7);
async function fixture(){
 const metadata=metadataFromCollect({inventory:{id:'genesis-1',kind:'genesis',tranche:1,season_start:null},row:{id:'asset-1',inventory_id:'genesis-1',owner,asset:JSON.stringify({id:'asset-1',owner,level:1,traits:{model:'Original',backdrop:'Night',symbol:'X'},version:0,rerolls:0,eligibleAt:0,pending:null,expiresAt:null}),slot:JSON.stringify({kind:'genesis',tranche:1,level:1,ordinal:0}),bind_ms:at,reveal_ms:at,observed_ms:at}});
 const workflow=createRefreshWorkflow({crypto});let state=await workflow.create({requestId:'refresh-1',metadata,owner,expectedVersion:0,referenceDigest:'1'.repeat(64),quoteDigest:'2'.repeat(64),createdMs:at});
 const event={eventId:'reference',kind:'validate-reference',atMs:at+1,principal:{kind:'operator',id:'fixture-reviewer'},input:{referenceDigest:'1'.repeat(64),recordingDigest:'3'.repeat(64),provenance:'recorded-synthetic-fixture'}};
 state=(await workflow.advance(state,event,metadata)).state;
 return {state,metadata,event};
}
async function disk(t){const root=await mkdtemp(join(tmpdir(),'10x-refresh-'));t.after(()=>rm(root,{recursive:true,force:true}));return {root,store:nodeArtifactStore(root)};}
test('private checkpoint survives new store/workflow instances and preserves same-event retry',async t=>{
 const {root,store}=await disk(t),{state,metadata,event}=await fixture(),service=createRefreshCheckpoints({crypto,store});
 const saved=await service.save(state);assert.equal(saved.kind,'saved');assert.equal(saved.pin.identity.visibility,'private');assert.ok(saved.pin.identity.size<32768);assert.equal(saved.isAuthorization,false);
 const restored=await createRefreshCheckpoints({crypto,store:nodeArtifactStore(root)}).restore(JSON.parse(JSON.stringify(saved.pin)));
 assert.deepEqual(restored.state,state);assert.equal(restored.authority,'unverified-rehearsal');assert.equal((await createRefreshWorkflow({crypto}).advance(restored.state,event,metadata)).replay,true);
 assert.deepEqual((await service.save(state)).pin,saved.pin);
 const bytes=await readFile(join(root,saved.pin.identity.key));assert.equal(bytes.length,saved.pin.identity.size);
});
test('unknown writes reconcile only exact readback; missing writes retain the same pin for retry',async t=>{
 const {store}=await disk(t),{state}=await fixture();let written=false;
 const uncertain={async putIfAbsent(identity,bytes){if(written)await store.putIfAbsent(identity,bytes);return {status:'unknown',identity};},getVerified:identity=>store.getVerified(identity)};
 const service=createRefreshCheckpoints({crypto,store:uncertain}),first=await service.save(state);assert.equal(first.kind,'pending');assert.equal(first.reason,'refresh-checkpoint-missing');
 written=true;const second=await service.save(state);assert.equal(second.kind,'saved');assert.deepEqual(second.pin,first.pin);
});
test('tampered bytes, substituted pins and validly hashed fabricated history cannot restore',async t=>{
 const {root,store}=await disk(t),{state}=await fixture(),service=createRefreshCheckpoints({crypto,store}),saved=await service.save(state);
 const pin=JSON.parse(JSON.stringify(saved.pin));pin.requestDigest='9'.repeat(64);await assert.rejects(service.restore(pin),/state binding/);
 const publicPin=JSON.parse(JSON.stringify(saved.pin));publicPin.identity.visibility='public';await assert.rejects(service.restore(publicPin),/private/);
 const changed=JSON.parse(JSON.stringify(state));changed.history[0].outcome.requestState='fulfilled';await assert.rejects(service.save(changed),/history-conflict/);
 const path=join(root,saved.pin.identity.key),bytes=await readFile(path);bytes[bytes.length-2]^=1;await writeFile(path,bytes);assert.equal((await service.restore(saved.pin)).kind,'pending');
 const liar=createRefreshCheckpoints({crypto,store:{getVerified:async identity=>({status:'verified',identity,bytes}),putIfAbsent:store.putIfAbsent}});await assert.rejects(liar.restore(saved.pin),/byte digest/);
});
test('captures state and pin before await; rejects getters and oversized identities without reads',async t=>{
 const {store}=await disk(t),{state}=await fixture();let entered,release;const gate=new Promise(r=>release=r),started=new Promise(r=>entered=r);let blocked=true;
 const slow={...crypto,async sha256(bytes){if(blocked){blocked=false;entered();await gate;}return crypto.sha256(bytes);}};
 const mutable=JSON.parse(JSON.stringify(state)),saving=createRefreshCheckpoints({crypto:slow,store}).save(mutable);await started;mutable.request.owner='changed';release();const saved=await saving;assert.equal(saved.state.request.owner,owner);
 let reads=0;const guarded=createRefreshCheckpoints({crypto,store:{getVerified(){reads++;throw Error('unexpected read');}}});
 const pin=JSON.parse(JSON.stringify(saved.pin));pin.identity.size=32769;await assert.rejects(guarded.restore(pin),/pin binding/);
 let calls=0;Object.defineProperty(pin,'identity',{get(){calls++;return saved.pin.identity;}});await assert.rejects(guarded.restore(pin),/pin fields/);assert.equal(calls,0);assert.equal(reads,0);
});
