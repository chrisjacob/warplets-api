import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createManifestCodec} from './manifest-codec.mjs';
import {createNodeCrypto} from '../security/node-crypto.mjs';
import {canonicalJson,utf8} from '../security/canonical.mjs';
import {commitment,makeAwardProof,verifyAwardProof} from '../earn/commitments.mjs';
import {computeAllocation} from '../earn/settlement.mjs';
import {openDatabase} from '../storage/database.mjs';
import {buildGoldenScenario} from '../application/fixtures/earn-scenario.mjs';
import {MAX_PUBLIC_ARTIFACT_BYTES} from './identity.mjs';
const crypto=createNodeCrypto(),codec=createManifestCodec({crypto}),clone=value=>JSON.parse(JSON.stringify(value));
const golden=JSON.parse(readFileSync(new URL('../application/fixtures/earn-golden.json',import.meta.url)));
function source(count=3){
 const epoch=20,start=epoch*86400000,board={epoch,finalizedAtMs:start+86400000,snapshotId:'a'.repeat(64),winners:Array.from({length:count},(_,i)=>({
  userId:'wallet-'+i,wallet:'wallet-'+i,submissionId:'post-'+i,tokenId:'A',submittedAtMs:start+i,contentScore:7,multiplierTenths:1,pointsTenths:7}))};
 const plan=computeAllocation({tokenId:'A',day:2,activationMs:start,originalSupplyUnits:'1000000',nowMs:board.finalizedAtMs,board:{...board,status:'final'}});
 const {tokenId,day,startsAtMs,vestsFromMs,vestsThroughMs,budgetUnits,burnUnits,awards}=plan;
 return {board,allocations:[{tokenId,day,activationMs:start,originalUnits:'1000000',startsAtMs,vestsFromMs,vestsThroughMs,budgetUnits,burnUnits,awards}]};
}
async function bytesFor(manifest){const semanticDigest=commitment('manifest',manifest),bytes=utf8(canonicalJson({sha256:semanticDigest,manifest}));return {bytes,semanticDigest,byteDigest:await crypto.sha256(bytes)};}

test('portable codec preserves independently pinned legacy bundle, allocation commitment and every odd-tree proof byte',async t=>{
 const db=openDatabase();t.after(()=>db.close());const scenario=await buildGoldenScenario(db);
 assert.deepEqual(scenario.bundle,golden.bundle);
 const result=await codec.build({board:scenario.bundle.manifest.board,allocations:scenario.bundle.manifest.allocations});
 assert.deepEqual(result.bundle,golden.bundle);assert.equal(result.semanticDigest,golden.bundle.sha256);
 assert.deepEqual(result.bytes,utf8(canonicalJson(golden.bundle)));assert.notEqual(result.byteDigest,result.semanticDigest);
 assert.equal(result.identity.key,'public/'+result.byteDigest+'.json');assert.equal(result.identity.semanticDigest,result.semanticDigest);
 assert.equal(await codec.allocationDigest(result.manifest.allocations[0]),golden.allocationDigest);
 for(const expected of golden.proofs){
  const proof=await codec.proof(result.manifest.allocations[0],expected.proof.award.wallet);assert.deepEqual(proof,expected.proof);
  assert.equal(await codec.verifyProof(proof,proof.root),true);assert.equal(verifyAwardProof(proof,proof.root),true);
 }
 assert.deepEqual((await codec.verify(result.bytes,{semanticDigest:result.semanticDigest,byteDigest:result.byteDigest})).bundle,result.bundle);
});

test('builder allowlist excludes private fields while verifier rejects injected fields even with recomputed outer commitments',async()=>{
 const input=source();input.session='private-canary';input.board.url='private-canary';input.board.winners[0].moderation='private-canary';
 input.allocations[0].sourceObject='private-canary';input.allocations[0].awards[0].session='private-canary';
 const result=await codec.build(input);assert.ok(!new TextDecoder().decode(result.bytes).includes('private-canary'));
 for(const mutate of [m=>m.privateNote='private-canary',m=>m.board.url='private-canary',m=>m.board.winners[0].reason='private-canary',
  m=>m.allocations[0].source='private-canary',m=>m.allocations[0].awards[0].session='private-canary']){
  const manifest=clone(result.manifest);mutate(manifest);const tampered=await bytesFor(manifest);
  await assert.rejects(codec.verify(tampered.bytes,tampered));
 }
 const bundle={...result.bundle,privateNote:'private-canary'},bytes=utf8(canonicalJson(bundle));
 await assert.rejects(codec.verify(bytes,{semanticDigest:result.semanticDigest}),/bundle fields/);
});

test('zero, single, odd and maximum winner trees preserve legacy roots and proofs',async()=>{
 for(const count of [0,1,3,100]){
  const result=await codec.build(source(count)),allocation=result.manifest.allocations[0];
  assert.equal((await codec.verify(result.bytes,{semanticDigest:result.semanticDigest})).verification.allocations,1);
  assert.equal(await codec.proof(allocation,'absent'),null);
  for(const award of allocation.awards){
   const proof=await codec.proof(allocation,award.wallet);assert.deepEqual(proof,makeAwardProof(allocation,award.wallet));assert.equal(await codec.verifyProof(proof,allocation.awardRoot),true);
  }
 }
});

test('public semantic and byte pins are distinct, and altered amounts, burn or dates cannot pass semantic reconciliation',async()=>{
 const result=await codec.build(source());
 await assert.rejects(codec.verify(result.bytes,{semanticDigest:result.byteDigest}),/semantic digest/);
 await assert.rejects(codec.verify(result.bytes,{semanticDigest:result.semanticDigest,byteDigest:result.semanticDigest}),/byte digest/);
 for(const mutate of [m=>m.allocations[0].awards[0].amountUnits='9',m=>m.allocations[0].burnUnits='1',m=>m.allocations[0].vestsThroughMs++,
  m=>m.board.winners.reverse(),m=>m.allocations[0].originalUnits='100']){
  const manifest=clone(result.manifest);mutate(manifest);const tampered=await bytesFor(manifest);await assert.rejects(codec.verify(tampered.bytes,tampered));
 }
 const proof=clone(await codec.proof(result.manifest.allocations[0],'wallet-0'));proof.award.amountUnits='9';assert.equal(await codec.verifyProof(proof,proof.root),false);
 proof.privateNote='private-canary';await assert.rejects(codec.verifyProof(proof,proof.root),/proof fields/);
});

test('canonical encoding and2MiB byte bound are enforced before publication',async()=>{
 const result=await codec.build(source());
 await assert.rejects(codec.verify(utf8(JSON.stringify(result.bundle,null,2)),{semanticDigest:result.semanticDigest}),/canonical/);
 const duplicate=utf8(new TextDecoder().decode(result.bytes).replace('"sha256":','"extra":0,"extra":0,"sha256":'));
 await assert.rejects(codec.verify(duplicate,{semanticDigest:result.semanticDigest}),/bundle fields/);
 await assert.rejects(codec.verify(new Uint8Array(MAX_PUBLIC_ARTIFACT_BYTES+1),{semanticDigest:result.semanticDigest}),/2MiB/);
 let hashes=0;const input=source();input.board.winners[0].wallet='x'.repeat(MAX_PUBLIC_ARTIFACT_BYTES);
 await assert.rejects(createManifestCodec({crypto:{...crypto,async sha256(bytes){hashes++;return crypto.sha256(bytes);}}}).build(input),/2MiB/);assert.equal(hashes,0);
});

test('async codec snapshots caller projections, bytes and independent pins before hashing',async()=>{
 const input=source(),expected=await codec.build(input);let fired=false;
 const racing=createManifestCodec({crypto:{...crypto,async sha256(bytes){if(!fired){fired=true;input.board.winners[0].wallet='changed';input.allocations[0].awards[0].amountUnits='1';}return crypto.sha256(bytes);}}});
 assert.deepEqual((await racing.build(input)).bundle,expected.bundle);
 const bytes=new Uint8Array(expected.bytes),pins={semanticDigest:expected.semanticDigest,byteDigest:expected.byteDigest};fired=false;
 const verifier=createManifestCodec({crypto:{...crypto,async sha256(value){if(!fired){fired=true;bytes.fill(0);pins.semanticDigest='0'.repeat(64);}return crypto.sha256(value);}}});
 assert.deepEqual((await verifier.verify(bytes,pins)).bundle,expected.bundle);
 assert.equal(Object.isFrozen(expected.manifest.allocations[0].awards[0]),true);
});
