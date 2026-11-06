import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {_SHA256} from '../../beacon/node_modules/.pnpm/@noble+hashes@2.2.0/node_modules/@noble/hashes/sha2.js';
import {localRuntime} from './local-runtime.mjs';
import {openDatabase} from '../../storage/database.mjs';
import {createNodeAtomicDriver} from '../../storage/node/atomic-driver.mjs';
import {createCollectionSourceRepository} from '../../collect/source-repository.mjs';
import {createCollectionSourceIntake} from '../../collect/source-intake.mjs';
import {createLegacyStateAudit} from '../../collect/legacy-state-audit.mjs';
import {createLegacyAuditHashAdapter,LEGACY_HASH_IMPLEMENTATION_PIN} from '../../collect/legacy-audit-hash.mjs';
import {canonicalStateFixture,stateBundle,changedRecord,legacyStateTestCrypto as crypto} from '../../collect/legacy-state-audit.fixtures.mjs';
test('actualD1 named records and fresh pinned hash adapters reproduce every canonical continuation across Worker invocations',async t=>{
 const began=performance.now(),nodeDb=openDatabase();t.after(()=>nodeDb.close());const principal={kind:'operator',id:'synthetic-canonical-audit'},ports={crypto,clock:{nowMs:()=>Date.now()},ids:{next:randomUUID}};nodeDb.prepare('INSERT INTO app_operator_scopes VALUES(?,?,0,1)').run(principal.id,'collection-import');
 const intake=createCollectionSourceIntake({...ports,repository:createCollectionSourceRepository(createNodeAtomicDriver(nodeDb),ports)}),cases=[],all=new Map();
 const states=[canonicalStateFixture({stages:0,admissions:0}),canonicalStateFixture({stages:2,members:0,admissions:0}),canonicalStateFixture({stages:3,members:201,admissions:1000,shared:true,explicitNull:true})];
 const last=states.at(-1);last.stages[2]={...last.stages[2],type:'free',wallets:null};
 for(const state of states){const data=await stateBundle(state);cases.push(data.bundle.root.id);for(const [id,record] of data.records)all.set(id,record);}
 const bad=await changedRecord(all.get(cases.at(-1)),b=>b.source.stateDigest='f'.repeat(64));all.set(bad.id,bad);
 for(const record of all.values())assert.ok(['committed','replayed'].includes((await intake.stageRecord(principal,{record,requestKey:record.id})).kind));
 const {mf,db}=await localRuntime(t,new URL('./fixtures/legacy-state-audit-worker.ts',import.meta.url));
 for(const table of ['app_operator_scopes','app_command_receipts','app_collection_records']){const rows=nodeDb.prepare('SELECT * FROM '+table).all();for(let start=0;start<rows.length;start+=3)await db.batch(rows.slice(start,start+3).map(row=>{const names=Object.keys(row);return db.prepare('INSERT INTO '+table+'('+names.join(',')+') VALUES('+names.map(()=>'?').join(',')+')').bind(...Object.values(row));}));}
 const call=async input=>{const response=await mf.dispatchFetch('http://localhost/__fixture',{method:'POST',body:JSON.stringify(input)});assert.equal(response.status,200);return response.json();},adapter=()=>createLegacyAuditHashAdapter({createSha256:()=>new _SHA256(),implementationPin:LEGACY_HASH_IMPLEMENTATION_PIN}),results=[];let maxQueries=0,maxReturnedBytes=0,maxWorkingBytes=0,maxCheckpointBytes=0,totalCalls=0;
 for(const rootId of [...cases,bad.id]){let checkpoint=null,steps=0;for(;;){
  // Reconstruct both services/adapters at every step. Only the serialized
  // checkpoint and immutable035 records cross the invocation boundary.
  const node=createLegacyStateAudit({crypto,hash:adapter(),readRecord:async id=>all.get(id)??null}),input={rootId,checkpoint},expected=await node.step(input),actual=await call(input);totalCalls++;steps++;assert.deepEqual(actual.result,expected);maxQueries=Math.max(maxQueries,actual.metrics.queries);maxReturnedBytes=Math.max(maxReturnedBytes,actual.metrics.maxReturnedBytes);maxWorkingBytes=Math.max(maxWorkingBytes,actual.result.metrics.maxWorkingBytes);
  if(actual.result.kind!=='continue'){assert.equal(actual.result.kind,rootId===bad.id?'held':'verified');if(rootId===bad.id)assert.equal(actual.result.reason,'legacy-state-projection-digest-mismatch');results.push({rootId,steps,kind:actual.result.kind,...(actual.result.kind==='verified'?{digest:actual.result.stateDigest,bytes:actual.result.transcriptBytes}:{reason:actual.result.reason})});break;}
  if(steps===3){const replay=await call(input);totalCalls++;assert.deepEqual(replay,actual);const changed={...actual.result.checkpoint,prefixBytes:actual.result.checkpoint.prefixBytes+1};assert.equal((await call({rootId,checkpoint:changed})).result.kind,'held');totalCalls++;}
  checkpoint=JSON.parse(JSON.stringify(actual.result.checkpoint));maxCheckpointBytes=Math.max(maxCheckpointBytes,Buffer.byteLength(JSON.stringify(checkpoint)));assert.ok(steps<100);
 }}
 assert.ok(maxQueries<=3&&maxWorkingBytes<=1048576&&maxCheckpointBytes<=4096);assert.equal((await call({rootId:'0'.repeat(64),checkpoint:null})).result.reason,'legacy-state-record-missing');assert.equal((await mf.dispatchFetch('http://localhost/api/v1/legacy-state-audit')).status,404);
 t.diagnostic(JSON.stringify({canonicalStateD1:{source:'synthetic035 actual retained rows; pinned optional adapter fixture only',implementationPin:LEGACY_HASH_IMPLEMENTATION_PIN,totalCalls,maxQueries,maxReturnedBytes,maxWorkingBytes,maxCheckpointBytes,results,elapsedMs:performance.now()-began,applicationAuthority:false}}));
});
