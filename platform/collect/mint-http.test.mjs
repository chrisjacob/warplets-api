import test from 'node:test';
import assert from 'node:assert/strict';
import {mintFixture} from './mint-test-fixture.mjs';
import {createMintReservationRepository} from './mint-repository.mjs';
import {createMintReservationService} from './mint-service.mjs';
import {handleMintReservation} from './mint-http.mjs';
// Shared transport boundaries; production wallet sessions are covered by edge/test/mint-http.test.mjs.
test('normalized mint transport binds reviewed terms and preserves accepted replay without exposing draw material',async t=>{
 const f=await mintFixture(t),reservations=createMintReservationService({...f.ports,repository:createMintReservationRepository(f.base,f.ports)});
 let principal=f.principal;const ports={reservations,authenticate:async()=>principal,consumeQuota:async()=>null};
 const url='http://localhost/api/v1/collect/inventories/'+f.input.inventoryId+'/stages/'+f.input.stageId+'/reservations';
 const send=(body,key='synthetic-http-mint',patch={})=>handleMintReservation(new Request(url,{method:'POST',headers:{origin:'http://localhost','content-type':'application/json','idempotency-key':key,...patch},body:JSON.stringify(body)}),ports);
 const terms={expectedTermsDigest:f.published.value.termsDigest};
 assert.equal((await send({...terms,wallet:f.holders[1]})).status,400);
 assert.equal((await send({})).status,400);assert.equal((await send(terms,'origin',{origin:'http://other'})).status,403);
 principal=null;assert.equal((await send(terms)).status,401);principal=f.principal;
 const first=await send(terms);assert.equal(first.status,201);const value=await first.json();assert.equal(value.operation.owner,f.principal.wallet);assert.equal(value.operation.termsDigest,terms.expectedTermsDigest);assert.equal(value.operation.executable,false);assert.equal(value.operation.assetId,null);assert.equal(value.operation.status,'awaiting-evidence');
 for(const key of ['commitment','proof','ticket','slot','traits','level'])assert.equal(Object.hasOwn(value.operation,key),false);
 f.setNow(f.input.closesAt+1000);const retry=await send(terms);assert.equal(retry.status,200);assert.deepEqual((await retry.json()).operation,value.operation);
 assert.equal((await send({expectedTermsDigest:'0'.repeat(64)})).status,409);
 assert.equal(f.db.prepare('SELECT COUNT(*) n FROM app_collection_mint_admissions').get().n,1);
 assert.equal(f.db.prepare('SELECT COUNT(*) n FROM tx_intents').get().n,0);
});

// These transport failures must not enter the repository or leak a quote/draw.
test('mint transport rejects malformed, cross-origin, non-wallet and quota-limited requests before admission',async()=>{
 let calls=0,principal={kind:'wallet',wallet:'synthetic-wallet'},limited=null;const ports={reservations:{async reserveMint(){calls++;throw Error('unexpected admission');}},authenticate:async()=>principal,consumeQuota:async()=>limited};
 const url='http://localhost/api/v1/collect/inventories/synthetic/stages/free/reservations',headers={origin:'http://localhost','content-type':'application/json','idempotency-key':'synthetic-key'},send=(patch={})=>handleMintReservation(new Request(patch.url??url,{method:patch.method??'POST',headers:{...headers,...patch.headers},...(patch.method==='GET'?{}:{body:patch.body??'{}'})}),ports);
 for(const [patch,status]of [[{method:'GET'},405],[{url:url+'?override=1'},400],[{headers:{origin:'http://elsewhere'}},403],[{headers:{'idempotency-key':''}},400],[{headers:{'content-type':'text/plain'}},415],[{body:'{'},400],[{body:JSON.stringify({expectedTermsDigest:'a'.repeat(64),wallet:'other'})},400],[{body:' '.repeat(4097)},413]])assert.equal((await send(patch)).status,status);
 principal=null;assert.equal((await send()).status,401);principal={kind:'operator',id:'synthetic'};assert.equal((await send()).status,403);principal={kind:'wallet',wallet:'synthetic-wallet'};limited=new Response(null,{status:429});assert.equal((await send()).status,429);assert.equal(calls,0);
});
import {openDatabase} from '../storage/database.mjs';
import {createCollection,publishCollectionStage,reserveMint,readInventory} from './store.mjs';
import {encode58} from '../server/base58.mjs';
import {createInventoryReadRepository} from './inventory-read-model.mjs';
import {createNodeAtomicDriver} from '../storage/node/atomic-driver.mjs';
test('Node legacy compatibility validates reviewed digest without inventing normalized authority and Worker reads mark it unavailable',async t=>{
 const db=openDatabase();t.after(()=>db.close());const now=Date.UTC(2026,0,3),wallet=encode58(new Uint8Array(32).fill(1)),inventoryId='synthetic-legacy-reviewed';createCollection(db,{id:inventoryId,kind:'genesis',tranche:1});publishCollectionStage(db,{inventoryId,stage:{id:'first',type:'whitelist',publishedAt:now-172800000,opensAt:now,closesAt:now+86400000,allocation:1000,priceLamports:'100000000',costLamports:'5000',wallets:[wallet],walletLimit:1}},now);
 const termsDigest=readInventory(db,inventoryId,now,wallet).stages[0].termsDigest,request={inventoryId,stageId:'first',wallet,requestKey:'synthetic-reviewed',expectedTermsDigest:termsDigest,now};assert.throws(()=>reserveMint(db,{...request,expectedTermsDigest:'0'.repeat(64)}),e=>e.code==='mint-command-binding');
 const worker=await createInventoryReadRepository(createNodeAtomicDriver(db),{normalizedAdmissionAvailable:true,legacyAdmissionAvailable:false}).readInventory({inventoryId,nowMs:now,principal:{kind:'wallet',wallet}});assert.equal(worker.kind,'ready');assert.equal(worker.value.stages[0].reservationStatus.reason,'admission-unavailable');
 const accepted=reserveMint(db,request);assert.equal(accepted.operation.termsDigest,termsDigest);const retry=reserveMint(db,{...request,now:now+172800000});assert.equal(retry.replayed,true);assert.deepEqual(retry.operation,accepted.operation);assert.throws(()=>reserveMint(db,{...request,expectedTermsDigest:'0'.repeat(64),now:now+172800000}),e=>e.code==='mint-command-binding');assert.equal(db.prepare('SELECT COUNT(*) n FROM app_collection_authorities').get().n,0);
});
