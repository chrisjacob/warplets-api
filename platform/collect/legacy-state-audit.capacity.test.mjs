import test from 'node:test';
import assert from 'node:assert/strict';
import {createCollectionStateCodec} from './state-codec.mjs';
import {createLegacyStateAudit} from './legacy-state-audit.mjs';
import {canonicalJson,utf8} from '../security/canonical.mjs';
import {nativeTranscriptFixture,canonicalStateFixture,stateBundle,runStateAudit,legacyStateTestCrypto as crypto} from './legacy-state-audit.fixtures.mjs';
test('complete32 distinct10000-wallet lists and1000 admissions reproduce035 digest with bounded resumable steps',async t=>{
 const began=performance.now(),state=canonicalStateFixture({stages:32,members:10000,admissions:1000,explicitNull:true});
 // Bounded maximal scalar lengths remain explicit; no record is silently cut.
 for(const stage of state.stages){const old=stage.id;stage.id=old+'x'.repeat(128-old.length);stage.inventoryOverrideReason='雪'.repeat(500);for(const row of state.admissions)if(row.stageId===old)row.stageId=stage.id;}
 const levels=state.remaining.flatMap((count,index)=>Array(count).fill(index+1));
 for(const [index,row] of state.admissions.entries()){row.operationId+='x'.repeat(128-row.operationId.length);row.drawCommitment+='x'.repeat(128-row.drawCommitment.length);const proof='synthetic-proof-'+index;row.proofId=proof+'x'.repeat(128-proof.length);row.level=levels[index];row.ticket=0;row.costLamports=18446744073709551615n;}
 state.fulfilled=1000;state.remaining=Array(10).fill(0);
 const {bundle,records}=await stateBundle(state),hash=nativeTranscriptFixture(),service=createLegacyStateAudit({crypto,hash,readRecord:async id=>records.get(id)??null}),result=await runStateAudit(service,bundle.root.id);
 assert.equal(result.result.kind,'verified',JSON.stringify(result));assert.equal(result.result.stageCount,32);assert.equal(result.result.walletOccurrences,320000);assert.equal(result.result.admissionCount,1000);assert.equal(result.maxRecords,3);assert.ok(result.maxWorkingBytes<=1048576&&result.maxCheckpointBytes<=4096);
 const decoded=await createCollectionStateCodec({crypto}).decodeReferenceInventory(bundle),normal=JSON.parse(JSON.stringify(decoded,(_k,x)=>typeof x==='bigint'?{$lamports:x.toString()}:x));assert.equal(await crypto.sha256(utf8(canonicalJson(normal))),result.result.stateDigest);
 t.diagnostic(JSON.stringify({canonicalStateMaximum:{classification:'synthetic source projection only; Node native-copy fixture hash; no source/adoption authority',records:records.size,listManifests:bundle.listManifests.length,pages:bundle.pages.length,sourceBytes:[...records.values()].reduce((n,r)=>n+r.size,0),transcriptBytes:result.result.transcriptBytes,steps:result.steps,maxRecords:result.maxRecords,maxWorkingBytes:result.maxWorkingBytes,maxCheckpointBytes:result.maxCheckpointBytes,elapsedMs:performance.now()-began}}));
});
