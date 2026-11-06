import test from 'node:test';
import assert from 'node:assert/strict';
import {relationFixture,runRelation} from './legacy-source-relation.fixtures.mjs';
import {canonicalStateFixture} from './legacy-state-audit.fixtures.mjs';
test('complete32 distinct10000-wallet legacy lists and1000 admissions equal all3245 named035 records with bounded SQL projection',async t=>{
 const began=performance.now(),state=canonicalStateFixture({stages:32,members:10000,admissions:1000,explicitNull:true});
 for(const stage of state.stages){const old=stage.id;stage.id=old+'x'.repeat(128-old.length);stage.inventoryOverrideReason='雪'.repeat(500);for(const row of state.admissions)if(row.stageId===old)row.stageId=stage.id;}
 const levels=state.remaining.flatMap((count,index)=>Array(count).fill(index+1));for(const [index,row]of state.admissions.entries()){row.operationId+='x'.repeat(128-row.operationId.length);row.drawCommitment+='x'.repeat(128-row.drawCommitment.length);const proof='synthetic-proof-'+index;row.proofId=proof+'x'.repeat(128-proof.length);row.level=levels[index];row.ticket=0;row.costLamports=18446744073709551615n;}state.fulfilled=1000;state.remaining=Array(10).fill(0);
 const f=await relationFixture(t,{state}),seedMs=performance.now()-began,r=await runRelation(f.service,f.input);assert.equal(r.result.kind,'verified',JSON.stringify(r));assert.equal(r.result.walletOccurrences,320000);assert.equal(r.result.admissionCount,1000);assert.equal(f.records.size,3245);assert.ok(r.maxWorkingBytes<=1048576-65536&&r.maxOperations<=8&&r.maxBatchBytes<=262144);
 t.diagnostic(JSON.stringify({legacyRelationMaximum:{source:'synthetic SQL legacy state versus real035 retained source records; no economic or adoption authority',installedMigration:f.db.prepare('SELECT MAX(version) version FROM schema_versions').get(),records:f.records.size,rawBytes:Buffer.byteLength(f.raw),sourceBytes:[...f.records.values()].reduce((n,x)=>n+x.size,0),seedMs,...r,elapsedMs:performance.now()-began}}));
});
