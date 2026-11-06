import test from 'node:test';
import assert from 'node:assert/strict';
import {createCollectionEdgeFixture} from '../application/fixtures/collection-edges.mjs';
import {governanceOperatorFixture,governanceWallets} from '../governance/operator-test-fixture.mjs';
import {createNodeAtomicDriver} from '../storage/node/atomic-driver.mjs';
import {openDatabase} from '../storage/database.mjs';
import {createCollection,readInventory,listInventories,publishCollectionStage} from './store.mjs';
import {createInventoryReadRepository} from './inventory-read-model.mjs';
import {createStagePublicationRepository} from './stage-repository.mjs';
import {createStagePublicationService} from './stage-service.mjs';
import {measureBatch} from '../storage/atomic-driver.mjs';
const ready=r=>{assert.equal(r.kind,'ready',JSON.stringify(r));return r.value;};

test('bounded inventory projections preserve legacy disclosure and wallet-specific eligibility without hydrating private arrays',async t=>{
 const f=await createCollectionEdgeFixture({assetCount:12,startServer:false});t.after(()=>f.close());const base=createNodeAtomicDriver(f.db);let calls=0;
 const repository=createInventoryReadRepository({...base,async batch(statements){calls++;const rows=await base.batch(statements);for(const response of rows)for(const row of response.rows){assert.ok(!Object.hasOwn(row,'state'));assert.ok(!Object.hasOwn(row,'asset'));}return rows;}});
 for(const wallet of [null,f.accounts.original.wallet,f.accounts.buyer.wallet]){
  const principal=wallet?{kind:'wallet',wallet}:null,actual=ready(await repository.listInventories({nowMs:f.nowMs,principal})),expected=listInventories(f.db,{now:f.nowMs,wallet});assert.deepEqual(actual,expected);
  for(const item of actual.items)assert.deepEqual(ready(await repository.readInventory({inventoryId:item.id,nowMs:f.nowMs,principal})),readInventory(f.db,item.id,f.nowMs,wallet));
 }
 assert.ok(calls>0);assert.deepEqual(await repository.readInventory({inventoryId:'missing',nowMs:f.nowMs,principal:null}),{kind:'missing'});
});

test('normalized10000-member stage returns exact public terms and one wallet membership without the stale legacy header',async t=>{
 const f=await governanceOperatorFixture(t,{holders:governanceWallets(10000),nextWhitelist:[]}),reference=openDatabase();t.after(()=>reference.close());
 const inventoryId='synthetic-read-normalized',principal={kind:'operator',id:'synthetic-stage-reader'};createCollection(f.db,{id:inventoryId,kind:'genesis',tranche:1});createCollection(reference,{id:inventoryId,kind:'genesis',tranche:1});f.db.prepare('INSERT INTO app_operator_scopes VALUES(?,?,0,1)').run(principal.id,'collection-publication');
 const input={inventoryId,stageId:'synthetic-read-stage',type:'whitelist',publishedAt:f.getNow(),opensAt:f.getNow()+172800000,closesAt:f.getNow()+259200000,priceLamports:'100000000',costLamports:'500000',allocation:1000,walletLimit:null,founderApproved:false,approvedSpendLamports:null,ballotId:null,inventoryOverrideReason:null,eligibilityListId:f.groups[0].manifest.id,sourceKind:'synthetic-local-operator-fixture'};
 const accepted=await createStagePublicationService({...f.ports,repository:createStagePublicationRepository(f.base,f.ports)}).publishStage(principal,{input,requestKey:'synthetic-publication'});assert.equal(accepted.kind,'committed');
 const {inventoryId:ignored,eligibilityListId,sourceKind,stageId,...terms}=input;publishCollectionStage(reference,{inventoryId,stage:{...terms,id:stageId,wallets:f.holders}},f.getNow());
 const metrics=[],repo=createInventoryReadRepository({...f.base,async batch(statements){metrics.push(measureBatch(statements));const result=await f.base.batch(statements);for(const row of result.flatMap(r=>r.rows))if(row.stages)assert.doesNotMatch(row.stages,new RegExp(f.holders[9999]));return result;}});
 for(const wallet of [null,f.holders[0],governanceWallets(10001).at(-1)]){const expected=readInventory(reference,inventoryId,input.opensAt,wallet);if(expected.stages[0].reservationStatus.status==='available'){expected.stages[0].reservationStatus.status='unavailable';expected.stages[0].reservationStatus.reason='admission-unavailable';}assert.deepEqual(ready(await repo.readInventory({inventoryId,principal:wallet?{kind:'wallet',wallet}:null,nowMs:input.opensAt})),expected);}
 assert.equal(JSON.parse(f.db.prepare('SELECT state FROM collect_inventories').get().state).stages.length,0);
 t.diagnostic(JSON.stringify({members:10000,maxBatchBytes:Math.max(...metrics.map(m=>m.batchBytes)),maxParameters:Math.max(...metrics.map(m=>m.maxParameters)),maxStatements:Math.max(...metrics.map(m=>m.statements)),legacyAggregateHydrated:false,privateListReturned:false}));
});

test('inventory pages are bounded and a changing source or malformed legacy aggregate yields pending without partial results',async t=>{
 const db=openDatabase();t.after(()=>db.close());const base=createNodeAtomicDriver(db),nowMs=Date.parse('2030-01-01T00:00:00Z');
 for(let n=0;n<28;n++)createCollection(db,{id:'synthetic-page-'+String(n).padStart(2,'0'),kind:'season',seasonStart:Date.UTC(2027+Math.floor(n/12),n%12,1)});
 const calls=[],repo=createInventoryReadRepository({...base,async batch(s){calls.push(measureBatch(s));return base.batch(s);}}),first=ready(await repo.listInventories({nowMs,principal:null}));assert.equal(first.items.length,25);assert.equal(first.nextCursor,'synthetic-page-24');assert.equal(ready(await repo.listInventories({nowMs,principal:null,after:first.nextCursor})).items.length,3);assert.ok(calls.every(m=>m.statements<=27&&m.batchBytes<262144));
 let once=false;const changing=createInventoryReadRepository({...base,async batch(s){const result=await base.batch(s);if(!once){once=true;db.prepare("UPDATE app_revisions SET revision=revision+1 WHERE name='source'").run();}return result;}});assert.equal((await changing.listInventories({nowMs,principal:null})).reason,'inventory-read-revision-changed');
 db.prepare('UPDATE collect_inventories SET state=? WHERE id=?').run('x'.repeat(524289),'synthetic-page-00');assert.equal((await repo.listInventories({nowMs,principal:null})).reason,'inventory-header-unavailable');
 assert.throws(()=>repo.listInventories({nowMs,principal:{kind:'operator',id:'untrusted'}}),/principal/);
});

test('inventory reads hold an incomplete recovery target and detect generation replacement between batches',async t=>{
 const db=openDatabase();t.after(()=>db.close());const base=createNodeAtomicDriver(db),repo=createInventoryReadRepository(base),nowMs=Date.parse('2026-11-01T00:00:00Z');
 createCollection(db,{id:'synthetic-recovery-read',kind:'genesis',tranche:1});
 db.prepare("UPDATE app_recovery_state SET status='held' WHERE id=1").run();assert.equal((await repo.listInventories({nowMs,principal:null})).reason,'inventory-read-source-unavailable');
 db.prepare("UPDATE app_recovery_state SET status='live' WHERE id=1").run();let changed=false;
 const racing=createInventoryReadRepository({...base,async batch(s){const result=await base.batch(s);if(!changed){changed=true;db.prepare("UPDATE app_recovery_state SET generation='synthetic-new-generation' WHERE id=1").run();}return result;}});
 assert.equal((await racing.listInventories({nowMs,principal:null})).reason,'inventory-read-revision-changed');
});

test('later Genesis opening holds retain exact legacy wording and admission prerequisites',async t=>{
 const db=openDatabase();t.after(()=>db.close());const repo=createInventoryReadRepository(createNodeAtomicDriver(db)),nowMs=Date.parse('2030-01-01T00:00:00Z');
 for(const tranche of [2,3]){
  const inventoryId='synthetic-later-tranche-'+tranche;createCollection(db,{id:inventoryId,kind:'genesis',tranche});
  assert.deepEqual(ready(await repo.readInventory({inventoryId,nowMs,principal:null})),readInventory(db,inventoryId,nowMs,null));
 }
});
