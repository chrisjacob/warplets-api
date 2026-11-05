import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { openDatabase } from '../storage/database.mjs';
import { createNodeAtomicDriver } from '../storage/node/atomic-driver.mjs';
import { createArtifactReferenceRepository } from '../storage/atomic-artifacts.mjs';
import { createPrivateReferenceService } from './reference-service.mjs';
import { createNodeCrypto } from '../security/node-crypto.mjs';
const crypto=createNodeCrypto(),bytes=new TextEncoder().encode('synthetic-private-evidence');
async function identity(){const byteDigest=await crypto.sha256(bytes);return {key:'private/'+byteDigest+'.bin',byteDigest,size:bytes.length,semanticDigest:null,visibility:'private',contentType:'application/octet-stream'};}

test('private reference service rejects a valid public object identity before any store or repository call',async()=>{
 let called=false;const forbidden=async()=>{called=true;throw Error('Private reference crossed public boundary');};
 const service=createPrivateReferenceService({store:{putIfAbsent:forbidden,getVerified:forbidden},repository:{recordVerifiedReference:forbidden},crypto,clock:{nowMs:()=>100}});
 const base=await identity(),publicId={...base,key:'public/'+base.byteDigest+'.json',visibility:'public',contentType:'application/json'};
 await assert.rejects(service.persist({kind:'operator',id:'synthetic'},{identity:publicId,bytes,requestKey:'public-forbidden'}),/private artifact/);assert.equal(called,false);
});
test('private reference is committed only after exact readback and interrupted DB leaves a recoverable unlisted object',async t=>{
  const db=openDatabase();t.after(()=>db.close());
  db.exec("INSERT INTO app_operator_scopes VALUES('synthetic','evidence-ingest',0,1)");
  const stored=new Map(),store={async putIfAbsent(identity,bytes){stored.set(identity.key,bytes);return {status:'created',identity};},
    async getVerified(identity){return {status:'verified',identity,bytes:stored.get(identity.key)};}};
  const repository=createArtifactReferenceRepository(createNodeAtomicDriver(db),{crypto,ids:{next:randomUUID}});
  const service=createPrivateReferenceService({store,repository,crypto,clock:{nowMs:()=>100}}),principal={kind:'operator',id:'synthetic'};
  const input={identity:await identity(),bytes,requestKey:'private-fixture'};
  db.exec("CREATE TEMP TRIGGER fail_private_reference BEFORE INSERT ON app_private_artifacts BEGIN SELECT RAISE(ABORT,'reference interrupted'); END");
  await assert.rejects(service.persist(principal,input),/reference interrupted/);
  assert.equal(stored.size,1);assert.equal(db.prepare('SELECT COUNT(*) n FROM app_command_receipts').get().n,0);
  db.exec('DROP TRIGGER fail_private_reference');
  const accepted=await service.persist(principal,input);assert.equal(accepted.kind,'committed');
  assert.equal(accepted.value.verification,'exact-bytes');assert.equal(db.prepare('SELECT COUNT(*) n FROM manifest_catalog').get().n,0);
  const replay=await service.persist(principal,input);assert.equal(replay.kind,'replayed');assert.deepEqual(replay.value,accepted.value);
});
test('unknown write or conflicting readback cannot register a private reference',async()=>{
  let calls=0;const repository={recordVerifiedReference(){calls++;throw Error('unexpected');}};
  const principal={kind:'operator',id:'synthetic'},input={identity:await identity(),bytes,requestKey:'key'};
  for(const outcome of ['unknown','conflict']) {
    const store={async putIfAbsent(){return {status:outcome==='unknown'?'unknown':'exists'};},async getVerified(){return {status:'conflict'};}};
    const result=await createPrivateReferenceService({store,repository,crypto,clock:{nowMs:()=>100}}).persist(principal,input);
    assert.equal(result.kind,'pending');
  }
  assert.equal(calls,0);
});
