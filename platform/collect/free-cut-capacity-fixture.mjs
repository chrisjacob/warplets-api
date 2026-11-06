import assert from 'node:assert/strict';
import {freeCutFixture} from './free-cut-test-fixture.mjs';
/** Full real local command transcript:100 known Genesis,9,900 explicitly
 * synthetic external holdings,100 retained pages and a10k-member indexed list. */
export async function prepareFreeCutCapacity(t){
 const f=await freeCutFixture(t,{count:10000,trackedCount:100});await f.stage();const begin=await f.begin();assert.equal(begin.kind,'committed',JSON.stringify(begin));const attemptId=begin.value.attemptId,commandMetrics=[];
 for(let index=0;index<f.bundle.pages.length;index++){const offset=f.measurements.length,p=await f.page(attemptId,index);assert.equal(p.kind,'committed',JSON.stringify(p));assert.equal(p.value.trackedCount,index===0?100:0);const m=f.measurements.slice(offset);commandMetrics.push({statements:m.reduce((s,v)=>s+v.statements,0),readBytes:m.reduce((s,v)=>s+v.resultBytes,0),maxBatchBytes:Math.max(...m.map(v=>v.batchBytes))});}
 const offset=f.measurements.length,accepted=await f.seal(attemptId);assert.equal(accepted.kind,'committed',JSON.stringify(accepted));assert.equal(accepted.value.eligibleWallets,10000);const m=f.measurements.slice(offset),sealMetrics={statements:m.reduce((s,v)=>s+v.statements,0),readBytes:m.reduce((s,v)=>s+v.resultBytes,0),maxBatchBytes:Math.max(...m.map(v=>v.batchBytes))};
 return {...f,attemptId,accepted,commandMetrics,sealMetrics};
}
