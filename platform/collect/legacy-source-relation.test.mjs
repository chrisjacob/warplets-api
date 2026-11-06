import test from 'node:test';
import assert from 'node:assert/strict';
import {createLegacySourceRelationAudit} from './legacy-source-relation.mjs';
import {relationFixture,runRelation,crypto,legacyJson} from './legacy-source-relation.fixtures.mjs';
import {canonicalStateFixture} from './legacy-state-audit.fixtures.mjs';
import {openDatabase} from '../storage/database.mjs';
import {createCollection,publishCollectionStage,reserveMint} from './store.mjs';
import {createHash} from 'node:crypto';
import {canonicalJson} from '../security/canonical.mjs';

test('actual reference-store publication and pending admission JSON retain absent optional fields and reducer output exactly',async t=>{
 const db=openDatabase();t.after(()=>db.close());const now=20000*86400000,inventoryId='synthetic-real-reference',wallet=canonicalStateFixture({stages:1,members:1,admissions:0}).stages[0].wallets[0];
 createCollection(db,{id:inventoryId,kind:'genesis',tranche:1});
 for(const [index,type]of ['whitelist','public','founder'].entries())publishCollectionStage(db,{inventoryId,stage:{id:type,type,publishedAt:now,opensAt:now+2*86400000,closesAt:now+3*86400000,priceLamports:type==='founder'?'0':'100000000',costLamports:'5000',allocation:1000,wallets:[wallet],walletLimit:null,founderApproved:type!=='whitelist',...(type==='founder'?{approvedSpendLamports:'5000000'}:{})}},now);
 reserveMint(db,{inventoryId,stageId:'whitelist',wallet,requestKey:'synthetic-pending',now:now+2*86400000});
 const raw=db.prepare('SELECT state FROM collect_inventories WHERE id=?').get(inventoryId).state,state=JSON.parse(raw,(_k,v)=>v&&typeof v==='object'&&Object.hasOwn(v,'$lamports')?BigInt(v.$lamports):v),f=await relationFixture(t,{state});assert.equal(f.raw,raw);assert.equal((await runRelation(f.service,f.input)).result.kind,'verified');
});

test('bounded source relation compares all named admissions, scalar terms and current wallet pages without granting adoption authority',async t=>{
 for(const state of [canonicalStateFixture(),canonicalStateFixture({stages:2,members:0,admissions:0,shared:true,explicitNull:true}),canonicalStateFixture({stages:0,members:0,admissions:0}),(()=>{const s=canonicalStateFixture({stages:1,admissions:0});s.stages[0].type='free';s.stages[0].wallets=null;return s;})()]){
  const f=await relationFixture(t,{state}),before=f.db.prepare('SELECT revision FROM app_recovery_watermark').get(),r=await runRelation(f.service,f.input);assert.equal(r.result.kind,'verified',JSON.stringify(r));assert.equal(r.result.admissionCount,state.admissions.length);assert.equal(r.result.stageCount,state.stages.length);assert.equal(r.result.walletOccurrences,state.stages.reduce((n,s)=>n+(s.wallets?.length??0),0));for(const k of ['canonicalDigestVerified','rawByteDigestVerified','economicsVerified','adoptionAuthorized','executable'])assert.equal(r.result[k],false);assert.deepEqual(f.db.prepare('SELECT revision FROM app_recovery_watermark').get(),before);assert.ok(r.maxOperations<=7&&r.maxWorkingBytes<=1048576&&r.maxBatchBytes<=262144);
 }
});

test('raw duplicate and unknown keys, missing/null and numeric lexical drift hold at every nested object',async t=>{
 const cases=[
  raw=>raw.replace('{','{"id":"shadow",'),raw=>raw.replace('{','{"unknown":null,'),raw=>raw.replace('"version":5','"version":5.0'),raw=>raw.replace('"kind":"season"','"kind":"season","tranche":null'),
  raw=>raw.replace('"id":"synthetic-stage-0"','"id":"synthetic-stage-0","id":"shadow"'),raw=>raw.replace('"type":"whitelist"','"unknown":null,"type":"whitelist"'),raw=>raw.replace('"publishedAt":1700000000000','"publishedAt":1700000000000.0'),
  raw=>raw.replace('"$lamports":"100000000"','"$lamports":"1","$lamports":"100000000"'),raw=>raw.replace('"operationId":"synthetic-admission-0"','"operationId":"synthetic-admission-0","operationId":"synthetic-admission-0"'),
  raw=>raw.replace('"admittedAt":1700000000000','"admittedAt":1700000000000.0'),raw=>raw.replace('"costLamports":{"$lamports":"5000"},"level"','"costLamports":{"$lamports":"5000","$lamports":"5000"},"level"'),
  raw=>raw.replace('"remaining":[','"remaining":[0,'),raw=>raw.replace('"ballotId":null,','')
 ];
 for(const [index,mutateRaw] of cases.entries()){const f=await relationFixture(t,{mutateRaw});assert.notEqual(f.raw,legacyJson(f.state),'fixture transform');const r=await runRelation(f.service,f.input);assert.equal(r.result.kind,'held',index+': '+JSON.stringify(r));}
});

test('wallet ordering, admission identity and actual scalar changes never match a named source',async t=>{
 for(const mutateRaw of [raw=>{const v=JSON.parse(raw);v.stages[0].wallets.reverse();return JSON.stringify(v);},raw=>{const v=JSON.parse(raw);v.admissions.reverse();return JSON.stringify(v);},raw=>raw.replace('"allocation":1000','"allocation":999')]){const f=await relationFixture(t,{mutateRaw}),r=await runRelation(f.service,f.input);assert.equal(r.result.kind,'held');}
});

test('checkpoint replay is deterministic, SQL failures retry, and source pins catch business/header changes after hashing',async t=>{
 const f=await relationFixture(t),first=await f.service.step(f.input);assert.equal(first.kind,'continue');assert.deepEqual(await f.service.step({...f.input,checkpoint:first.checkpoint}),await f.service.step({...f.input,checkpoint:first.checkpoint}));
 const bad=structuredClone(first.checkpoint);bad.stageIndex++;assert.equal((await f.service.step({...f.input,checkpoint:bad})).reason,'legacy-relation-checkpoint-digest');
 let fail=true;const faults=createLegacySourceRelationAudit({crypto,driver:{batch:async s=>{if(fail){fail=false;throw Error('synthetic transport');}return f.driver.batch(s);}}});assert.equal((await faults.step(f.input)).kind,'held');assert.equal((await faults.step(f.input)).kind,'continue');
 let mutate=true;const racing=createLegacySourceRelationAudit({driver:f.driver,crypto:{sha256:async bytes=>{const digest=await crypto.sha256(bytes);if(mutate){mutate=false;f.db.prepare("UPDATE collect_inventories SET state=state||' ' WHERE id=?").run(f.state.id);}return digest;}}});assert.equal((await racing.step(f.input)).reason,'legacy-relation-source-pin-changed');assert.equal((await f.service.step({...f.input,checkpoint:first.checkpoint})).reason,'legacy-relation-source-pin-changed');

});

test('named record substitution and omitted rows hold instead of trusting reader transport',async t=>{
 const f=await relationFixture(t),foreign=[...f.records.values()].find(r=>r.id!==f.bundle.root.id);
 for(const substitute of [[],[{id:foreign.id,size:foreign.size,body_base64:Buffer.from(foreign.bytes).toString('base64')}]]){const service=createLegacySourceRelationAudit({crypto,driver:{batch:async statements=>{const result=await f.driver.batch(statements);for(let i=0;i<statements.length;i++)if(statements[i].sql.includes('FROM app_collection_records'))result[i]={...result[i],rows:substitute};return result;}}});assert.equal((await service.step(f.input)).kind,'held');}
});

test('many duplicate known scalar keys stay bounded before hydration and mutable input is captured before digest awaits',async t=>{
 const f=await relationFixture(t,{mutateRaw:raw=>raw.replace('{','{'+('"id":"'+'x'.repeat(4096)+'",').repeat(500))}),held=await f.service.step(f.input);assert.equal(held.reason,'legacy-relation-object-keys');assert.ok(held.metrics.resultBytes<200000&&held.metrics.maxWorkingBytes<1048576);
 const good=await relationFixture(t),input=structuredClone(good.input);let once=true;const capture=createLegacySourceRelationAudit({driver:good.driver,crypto:{sha256:async bytes=>{if(once){once=false;input.inventoryId='mutated';input.rootId='f'.repeat(64);}return crypto.sha256(bytes);}}}),result=await capture.step(input);assert.equal(result.kind,'continue');assert.equal(result.checkpoint.inventoryId,good.input.inventoryId);assert.equal(result.checkpoint.rootId,good.input.rootId);
});

test('selected root facts preserve the frozen B11-30 logical continuation transcript and exact checkpoint hashes',async t=>{
 // Generated from committed ebf5b57. Runtime pin/metrics are deliberately
 // excluded from this logical transcript; each current checkpoint hash is
 // separately checked against its complete actual pin and body below.
 const cases=[[{stages:0,members:0,admissions:0},4,'23542744f101fd8e9110b25de5a616527ebaa9e2e75e30837feeed2cf5639af5'],[{stages:3,members:101,admissions:101,shared:true,explicitNull:true},13,'520f6b7ba604da62e2f219fb4daa874e6896c6c600b10c3667f37f097e571bc7'],[{stages:2,members:0,admissions:0},8,'e51270e24ca9cac5a58917d6df237d5b2a235f091911181119c00918a14dfd03']];
 for(const [setup,steps,expected]of cases){const state=canonicalStateFixture(setup);if(setup.stages===3)state.stages[2]={...state.stages[2],type:'free',wallets:null};const f=await relationFixture(t,{state}),hash=createHash('sha256'),report=await runRelation(f.service,f.input,{onStep:async result=>{
  assert.equal(result.metrics.maxWorkingBytes,Math.max(...Object.values(result.metrics.phasePeaks)));assert.ok(result.metrics.retainedFactsBytes<8192);assert.ok(result.metrics.resultBytes>=result.metrics.maxResultBatchBytes);
  if(result.kind==='continue'){const {checkpointDigest,...body}=result.checkpoint;assert.equal(checkpointDigest,createHash('sha256').update(canonicalJson(body)).digest('hex'));}
  const value=structuredClone(result);delete value.metrics;delete value.pin;delete value.relationDigest;if(value.checkpoint){delete value.checkpoint.pin;delete value.checkpoint.checkpointDigest;}hash.update(canonicalJson(value)+'\n');
 }});assert.equal(report.result.kind,'verified');assert.equal(report.steps,steps);assert.equal(hash.digest('hex'),expected);}
});

test('byte-bounded admission pages query only their exact verified entries and retain no full root during comparison',async t=>{
 const state=canonicalStateFixture({stages:1,members:1,admissions:1000,explicitNull:true}),old=state.stages[0].id;state.stages[0].id+='x'.repeat(128-old.length);const levels=state.remaining.flatMap((count,index)=>Array(count).fill(index+1));
 for(const [n,row]of state.admissions.entries()){row.stageId=state.stages[0].id;row.operationId+='x'.repeat(128-row.operationId.length);row.drawCommitment+='x'.repeat(128-row.drawCommitment.length);row.proofId=('synthetic-proof-'+n).padEnd(128,'x');row.level=levels[n];row.ticket=0;row.costLamports=18446744073709551615n;}state.fulfilled=1000;state.remaining=Array(10).fill(0);
 const f=await relationFixture(t,{state}),root=JSON.parse(Buffer.from(f.bundle.root.bytes)),sizes=root.admissions.pageIds.map(id=>JSON.parse(Buffer.from(f.records.get(id).bytes)).entries.length);assert.ok(sizes.some(n=>n<100));let queries=0,offset=0;
 const service=createLegacySourceRelationAudit({crypto,driver:{batch:async statements=>{for(const s of statements)if(s.sql.includes("json_each(h.state,'$.admissions')")){assert.equal(s.values[1],offset);assert.equal(s.values[2]-s.values[1],sizes[queries]);offset+=sizes[queries++];}return f.driver.batch(statements);}}}),report=await runRelation(service,f.input,{onStep:r=>{assert.ok(r.metrics.retainedFactsBytes<8192);}});
 assert.equal(report.result.kind,'verified');assert.equal(queries,sizes.length);assert.equal(offset,1000);assert.ok(report.maxWorkingBytes<1048576-65536);t.diagnostic(JSON.stringify({exactAdmissionPartitions:{sizes,maxWorkingBytes:report.maxWorkingBytes}}));
});
