import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createLegacyStateAudit} from './legacy-state-audit.mjs';
import {createCollectionStateCodec} from './state-codec.mjs';
import {validateLegacyAuditHashState} from './legacy-audit-hash.mjs';
import {canonicalJson,utf8} from '../security/canonical.mjs';
import {nativeTranscriptFixture,canonicalStateFixture,stateBundle,changedRecord,runStateAudit,legacyStateTestCrypto as crypto} from './legacy-state-audit.fixtures.mjs';
const normalized=v=>JSON.parse(JSON.stringify(v,(_k,x)=>typeof x==='bigint'?{$lamports:x.toString()}:x));
function service(records,hash=nativeTranscriptFixture()){return createLegacyStateAudit({crypto,hash,readRecord:async id=>records.get(id)??null});}
test('bounded canonical transcript matches exact offline035 projection while raw JSON order has a different identity',async()=>{
 const state=canonicalStateFixture(),{bundle,records}=await stateBundle(state),hash=nativeTranscriptFixture({trace:true}),runner=service(records,hash);let last;
 const result=await runStateAudit(runner,bundle.root.id,{onStep:r=>{if(r.kind==='continue')last=r.checkpoint;}}),canonical=canonicalJson(normalized(state));assert.equal(result.result.kind,'verified',JSON.stringify(result));assert.equal(hash.text(last.mainHash),canonical);assert.equal(result.result.stateDigest,createHash('sha256').update(canonical).digest('hex'));assert.notEqual(createHash('sha256').update(JSON.stringify(normalized(state))).digest('hex'),result.result.stateDigest);
 assert.equal(result.result.rawSourceRelationVerified,false);assert.equal(result.result.economicsVerified,false);assert.equal(result.result.adoptionAuthorized,false);assert.equal(result.result.verification,'projection-digest-only');assert.ok(result.maxRecords<=3&&result.maxWorkingBytes<=1048576);assert.throws(()=>validateLegacyAuditHashState(last.mainHash),/Legacy audit hash/);
 const decoded=await createCollectionStateCodec({crypto}).decodeReferenceInventory(bundle);assert.deepEqual(normalized(decoded),normalized(state));
});
test('empty inventories/lists, shared lists, free null/fixed membership and explicit null preserve the exact optional-field transcript',async()=>{
 for(const state of [canonicalStateFixture({stages:0,admissions:0}),canonicalStateFixture({stages:1,members:0,admissions:0}),canonicalStateFixture({shared:true,explicitNull:true})]){const {bundle,records}=await stateBundle(state);assert.equal((await runStateAudit(service(records),bundle.root.id)).result.kind,'verified');}
 const state=canonicalStateFixture({stages:4,admissions:0});state.stages[0]={...state.stages[0],type:'public',wallets:null};state.stages[1]={...state.stages[1],type:'free',wallets:null};state.stages[2]={...state.stages[2],type:'free',priceLamports:0n};const {bundle,records}=await stateBundle(state),r=await runStateAudit(service(records),bundle.root.id);assert.equal(r.result.kind,'verified',JSON.stringify(r));assert.equal(r.result.listOccurrences,2);
});
test('valid child byte identities cannot rescue a changed declared semantic digest, revision, source identity or unknown stage field',async()=>{
 const {bundle,records}=await stateBundle(canonicalStateFixture());
 for(const [patch,reason] of [[b=>b.source.stateDigest='f'.repeat(64),'legacy-state-projection-digest-mismatch'],[b=>b.source.revision='999','legacy-state-record-or-hash-invalid'],[b=>b.source.inventoryId='different','legacy-state-record-or-hash-invalid'],[b=>b.stages[0].terms.unreviewed='unknown','legacy-state-unknown-stage-terms']]){const root=await changedRecord(bundle.root,patch),set=new Map(records).set(root.id,root),r=await runStateAudit(service(set),root.id);assert.equal(r.result.kind,'held');assert.equal(r.result.reason,reason);}
});
test('missing/reordered/wrong-kind pages and cross-page wallet order are held despite recomputed parent identities',async()=>{
 const {bundle,records}=await stateBundle(canonicalStateFixture({stages:1,members:201,admissions:2})),manifest=bundle.listManifests[0],body=JSON.parse(new TextDecoder().decode(manifest.bytes));
 const missing=new Map(records);missing.delete(body.pageIds[1]);assert.equal((await runStateAudit(service(missing),bundle.root.id)).result.reason,'legacy-state-record-missing');
 for(const patch of [b=>{[b.pageIds[0],b.pageIds[1]]=[b.pageIds[1],b.pageIds[0]];},b=>b.walletsDigest='f'.repeat(64),b=>b.count--]){const list=await changedRecord(manifest,patch),root=await changedRecord(bundle.root,b=>b.stages[0].eligibility.manifestId=list.id),set=new Map(records).set(list.id,list).set(root.id,root),r=await runStateAudit(service(set),root.id);assert.equal(r.result.kind,'held');assert.match(r.result.reason,/wallet-page|list-digest|record-or-hash/);}
 const duplicate=await changedRecord(records.get(body.pageIds[1]),b=>b.entries=JSON.parse(new TextDecoder().decode(records.get(body.pageIds[0]).bytes)).entries),list=await changedRecord(manifest,b=>b.pageIds[1]=duplicate.id),root=await changedRecord(bundle.root,b=>b.stages[0].eligibility.manifestId=list.id),set=new Map(records).set(duplicate.id,duplicate).set(list.id,list).set(root.id,root);assert.equal((await runStateAudit(service(set),root.id)).result.reason,'legacy-state-wallet-page');
 const wrongRoot=await changedRecord(bundle.root,b=>b.admissions.pageIds=[body.pageIds[0]]),wrong=new Map(records).set(wrongRoot.id,wrongRoot);assert.equal((await runStateAudit(service(wrong),wrongRoot.id)).result.reason,'legacy-state-admission-page');
});
test('continuations replay deterministically and reject changed digest, cursors, root or prefix byte count',async()=>{
 const {bundle,records}=await stateBundle(canonicalStateFixture()),hash=nativeTranscriptFixture(),runner=service(records,hash),first=await runner.step({rootId:bundle.root.id,checkpoint:null});assert.equal(first.kind,'continue');const input={rootId:bundle.root.id,checkpoint:first.checkpoint},a=await runner.step(input),b=await runner.step(input);assert.deepEqual(a,b);assert.ok(Object.isFrozen(a.checkpoint));
 for(const patch of [{prefixBytes:first.checkpoint.prefixBytes+1},{rootId:'f'.repeat(64)},{stageIndex:1},{admissionIndex:99}]){const c={...first.checkpoint,...patch},r=await runner.step({rootId:bundle.root.id,checkpoint:c});assert.equal(r.kind,'held');}
 const altered={...first.checkpoint,stageIndex:1};delete altered.checkpointDigest;altered.checkpointDigest=await crypto.sha256(utf8(canonicalJson(altered)));assert.equal((await runner.step({rootId:bundle.root.id,checkpoint:altered})).reason,'legacy-state-cursor-invalid');
 let interrupted=false;const retry=createLegacyStateAudit({crypto,hash,async readRecord(id){if(id!==bundle.root.id&&!interrupted){interrupted=true;throw Error('Synthetic interruption');}return records.get(id);}});assert.equal((await retry.step(input)).kind,'held');assert.deepEqual(await retry.step(input),a);
});
test('checkpoint and record bytes are captured before injected digest awaits',async()=>{
 const {bundle,records}=await stateBundle(canonicalStateFixture()),hash=nativeTranscriptFixture(),runner=service(records,hash),first=await runner.step({rootId:bundle.root.id,checkpoint:null}),input=JSON.parse(JSON.stringify({rootId:bundle.root.id,checkpoint:first.checkpoint})),expected=await runner.step(input);let changed=false;
 const guarded=createLegacyStateAudit({hash,readRecord:async id=>records.get(id),crypto:{...crypto,async sha256(bytes){if(!changed){changed=true;input.rootId='f'.repeat(64);input.checkpoint.phase='finish';input.checkpoint.prefixBytes=999;}return crypto.sha256(bytes);}}});
 assert.deepEqual(await guarded.step(input),expected);
 const record={...bundle.root,bytes:bundle.root.bytes.slice()};let once=false;
 const fresh=createLegacyStateAudit({hash:nativeTranscriptFixture(),readRecord:async()=>record,crypto:{...crypto,async sha256(bytes){if(!once){once=true;record.bytes.fill(0);}return crypto.sha256(bytes);}}});
 assert.equal((await fresh.step({rootId:bundle.root.id,checkpoint:null})).kind,'continue');
});
