import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {openDatabase} from '../storage/database.mjs';
import {createNodeAtomicDriver} from '../storage/node/atomic-driver.mjs';
import {createNodeCrypto} from '../security/node-crypto.mjs';
import {seedCollectionContext} from '../application/fixtures/collection-context.mjs';
import {createCollectionQuoteRepository} from './quote-repository.mjs';
import {createCollectionQuoteService} from './quote-service.mjs';
import {handleProgression} from './progression-http.mjs';
const origin='http://127.0.0.1:8765';
function fixture(t){
 const db=openDatabase();t.after(()=>db.close());const f=seedCollectionContext(db),crypto=createNodeCrypto(),principal={kind:'wallet',wallet:f.wallet};
 const quotes=createCollectionQuoteService({crypto,repository:createCollectionQuoteRepository({...createNodeAtomicDriver(db),leaseNowSql:String(f.nowMs)},{crypto,ids:{next:randomUUID},clock:{nowMs:()=>f.nowMs}})});
 let reserved=null;const ports={quotes,authenticate:async()=>principal,consumeQuota:async()=>null,reservations:{async reserve(p,input){reserved={p,input};return {kind:'pending',reason:'test-reservation-unmounted',dependencyIds:[]};}}};
 const request=(body,options={})=>new Request(origin+'/api/v1/collect/inventories/'+f.inventoryId+'/progression'+(options.quote===false?'':'/quote')+(options.query??''),{method:options.method??'POST',headers:{origin,'content-type':'application/json','idempotency-key':options.key??'http-test',...options.headers},...(options.method==='GET'?{}:{body:typeof body==='string'?body:JSON.stringify(body)})});
 return {db,f,ports,principal,request,get reserved(){return reserved;}};
}
test('private progression transport rejects bypasses before invoking either command',async t=>{
 const h=fixture(t),body=h.f.request(1);let calls=0;const ports={...h.ports,quotes:{async issueQuote(){calls++;throw Error('Unexpected issuance');}},reservations:{async reserve(){calls++;throw Error('Unexpected reservation');}}};
 const cases=[
  [h.request(body,{method:'GET'}),405], [h.request(body,{query:'?wallet=other'}),400],
  [h.request(body,{headers:{origin:'http://other.invalid'}}),403], [h.request(body,{headers:{'idempotency-key':''}}),400],
  [h.request(body,{headers:{'content-type':'text/plain'}}),415], [h.request('x'.repeat(4097)),413],
  [h.request({...body,inventoryId:'other'}),400], [h.request({...body,requestKey:'body-key'}),400],
  [h.request({...body,wallet:'caller-wallet'}),400], [h.request({...body,quoteId:'caller-quote'}),400],
  [h.request(body,{quote:false}),400], [h.request({}),400], [h.request('{'),400],
  [h.request('{"kind":"visual","targetId":"target","expectedTargetVersion":1e999}'),400],
 ];
 for(const [request,status]of cases){const response=await handleProgression(request,ports);assert.equal(response.status,status);assert.equal(response.headers.get('cache-control'),'no-store');}
 assert.equal((await handleProgression(h.request(body),{...ports,authenticate:async()=>null})).status,401);
 assert.equal((await handleProgression(h.request(body),{...ports,consumeQuota:async()=>new Response(null,{status:429})})).status,429);
 assert.equal(await handleProgression(new Request(origin+'/api/v1/collect/inventories'),ports),null);assert.equal(calls,0);
});
test('quote HTTP projection retains persisted review bindings and original expiry across accepted retry',async t=>{
 const h=fixture(t),body=h.f.request(1),response=await handleProgression(h.request(body),h.ports);assert.equal(response.status,200);const q=await response.json();
 assert.equal(q.targetVersion,body.expectedTargetVersion);assert.equal(q.materialVersion,body.expectedMaterialVersion);assert.equal(q.quoteExpiresMs,h.f.nowMs+120000);
 assert.equal(q.nextTargetLevel,2);assert.equal(q.materialProbabilities.length,10);assert.equal(q.materialProbabilities.reduce((sum,r)=>sum+r.count,0),1000);assert.equal(q.totalCost,'unknown');assert.equal(q.ceilingScope,'disclosed-local-components-only');assert.equal(q.executable,false);
 const stored=JSON.parse(h.db.prepare('SELECT body_json FROM app_collection_quotes WHERE id=?').get(q.quoteId).body_json);assert.equal(q.bindingDigest,stored.bindingDigest);assert.equal(q.asOf,new Date(stored.asOfMs).toISOString());
 h.db.prepare('UPDATE collect_assets SET owner=? WHERE id=?').run(h.f.other,body.targetId);
 const replay=await handleProgression(h.request(body),h.ports);assert.deepEqual(await replay.json(),q);assert.equal(h.db.prepare('SELECT COUNT(*) n FROM app_collection_quotes').get().n,1);
 const changed=await handleProgression(h.request({...body,maxTotalLamports:'20000000'}),h.ports);assert.equal(changed.status,409);
 const reviewed={...body,quoteId:q.quoteId,bindingDigest:q.bindingDigest,policyVersion:q.policyVersion,reviewedFeeLamports:q.feeLamports,reviewedMaxTotalLamports:q.maxTotalLamports,quoteExpiresMs:q.quoteExpiresMs};
 const held=await handleProgression(h.request(reviewed,{quote:false,key:'reservation-key'}),h.ports);assert.equal(held.status,503);assert.equal(h.reserved.input.inventoryId,h.f.inventoryId);assert.equal(h.reserved.input.requestKey,'reservation-key');assert.deepEqual(h.reserved.p,h.principal);
 assert.equal(h.db.prepare('SELECT COUNT(*) n FROM collect_operations').get().n,0);
});

test('changed participant facts require refresh while broken source evidence remains unavailable',async t=>{
 const h=fixture(t),body=h.f.request(1);
 for(const [reason,status]of [['owner-changed',409],['asset-version-changed',409],['asset-reserved',409],['quote-storage-conflict',503],['quote-clock-unavailable',503]]){
  const response=await handleProgression(h.request(body),{...h.ports,quotes:{async issueQuote(){return {kind:'pending',reason,dependencyIds:[]};}}});
  assert.equal(response.status,status,reason);assert.equal((await response.json()).error.code,reason);
 }
});
