import test from 'node:test';
import assert from 'node:assert/strict';
import {createNodeCrypto} from '../security/node-crypto.mjs';
import {canonicalJson,utf8} from '../security/canonical.mjs';
import {privateIdentity} from '../artifacts/identity.mjs';
import {createVaultArchiveIndex,createVaultArchiveIndexStore,VAULT_ARCHIVE_INDEX_TABLES} from './archive-index.mjs';
import {archiveIndexFixture} from './archive-index.fixtures.mjs';
import {createVaultRecoveryReader} from './archive-index-reader.mjs';
const crypto=createNodeCrypto();
test('cached index nodes cannot be reused under a conflicting size identity',async()=>{
 const f=await archiveIndexFixture(crypto),reader=await createVaultRecoveryReader({rootBytes:f.root.bytes,rootDigest:f.root.digest},{crypto,store:f.store});
 await reader.lookup(reader.root.tables,'tables','vault_manifests');const pointer={...reader.root.tables,identity:{...reader.root.tables.identity,size:reader.root.tables.identity.size+1}};
 await assert.rejects(reader.lookup(pointer,'tables','vault_manifests'),/conflicting index identity/);
});
test('compact private index binds every required history descriptor and retries unknown writes',async()=>{
 const f=await archiveIndexFixture(crypto),service=createVaultArchiveIndexStore({crypto,store:f.store});f.setUnknown(true);const pending=await service.save(f.input);assert.equal(pending.kind,'pending');f.setUnknown(false);
 const saved=await service.save(f.input);assert.equal(saved.kind,'saved');assert.deepEqual(saved.pin,pending.pin);assert.equal(saved.index.visibility,'private');assert.equal(saved.index.fullRecoveryVerified,false);assert.equal(saved.index.currentOwnerVerified,false);assert.equal(saved.index.financialExecution,false);
 assert.deepEqual(saved.index.tables.map(t=>t.name),VAULT_ARCHIVE_INDEX_TABLES);assert.ok(saved.pin.identity.size<16384);assert.ok(saved.index.tables.every(t=>!Object.hasOwn(t,'rows')));
 const restored=await createVaultArchiveIndexStore({crypto,store:f.store}).restore(saved.pin);assert.deepEqual(restored.index,saved.index);assert.equal(restored.isAuthorization,false);
 let reads=0;const bad={...saved.pin.identity};Object.defineProperty(bad,'size',{get(){reads++;return saved.pin.identity.size;},enumerable:true});await assert.rejects(service.restore({...saved.pin,identity:bad}),/exact data/);assert.equal(reads,0);
});
test('omitted claim history, wrong scope and forged index coverage fail even with a new index digest',async()=>{
 const missing=await archiveIndexFixture(crypto,{omit:'vault_claim_totals'});await assert.rejects(createVaultArchiveIndex(missing.input,{crypto,store:missing.store}),/required table absent: vault_claim_totals/);
 const f=await archiveIndexFixture(crypto),service=createVaultArchiveIndexStore({crypto,store:f.store}),saved=await service.save(f.input);
 await assert.rejects(service.restore({...saved.pin,rootDigest:'c'.repeat(64)}),/scope mismatch/);await assert.rejects(service.restore({...saved.pin,liabilityDigest:'d'.repeat(64)}),/scope mismatch/);
 const changed=JSON.parse(canonicalJson(saved.index));changed.tables=changed.tables.filter(t=>t.name!=='vault_claim_totals');const bytes=utf8(canonicalJson(changed)),digest=await crypto.sha256(bytes),i=privateIdentity({key:'private/'+digest+'.json',byteDigest:digest,size:bytes.length,semanticDigest:null,visibility:'private',contentType:'application/json'});f.objects.set(i.key,bytes);
 await assert.rejects(service.restore({...saved.pin,identity:i}),/coverage or derived descriptor/);
 const bad=Uint8Array.from(f.objects.get(saved.pin.identity.key));bad[0]^=1;f.objects.set(saved.pin.identity.key,bad);await assert.rejects(service.restore(saved.pin),/byte mismatch/);
});
test('liability must match the selected source root and exact original market snapshot',async()=>{
 const f=await archiveIndexFixture(crypto);await assert.rejects(createVaultArchiveIndex({...f.input,rootDigest:'e'.repeat(64)},{crypto,store:f.store}),/liability root scope/);
 const changed=JSON.parse(new TextDecoder().decode(f.input.liabilityBytes));changed.marketId='other';const bytes=utf8(canonicalJson(changed));await assert.rejects(createVaultArchiveIndex({...f.input,liabilityBytes:bytes,liabilityDigest:await crypto.sha256(bytes)},{crypto,store:f.store}),/market absent/);
 let reads=0;const getter={...f.input};Object.defineProperty(getter,'rootBytes',{get(){reads++;return f.input.rootBytes;},enumerable:true});await assert.rejects(createVaultArchiveIndex(getter,{crypto,store:f.store}),/exact data/);assert.equal(reads,0);
});
