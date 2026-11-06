import test from 'node:test';
import assert from 'node:assert/strict';
import {governanceCapacityFixture,measureCurrentCapture,castCapacityVotes,maximumSourcePayloadFootprint} from './capacity-fixtures.mjs';
test('legal10000-voter publication measures current recovery refusal without writing incomplete artifacts',async t=>{
 const f=await governanceCapacityFixture(t),measurement=await measureCurrentCapture(f),{result,metrics,footprint}=measurement;
 assert.deepEqual(result,{kind:'pending',reason:'private-snapshot-bound'});assert.equal(metrics.objectReads,0);assert.equal(metrics.objectWrites,0);assert.equal(footprint.tables.find(t=>t.name==='genesis_voters').rowCount,10000);
 assert.ok(footprint.rowBytes<footprint.currentLimits.totalBytes);assert.ok(footprint.estimatedCaptureOperations<=footprint.currentLimits.finishOperations);assert.ok(footprint.estimatedFinishOperations<=footprint.currentLimits.finishOperations);
 t.diagnostic(JSON.stringify({...measurement,footprint:{...footprint,tables:footprint.tables.filter(t=>t.rowCount)}}));
});
test('full10000 guarded votes measure receipt and operation ceilings without lifting any capture bound',async t=>{
 const f=await governanceCapacityFixture(t);await castCapacityVotes(f);const measurement=await measureCurrentCapture(f),{result,metrics,footprint}=measurement;
 assert.deepEqual(result,{kind:'pending',reason:'private-snapshot-bound'});assert.equal(metrics.objectWrites,0);assert.equal(footprint.tables.find(t=>t.name==='genesis_votes').rowCount,10000);assert.equal(footprint.tables.find(t=>t.name==='app_command_receipts').rowCount,10327);assert.ok(footprint.estimatedCaptureOperations>footprint.currentLimits.finishOperations);
 t.diagnostic(JSON.stringify({...measurement,footprint:{...footprint,tables:footprint.tables.filter(t=>t.rowCount)}}));
});
test('maximum32 distinct10000-member source graph already exceeds aggregate recovery budget before receipts',async t=>{
 const result=await maximumSourcePayloadFootprint();assert.equal(result.lists,32);assert.equal(result.indexPages,3200);assert.equal(result.records,3245);assert.ok(result.minimumStoredPayloadBytes>result.currentTotalBytesLimit);t.diagnostic(JSON.stringify(result));
});
