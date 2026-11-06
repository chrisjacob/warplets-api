import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {openDatabase} from '../storage/database.mjs';
import {createNodeAtomicDriver} from '../storage/node/atomic-driver.mjs';
import {createNodeCrypto} from '../security/node-crypto.mjs';
import {seedCollectionContext} from '../application/fixtures/collection-context.mjs';
import {dispatchProgressionReservation,reviewedReservation} from './reservation-test-harness.mjs';
import {prepareCollectionFulfillment} from './fulfillment-plan.mjs';
import {roundTime,leadMs} from '../randomness/request-plan.mjs';
import {seasonExpiry} from '../domain/collections/policy.mjs';
import {fulfillProgression} from './store.mjs';
const crypto=createNodeCrypto(),proof=JSON.parse(readFileSync(new URL('../beacon/fixtures/round-30000000.json',import.meta.url)));
async function fixture(t,{kind='upgrade',level=2,configured=false}={}){
 const db=openDatabase();t.after(()=>db.close());const f=seedCollectionContext(db),driver=createNodeAtomicDriver(db),nowMs=configured?roundTime(proof.round)-leadMs:f.nowMs,principal={kind:'wallet',wallet:f.wallet};
 if(configured)db.prepare('INSERT INTO fair_inventories VALUES(?,?,?,?)').run(f.inventoryId,'a'.repeat(64),JSON.stringify(Object.fromEntries(['model','backdrop','symbol'].map(k=>[k,[{name:'synthetic one',weight:2},{name:'synthetic two',weight:1}]]))),f.start);
 const q=await dispatchProgressionReservation({driver,crypto,request:{method:'quote',principal,nowMs,idPrefix:'synthetic-quote',input:{requestKey:'synthetic-quote',inventoryId:f.inventoryId,...f.request(level,kind)}}});assert.equal(q.result.kind,'committed',JSON.stringify(q));
 const reserved=await dispatchProgressionReservation({driver,crypto,request:{principal,nowMs,idPrefix:'synthetic-reserve',input:reviewedReservation(q.result.value,'synthetic-reserve')}});assert.equal(reserved.result.kind,'committed',JSON.stringify(reserved));
 const operation=db.prepare('SELECT * FROM collect_operations WHERE id=?').get(reserved.result.value.operationId),reservation=db.prepare('SELECT * FROM app_collection_reservations WHERE operation_id=?').get(operation.id),ids=[reservation.target_id,...(reservation.material_id?[reservation.material_id]:[])],atMs=configured?roundTime(proof.round):nowMs+5000;
 const value={input:{operationId:operation.id,evidenceReceiptId:'a'.repeat(64),evidenceDigest:'b'.repeat(64)},event:{inventoryId:f.inventoryId,operationId:operation.id,kind,commitment:operation.commitment,provenance:configured?'configured-offline-beacon':'manual-fixture',atMs,proof:configured?proof:{proofId:'synthetic-proof',ticket:kind==='upgrade'?999:null,traits:kind==='visual'?{model:'Synthetic new',backdrop:'Synthetic new',symbol:'Synthetic new'}:null}},operation,reservation,inventory:db.prepare('SELECT id,kind,tranche,season_start FROM collect_inventories WHERE id=?').get(f.inventoryId),assets:ids.map(id=>db.prepare('SELECT * FROM collect_assets WHERE id=?').get(id)),vaults:ids.map(id=>db.prepare('SELECT * FROM vault_assets WHERE id=?').get(id)),owners:ids.map(id=>db.prepare("SELECT * FROM vault_observations WHERE asset_id=? AND kind IN ('bind','transfer') ORDER BY observed_ms DESC,rowid DESC LIMIT 1").get(id)),fairPolicy:db.prepare('SELECT * FROM fair_inventories WHERE inventory_id=?').get(f.inventoryId)??null,fairRequest:db.prepare('SELECT * FROM fair_requests WHERE operation_id=?').get(operation.id)??null,existingFairResult:null,holdCount:0,snapshotConflict:false,nowMs:atMs+1000};
 return {f,value};
}
test('pure fulfillment retains fixed slots and historical allocations while applying shared upgrade/reactivation math',async t=>{
 for(const level of [1,2,9]){const {f,value}=await fixture(t,{level}),plan=await prepareCollectionFulfillment(value,crypto,null);assert.equal(plan.result.status,'fulfilled');assert.equal(plan.result.executable,false);assert.equal(plan.effect.history.length,2);assert.equal(plan.effect.fairResult,null);
  const target=JSON.parse(plan.effect.target.afterJson),material=JSON.parse(plan.effect.material.afterJson);assert.equal(target.level,level+1);assert.equal(material.level,10);assert.equal(target.expiresAt,seasonExpiry(f.start,level+1));assert.equal(material.expiresAt,seasonExpiry(f.start,10));assert.equal(target.pending,null);assert.equal(material.pending,null);assert.equal(target.version,2);assert.equal(material.version,2);assert.equal(plan.effect.target.slotJson,value.assets[0].slot);assert.equal(plan.effect.material.vaultCoordsJson,value.vaults[1].coords);assert.deepEqual(target.traits,JSON.parse(value.assets[0].asset).traits);
 }
});
test('visual fulfillment starts cooldown at effective fulfillment and changes neither Level nor history',async t=>{
 const {value}=await fixture(t,{kind:'visual',level:10});value.event.atMs+=86400000;value.nowMs=value.event.atMs+1000;const plan=await prepareCollectionFulfillment(value,crypto,null),after=JSON.parse(plan.effect.target.afterJson),before=JSON.parse(value.assets[0].asset);assert.equal(after.eligibleAt,value.event.atMs+3600000);assert.equal(after.rerolls,1);assert.equal(after.level,10);assert.equal(after.expiresAt,before.expiresAt);assert.deepEqual(after.traits,value.event.proof.traits);assert.deepEqual(plan.effect.history,[]);assert.equal(plan.effect.material,null);
});
test('permanent holds, ownership/lock changes, future evidence and already sealed allocation history stay unavailable',async t=>{
 const {value}=await fixture(t);for(const mutate of [v=>v.holdCount=1,v=>v.assets[0].owner='changed',v=>v.assets[0].asset=JSON.stringify({...JSON.parse(v.assets[0].asset),version:2}),v=>v.event.atMs=v.nowMs+1,v=>v.snapshotConflict=true,v=>v.owners[0].observed_ms=v.nowMs+1,v=>v.reservation.fair_policy_hash='a'.repeat(64),v=>v.operation.settled_ms=v.event.atMs]){const changed=structuredClone(value);mutate(changed);await assert.rejects(prepareCollectionFulfillment(changed,crypto,null));}
 let changed=false;const original=structuredClone(value),plan=await prepareCollectionFulfillment(value,{...crypto,async sha256(bytes){if(!changed){changed=true;value.event.proof.ticket=0;value.assets[0].owner='changed';}return crypto.sha256(bytes);}},null);assert.equal(plan.result.operationId,original.operation.id);assert.equal(JSON.parse(plan.effect.material.afterJson).level,10);
});
test('configured plan requires pinned verifier and original exact request, never manual fallback or caller outcome',async t=>{
 const {value}=await fixture(t,{configured:true});await assert.rejects(prepareCollectionFulfillment(value,crypto,null),/verifier unavailable/);await assert.rejects(prepareCollectionFulfillment(value,crypto,{verifyShortSignature:()=>false}),/verification failed/);
 // This isolated test exercises trusted-port wiring only. Actual noble BLS
 // verification runs separately in beacon and real Worker acceptance.
 const plan=await prepareCollectionFulfillment(value,crypto,{verifyShortSignature:()=>true});assert.equal(plan.effect.fairResult.signedRoundJson,JSON.stringify(Object.fromEntries(Object.entries(proof).sort(([a],[b])=>a.localeCompare(b)))));assert.equal(plan.result.effectiveMs,value.nowMs);assert.equal(plan.result.provenance,'configured-offline-beacon');
 for(const mutate of [v=>v.event.provenance='manual-fixture',v=>v.fairRequest.target_round++,v=>v.fairRequest.context_digest='b'.repeat(64),v=>v.fairPolicy.policy_hash='b'.repeat(64)]){const changed=structuredClone(value);mutate(changed);await assert.rejects(prepareCollectionFulfillment(changed,crypto,{verifyShortSignature:()=>true}));}
});
test('upgrade and visual effects preserve exact unguarded legacy asset, receipt and evidence-digest bytes',async t=>{
 for(const kind of ['upgrade','visual']){
  const {value}=await fixture(t,{kind}),plan=await prepareCollectionFulfillment(value,crypto,null),reference=openDatabase();t.after(()=>reference.close());seedCollectionContext(reference);
  // Copy only synthetic reference operation/current participant rows, without
  // guarded reservation linkage, so the legacy comparison remains its own lane.
  const keys=Object.keys(value.operation);reference.prepare('INSERT INTO collect_operations ('+keys.join(',')+') VALUES('+keys.map(()=>'?').join(',')+')').run(...Object.values(value.operation));
  for(const a of value.assets)reference.prepare('UPDATE collect_assets SET asset=?,observed_ms=? WHERE id=?').run(a.asset,a.observed_ms,a.id);
  fulfillProgression(reference,plan.fixture,value.nowMs);const old=reference.prepare('SELECT * FROM collect_operations WHERE id=?').get(value.operation.id);assert.equal(plan.effect.legacyEvidenceDigest,old.evidence_digest);assert.equal(plan.effect.operationReceiptJson,old.receipt);
  for(const w of [plan.effect.target,plan.effect.material].filter(Boolean))assert.equal(w.afterJson,reference.prepare('SELECT asset FROM collect_assets WHERE id=?').get(w.id).asset);
 }
});
