import test from 'node:test';
import assert from 'node:assert/strict';
import {openDatabase} from './database.mjs';
import {createNodeAtomicDriver} from './node/atomic-driver.mjs';
import {createNodeCrypto} from '../security/node-crypto.mjs';
import {createCollectionContextRepository,createCollectionContextService} from './collection-context.mjs';
import {seedCollectionContext} from '../application/fixtures/collection-context.mjs';
import {createCollectionQuotePlanning} from '../application/collection-quotes.mjs';
import {quoteProgression} from '../collect/store.mjs';
import {prepareProgression,applyVerifiedProgressionDraw} from '../domain/collections/progression.mjs';
const crypto=createNodeCrypto(),planning=createCollectionQuotePlanning({crypto});
function setup(t){const db=openDatabase();t.after(()=>db.close());const f=seedCollectionContext(db),raw=createNodeAtomicDriver(db),batches=[],repository=createCollectionContextRepository({...raw,async batch(s){batches.push(s);return raw.batch(s);}}),service=createCollectionContextService({repository,clock:{nowMs:()=>f.nowMs}});return {db,f,batches,repository,service};}
const principal=f=>({kind:'wallet',wallet:f.wallet});
const read=(s,f,request=f.request(1))=>s.read(principal(f),{inventoryId:f.inventoryId,request});

test('bounded contexts match legacy upgrade Levels1–9 and Level10 visual quotes, preserving expired/reactivated clocks',async t=>{
 const {db,f,batches,service}=setup(t);
 for(let level=1;level<=10;level++){
  const request=f.request(level,level===10?'visual':'upgrade'),result=await read(service,f,request);assert.equal(result.kind,'ready');assert.equal(batches.at(-1).length,3);assert.ok(batches.at(-1).every(s=>!s.sql.includes('SELECT *')));
  assert.equal(result.context.assets.length,level===10?1:2);assert.equal(result.context.assets[0].ownerObservedAtMs,f.start+1000);assert.ok(Object.isFrozen(result.context.assets[0].traits));
  const old=quoteProgression(db,{inventoryId:f.inventoryId,wallet:f.wallet,request,now:f.nowMs}),q=await planning.derive({quoteId:'synthetic-level-'+level,principal:principal(f),inventoryId:f.inventoryId,request,context:result.context,policyVersion:'synthetic',nowMs:f.nowMs,expiresMs:f.nowMs+15000});
  assert.equal(q.feeLamports,old.feeLamports);assert.equal(q.executable,false);
  if(level<10){assert.equal(q.outcomes.targetAfter.level,old.nextTargetLevel);assert.equal(new Date(q.outcomes.targetAfter.expiresAtMs).toISOString(),old.nextTargetExpiry);assert.deepEqual(q.outcomes.materialOutcomes.map(o=>({level:o.level,expiresAt:new Date(o.expiresAtMs).toISOString(),remainingMs:o.remainingMs,count:o.probabilityNumerator,total:o.probabilityDenominator})),old.materialProbabilities);}
  else assert.equal(q.outcomes.cooldownMs,old.cooldownMs);
 }
 const initial=(await read(service,f)).context;assert.ok(initial.assets.every(a=>a.expiresAt<f.nowMs));
 const state={seasonId:f.inventoryId,start:f.start,assets:initial.assets.map(({inventoryId,revealStatus,ownerObservedAtMs,...a})=>a),operations:[]},request={...f.request(1),operationId:'synthetic-reactivate',commitment:'synthetic-draw',signer:f.wallet,at:f.nowMs};
 const prepared=prepareProgression(state,request),reactivated=applyVerifiedProgressionDraw(prepared,{operationId:request.operationId,commitment:request.commitment,proofId:'synthetic-proof',at:f.nowMs,ticket:489});
 for(const asset of reactivated.assets)db.prepare('UPDATE collect_assets SET asset=?,observed_ms=? WHERE id=?').run(JSON.stringify(asset),f.nowMs,asset.id);
 const current=await read(service,f,{...f.request(1),expectedTargetVersion:2,expectedMaterialVersion:2});assert.equal(current.kind,'ready');assert.ok(current.context.assets.every(a=>a.level===2&&a.expiresAt>f.nowMs));assert.equal(current.context.assets[0].ownerObservedAtMs,f.start+1000);
});

test('concealed or other-owner rows never expose asset JSON or coordinates, and aggregate inventory state is not loaded',async t=>{
 const {db,f,repository,service,batches}=setup(t),target=f.ids(1,'target');
 db.prepare('UPDATE collect_inventories SET state=? WHERE id=?').run('synthetic-not-loaded-'+('x'.repeat(1000000)),f.inventoryId);
 assert.equal((await read(service,f)).kind,'ready');
 db.prepare('UPDATE collect_assets SET reveal_ms=NULL,asset=? WHERE id=?').run('{malformed private concealed level and traits',target);
 const snapshot=await repository.readProgressionContext({wallet:f.wallet,inventoryId:f.inventoryId,assetIds:[target],nowMs:f.nowMs});assert.equal(snapshot.assets[0].assetJson,null);assert.doesNotMatch(JSON.stringify(snapshot),/slotIndex|malformed private|traits/);assert.equal((await read(service,f)).reason,'metadata-unrevealed');
 const other=await repository.readProgressionContext({wallet:f.other,inventoryId:f.inventoryId,assetIds:[f.ids(2,'target')],nowMs:f.nowMs});assert.equal(other.assets[0].assetJson,null);assert.equal(other.assets[0].ownerEvidenceJson,null);
 assert.equal((await service.read({kind:'wallet',wallet:f.other},{inventoryId:f.inventoryId,request:f.request(2)})).reason,'owner-changed');assert.equal(batches.at(-1).length,3);
});

test('actual newest owner evidence, field conflicts, future state, stale versions and byte bounds hold without partial contexts',async t=>{
 const {db,f,service}=setup(t),target=f.ids(1,'target'),original=db.prepare('SELECT * FROM collect_assets WHERE id=?').get(target),observation=db.prepare('SELECT * FROM vault_observations WHERE asset_id=?').get(target);
 const check=async(reason)=>{const result=await read(service,f);assert.equal(result.kind,'unavailable');assert.equal(result.reason,reason);assert.equal(Object.hasOwn(result,'context'),false);};
 db.prepare('UPDATE collect_assets SET observed_ms=? WHERE id=?').run(f.nowMs+1,target);await check('future-or-invalid-observation');db.prepare('UPDATE collect_assets SET observed_ms=? WHERE id=?').run(original.observed_ms,target);
 db.prepare('INSERT INTO vault_observations VALUES(?,?,?,?,?)').run('synthetic-future-owner',target,'transfer',f.nowMs+1000,JSON.stringify({eventId:'synthetic-future-owner',assetId:target,kind:'transfer',at:new Date(f.nowMs+1000).toISOString(),from:f.wallet,to:f.other}));await check('future-owner-observation');db.prepare('DELETE FROM vault_observations WHERE event_id=?').run('synthetic-future-owner');
 const bad=JSON.parse(observation.body);bad.owner=f.other;db.prepare('UPDATE vault_observations SET body=? WHERE event_id=?').run(JSON.stringify(bad),observation.event_id);await check('owner-evidence-conflict');db.prepare('UPDATE vault_observations SET body=? WHERE event_id=?').run(observation.body,observation.event_id);
 for(const [patch,reason] of [[{owner:f.other},'asset-identity-or-state-mismatch'],[{expiresAt:1},'asset-expiry-mismatch'],[{version:1},'asset-version-changed'],[{pending:'synthetic-lock'},'asset-reserved']]){db.prepare('UPDATE collect_assets SET asset=? WHERE id=?').run(JSON.stringify({...JSON.parse(original.asset),...patch}),target);await check(reason);}
 db.prepare('UPDATE collect_assets SET asset=? WHERE id=?').run('x'.repeat(16385),target);await check('asset-byte-bound');
 db.prepare('UPDATE collect_assets SET asset=? WHERE id=?').run(original.asset.replace('"version":0','"version":9,"version":0'),target);await check('invalid-asset-json');
 db.prepare('UPDATE collect_assets SET asset=? WHERE id=?').run(original.asset,target);db.prepare('DELETE FROM vault_observations WHERE event_id=?').run(observation.event_id);await check('owner-evidence-unavailable');
});

test('caller mutation across the database await cannot replace wallet, participants or evaluation time',async t=>{
 const {db,f}=setup(t),raw=createNodeAtomicDriver(db),p=principal(f),input={inventoryId:f.inventoryId,request:f.request(1)},repository=createCollectionContextRepository({...raw,async batch(s){p.wallet=f.other;input.inventoryId='changed';input.request.targetId='changed';return raw.batch(s);}});
 const result=await createCollectionContextService({repository,clock:{nowMs:()=>f.nowMs}}).read(p,input);assert.equal(result.kind,'ready');assert.equal(result.context.assets[0].owner,f.wallet);assert.equal(result.context.assets[0].id,f.ids(1,'target'));
 await assert.rejects(repository.readProgressionContext({wallet:f.wallet,inventoryId:f.inventoryId,assetIds:['a','b','c'],nowMs:f.nowMs}),/invalid-context-query/);
});
