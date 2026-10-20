import assert from "node:assert/strict";
import {existsSync,mkdirSync,readFileSync,writeFileSync} from "node:fs";
import {evaluateLaunch,exampleLaunch} from "../discovery/src/launch-math";
import {feeExampleFromNet} from "../discovery/src/launch-fees";
import {routeExampleFromFees} from "../discovery/src/launch-routes";
import {timedExampleFromRoutes} from "../discovery/src/launch-timed";
import {TimedLaunchResult,LaunchRecord,LaunchList} from "../discovery/src/launch-model";
import {hashJson} from "../discovery/src/solana";
import {StatusResponse} from "../app/src/discovery/client";
import {DEFAULT_POLICY} from "../discovery/src/model";
import v1 from "../discovery/fixtures/recorded/launch-curve-v1.json";
import v2 from "../discovery/fixtures/recorded/launch-fee-v2.json";
import v3 from "../discovery/fixtures/recorded/launch-route-v3.json";
import v4 from "../discovery/fixtures/recorded/launch-cycle-v4.json";
const base="http://127.0.0.1:8794/api/10x",file=new URL("../.tmp/launch-timed-local.json",import.meta.url);
const token=readFileSync(new URL("../discovery/.dev.vars",import.meta.url),"utf8").match(/^TENX_ADMIN_TOKEN=([a-f0-9]{64})\s*$/m)?.[1];assert(token,"Local operator token required");
const call=(path:string,init:RequestInit={})=>fetch(`${base}/${path}`,{...init,signal:AbortSignal.timeout(30000)}),auth={authorization:`Bearer ${token}`};
let body:unknown;
if(existsSync(file))body=JSON.parse(readFileSync(file,"utf8")).request;
else{body={request_id:crypto.randomUUID(),reason:"Review funded timestamp activation, linear opening fees, period boundaries and two-leg rollback",scenario:timedExampleFromRoutes(routeExampleFromFees(feeExampleFromNet(exampleLaunch())))};mkdirSync(new URL("../.tmp/",import.meta.url),{recursive:true});writeFileSync(file,JSON.stringify({request:body},null,2));}
async function checkOld(){let count=0;for(const old of [v1,v2,v3,v4]){const response=await call(`admin/launches/lab/${old.id}`,{headers:auth});assert.ok([200,404].includes(response.status));if(response.status===200){assert.deepEqual(LaunchRecord.parse((await response.json() as {record:unknown}).record),old);count++;}}return count;}
const retainedOld=await checkOld();
async function post(){const response=await call("admin/launches/lab",{method:"POST",headers:{...auth,"content-type":"application/json"},body:JSON.stringify(body)});assert.equal(response.status,200,await response.clone().text());return LaunchRecord.parse((await response.json() as {record:unknown}).record);}
const record=await post(),result=TimedLaunchResult.parse(record.result);assert.deepEqual(await post(),record);assert.equal(await hashJson(evaluateLaunch(record.inputs)),record.result_hash);
const replay=await call(`admin/launches/lab/${record.id}`,{headers:auth});assert.equal(replay.status,200);assert.deepEqual(LaunchRecord.parse((await replay.json() as {record:unknown}).record),record);assert.equal((await call(`admin/launches/lab/${record.id}`)).status,401);assert.equal(await checkOld(),retainedOld);
const listResponse=await call("launches/lab");assert.equal(listResponse.status,200);const list=LaunchList.parse(await listResponse.json());assert(list.runs.some(r=>r.id===record.id));for(const r of list.runs){assert(!("inputs" in r));assert(!("reason" in r));assert.equal(r.result.launch_enabled,false);}
assert.deepEqual(result.actions.map(a=>a.status),["not_active","minimum_output_not_met","simulated","simulated","simulated","simulated","simulated"]);
assert.equal(result.actions[0]!.attempted_fees.length,0);assert.equal(result.steps[0]!.effective_fee_numerator,"500000000");assert.equal(result.steps[1]!.effective_fee_numerator,"377500000");assert.equal(result.steps[2]!.effective_fee_numerator,"10000000");
for(const a of result.actions)if(a.status!=="simulated"){assert.deepEqual(a.after_balances,a.before_balances);assert.deepEqual(a.committed_step_indexes,[]);assert.equal(a.trader_debit_raw,"0");assert.equal(a.trader_output_raw,"0");}
const status=StatusResponse.parse(await (await call("system/status")).json()).data;assert.deepEqual(status.policy,DEFAULT_POLICY);assert.equal(status.capabilities.launches,false);assert.equal(status.capabilities.signing,false);assert.equal(status.capabilities.rewards,false);
writeFileSync(file,JSON.stringify({request:body,record,checks:{retry:"identical",replay:"verified",retained_versions_unchanged:retainedOld,private_access_without_token:401,provider_requests:0,deploy:false}},null,2));
console.log(JSON.stringify({id:record.id,math_revision:result.math_revision,actions:result.actions.map(a=>({offset:(BigInt(a.point)-BigInt(result.activation_point)).toString(),status:a.status,attempted_fees:a.attempted_fees})),retained_versions_unchanged:retainedOld,private_access_without_token:401,source_requests_made_by_this_check:0,evidence_gates_changed:false,launch_enabled:false,activation_verified:false,deploy:false},null,2));
