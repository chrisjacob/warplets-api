import test from 'node:test';
import assert from 'node:assert/strict';
import {fairnessRepositoryFixture} from './fairness-repository.fixtures.mjs';
import {fairnessProgressionFixture} from './fairness-progression.fixtures.mjs';
import {createCollectionReadRepository} from './read-model.mjs';
import {createCollectionFairnessRepository} from './fairness-repository.mjs';
import {readOwnOperation,listOwnOperations} from './store.mjs';
import {handleMintReservation} from './mint-http.mjs';
import {progressionReservationView} from './progression-http.mjs';
import {futureRound} from '../randomness/request-plan.mjs';
function sealedTiming(views,op,round){
 // Demonstrates the old exact round derivation, rather than searching for the
 // serialized round string alone. Public wall-clock estimates are not ruled out.
 assert.equal(futureRound(op.created_ms),round);
 for(const view of views){assert.equal(view.createdAt,null);assert.throws(()=>futureRound(Date.parse(view.createdAt)));}
 const combined=JSON.stringify(views);for(const secret of [new Date(op.created_ms).toISOString(),op.commitment])assert.ok(!combined.includes(secret));
 for(const view of views)for(const key of ['createdMs','targetRound','contextDigest','rawCommitment','proof'])assert.equal(Object.hasOwn(view,key),false);
}
test('mint mutation/detail/list and concealed asset observation do not disclose exact admission or binding time',async t=>{
 const f=await fairnessRepositoryFixture(t),op=f.operations[0],principal=f.query().principal,reads=createCollectionReadRepository(f.driver),query={...f.query(),nowMs:f.clock.nowMs()};
 const accepted=JSON.parse(f.db.prepare('SELECT result_json FROM app_collection_mint_admissions WHERE operation_id=?').get(op.id).result_json);
 const response=await handleMintReservation(new Request('http://localhost/api/v1/collect/inventories/'+op.inventory_id+'/stages/'+accepted.stageId+'/reservations',{method:'POST',headers:{origin:'http://localhost','content-type':'application/json','idempotency-key':'timing-replay'},body:JSON.stringify({expectedTermsDigest:accepted.termsDigest})}),{authenticate:async()=>principal,consumeQuota:async()=>null,reservations:{reserveMint:async()=>({kind:'replayed',value:accepted})}});
 const mutation=(await response.json()).operation,detail=(await reads.readOwnOperation(query)).value,list=(await reads.listOwnOperations({principal,nowMs:query.nowMs})).value.items;
 const round=f.db.prepare('SELECT target_round FROM fair_requests WHERE operation_id=?').get(op.id).target_round;
 sealedTiming([mutation,detail,...list,readOwnOperation(f.db,principal.wallet,op.id),...listOwnOperations(f.db,principal.wallet).items],op,round);
 const assetId=await f.fulfill(),asset=(await reads.readAsset({assetId,nowMs:f.clock.nowMs()})).value;assert.equal(asset.revealStatus,'unrevealed');assert.equal(asset.ownerObservedAt,null);
 await f.reveal(assetId);const fairness=await createCollectionFairnessRepository(f.driver,{crypto:f.ports.crypto,clock:f.clock,beaconVerifier:f.beaconVerifier}).readOwnFairness(f.query());assert.equal(fairness.value.disclosure,'revealed');assert.ok(fairness.value.transcript.requestPreimage.includes(op.created_ms));
});
test('upgrade and visual receipts withhold exact creation time while retaining original internal draw binding',async t=>{
 for(const kind of ['upgrade','visual']){const f=await fairnessProgressionFixture(t,{kind}),reads=createCollectionReadRepository(f.driver),row=f.db.prepare('SELECT result_json FROM app_collection_reservations WHERE operation_id=?').get(f.op.id),mutation=progressionReservationView(JSON.parse(row.result_json));
  const detail=(await reads.readOwnOperation({...f.query,nowMs:f.clock.nowMs()})).value,list=(await reads.listOwnOperations({principal:f.query.principal,nowMs:f.clock.nowMs()})).value.items;
  sealedTiming([mutation,detail,...list],f.op,f.db.prepare('SELECT target_round FROM fair_requests WHERE operation_id=?').get(f.op.id).target_round);
 }
});
