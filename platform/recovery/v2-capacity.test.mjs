import test from 'node:test';
import assert from 'node:assert/strict';
import {governanceCapacityFixture,castCapacityVotes} from './capacity-fixtures.mjs';
import {createRecoveryV2Capture} from './v2-capture.mjs';
import {createRecoveryV2Codec} from './v2-codec.mjs';
import {createManifestCodec} from '../artifacts/manifest-codec.mjs';
import {memoryArtifacts} from '../application/fixtures/memory-artifacts.mjs';
import {readInstalledRecoverySchema} from './node-schema.mjs';
import {measureBatch} from '../storage/atomic-driver.mjs';
test('complete legal10000-voter/full-turnout source captures through bounded continuations without a giant receipt or pin',async t=>{
 const f=await governanceCapacityFixture(t);await castCapacityVotes(f);const store=memoryArtifacts(),schema=await readInstalledRecoverySchema(f.ports.crypto),v2Codec=createRecoveryV2Codec(f.ports),metrics=[];let current=null;
 const driver={...f.base,async batch(statements){current.sql+=statements.length;current.maxBatchBytes=Math.max(current.maxBatchBytes,measureBatch(statements).batchBytes);const results=await f.base.batch(statements);current.returnedBytes+=Buffer.byteLength(JSON.stringify(results));return results;}},artifacts={async getVerified(identity){current.reads++;const result=await store.getVerified(identity);if(result.status==='verified')current.objectBytes+=result.bytes.length;return result;},async putIfAbsent(identity,bytes){current.writes++;current.objectBytes+=bytes.length;return store.putIfAbsent(identity,bytes);}},capture=createRecoveryV2Capture({...f.ports,driver,artifacts,schema,v2Codec,codec:createManifestCodec(f.ports)});
 const call=async(method,input)=>{current={sql:0,reads:0,writes:0,maxBatchBytes:0,returnedBytes:0,objectBytes:0};try{return await capture[method](input);}finally{metrics.push(current);current=null;}};
 let result=await call('start',{captureId:'synthetic-full-turnout',sourceCommit:'a'.repeat(40)});for(let n=0;n<5000&&['started','progress','replayed'].includes(result.kind);n++)result=await call('step',{captureId:result.captureId,expectedRevision:result.revision});assert.equal(result.kind,'captured',JSON.stringify(result));const root=await v2Codec.verifyRoot(result.bytes,result.digest);assert.equal(root.totals.rows,30988); // Includes327mandatory governance/source/index audit rows (058/061).
 assert.ok(root.totals.bytes>13*1024*1024);assert.ok(result.bytes.length<16384);
 async function tables(pointer){const object=await store.getVerified(pointer.identity),node=await v2Codec.verifyIndex(object.bytes,pointer.identity);return node.level===0?node.entries.map(e=>e.value):(await Promise.all(node.entries.map(e=>tables(e)))).flat();}
 const descriptors=await tables(root.tables);for(const [name,count] of [['ops_config_audit',327],['genesis_voters',10000],['genesis_votes',10000],['app_command_receipts',10327]])assert.equal(descriptors.find(t=>t.name===name).rowCount,count);
 assert.ok(metrics.every(m=>m.sql+m.reads+m.writes<=64));assert.ok(metrics.every(m=>m.returnedBytes+m.objectBytes+m.maxBatchBytes<=1024*1024));t.diagnostic(JSON.stringify({calls:metrics.length,rows:root.totals.rows,objects:root.totals.objects,bytes:root.totals.bytes,rootBytes:result.bytes.length,maxOperations:Math.max(...metrics.map(m=>m.sql+m.reads+m.writes)),maxBatchBytes:Math.max(...metrics.map(m=>m.maxBatchBytes)),maxSerializedWorkingBytes:Math.max(...metrics.map(m=>m.returnedBytes+m.objectBytes+m.maxBatchBytes)),restoreAcceptanceOutstanding:true}));
});
