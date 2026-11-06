import test from 'node:test';
import assert from 'node:assert/strict';
import {openDatabase} from '../storage/database.mjs';
import {createNodeAtomicDriver} from '../storage/node/atomic-driver.mjs';
import {createNodeCrypto} from '../security/node-crypto.mjs';
import {seedCollectionContext} from '../application/fixtures/collection-context.mjs';
import {memoryArtifacts} from '../application/fixtures/memory-artifacts.mjs';
import {dispatchCollectionObservation,observationInput,OBSERVATION_TEST_OPERATOR} from './observation-test-harness.mjs';
import {dispatchProgressionReservation,reviewedReservation} from './reservation-test-harness.mjs';
import {fulfillProgression} from './store.mjs';
const crypto=createNodeCrypto();
function setup(t){const db=openDatabase();t.after(()=>db.close());const f=seedCollectionContext(db),driver=createNodeAtomicDriver(db),store=memoryArtifacts();let seq=0;
 for(const scope of ['evidence-ingest','collection-evidence'])db.prepare('INSERT INTO app_operator_scopes VALUES(?,?,0,1)').run(OBSERVATION_TEST_OPERATOR.id,scope);
 const call=patch=>dispatchCollectionObservation({driver,crypto,store,request:{nowMs:f.nowMs+10000,idPrefix:'synthetic-observe-'+(++seq),...patch}});
 const evidence=async(assetId,events,recordId=events[0].id,supersedes=null,nowMs=f.nowMs+10000)=>{const r=await call({method:'evidence',inventoryId:f.inventoryId,assetId,events,recordId,supersedes,nowMs});assert.ok(['committed','replayed'].includes(r.result?.kind),JSON.stringify(r));assert.equal(r.result.value.decision.status,'verified',JSON.stringify(r));return r.result.value;};
 const reserve=async(level=2)=>{const principal={kind:'wallet',wallet:f.wallet},q=await dispatchProgressionReservation({driver,crypto,request:{method:'quote',principal,nowMs:f.nowMs,idPrefix:'synthetic-quote',input:{requestKey:'synthetic-quote',inventoryId:f.inventoryId,...f.request(level)}}});assert.equal(q.result.kind,'committed');const r=await dispatchProgressionReservation({driver,crypto,request:{principal,nowMs:f.nowMs,idPrefix:'synthetic-reserve',input:reviewedReservation(q.result.value,'synthetic-reserve')}});assert.equal(r.result.kind,'committed');return r.result;};
 return {db,f,driver,store,call,evidence,reserve};}
test('actual B04-bound normal transfer updates Collect and Vault together, retains slots, and replays after grant revocation and object loss',async t=>{
 const {db,f,store,call,evidence}=setup(t),assetId=f.ids(1,'target'),before=db.prepare('SELECT * FROM collect_assets WHERE id=?').get(assetId),vaultBefore=db.prepare('SELECT * FROM vault_assets WHERE id=?').get(assetId),receipt=await evidence(assetId,[{id:'transfer',kind:'transfer',observedMs:f.nowMs,from:f.wallet,to:f.other}]),input=observationInput(receipt,{requestKey:'synthetic-transfer',expectedAssetVersion:0});
 const r=await call({input});assert.equal(r.result.kind,'committed',JSON.stringify(r));assert.equal(r.result.value.resultKind,'applied');assert.equal(r.result.value.owner,f.other);
 const after=db.prepare('SELECT * FROM collect_assets WHERE id=?').get(assetId),vault=db.prepare('SELECT * FROM vault_assets WHERE id=?').get(assetId);assert.equal(after.owner,f.other);assert.equal(vault.owner,f.other);assert.equal(after.slot,before.slot);assert.equal(vault.slot_key,vaultBefore.slot_key);assert.equal(vault.coords,vaultBefore.coords);assert.deepEqual(JSON.parse(after.asset),{...JSON.parse(before.asset),owner:f.other,version:1});
 const binding=db.prepare('SELECT * FROM app_collection_observation_bindings').get(),effect=JSON.parse(binding.effect_json),vo=db.prepare('SELECT * FROM vault_observations WHERE event_id=?').get(effect.vaultEventId);assert.equal(vo.body,JSON.stringify({eventId:vo.event_id,assetId,kind:'transfer',at:new Date(f.nowMs).toISOString(),from:f.wallet,to:f.other}));
 for(const sql of ['DELETE FROM collect_observations WHERE source_id=?','UPDATE collect_observations SET digest=digest WHERE source_id=?'])assert.throws(()=>db.prepare(sql).run(binding.source_id),/immutable/);
 assert.throws(()=>db.prepare('DELETE FROM vault_observations WHERE event_id=?').run(vo.event_id),/immutable/);
 db.prepare("UPDATE app_operator_scopes SET enabled=0 WHERE operator=? AND scope='collection-evidence'").run(OBSERVATION_TEST_OPERATOR.id);store.objects.clear();const replay=await call({input});assert.equal(replay.result.kind,'replayed');assert.deepEqual(replay.result.value,r.result.value);assert.equal(replay.metrics.objectReads,0);
 assert.equal((await call({input:{...input,expectedAssetVersion:1}})).result?.code,'idempotency_conflict');
});
test('reveal changes only reveal clock, preserves concealed payload, and cannot accept caller finality or forged command approval',async t=>{
 const {db,f,call,evidence}=setup(t),assetId=f.ids(1,'material');db.prepare('UPDATE collect_assets SET reveal_ms=NULL WHERE id=?').run(assetId);const before=db.prepare('SELECT * FROM collect_assets WHERE id=?').get(assetId),receipt=await evidence(assetId,[{id:'reveal',kind:'reveal',observedMs:f.nowMs,from:null,to:null}]),input=observationInput(receipt,{requestKey:'synthetic-reveal',expectedAssetVersion:0});
 assert.equal((await call({input,method:'forged'})).status,500);const r=await call({input});assert.equal(r.result.kind,'committed',JSON.stringify(r));assert.equal(r.result.value.revealMs,f.nowMs);assert.equal(r.result.value.assetVersion,0);assert.equal(db.prepare('SELECT asset FROM collect_assets WHERE id=?').get(assetId).asset,before.asset);assert.equal(db.prepare("SELECT COUNT(*) n FROM vault_observations WHERE kind='transfer'").get().n,0);
 assert.doesNotMatch(JSON.stringify(r.result.value),/slotIndex|Synthetic ink|traits|level/);
});
test('late external transfer updates observed owner but retains pending operation and permanent hold even after owner returns',async t=>{
 const {db,f,call,evidence,reserve}=setup(t),reservation=await reserve(),assetId=f.ids(2,'target'),events=[{id:'away',kind:'transfer',observedMs:f.nowMs-1000,from:f.wallet,to:f.other},{id:'back',kind:'transfer',observedMs:f.nowMs+2000,from:f.other,to:f.wallet}],receipt=await evidence(assetId,events),input=observationInput(receipt,{requestKey:'synthetic-away',expectedAssetVersion:1});
 const r=await call({input});assert.equal(r.result.kind,'committed',JSON.stringify(r));assert.equal(r.result.value.resultKind,'held');assert.equal(r.result.value.operationId,reservation.value.operationId);
 const row=db.prepare('SELECT * FROM collect_assets WHERE id=?').get(assetId);assert.equal(row.owner,f.other);assert.equal(row.observed_ms,f.nowMs);assert.equal(JSON.parse(row.asset).pending,reservation.value.operationId);assert.equal(JSON.parse(row.asset).version,2);assert.equal(db.prepare('SELECT latest_ms FROM vault_assets WHERE id=?').get(assetId).latest_ms,f.nowMs-1000);
 const back=await evidence(assetId,events,'back',receipt.receiptDigest),returned=await call({input:observationInput(back,{requestKey:'synthetic-back',expectedAssetVersion:2})});assert.equal(returned.result.kind,'committed',JSON.stringify(returned));assert.equal(returned.result.value.resultKind,'held');assert.equal(returned.result.value.owner,f.wallet);assert.equal(db.prepare('SELECT COUNT(*) n FROM app_collection_operation_conflicts').get().n,2);
 const op=db.prepare('SELECT * FROM collect_operations WHERE id=?').get(reservation.value.operationId);assert.throws(()=>fulfillProgression(db,{operationId:op.id,commitment:op.commitment,proofId:'synthetic-proof',at:f.nowMs+5000,finalized:true,ticket:0},f.nowMs+5000),/operation_lock_mismatch/);assert.throws(()=>db.prepare('UPDATE collect_operations SET settled_ms=? WHERE id=?').run(f.nowMs+5000,op.id),/unresolved external-transfer/);
 // Even a synthetic repair that restores the old lock version cannot erase
 // the independently retained hold or permit legacy fulfillment to commit.
 const returnedAsset=db.prepare('SELECT asset FROM collect_assets WHERE id=?').get(assetId).asset;db.prepare('UPDATE collect_assets SET asset=? WHERE id=?').run(JSON.stringify({...JSON.parse(returnedAsset),version:1}),assetId);const repaired=db.prepare('SELECT asset FROM collect_assets WHERE id=?').get(assetId).asset;
 assert.throws(()=>fulfillProgression(db,{operationId:op.id,commitment:op.commitment,proofId:'synthetic-proof-after-repair',at:f.nowMs+5000,finalized:true,ticket:0},f.nowMs+5000),/unresolved external-transfer/);assert.equal(db.prepare('SELECT asset FROM collect_assets WHERE id=?').get(assetId).asset,repaired);db.prepare('UPDATE collect_assets SET asset=? WHERE id=?').run(returnedAsset,assetId);
 assert.equal(db.prepare('SELECT COUNT(*) n FROM collect_level_history').get().n,0);assert.equal(db.prepare('SELECT COUNT(*) n FROM tx_intents').get().n,0);
});
test('every omitted observation child rolls back owner, Vault, hold and receipt effects',async t=>{
 const {db,f,call,evidence,reserve}=setup(t);await reserve(3);const assetId=f.ids(3,'target'),receipt=await evidence(assetId,[{id:'transfer',kind:'transfer',observedMs:f.nowMs+1000,from:f.wallet,to:f.other}]);
 for(const fault of ['omit-asset','omit-vault','omit-vault-observation','omit-collect-observation','omit-conflict','omit-binding']){
  const r=await call({input:observationInput(receipt,{requestKey:'synthetic-'+fault,expectedAssetVersion:1}),fault});assert.equal(r.error,'mandatory-effects-aborted',JSON.stringify(r));assert.equal(db.prepare('SELECT owner FROM collect_assets WHERE id=?').get(assetId).owner,f.wallet);assert.equal(db.prepare('SELECT owner FROM vault_assets WHERE id=?').get(assetId).owner,f.wallet);assert.equal(db.prepare('SELECT COUNT(*) n FROM app_collection_operation_conflicts').get().n,0);assert.equal(db.prepare('SELECT COUNT(*) n FROM app_collection_observation_bindings').get().n,0);
 }
 const lost=await call({input:observationInput(receipt,{requestKey:'synthetic-lost',expectedAssetVersion:1}),fault:'lost-response'});assert.equal(lost.result.kind,'replayed');assert.equal(lost.result.value.resultKind,'held');
});
test('missing/corrupt raw objects, changed source head and revoked grant cannot authorize observed ownership',async t=>{
 for(const fault of ['missing-object','corrupt-bytes','head-change','revoke'])await t.test(fault,async t=>{const {db,f,call,evidence}=setup(t),assetId=f.ids(4,'target'),receipt=await evidence(assetId,[{id:'transfer',kind:'transfer',observedMs:f.nowMs,from:f.wallet,to:f.other}]),r=await call({input:observationInput(receipt,{requestKey:'synthetic-'+fault,expectedAssetVersion:0}),fault});assert.equal(r.injected,true);assert.ok(['pending','conflict'].includes(r.result.kind),JSON.stringify(r));assert.equal(db.prepare('SELECT owner FROM collect_assets WHERE id=?').get(assetId).owner,f.wallet);assert.equal(db.prepare('SELECT COUNT(*) n FROM app_collection_observation_bindings').get().n,0);});
});
test('oversized corrupted columns are bounded in SQL before hydration and cannot apply ownership evidence',async t=>{
 for(const [table,column,max,trigger] of [
  ['collect_assets','asset',16384,null],['collect_assets','slot',4096,null],['vault_assets','coords',4096,null],['vault_assets','slot_key',4096,null],
  ['app_evidence_sources','config_json',65536,'app_evidence_sources_no_update'],['app_evidence_receipts','envelope_json',16384,'app_evidence_receipts_no_update'],['app_evidence_receipts','decision_json',16384,'app_evidence_receipts_no_update'],
 ])await t.test(table+'.'+column,async t=>{
  const {db,f,call,evidence}=setup(t),assetId=f.ids(5,'target'),receipt=await evidence(assetId,[{id:'transfer',kind:'transfer',observedMs:f.nowMs,from:f.wallet,to:f.other}]);
  // Simulate pre-existing database corruption in this disposable test only;
  // reinstall the exact immutable trigger before invoking product code.
  const ddl=trigger?db.prepare('SELECT sql FROM sqlite_master WHERE name=?').get(trigger).sql:null;if(trigger)db.exec('DROP TRIGGER '+trigger);
  const assetTable=table==='collect_assets'||table==='vault_assets';db.prepare('UPDATE '+table+' SET '+column+'=?'+(assetTable?' WHERE id=?':'')).run(JSON.stringify({syntheticOversizedCorruption:'x'.repeat(max)}),...(assetTable?[assetId]:[]));if(ddl)db.exec(ddl);
  const r=await call({input:observationInput(receipt,{requestKey:'synthetic-oversized',expectedAssetVersion:0})});assert.equal(r.result.reason,'observation-read-byte-bound',JSON.stringify(r));assert.equal(r.metrics.objectReads,0);assert.ok(r.metrics.maxResultBytes<16384,JSON.stringify(r.metrics));assert.equal(db.prepare('SELECT COUNT(*) n FROM app_collection_observation_bindings').get().n,0);
 });
});
