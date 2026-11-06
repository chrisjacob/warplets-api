import test from 'node:test';import assert from 'node:assert/strict';
import {createOperatorApp} from './console.mjs';import {createNodeCostReadiness} from './cost-readiness-transport.mjs';
import {economicPlanFixture,economicPlanRequest} from '../storage/economic-plans.fixtures.mjs';
const origin='http://127.0.0.1:4174',bootToken='synthetic-cost-review-bootstrap-code-32-characters';
async function fixture(t,{service}={}){
 const f=await economicPlanFixture(t),prepared=await f.repo.prepare(economicPlanRequest());assert.equal(prepared.kind,'committed');
 const real=createNodeCostReadiness(f.db,{driver:f.driver,clock:()=>f.clock.nowMs()}),handler=createOperatorApp(f.db,{bootToken,clock:()=>f.clock.nowMs(),costReadiness:service?service(f):real});
 const request=(path,token,body)=>new Request(origin+'/ops/'+path,{method:body?'POST':'GET',headers:{origin,'content-type':'application/json',...(token?{authorization:'Bearer '+token}:{})},body:body?JSON.stringify(body):undefined});
 const login=await handler(request('login',null,{code:bootToken}));assert.equal(login.status,200);const {sessionToken}=await login.json();
 const params=new URLSearchParams({owner:f.principal.wallet,intentId:prepared.value.intentId,preparationId:prepared.value.preparationId}),url='cost-readiness?'+params;
 return {...f,handler,request,sessionToken,url,params,prepared,grant(){f.db.prepare("INSERT INTO app_operator_scopes VALUES('local-founder','cost-review',0,1)").run();}};
}
test('operator cost review requires explicit scope, preserves owner selection and only reads genuine retained plan/usage',async t=>{
 const f=await fixture(t);assert.equal((await f.handler(f.request(f.url))).status,401);assert.equal((await f.handler(f.request(f.url,f.sessionToken))).status,403);f.grant();
 const before=f.db.prepare('SELECT total_changes() n').get().n,r=await f.handler(f.request(f.url,f.sessionToken));assert.equal(r.status,200);assert.equal(r.headers.get('cache-control'),'no-store');const report=await r.json();assert.equal(report.kind,'report',JSON.stringify(report));assert.equal(report.value.preparation.planDigest,f.prepared.value.planDigest);assert.equal(report.value.financialExecution,false);assert.equal(report.value.costs.sourceAuthority,'caller-supplied-unverified');assert.equal(report.value.spendReview.status,'not-assessed');assert.equal(report.value.comparisons.firstAtt.selected,null);assert.equal(f.db.prepare('SELECT total_changes() n').get().n,before);
 const p=new URLSearchParams(f.params);p.set('owner','So11111111111111111111111111111111111111112');assert.deepEqual(await (await f.handler(f.request('cost-readiness?'+p,f.sessionToken))).json(),{kind:'missing'});
 for(const suffix of ['&owner='+f.principal.wallet,'&context=forged'])assert.equal((await f.handler(f.request(f.url+suffix,f.sessionToken))).status,400);
 assert.equal((await f.handler(f.request('cost-readiness?owner=bad',f.sessionToken))).status,400);
});
test('scope revoked during awaited calculation suppresses private report',async t=>{
 const f=await fixture(t,{service:f=>({async read(){f.db.prepare("UPDATE app_operator_scopes SET enabled=0,revision=revision+1 WHERE scope='cost-review'").run();return {kind:'report',value:{secret:'private-cost-canary'}};}})});f.grant();
 const r=await f.handler(f.request(f.url,f.sessionToken));assert.equal(r.status,403);assert.ok(!(await r.text()).includes('private-cost-canary'));
});
test('session expiry during awaited calculation suppresses report through normal authentication error',async t=>{
 const f=await fixture(t,{service:f=>({async read(){f.setNow(f.clock.nowMs()+3*3600000);return {kind:'report',value:{secret:'expired-cost-canary'}};}})});f.grant();
 const r=await f.handler(f.request(f.url,f.sessionToken));assert.equal(r.status,401);assert.ok(!(await r.text()).includes('expired-cost-canary'));
});
