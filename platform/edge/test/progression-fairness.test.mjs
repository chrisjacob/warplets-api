import test from 'node:test';
import assert from 'node:assert/strict';
import {localRuntime} from './local-runtime.mjs';
import {fairnessProgressionFixture} from '../../collect/fairness-progression.fixtures.mjs';
import {createCollectionFairnessRepository} from '../../collect/fairness-repository.mjs';
import {reviewedReservation} from '../../collect/reservation-test-harness.mjs';
import {fulfillmentInput} from '../../collect/fulfillment-test-harness.mjs';
test('actual D1 progression fairness uses guarded reservations/fulfillment and matches Node pinned BLS replay',async t=>{
 for(const kind of ['upgrade','visual']){
  const f=await fairnessProgressionFixture(t,{kind}),{mf,db}=await localRuntime(t,new URL('./fixtures/progression-fairness-worker.ts',import.meta.url));
  for(const [table,rows] of Object.entries(f.baseTables))for(let offset=0;offset<rows.length;offset+=20)await db.batch(rows.slice(offset,offset+20).map(row=>{const keys=Object.keys(row);return db.prepare('INSERT INTO '+table+'('+keys.join(',')+') VALUES('+keys.map(()=>'?').join(',')+')').bind(...Object.values(row));}));
  const call=async body=>{const response=await mf.dispatchFetch('http://localhost/__fixture',{method:'POST',body:JSON.stringify({nowMs:f.clock.nowMs(),...body})});assert.equal(response.status,200);return response.json();};
  const quote=await call({lane:'reservation',method:'quote',nowMs:f.createdMs,principal:f.query.principal,idPrefix:'synthetic-quote',input:{requestKey:'synthetic-quote',inventoryId:f.context.inventoryId,...f.context.request(2,kind)}});assert.equal(quote.result.kind,'committed',JSON.stringify(quote));
  const reserved=await call({lane:'reservation',nowMs:f.createdMs,principal:f.query.principal,idPrefix:'synthetic-reserve',input:reviewedReservation(quote.result.value,'synthetic-reserve')});assert.equal(reserved.result.kind,'committed',JSON.stringify(reserved));assert.equal(reserved.result.value.operationId,f.op.id);
  const repo=createCollectionFairnessRepository(f.driver,f),pending=await call({query:f.query});assert.deepEqual(pending.result,await repo.readOwnFairness(f.query));assert.equal(pending.result.value.disclosure,'sealed');
  await f.fulfill();const event={inventoryId:f.context.inventoryId,operationId:f.op.id,kind,commitment:f.op.commitment,provenance:'configured-offline-beacon',atMs:f.atMs,proof:f.proof};
  const evidence=await call({lane:'fulfill',method:'evidence',idPrefix:'synthetic-fulfill-1',event});assert.equal(evidence.result.kind,'committed',JSON.stringify(evidence));const fulfilled=await call({lane:'fulfill',idPrefix:'synthetic-fulfill-2',input:fulfillmentInput(evidence.result.value,'synthetic-fulfillment')});assert.equal(fulfilled.result.kind,'committed',JSON.stringify(fulfilled));
  const disclosed=await call({query:f.query});assert.deepEqual(disclosed.result,await repo.readOwnFairness(f.query));assert.equal(disclosed.result.value.disclosure,'revealed');assert.ok(disclosed.metrics.statements<=16);assert.ok(disclosed.metrics.serializedWorkingBytes<=1048576);
  const watermark=await db.prepare('SELECT revision FROM app_recovery_watermark WHERE id=1').first('revision');assert.deepEqual((await call({query:f.query})).result,disclosed.result);assert.equal(await db.prepare('SELECT revision FROM app_recovery_watermark WHERE id=1').first('revision'),watermark);
  const stale=await call({query:f.query,fault:'after-bls'});assert.equal(stale.result.kind,'pending');assert.equal(stale.result.reason,'fairness-snapshot-changed');t.diagnostic(JSON.stringify({kind,metrics:disclosed.metrics}));
 }
});
