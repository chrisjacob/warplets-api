import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {openDatabase} from '../storage/database.mjs';
import {createNodeAtomicDriver} from '../storage/node/atomic-driver.mjs';
import {createNodeCrypto} from '../security/node-crypto.mjs';
import {memoryArtifacts} from '../application/fixtures/memory-artifacts.mjs';
import {seedCollectionContext} from '../application/fixtures/collection-context.mjs';
import {dispatchProgressionReservation,reviewedReservation} from './reservation-test-harness.mjs';
import {dispatchCollectionFulfillment,fulfillmentInput,FULFILLMENT_TEST_OPERATOR} from './fulfillment-test-harness.mjs';
import {fulfillProgression} from './store.mjs';
import {roundTime,leadMs} from '../randomness/request-plan.mjs';
import {materializeProgressionDraw} from '../randomness/portable-draw.mjs';
import {canonicalJson} from '../security/canonical.mjs';
const crypto=createNodeCrypto(),proof=JSON.parse(readFileSync(new URL('../beacon/fixtures/round-30000000.json',import.meta.url)));
async function setup(t,{kind='upgrade',configured=false,level=2}={}){
 const db=openDatabase();t.after(()=>db.close());
 const f=seedCollectionContext(db),driver=createNodeAtomicDriver(db),store=memoryArtifacts(),now=configured?roundTime(proof.round)-leadMs:f.nowMs,principal={kind:'wallet',wallet:f.wallet};let seq=0;
 for(const scope of ['evidence-ingest','collection-evidence'])db.prepare('INSERT INTO app_operator_scopes VALUES(?,?,0,1)').run(FULFILLMENT_TEST_OPERATOR.id,scope);
 if(configured)db.prepare('INSERT INTO fair_inventories VALUES(?,?,?,?)').run(f.inventoryId,'a'.repeat(64),JSON.stringify(Object.fromEntries(['model','backdrop','symbol'].map(k=>[k,[{name:'Synthetic first',weight:1},{name:'Synthetic second',weight:1}]]))),f.start);
 const q=await dispatchProgressionReservation({driver,crypto,request:{method:'quote',principal,nowMs:now,idPrefix:'synthetic-quote',input:{requestKey:'synthetic-quote',inventoryId:f.inventoryId,...f.request(level,kind)}}});assert.equal(q.result.kind,'committed',JSON.stringify(q));
 const reservation=await dispatchProgressionReservation({driver,crypto,request:{principal,nowMs:now,idPrefix:'synthetic-reserve',input:reviewedReservation(q.result.value,'synthetic-reserve')}});assert.equal(reservation.result.kind,'committed',JSON.stringify(reservation));
 const op=db.prepare('SELECT * FROM collect_operations WHERE id=?').get(reservation.result.value.operationId),atMs=configured?roundTime(proof.round):now+5000;
 const event={inventoryId:f.inventoryId,operationId:op.id,kind,commitment:op.commitment,provenance:configured?'configured-offline-beacon':'manual-fixture',atMs,proof:configured?proof:{proofId:'synthetic-proof',ticket:kind==='upgrade'?999:null,traits:kind==='visual'?{model:'Synthetic changed',backdrop:'Synthetic dusk',symbol:'Synthetic star'}:null}};
 // This Node command suite injects verifier behavior. Actual pinned BLS is
 // exercised separately by beacon.spec and Node/workerd paired acceptance.
 const call=patch=>dispatchCollectionFulfillment({driver,crypto,store,beaconVerifier:{verifyShortSignature:()=>true},request:{nowMs:atMs+1000,idPrefix:'synthetic-fulfill-'+(++seq),...patch}}),ev=await call({method:'evidence',event});assert.equal(ev.result?.kind,'committed',JSON.stringify(ev));assert.equal(ev.result.value.decision.status,'verified',JSON.stringify(ev));
 return {db,f,store,driver,call,op,event,reservation:reservation.result.value,evidence:ev.result.value,input:fulfillmentInput(ev.result.value,'synthetic-fulfillment')};
}
test('B04-bound upgrade atomically unlocks both assets and retains exact history/receipt; replay precedes revocation and object loss',async t=>{
 const {db,call,input,op,event,store}=await setup(t);assert.throws(()=>fulfillProgression(db,{operationId:op.id,commitment:op.commitment,proofId:'unbound-legacy',at:event.atMs,finalized:true,ticket:999},event.atMs),/Guarded progression/);assert.equal(db.prepare('SELECT COUNT(*) n FROM collect_level_history').get().n,0);
 const accepted=await call({input});assert.equal(accepted.result.kind,'committed',JSON.stringify(accepted));const effect=JSON.parse(db.prepare('SELECT effect_json FROM app_collection_fulfillments').get().effect_json);assert.equal(effect.history.length,2);for(const w of [effect.target,effect.material]){const a=db.prepare('SELECT * FROM collect_assets WHERE id=?').get(w.id);assert.equal(a.asset,w.afterJson);assert.equal(JSON.parse(a.asset).pending,null);assert.equal(a.observed_ms,event.atMs);assert.equal(a.slot,w.slotJson);}
 const stored=db.prepare('SELECT * FROM collect_operations WHERE id=?').get(op.id);assert.equal(stored.evidence_digest,effect.legacyEvidenceDigest);assert.equal(stored.receipt,effect.operationReceiptJson);
 db.prepare("UPDATE app_operator_scopes SET enabled=0 WHERE operator=?").run(FULFILLMENT_TEST_OPERATOR.id);store.objects.clear();const replay=await call({input,nowMs:event.atMs+86400000});assert.equal(replay.result.kind,'replayed');assert.deepEqual(replay.result.value,accepted.result.value);assert.equal(replay.metrics.objectReads,0);assert.equal((await call({input:{...input,evidenceDigest:'c'.repeat(64)}})).result.code,'idempotency_conflict');
 for(const table of ['app_collection_fulfillments','collect_level_history'])assert.throws(()=>db.prepare('DELETE FROM '+table).run(),/immutable/);assert.equal(db.prepare('SELECT COUNT(*) n FROM tx_intents').get().n,0);
});
test('every missing upgrade child aborts all updates, history, fulfillment binding and receipt; lost response replays',async t=>{
 const {db,call,input,op}=await setup(t);for(const fault of ['omit-target','omit-material','omit-history','omit-link','omit-settlement']){const r=await call({input:{...input,requestKey:'synthetic-'+fault},fault});assert.equal(r.error,'mandatory-effects-aborted',JSON.stringify(r));assert.equal(db.prepare('SELECT COUNT(*) n FROM app_collection_fulfillments').get().n,0);assert.equal(db.prepare('SELECT COUNT(*) n FROM collect_level_history').get().n,0);assert.equal(db.prepare('SELECT settled_ms FROM collect_operations WHERE id=?').get(op.id).settled_ms,null);}
 const lost=await call({input,fault:'lost-response'});assert.equal(lost.result.kind,'replayed');assert.equal(db.prepare('SELECT COUNT(*) n FROM app_collection_fulfillments').get().n,1);
});
test('configured draw requires fair-result child and preserves verified exact signed round; visual leaves Level history empty',async t=>{
 const {db,call,input,event}=await setup(t,{configured:true,kind:'visual',level:10});assert.equal((await call({input,fault:'omit-fair'})).error,'mandatory-effects-aborted');assert.equal(db.prepare('SELECT COUNT(*) n FROM fair_results').get().n,0);const accepted=await call({input});assert.equal(accepted.result.kind,'committed',JSON.stringify(accepted));assert.equal(accepted.result.value.provenance,'configured-offline-beacon');assert.equal(accepted.result.value.effectiveMs,event.atMs+1000);assert.equal(db.prepare('SELECT COUNT(*) n FROM collect_level_history').get().n,0);assert.throws(()=>db.prepare("UPDATE fair_results SET fixture='{}'").run(),/immutable/);
});
test('missing/corrupt raw evidence and source/head/scope races leave the original reservation unchanged',async t=>{
 for(const fault of ['missing-object','corrupt-bytes','source-change','head-change','revoke'])await t.test(fault,async t=>{const {db,call,input,op}=await setup(t),r=await call({input,fault});assert.equal(r.injected,true);assert.ok(['pending','conflict'].includes(r.result.kind),JSON.stringify(r));assert.equal(db.prepare('SELECT COUNT(*) n FROM app_collection_fulfillments').get().n,0);assert.equal(db.prepare('SELECT settled_ms FROM collect_operations WHERE id=?').get(op.id).settled_ms,null);});
});
test('an existing configured result is independently checked and retained exactly; changed chosen output cannot be adopted',async t=>{
 const {db,call,input,op,event}=await setup(t,{configured:true}),request=db.prepare('SELECT * FROM fair_requests WHERE operation_id=?').get(op.id),fixture=await materializeProgressionDraw({operation:op,request,randomness:proof.randomness,traitChoices:{}},crypto),correct=canonicalJson(fixture);
 db.prepare('INSERT INTO fair_results VALUES(?,?,?,?,?)').run(op.id,fixture.proofId,canonicalJson(proof),canonicalJson({...fixture,ticket:(fixture.ticket+1)%1000}),event.atMs);
 assert.equal((await call({input})).result.reason,'fulfillment-existing-fair-result-conflict');assert.equal(db.prepare('SELECT COUNT(*) n FROM app_collection_fulfillments').get().n,0);
 db.prepare('UPDATE fair_results SET fixture=? WHERE operation_id=?').run(correct,op.id);const before=db.prepare('SELECT * FROM fair_results WHERE operation_id=?').get(op.id),accepted=await call({input});assert.equal(accepted.result.kind,'committed',JSON.stringify(accepted));assert.deepEqual(db.prepare('SELECT * FROM fair_results WHERE operation_id=?').get(op.id),before);assert.throws(()=>db.prepare('DELETE FROM fair_results WHERE operation_id=?').run(op.id),/immutable/);
});
test('configured completion days after entropy starts a fresh cooldown while stale preparation cannot backdate effects',async t=>{
 const {db,call,input,op,event}=await setup(t,{configured:true,kind:'visual',level:10}),delayedMs=event.atMs+86400000;
 for(const fault of ['advance-in-batch','advance-final-hash']){const stale=await call({input,nowMs:delayedMs,fault,advanceMs:30001});assert.equal(stale.injected,true);assert.equal(stale.result.reason,'fulfillment-preparation-window-expired',JSON.stringify(stale));assert.equal(db.prepare('SELECT COUNT(*) n FROM app_collection_fulfillments').get().n,0);assert.equal(db.prepare('SELECT COUNT(*) n FROM fair_results').get().n,0);}
 const freshMs=delayedMs+30001,accepted=await call({input,nowMs:freshMs});assert.equal(accepted.result.kind,'committed',JSON.stringify(accepted));assert.equal(accepted.result.value.effectiveMs,freshMs);const fair=db.prepare('SELECT * FROM fair_results WHERE operation_id=?').get(op.id),binding=db.prepare('SELECT * FROM app_collection_fulfillments WHERE operation_id=?').get(op.id),effect=JSON.parse(binding.effect_json),asset=JSON.parse(effect.target.afterJson);
 assert.equal(JSON.parse(fair.fixture).at,event.atMs);assert.equal(fair.settled_ms,freshMs);assert.equal(asset.eligibleAt,freshMs+3600000);assert.equal(asset.rerolls,1);assert.equal(JSON.parse(effect.operationReceiptJson).at,freshMs);assert.equal(db.prepare('SELECT settled_ms FROM collect_operations WHERE id=?').get(op.id).settled_ms,freshMs);
 const replay=await call({input,nowMs:freshMs+86400000});assert.equal(replay.result.kind,'replayed');assert.deepEqual(replay.result.value,accepted.result.value);assert.equal(JSON.parse(db.prepare('SELECT asset FROM collect_assets WHERE id=?').get(effect.target.id).asset).eligibleAt,asset.eligibleAt);
});
