import assert from "node:assert/strict";
import {existsSync,mkdirSync,readFileSync,writeFileSync} from "node:fs";
import {evaluateLaunch,exampleLaunch} from "../discovery/src/launch-math";
import {LaunchList,LaunchRecord} from "../discovery/src/launch-model";
import {hashJson} from "../discovery/src/solana";
import {DEFAULT_POLICY} from "../discovery/src/model";
import {StatusResponse} from "../app/src/discovery/client";
const base="http://127.0.0.1:8794/api/10x",file=new URL("../.tmp/launch-curve-local.json",import.meta.url);
const token=readFileSync(new URL("../discovery/.dev.vars",import.meta.url),"utf8").match(/^TENX_ADMIN_TOKEN=([a-f0-9]{64})\s*$/m)?.[1];assert(token,"Local operator token required");
let body:unknown;
if(existsSync(file))body=JSON.parse(readFileSync(file,"utf8")).request;
else{body={request_id:crypto.randomUUID(),reason:"Review local hypothetical three-pool net curve math; no execution",scenario:exampleLaunch()};mkdirSync(new URL("../.tmp/",import.meta.url),{recursive:true});writeFileSync(file,JSON.stringify({request:body},null,2));}
async function call(path:string,options:RequestInit={}){return fetch(`${base}/${path}`,{...options,signal:AbortSignal.timeout(30000)});}
async function post(){const response=await call("admin/launches/lab",{method:"POST",headers:{"content-type":"application/json",authorization:`Bearer ${token}`},body:JSON.stringify(body)});assert.equal(response.status,200,await response.clone().text());return LaunchRecord.parse((await response.json() as {record:unknown}).record);}
const record=await post();assert.deepEqual(await post(),record);
const replay=await call(`admin/launches/lab/${record.id}`,{headers:{authorization:`Bearer ${token}`}});assert.equal(replay.status,200);assert.deepEqual(LaunchRecord.parse((await replay.json() as {record:unknown}).record),record);
assert.equal(await hashJson(evaluateLaunch(record.inputs)),record.result_hash);assert.equal((await call(`admin/launches/lab/${record.id}`)).status,401);
const listResponse=await call("launches/lab");assert.equal(listResponse.status,200);assert.equal(listResponse.headers.get("cache-control"),"no-store");const list=LaunchList.parse(await listResponse.json());assert(list.runs.some(r=>r.id===record.id));
for(const summary of list.runs){assert(!("inputs" in summary));assert(!("reason" in summary));assert.equal(summary.result.launch_enabled,false);assert.equal(summary.result.transfers_enabled,false);}
const status=StatusResponse.parse(await (await call("system/status")).json()).data;assert.deepEqual(status.policy,DEFAULT_POLICY);assert.equal(status.capabilities.launches,false);assert.equal(status.capabilities.signing,false);assert.equal(status.capabilities.rewards,false);
assert.equal(record.result.pools[1]!.initial.quote_raw,"0");assert.equal(record.result.pools[2]!.initial.quote_raw,"0");assert.equal(record.result.steps[0]!.status,"range_exhausted");assert.equal(record.result.steps.at(-1)!.status,"range_exhausted");
assert.equal(record.result.provider_requests,0);assert.equal(record.result.fees_modeled,false);assert.equal(record.result.locks_verified,false);
writeFileSync(file,JSON.stringify({request:body,record,checks:{retry:"identical",replay:"verified",private_access_without_token:401,provider_requests:0,deploy:false}},null,2));
console.log(JSON.stringify({id:record.id,math_revision:record.result.math_revision,pools:record.result.pools.map(p=>({quote:p.quote_asset,attn_share_pct:p.allocation_bps/100,initial_quote_raw:p.initial.quote_raw})),campaign_reserve_raw:record.result.campaign_reserve_raw,probe_results:record.result.steps.map(s=>s.status),replay:"verified",private_access_without_token:401,source_requests_made_by_this_check:0,evidence_gates_changed:false,launch_enabled:false,deploy:false},null,2));
