import {test}from'node:test';import assert from'node:assert/strict';
import{gmgnWindowPlan,collectGmgnWindow}from'./gmgn-window-operator.mjs';
const address='So11111111111111111111111111111111111111112',at=new Date('2026-10-21T07:00:22.000Z');
test('four fixed requests obey pacing and charge each HTTP attempt, with no retry',async()=>{
 let time=at.getTime(),calls=0,waits=0;const plan=gmgnWindowPlan(address,at);
 const call=async d=>{if(d.path==='admin/gmgn/status')return{key_configured:true,retained_research_permitted:true,transport:{next_at:new Date(time+10000).toISOString()}};
  if(d.method==='POST'){calls++;return{state:'retained',provider_requests:1};}return{complete_window:true};};
 const result=await collectGmgnWindow(plan,call,{now:()=>time,sleep:async ms=>{waits++;time+=ms;}});
 assert.equal(result.state,'complete');assert.equal(result.provider_requests,4);assert.equal(calls,4);assert.equal(waits,4);
 assert.equal(Date.parse(plan.requests[3].body.request.start_at)-Date.parse(plan.requests[2].body.request.start_at),3600000);
});
test('provider backoff, failed/pending parts and first failed attempt stop collection without retries',async()=>{
 const plan=gmgnWindowPlan(address,at);let posts=0;
 const limited=await collectGmgnWindow(plan,async()=>({key_configured:true,retained_research_permitted:true,transport:{backoff_until:'2026-10-21T08:00:00.000Z'}}),{now:()=>at.getTime()});assert.equal(limited.reason,'provider_backoff');
 const stopped=await collectGmgnWindow(plan,async d=>d.method==='POST'?(posts++,{state:'failed',provider_requests:1}):{key_configured:true,retained_research_permitted:true,transport:{}},{now:()=>at.getTime()});
 assert.equal(posts,1);assert.equal(stopped.provider_requests,1);assert.equal(stopped.state,'failed');
 const pending=await collectGmgnWindow(plan,async()=>{throw new Error('no IO');},{existing:[{part:0,state:'failed'}]});assert.equal(pending.reason,'existing_failed_or_pending_part');
});
test('resume skips completed slots and reuses the declared window and stable request identities',async()=>{
 const plan=gmgnWindowPlan(address,at),posts=[];
 const result=await collectGmgnWindow(plan,async d=>{
  if(d.method==='POST'){posts.push(d.body.request_id);return{state:'retained',provider_requests:1};}
  if(d.path.endsWith('/status'))return{key_configured:true,retained_research_permitted:true,transport:{}};
  return{complete_window:false};
 },{existing:[{part:0,state:'succeeded'},{part:1,state:'succeeded'}]});
 assert.deepEqual(posts,plan.requests.slice(2).map(v=>v.body.request_id));assert.equal(result.provider_requests,2);
 const resumed=gmgnWindowPlan(address,new Date(at.getTime()+600000),plan.window_id,{start_at:plan.requests[0].body.request.series.start_at,end_at:plan.requests[0].body.request.series.end_at});
 assert.deepEqual(resumed,plan);
});
test('lost local response preserves the window identity and holds unknown IO without leaking errors or retrying',async()=>{
 const plan=gmgnWindowPlan(address,at);let posts=0;
 const result=await collectGmgnWindow(plan,async d=>{
  if(d.method==='POST'){posts++;throw Error('secret-do-not-print');}
  return{key_configured:true,retained_research_permitted:true,transport:{}};
 });
 assert.equal(posts,1);assert.equal(result.state,'held');assert.equal(result.window_id,plan.window_id);
 assert.equal(result.provider_requests,null);assert.equal(result.confirmed_provider_requests,0);
 assert.ok(!JSON.stringify(result).includes('secret-do-not-print'));
});
