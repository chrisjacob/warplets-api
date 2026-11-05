import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createNodeCrypto} from '../security/node-crypto.mjs';
import {canonicalJson,utf8} from '../security/canonical.mjs';
import {openDatabase} from '../storage/database.mjs';
import {createNodeAtomicDriver} from '../storage/node/atomic-driver.mjs';
import {createArtifactReferenceRepository} from '../storage/atomic-artifacts.mjs';
import {createEvidenceRepository} from './repository.mjs';
import {createEvidenceService} from './service.mjs';
import {evidenceFixture} from './fixtures.mjs';
import {validateEnvelope,streamKey} from './envelope.mjs';
import {preparePrivateArtifact,verifiedBytes} from '../artifacts/identity.mjs';
const crypto=createNodeCrypto(),principal={kind:'operator',id:'fixture-reader'},now=100000;
const vector=JSON.parse(readFileSync(new URL('../quotes/fixtures/sdk-vectors.json',import.meta.url),'utf8'));
const account={...vector.attMint,address:'fixture-mint'};
async function setup(t,fixture,overrides={}){
 const db=openDatabase();t.after(()=>db.close());db.prepare('INSERT INTO app_operator_scopes VALUES(?,?,0,1)').run(principal.id,'evidence-ingest');
 const objects=new Map(),store={async putIfAbsent(i,b){const {identity,bytes}=await preparePrivateArtifact(i,b);const exists=objects.has(i.key);if(!exists)objects.set(i.key,bytes);await verifiedBytes(identity,objects.get(i.key));return {status:exists?'exists':'created'};},async getVerified(i){return objects.has(i.key)?verifiedBytes(i,objects.get(i.key)):{status:'missing',identity:i};}};
 let time=now,counter=0;const ports={crypto:overrides.crypto??crypto,ids:{next:()=>String(++counter)},clock:{nowMs:()=>time}},driver=createNodeAtomicDriver(db);
 const repository=createEvidenceRepository(driver,ports),artifactRepository=createArtifactReferenceRepository(driver,ports);
 const service=createEvidenceService({repository,artifactRepository,store:overrides.store??store,...ports,readers:fixture.readers});
 assert.equal((await service.registerSource(principal,fixture.source)).kind,'committed');
 return {db,repository,service,objects,clock:value=>time=value};
}
test('recorded adapter pins byte provenance and private receipt is replayable across clock changes',async t=>{
 const f=await evidenceFixture({crypto,payload:account}),env=await setup(t,f);
 const first=await env.service.ingest(principal,f.request);assert.equal(first.kind,'committed');assert.equal(first.value.decision.status,'verified');
 assert.equal(first.value.decision.scope,'decoder-only');assert.equal(first.value.decision.coverage.complete,false);
 assert.equal(first.value.envelope.mode,'synthetic-fixture');env.clock(now+500);
 const replay=await env.service.ingest(principal,f.request);assert.equal(replay.kind,'replayed');assert.deepEqual(replay.value,first.value);
 assert.equal(env.objects.size,1);assert.equal(env.db.prepare('SELECT COUNT(*) n FROM app_evidence_receipts').get().n,1);assert.equal(f.reader.counters().providerAttempts,0);
 assert.throws(()=>env.db.prepare("UPDATE app_evidence_receipts SET status='pending'").run(),/immutable/);
 assert.throws(()=>env.db.prepare("DELETE FROM app_evidence_sources").run(),/immutable/);
 const bad={...first.value.envelope,retrievedAtMs:now+1,ingestedAtMs:now};assert.equal(validateEnvelope(bad).retrievedAtMs,now+1,'clock violations retain original time for a negative receipt');
});
test('newer pending correction masks old good result and competing correction cannot replace the head',async t=>{
 const subject={kind:'mint',id:'fixture-mint'},record=(id,payload)=>({id,subject,contextSlot:'10',blockTimeMs:now,retrievedAtMs:now,finality:'finalized',bytes:utf8(canonicalJson(payload))});
 const f=await evidenceFixture({crypto,payload:account,subject,records:[record('good',account),record('missing',null),record('competing',account)]}),env=await setup(t,f);
 const good=await env.service.ingest(principal,f.request);env.clock(now+1);
 const pending=await env.service.ingest(principal,{...f.request,recordId:'missing',supersedes:good.value.receiptDigest});assert.equal(pending.value.decision.status,'pending');
 const key=streamKey(good.value.envelope);assert.equal((await env.repository.selectHead(key)).decision.status,'pending');
 const conflict=await env.service.ingest(principal,{...f.request,recordId:'competing',supersedes:good.value.receiptDigest});assert.equal(conflict.kind,'conflict');assert.equal(conflict.code,'evidence_head_changed');
 assert.equal(env.db.prepare('SELECT COUNT(*) n FROM app_evidence_receipts').get().n,2);
});
test('wrong owners/layouts, missing clocks and decoder drift retain explicit negative receipts',async t=>{
 for(const [patch,expected] of [[{payload:{...account,owner:'wrong'}},'incompatible'],[{payload:{...account,data:'AA=='}},'invalid'],[{decoderVersion:'unknown-v2'},'incompatible'],
  [{records:[{id:'first',subject:{kind:'mint',id:'fixture-mint'},contextSlot:null,blockTimeMs:null,retrievedAtMs:now,finality:'finalized',bytes:utf8(canonicalJson(account))}]},'pending']]){
  const f=await evidenceFixture({crypto,payload:account,...patch}),env=await setup(t,f);const result=await env.service.ingest(principal,f.request);assert.equal(result.value.decision.status,expected);
 }
});
test('recorded public captures never claim complete historical coverage or accept caller mode upgrades',async t=>{
 const f=await evidenceFixture({crypto,payload:account,mode:'recorded-public',chainGenesis:'fixture-public-genesis'}),env=await setup(t,f);
 const result=await env.service.ingest(principal,f.request);assert.equal(result.value.envelope.mode,'recorded-public');assert.equal(result.value.decision.coverage.complete,false);
 const forged={...f.reader,mode:'synthetic-fixture'};f.readers.set(canonicalJson(['fixture-source','v1']),forged);
 await assert.rejects(env.service.ingest(principal,{...f.request,requestedCutoffMs:now+1}),/provenance/);
});

test('bad byte digests reject before persistence and mutable reader results are captured before hashing',async t=>{
 const f=await evidenceFixture({crypto,payload:account}),original=f.reader;
 let returned,mutate=false;
 const mutable={...original,async read(id){returned=await original.read(id);return returned;}};
 f.readers.set(canonicalJson(['fixture-source','v1']),mutable);
 const delayed={...crypto,async sha256(bytes){if(mutate&&returned){returned.finality='unverified';returned.contextSlot='999';returned.bytes[0]^=1;mutate=false;}return crypto.sha256(bytes);}};
 const env=await setup(t,f,{crypto:delayed});mutate=true;
 const accepted=await env.service.ingest(principal,f.request);assert.equal(accepted.value.envelope.finality,'finalized');assert.equal(accepted.value.envelope.contextSlot,'10');assert.equal(accepted.value.decision.status,'verified');
 f.readers.set(canonicalJson(['fixture-source','v1']),{...original,async read(id){const row=await original.read(id);row.bytes[0]^=1;return row;}});
 await assert.rejects(env.service.ingest(principal,{...f.request,requestedCutoffMs:now+1}),/byte-digest/);assert.equal(env.db.prepare('SELECT COUNT(*) n FROM app_evidence_receipts').get().n,1);
});
test('future retrieval and absent/future cutoff times become negative receipts without timestamp rewriting',async t=>{
 const subject={kind:'mint',id:'fixture-mint'};
 const records=[{id:'future',subject,contextSlot:'10',blockTimeMs:now,retrievedAtMs:now+500,finality:'finalized',bytes:utf8(canonicalJson(account))}];
 const f=await evidenceFixture({crypto,payload:account,records}),env=await setup(t,f);
 const result=await env.service.ingest(principal,f.request);assert.equal(result.value.decision.status,'invalid');assert.equal(result.value.decision.reason,'future-recording-clock');assert.equal(result.value.envelope.retrievedAtMs,now+500);
 const other=await evidenceFixture({crypto,payload:account}),next=await setup(t,other);
 const future=await next.service.ingest(principal,{...other.request,requestedCutoffMs:now+1});assert.equal(future.value.decision.reason,'cutoff-not-reached');
});
test('private Node filesystem integration recovers an unlisted stored object and keeps bytes out of the public catalog',async t=>{
 const {mkdtemp,rm}=await import('node:fs/promises'),{tmpdir}=await import('node:os'),{join}=await import('node:path');
 const {nodeArtifactStore}=await import('../artifacts/node.mjs');
 const root=await mkdtemp(join(tmpdir(),'tenx-evidence-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const store=nodeArtifactStore(root),f=await evidenceFixture({crypto,payload:account}),record=await f.reader.read('first');
 const identity={key:'private/'+record.byteDigest+'.json',byteDigest:record.byteDigest,size:record.bytes.length,semanticDigest:null,visibility:'private',contentType:'application/json'};
 assert.equal((await store.putIfAbsent(identity,record.bytes)).status,'created');
 const env=await setup(t,f,{store});const result=await env.service.ingest(principal,f.request);assert.equal(result.kind,'committed');
 assert.equal((await store.getVerified(identity)).status,'verified');
 assert.equal(env.db.prepare('SELECT COUNT(*) n FROM app_private_artifacts').get().n,1);
 assert.equal(env.db.prepare('SELECT COUNT(*) n FROM manifest_catalog').get().n,0);
});

test('source revisions cannot drift and revoked ingestion authority leaves no evidence decision',async t=>{
 const f=await evidenceFixture({crypto,payload:account}),env=await setup(t,f);
 const changed=await env.service.registerSource(principal,{...f.source,maxAgeMs:1});assert.equal(changed.code,'source_revision_exists');
 env.db.prepare("UPDATE app_operator_scopes SET enabled=0 WHERE operator=?").run(principal.id);
 const denied=await env.service.ingest(principal,f.request);assert.equal(denied.code,'operator_scope_required');
 assert.equal(env.db.prepare('SELECT COUNT(*) n FROM app_evidence_receipts').get().n,0);
});
test('unknown object write remains pending and no provenance receipt invents success',async t=>{
 const f=await evidenceFixture({crypto,payload:account});
 const store={async putIfAbsent(identity){return {status:'unknown',identity};},async getVerified(){throw Error('must not read after unknown write');}};
 const env=await setup(t,f,{store}),result=await env.service.ingest(principal,f.request);assert.equal(result.kind,'pending');assert.equal(result.reason,'artifact-write-unknown');
 assert.equal(env.db.prepare('SELECT COUNT(*) n FROM app_evidence_receipts').get().n,0);
});
test('reader bounds and constructor snapshot prevent mutable catalogs from changing pinned evidence',async()=>{
 const {createRecordedReader}=await import('./recorded.mjs');
 const subject={kind:'mint',id:'fixture-mint'},bytes=utf8(canonicalJson(account));
 const entries=[{id:'first',subject,contextSlot:'10',blockTimeMs:now,retrievedAtMs:now,finality:'finalized',bytes},
  {id:'second',subject:{...subject},contextSlot:'11',blockTimeMs:now,retrievedAtMs:now,finality:'finalized',bytes:bytes.slice()}];
 let changed=false;const delayed={...crypto,async sha256(value){if(!changed){changed=true;entries[1].contextSlot='999';entries[1].bytes[0]^=1;}return crypto.sha256(value);}};
 const reader=await createRecordedReader({mode:'synthetic-fixture',chainGenesis:null,records:entries,crypto:delayed});
 assert.equal((await reader.read('second')).contextSlot,'11');assert.deepEqual((await reader.read('second')).bytes,bytes);
 await assert.rejects(createRecordedReader({mode:'synthetic-fixture',chainGenesis:null,records:Array(101).fill(entries[0]),crypto}),/recording-bound/);
 await assert.rejects(createRecordedReader({mode:'synthetic-fixture',chainGenesis:null,records:[{...entries[0],bytes:new Uint8Array(262145)}],crypto}),/recording-bytes/);
});

test('accepted replay survives unavailable recording adapter and revoked ingestion scope',async t=>{
 const f=await evidenceFixture({crypto,payload:account}),env=await setup(t,f),accepted=await env.service.ingest(principal,f.request);
 env.db.prepare("UPDATE app_operator_scopes SET enabled=0 WHERE operator=?").run(principal.id);
 f.readers.clear();env.clock(now+999);
 assert.deepEqual((await env.service.ingest(principal,f.request)).value,accepted.value);
 f.readers.set(canonicalJson(['fixture-source','v1']),{...f.reader,async read(){throw Error('recording offline');}});
 assert.deepEqual((await env.service.ingest(principal,f.request)).value,accepted.value);
 assert.equal(f.reader.counters().localReads,1);
});
