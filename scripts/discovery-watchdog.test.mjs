import {test} from "node:test";
import assert from "node:assert/strict";
import {boundedWatchdogJson,checkDiscovery,publishWatchdog,restartAllowance,watchdogDecision} from "./discovery-watchdog.mjs";
const at=new Date("2026-10-20T00:00:00.000Z"),clock=()=>at;
const status=(edits={})=>({data:{at:at.toISOString(),scope:"local_discovery_operations",provider_requests:0,heartbeat_limit_seconds:1200,state:"healthy",heartbeat_at:at.toISOString(),timer:"recent",...edits}});
test("responsive API with stale timer is independently detected without provider reads",async()=>{
  const calls=[],report=await checkDiscovery(async(url,init)=>{calls.push({url,init});return Response.json(status({heartbeat_at:new Date(at.getTime()-1200001).toISOString(),timer:"stale",state:"degraded"}));},clock);
  assert.equal(report.code,"timer_stale");assert.equal(report.restart_recommended,true);assert.equal(calls.length,1);assert.equal(calls[0].url,"http://127.0.0.1:8794/api/10x/system/operations");assert.equal(calls[0].init.redirect,"manual");assert.equal(calls[0].init.cache,"no-store");
  let state=watchdogDecision(null,report,true);assert.equal(state.action,"observe");state=watchdogDecision(state,report,true);assert.equal(state.action,"observe");assert.equal(watchdogDecision(state,report,true).action,"restart_owned");assert.equal(watchdogDecision(state,report,false).action,"report_unowned");
});
test("backoff, exhausted budgets and intentional pause never trigger a timer restart",async()=>{
  for(const state of ["healthy","degraded","paused"]){const report=await checkDiscovery(async()=>Response.json(status({state})),clock);assert.equal(report.restart_recommended,false);assert.equal(watchdogDecision({failures:2},report,true).failures,0);}
});
test("missing/future heartbeat, false freshness, stale or malformed status fail closed",async()=>{
  for(const [edits,expected] of [[{heartbeat_at:null,timer:"missing"},"timer_missing"],[{heartbeat_at:new Date(at.getTime()+1).toISOString(),timer:"future"},"timer_future"],[{heartbeat_at:new Date(at.getTime()-1800000).toISOString(),timer:"recent"},"timer_stale"],[{provider_requests:1},"invalid_status"],[{at:new Date(at.getTime()+1).toISOString()},"invalid_status"],[{at:new Date(at.getTime()-30001).toISOString()},"invalid_status"]]){
    const report=await checkDiscovery(async()=>Response.json(status(edits)),clock);assert.equal(report.code,expected);assert.equal(report.restart_recommended,true);
  }
  assert.equal((await checkDiscovery(async()=>Response.json({ready:true}),clock)).code,"invalid_status");assert.equal((await checkDiscovery(async()=>{throw new Error("offline");},clock)).code,"api_unreachable");assert.equal((await checkDiscovery(async()=>new Response(null,{status:307,headers:{location:"https://external.invalid"}}),clock)).code,"api_unreachable");
});
test("checker bounds untrusted response bodies and refuses inconsistent restart flags",async()=>{
  await assert.rejects(boundedWatchdogJson(new Response("x".repeat(65537))));assert.throws(()=>watchdogDecision(null,{code:"healthy",restart_recommended:true},true));
});
test("watchdog publication is bounded to its authenticated loopback route",async()=>{
  const report=await checkDiscovery(async()=>Response.json(status()),clock),calls=[];
  assert.equal(await publishWatchdog(report,null,async()=>{throw new Error("no token should not fetch");}),false);
  assert.equal(await publishWatchdog(report,"local-test-token",async(url,init)=>{calls.push({url,init});return Response.json({accepted:true});}),true);
  assert.equal(calls[0].url,"http://127.0.0.1:8794/api/10x/admin/watchdog");assert.equal(calls[0].init.headers.authorization,"Bearer local-test-token");assert.equal(JSON.parse(calls[0].init.body).report.code,"healthy");assert.ok(!JSON.stringify(report).includes("token"));
});
test("restart attempts have a bounded rolling allowance",()=>{
  assert.equal(restartAllowance([at.getTime()-900001,at.getTime()-1],at.getTime()).allowed,true);assert.equal(restartAllowance([at.getTime()-3,at.getTime()-2,at.getTime()-1],at.getTime()).allowed,false);assert.equal(restartAllowance([at.getTime()-900000,at.getTime()-900001,at.getTime()-900002],at.getTime()).allowed,true);
});
