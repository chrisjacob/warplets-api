import test from 'node:test';
import assert from 'node:assert/strict';
import {fairnessProgressionFixture} from './fairness-progression.fixtures.mjs';
import {createCollectionFairnessRepository} from './fairness-repository.mjs';
test('normalized progression withholds pending entropy and replays exact upgrade/visual records after assignment',async t=>{
 for(const kind of ['upgrade','visual']){const f=await fairnessProgressionFixture(t,{kind}),metrics=[],repo=createCollectionFairnessRepository(f.driver,{...f,onMeasure:m=>metrics.push(m)});
  const pending=await repo.readOwnFairness(f.query);assert.equal(pending.kind,'ready',JSON.stringify(pending));assert.equal(pending.value.disclosure,'sealed');assert.equal(pending.value.transcript,null);
  await f.fulfill();const result=await repo.readOwnFairness(f.query);assert.equal(result.kind,'ready',JSON.stringify(result));assert.equal(result.value.disclosure,'revealed',JSON.stringify(result));assert.equal(result.value.transcript.remainingQuotas,null);assert.equal(result.value.transcript.selectedAssignment.level,null);assert.equal(result.value.financialState,'not-applicable-local');assert.equal(result.value.providerStatus,'candidate-unselected');
  assert.deepEqual(await repo.readOwnFairness(f.query),result);assert.deepEqual(await repo.readOwnFairness({...f.query,principal:{kind:'wallet',wallet:'11111111111111111111111111111111'}}),{kind:'missing'});assert.ok(metrics.every(m=>m.statements<=16&&m.serializedWorkingBytes<=1048576));t.diagnostic(JSON.stringify({kind,metrics:metrics[1]}));
 }
});
test('manual progression remains sealed; a missing participant reveal cannot release a transcript',async t=>{
 const manual=await fairnessProgressionFixture(t,{configured:false});await manual.fulfill();const m=await createCollectionFairnessRepository(manual.driver,manual).readOwnFairness(manual.query);assert.equal(m.kind,'ready',JSON.stringify(m));assert.equal(m.value.evidenceState,'manual-fixture');assert.equal(m.value.transcript,null);
 const f=await fairnessProgressionFixture(t);await f.fulfill();f.db.prepare('UPDATE collect_assets SET reveal_ms=NULL WHERE id=(SELECT material_id FROM app_collection_reservations WHERE operation_id=?)').run(f.op.id);const r=await createCollectionFairnessRepository(f.driver,f).readOwnFairness(f.query);assert.equal(r.kind,'ready',JSON.stringify(r));assert.equal(r.value.disclosure,'sealed');assert.equal(r.value.transcript,null);
});
test('post-proof source changes and mismatched original receipt cannot disclose an obsolete transcript',async t=>{
 const f=await fairnessProgressionFixture(t);await f.fulfill();let changed=false;const beaconVerifier={async verifyShortSignature(...args){const out=await f.beaconVerifier.verifyShortSignature(...args);if(!changed){changed=true;f.db.exec("UPDATE collect_assets SET observed_ms=observed_ms+1");}return out;}};
 assert.equal((await createCollectionFairnessRepository(f.driver,{...f,beaconVerifier}).readOwnFairness(f.query)).kind,'pending');assert.equal(changed,true);
 assert.throws(()=>f.db.prepare("UPDATE collect_operations SET receipt='{}' WHERE id=?").run(f.op.id),/retained fulfillment/);
 const corrupted={...f.driver,async batch(statements){const out=await f.driver.batch(statements);for(const result of out)for(const row of result.rows)if(Object.hasOwn(row,'op_receipt'))row.op_receipt='{}';return out;}};
 const r=await createCollectionFairnessRepository(corrupted,f).readOwnFairness(f.query);assert.equal(r.kind,'pending');
});
