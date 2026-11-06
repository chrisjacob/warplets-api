import test from 'node:test';
import assert from 'node:assert/strict';
import {createCollectionReadRepository} from './read-model.mjs';
import {createCollectionEdgeFixture} from '../application/fixtures/collection-edges.mjs';
import {createNodeAtomicDriver} from '../storage/node/atomic-driver.mjs';
import {readCollectionAsset,listOwnedAssets,listOwnOperations,readOwnOperation,reserveProgression} from './store.mjs';
import {createNodeCrypto} from '../security/node-crypto.mjs';
import {dispatchProgressionReservation,reviewedReservation} from './reservation-test-harness.mjs';
import {dispatchCollectionObservation,observationInput,OBSERVATION_TEST_OPERATOR} from './observation-test-harness.mjs';
import {memoryArtifacts} from '../application/fixtures/memory-artifacts.mjs';
import {handleCollectionReads} from './read-http.mjs';
const crypto=createNodeCrypto();
async function fixture(t,assetCount=28){const f=await createCollectionEdgeFixture({assetCount,startServer:false});t.after(()=>f.close());const driver=createNodeAtomicDriver(f.db);return {...f,driver,repo:createCollectionReadRepository(driver),principal:{kind:'wallet',wallet:f.accounts.original.wallet}};}
const ready=r=>{assert.equal(r.kind,'ready',JSON.stringify(r));return r.value;};
test('bounded asset and operation pages exactly preserve legacy Node DTOs and concealed metadata stays inside SQL',async t=>{
 const f=await fixture(t);let calls=0,maximumRows=0;
 const repo=createCollectionReadRepository({...f.driver,async batch(statements){calls++;assert.equal(statements.length,3);assert.ok(statements.every(s=>!s.sql.includes('inventory.state')));const rows=await f.driver.batch(statements);maximumRows=Math.max(maximumRows,...rows.map(r=>r.rows.length));for(const row of rows[1].rows)if(row.reveal_ms===null)assert.equal(row.asset_json,null);return rows;}});
 for(const id of ['synthetic-genesis-before','synthetic-genesis-late','synthetic-season-000'])assert.deepEqual(ready(await repo.readAsset({assetId:id,nowMs:f.nowMs})),readCollectionAsset(f.db,id));
 for(const method of ['listOwnedAssets','listOwnOperations']){let after='';do{const actual=ready(await repo[method]({principal:f.principal,nowMs:f.nowMs,after})),expected=(method==='listOwnedAssets'?listOwnedAssets:listOwnOperations)(f.db,f.principal.wallet,after);assert.deepEqual(actual,expected);after=actual.nextCursor;}while(after);}
 assert.equal(maximumRows,26);assert.equal(calls,7);
 const first=listOwnOperations(f.db,f.principal.wallet).items[0];assert.deepEqual(ready(await repo.readOwnOperation({principal:f.principal,operationId:first.id,nowMs:f.nowMs})),readOwnOperation(f.db,f.principal.wallet,first.id));
 assert.deepEqual(await repo.readOwnOperation({principal:{kind:'wallet',wallet:f.accounts.buyer.wallet},operationId:first.id,nowMs:f.nowMs}),{kind:'missing'});
 assert.deepEqual(await repo.readAsset({assetId:'missing',nowMs:f.nowMs}),{kind:'missing'});
});
test('read input is captured before await; invalid principals, source races and bounded malformed bodies fail closed',async t=>{
 const f=await fixture(t,2),principal={...f.principal};let seen;
 const mutating=createCollectionReadRepository({...f.driver,async batch(s){seen=s;principal.wallet=f.accounts.buyer.wallet;return f.driver.batch(s);}});
 assert.deepEqual(ready(await mutating.listOwnedAssets({principal,nowMs:f.nowMs})),listOwnedAssets(f.db,f.principal.wallet));assert.equal(seen[1].values[1],f.principal.wallet);
 assert.throws(()=>f.repo.listOwnedAssets({principal:{kind:'operator',id:'x'},nowMs:f.nowMs}),/principal/);
 const racing=createCollectionReadRepository({...f.driver,async batch(s){const result=await f.driver.batch(s);result[2].rows[0].revision=String(BigInt(result[2].rows[0].revision)+1n);return result;}});
 assert.equal((await racing.readAsset({assetId:'synthetic-season-000',nowMs:f.nowMs})).reason,'collection-read-revision-changed');
 f.db.prepare('UPDATE collect_assets SET asset=?,reveal_ms=NULL WHERE id=?').run('x'.repeat(16385),'synthetic-genesis-late');assert.equal(ready(await f.repo.readAsset({assetId:'synthetic-genesis-late',nowMs:f.nowMs})).revealStatus,'unrevealed');
 f.db.prepare('UPDATE collect_assets SET asset=? WHERE id=?').run('x'.repeat(16385),'synthetic-season-000');assert.equal((await f.repo.readAsset({assetId:'synthetic-season-000',nowMs:f.nowMs})).reason,'asset-body-unavailable');
 const op=listOwnOperations(f.db,f.principal.wallet).items[0];f.db.prepare('UPDATE collect_operations SET operation=? WHERE id=?').run('{bad',op.id);assert.equal((await f.repo.readOwnOperation({principal:f.principal,operationId:op.id,nowMs:f.nowMs})).reason,'operation-body-unavailable');
});
test('guarded quote identity and actual B04 transfer holds survive owner return without exposing private proof or the operation to the buyer',async t=>{
 const f=await fixture(t,2),store=memoryArtifacts();let seq=0;const dispatch=patch=>dispatchProgressionReservation({driver:f.driver,crypto,request:{principal:f.principal,nowMs:f.nowMs,idPrefix:'read-reserve-'+(++seq),...patch}});
 const q=await dispatch({method:'quote',input:{requestKey:'read-quote',inventoryId:f.seasonId,kind:'upgrade',targetId:'synthetic-season-000',materialId:'synthetic-season-001',expectedTargetVersion:0,expectedMaterialVersion:0}});assert.equal(q.result.kind,'committed',JSON.stringify(q));
 const reserved=await dispatch({input:reviewedReservation(q.result.value,'read-reservation')});assert.equal(reserved.result.kind,'committed',JSON.stringify(reserved));const opId=reserved.result.value.operationId;
 const original=ready(await f.repo.readOwnOperation({principal:f.principal,operationId:opId,nowMs:f.nowMs}));assert.equal(original.quoteId,q.result.value.id);assert.equal(original.bindingDigest,q.result.value.bindingDigest);assert.equal(original.reconciliation,undefined);
 for(const scope of ['evidence-ingest','collection-evidence'])f.db.prepare('INSERT INTO app_operator_scopes VALUES(?,?,0,1)').run(OBSERVATION_TEST_OPERATOR.id,scope);
 const events=[{id:'away',kind:'transfer',observedMs:f.nowMs-1000,from:f.principal.wallet,to:f.accounts.buyer.wallet},{id:'back',kind:'transfer',observedMs:f.nowMs+2000,from:f.accounts.buyer.wallet,to:f.principal.wallet}];
 const call=patch=>dispatchCollectionObservation({driver:f.driver,crypto,store,request:{nowMs:f.nowMs+10000,idPrefix:'read-observe-'+(++seq),...patch}});let supersedes=null;
 for(const [index,event] of events.entries()){
  const evidence=await call({method:'evidence',inventoryId:f.seasonId,assetId:'synthetic-season-000',events,recordId:event.id,supersedes});assert.equal(evidence.result.kind,'committed',JSON.stringify(evidence));const receipt=evidence.result.value;supersedes=receipt.receiptDigest;
  const observed=await call({input:observationInput(receipt,{requestKey:'read-'+event.id,expectedAssetVersion:index+1})});assert.equal(observed.result.kind,'committed',JSON.stringify(observed));
  const held=ready(await f.repo.readOwnOperation({principal:f.principal,operationId:opId,nowMs:f.nowMs+10000}));assert.equal(held.status,'awaiting-evidence');assert.deepEqual(held.reconciliation,{status:'held',reason:'external-transfer',observedAt:new Date(events[0].observedMs).toISOString()});assert.equal(held.quoteId,original.quoteId);assert.doesNotMatch(JSON.stringify(held),/receiptDigest|evidence_receipt|commitment|from_wallet|to_wallet/);
  assert.equal((await f.repo.readOwnOperation({principal:{kind:'wallet',wallet:f.accounts.buyer.wallet},operationId:opId,nowMs:f.nowMs+10000})).kind,'missing');
  const asset=ready(await f.repo.readAsset({assetId:'synthetic-season-000',nowMs:f.nowMs+10000}));assert.equal(asset.owner,event.to);assert.equal(asset.operationPending,true);assert.equal(asset.reconciliation,undefined);
 }
});
test('shared read transport preserves public/private boundaries, exact routes, methods, cursor and owner quota',async t=>{
 const f=await fixture(t,2);let authenticate=0,quota=0;
 const ports={reads:f.repo,clock:{nowMs:()=>f.nowMs},authenticate:async request=>{authenticate++;return request.headers.get('cookie')==='owner'?f.principal:null;},consumeQuota:async(bucket,limit)=>{quota++;assert.equal(bucket,'collect-owner:'+f.principal.wallet);assert.equal(limit,60);return quota>2?new Response('{}',{status:429}):null;}};
 const call=(path,options={})=>handleCollectionReads(new Request('http://localhost/api/v1/collect/'+path,options),ports);
 assert.equal((await call('assets/synthetic-season-000')).status,200);assert.equal(authenticate,0);assert.equal(quota,0);
 assert.equal((await call('me/assets')).status,401);assert.equal((await call('me/assets',{headers:{cookie:'owner'}})).status,200);
 assert.equal((await call('me/assets?cursor=x&cursor=y',{headers:{cookie:'owner'}})).status,400);assert.equal((await call('assets/synthetic-season-000?cursor=x')).status,400);
 assert.equal((await call('me/operations',{method:'POST',headers:{cookie:'owner'}})).status,405);
 assert.equal((await call('me/operations',{headers:{cookie:'owner'}})).status,200);assert.equal((await call('me/operations',{headers:{cookie:'owner'}})).status,429);
 assert.equal(await call('inventories'),null);assert.equal(await call('inventories/x/progression'),null);
});
test('conflicting owner evidence, oversized scalars, future reveals and inconsistent fulfilled operations remain unavailable',async t=>{
 const f=await fixture(t,2),id='synthetic-season-000',asset=f.db.prepare('SELECT * FROM collect_assets WHERE id=?').get(id),owner=f.db.prepare("SELECT * FROM vault_observations WHERE asset_id=? AND kind IN ('bind','transfer') ORDER BY observed_ms DESC,rowid DESC LIMIT 1").get(id);
 f.db.prepare('UPDATE vault_assets SET owner=? WHERE id=?').run(f.accounts.buyer.wallet,id);assert.equal((await f.repo.readAsset({assetId:id,nowMs:f.nowMs})).reason,'owner-observation-unavailable');f.db.prepare('UPDATE vault_assets SET owner=? WHERE id=?').run(asset.owner,id);
 f.db.prepare('UPDATE vault_observations SET body=? WHERE event_id=?').run(JSON.stringify({...JSON.parse(owner.body),owner:f.accounts.buyer.wallet}),owner.event_id);assert.equal((await f.repo.readAsset({assetId:id,nowMs:f.nowMs})).reason,'owner-observation-conflict');f.db.prepare('UPDATE vault_observations SET body=? WHERE event_id=?').run(owner.body,owner.event_id);
 let captured;const repo=createCollectionReadRepository({...f.driver,async batch(s){const r=await f.driver.batch(s);captured=r[1].rows[0];return r;}});
 f.db.prepare('UPDATE collect_assets SET owner=? WHERE id=?').run('x'.repeat(100000),id);assert.equal((await repo.readAsset({assetId:id,nowMs:f.nowMs})).kind,'pending');assert.equal(captured.owner,null);f.db.prepare('UPDATE collect_assets SET owner=? WHERE id=?').run(asset.owner,id);
 f.db.prepare('UPDATE collect_assets SET reveal_ms=? WHERE id=?').run(f.nowMs+1000,id);assert.equal((await repo.readAsset({assetId:id,nowMs:f.nowMs})).kind,'pending');assert.equal(captured.asset_json,null);f.db.prepare('UPDATE collect_assets SET reveal_ms=? WHERE id=?').run(asset.reveal_ms,id);
 const op=f.db.prepare('SELECT * FROM collect_operations WHERE owner=? LIMIT 1').get(f.principal.wallet),receipt=JSON.parse(op.receipt);delete receipt.assetId;f.db.prepare('UPDATE collect_operations SET receipt=? WHERE id=?').run(JSON.stringify(receipt),op.id);assert.equal((await f.repo.readOwnOperation({principal:f.principal,operationId:op.id,nowMs:f.nowMs})).reason,'operation-settlement-inconsistent');
 f.db.prepare('UPDATE collect_operations SET receipt=?,operation=? WHERE id=?').run(op.receipt,JSON.stringify({...JSON.parse(op.operation),targetId:'forged-target'}),op.id);assert.equal((await f.repo.readOwnOperation({principal:f.principal,operationId:op.id,nowMs:f.nowMs})).reason,'operation-shape-invalid');
});
test('fulfilled upgrade and visual receipts preserve original fees, participants and retained outcome identity',async t=>{
 const f=await fixture(t,4);
 for(const [kind,targetId,materialId] of [['upgrade','synthetic-season-000','synthetic-season-001'],['visual','synthetic-season-002',undefined]]){
  const operation=reserveProgression(f.db,{inventoryId:f.seasonId,wallet:f.principal.wallet,requestKey:'read-fulfilled-'+kind,request:{kind,targetId,materialId,expectedTargetVersion:0,...(materialId?{expectedMaterialVersion:0}:{})},now:f.nowMs}).operation;
  f.fulfill(operation.id,kind==='visual'?{traits:{model:'Synthetic reroll',backdrop:'Synthetic backdrop',symbol:'Synthetic symbol'}}:{ticket:0});
  assert.deepEqual(ready(await f.repo.readOwnOperation({principal:f.principal,operationId:operation.id,nowMs:f.nowMs})),readOwnOperation(f.db,f.principal.wallet,operation.id));
  const row=f.db.prepare('SELECT receipt FROM collect_operations WHERE id=?').get(operation.id);f.db.prepare('UPDATE collect_operations SET receipt=? WHERE id=?').run(JSON.stringify({...JSON.parse(row.receipt),assetId:'wrong-target'}),operation.id);assert.equal((await f.repo.readOwnOperation({principal:f.principal,operationId:operation.id,nowMs:f.nowMs})).reason,'operation-settlement-inconsistent');
 }
});
