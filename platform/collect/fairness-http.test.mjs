import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createApp} from '../server/application.mjs';
import {createClient} from '../contracts/client.mjs';
import {fairnessRepositoryFixture} from './fairness-repository.fixtures.mjs';
import {handleCollectionFairness} from './fairness-http.mjs';
import {createCollectionFairnessRepository} from './fairness-repository.mjs';
const origin='http://localhost';
test('actual Node owner fairness route is explicit, private, bounded and compatible with generated client',async t=>{
 const f=await fairnessRepositoryFixture(t),asset=await f.fulfill(),app=createApp(f.db),cookie='synthetic-fairness-session';f.db.prepare('INSERT INTO sessions VALUES(?,?,?,?)').run(createHash('sha256').update(cookie).digest('hex'),f.holders[0],origin,Date.now()+60000);
 const headers={cookie:'tenx_local_session='+cookie},path='/api/v1/collect/me/operations/'+f.operations[0].id+'/fairness',call=(suffix='',init={})=>app(new Request(origin+path+suffix,{headers,...init}));
 const cap=await (await app(new Request(origin+'/api/v1/capabilities'))).json();assert.ok(cap.features.some(x=>x.id==='collection-fairness-read'));assert.equal(cap.production.financialExecution,false);
 const closed=await call();assert.equal(closed.status,200);assert.match(closed.headers.get('cache-control'),/private.*no-store/);assert.equal((await closed.json()).transcript,null);
 await f.reveal(asset);const client=createClient({baseUrl:origin+'/api/v1',fetchImpl:(url,init)=>app(new Request(url,{...init,headers:{...Object.fromEntries(new Headers(init.headers)),...headers}}))});const view=(await client.readMyCollectionFairness({path:{id:f.operations[0].id}})).data;assert.equal(view.disclosure,'revealed');assert.equal(view.transcript.selectedAssignment.assetId,asset);assert.equal(view.broadcast,false);
 assert.equal((await call('?x=1')).status,400);assert.equal((await call('',{method:'POST',headers})).status,405);assert.equal((await call('',{headers:{}})).status,401);assert.equal((await app(new Request(origin+path.replace(f.operations[0].id,'missing'),{headers}))).status,404);
 for(let n=0;n<12;n++)await call();assert.equal((await call()).status,429);
 f.db.prepare('UPDATE sessions SET expires_at=0').run();assert.equal((await call()).status,401);
});
test('handler rechecks session after real async verification and disabled service never releases data',async t=>{
 const f=await fairnessRepositoryFixture(t),asset=await f.fulfill();await f.reveal(asset);const repository=createCollectionFairnessRepository(f.driver,{crypto:f.ports.crypto,clock:f.clock,beaconVerifier:f.beaconVerifier}),request=new Request(origin+'/api/v1/collect/me/operations/'+f.operations[0].id+'/fairness');
 for(const changed of [null,{kind:'wallet',wallet:f.holders[1]}]){let calls=0;const response=await handleCollectionFairness(request,{repository,authenticate:async()=>++calls===1?f.query().principal:changed,consumeQuota:async()=>null});assert.equal(response.status,401);assert.ok(!(await response.text()).includes(asset));}
 const response=await handleCollectionFairness(request,{repository:null,authenticate:async()=>f.query().principal,consumeQuota:async()=>null});assert.equal(response.status,503);
});
