import test from 'node:test';
import assert from 'node:assert/strict';
import {createNodeCrypto} from '../security/node-crypto.mjs';
import {canonicalJson,utf8} from '../security/canonical.mjs';
import {createVaultLiabilityArchive} from './archive.mjs';
const crypto=createNodeCrypto();
const bytes=()=>utf8(canonicalJson({marketId:'synthetic-vault',activatedMs:Date.UTC(2026,10,1),originalUnits:'402600000',inventoryCommitment:'a'.repeat(64),seasons:[]}));
function fixture(){const objects=new Map();let unknown=false;return {objects,setUnknown:v=>unknown=v,store:{async putIfAbsent(i,b){const exists=objects.has(i.key);if(!exists)objects.set(i.key,Uint8Array.from(b));return {status:unknown?'unknown':exists?'exists':'created'};},async getVerified(i){return objects.has(i.key)?{status:'verified',bytes:objects.get(i.key)}:{status:'missing'};}}};}

test('private liability archive retries the same immutable bytes after an unknown write acknowledgement',async()=>{
 const f=fixture(),archive=createVaultLiabilityArchive({crypto,store:f.store});f.setUnknown(true);
 const pending=await archive.save(bytes());assert.equal(pending.kind,'pending');assert.equal(pending.reason,'vault-liability-write-unknown');assert.equal(f.objects.size,1);
 f.setUnknown(false);const saved=await archive.save(bytes());assert.equal(saved.kind,'saved');assert.deepEqual(saved.pin,pending.pin);assert.equal(f.objects.size,1);
 const restored=await createVaultLiabilityArchive({crypto,store:f.store}).restore(saved.pin);
 assert.equal(restored.kind,'restored');assert.equal(restored.scope,'liability-component-only');assert.equal(restored.isAuthorization,false);assert.equal(restored.manifest.claimHistoryIncluded,false);assert.equal(restored.pin.identity.visibility,'private');
});

test('independent digest and scope pins reject lying reads and changed inventory identity',async()=>{
 const f=fixture(),archive=createVaultLiabilityArchive({crypto,store:f.store}),saved=await archive.save(bytes());
 await assert.rejects(archive.restore({...saved.pin,inventoryCommitment:'b'.repeat(64)}),/scope pin/);
 await assert.rejects(archive.restore({...saved.pin,marketId:'other'}),/scope pin/);
 const original=f.objects.get(saved.pin.identity.key),changed=Uint8Array.from(original);changed[changed.length-2]^=1;f.objects.set(saved.pin.identity.key,changed);
 await assert.rejects(archive.restore(saved.pin));
 f.objects.delete(saved.pin.identity.key);assert.equal((await archive.restore(saved.pin)).reason,'vault-liability-object-missing');
});
