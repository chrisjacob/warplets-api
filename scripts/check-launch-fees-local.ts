import assert from "node:assert/strict";
import {existsSync,mkdirSync,readFileSync,writeFileSync} from "node:fs";
import {evaluateLaunch,exampleLaunch} from "../discovery/src/launch-math";
import {feeExampleFromNet} from "../discovery/src/launch-fees";
import {FeeLaunchResult,LaunchRecord,LaunchList} from "../discovery/src/launch-model";
import {hashJson} from "../discovery/src/solana";
import {StatusResponse} from "../app/src/discovery/client";
import {DEFAULT_POLICY} from "../discovery/src/model";
import oldV1 from "../discovery/fixtures/recorded/launch-curve-v1.json";
const base="http://127.0.0.1:8794/api/10x",file=new URL("../.tmp/launch-fees-local.json",import.meta.url);
const token=readFileSync(new URL("../discovery/.dev.vars",import.meta.url),"utf8").match(/^TENX_ADMIN_TOKEN=([a-f0-9]{64})\s*$/m)?.[1];assert(token,"Local operator token required");
const call=(path:string,init:RequestInit={})=>fetch(`${base}/${path}`,{...init,signal:AbortSignal.timeout(30000)});
const auth={authorization:`Bearer ${token}`};
let body:unknown;
if(existsSync(file))body=JSON.parse(readFileSync(file,"utf8")).request;
else{body={request_id:crypto.randomUUID(),reason:"Review hypothetical quote-only static fee debits, receipts and separate principal",scenario:feeExampleFromNet(exampleLaunch())};mkdirSync(new URL("../.tmp/",import.meta.url),{recursive:true});writeFileSync(file,JSON.stringify({request:body},null,2));}
const oldResponse=await call(`admin/launches/lab/${oldV1.id}`,{headers:auth});assert.ok([200,404].includes(oldResponse.status));const retainedOld=oldResponse.status===200?LaunchRecord.parse((await oldResponse.json() as {record:unknown}).record):null;if(retainedOld)assert.deepEqual(retainedOld,oldV1);
async function post(){const response=await call("admin/launches/lab",{method:"POST",headers:{...auth,"content-type":"application/json"},body:JSON.stringify(body)});assert.equal(response.status,200,await response.clone().text());return LaunchRecord.parse((await response.json() as {record:unknown}).record);}
const record=await post();assert.deepEqual(await post(),record);const result=FeeLaunchResult.parse(record.result);assert.equal(await hashJson(evaluateLaunch(record.inputs)),record.result_hash);
const replay=await call(`admin/launches/lab/${record.id}`,{headers:auth});assert.equal(replay.status,200);assert.deepEqual(LaunchRecord.parse((await replay.json() as {record:unknown}).record),record);assert.equal((await call(`admin/launches/lab/${record.id}`)).status,401);
if(retainedOld){const oldAgain=await call(`admin/launches/lab/${oldV1.id}`,{headers:auth});assert.equal(oldAgain.status,200);assert.deepEqual(LaunchRecord.parse((await oldAgain.json() as {record:unknown}).record),retainedOld);}
const listResponse=await call("launches/lab");assert.equal(listResponse.status,200);const list=LaunchList.parse(await listResponse.json());assert(list.runs.some(r=>r.id===record.id));for(const run of list.runs){assert(!("inputs" in run));assert(!("reason" in run));assert.equal(run.result.launch_enabled,false);}
for(const p of result.pools){const rows=result.steps.filter(s=>s.pool===p.pool);for(const key of ["total_fee_raw","lp_claiming_fee_raw","protocol_fee_raw","referral_fee_raw"] as const)assert.equal(BigInt(p.fee_totals[key]),rows.reduce((sum,s)=>sum+BigInt(s[key]),0n));}
const buy=result.steps[1]!,sell=result.steps[2]!;assert.equal(BigInt(buy.trader_debit_raw),BigInt(buy.net_input_raw)+BigInt(buy.total_fee_raw));assert.equal(BigInt(sell.curve_output_raw),BigInt(sell.trader_output_raw)+BigInt(sell.total_fee_raw));assert.equal(result.steps.at(-1)!.status,"minimum_output_not_met");assert.equal(result.steps.at(-1)!.total_fee_raw,"0");
const status=StatusResponse.parse(await (await call("system/status")).json()).data;assert.deepEqual(status.policy,DEFAULT_POLICY);assert.equal(status.capabilities.launches,false);assert.equal(status.capabilities.signing,false);assert.equal(status.capabilities.rewards,false);
writeFileSync(file,JSON.stringify({request:body,record,checks:{retry:"identical",replay:"verified",retained_v1_unchanged:Boolean(retainedOld),private_access_without_token:401,provider_requests:0,deploy:false}},null,2));
console.log(JSON.stringify({id:record.id,math_revision:result.math_revision,probe_results:result.steps.map(s=>s.status),quote_fee_totals:result.pools.map(p=>({asset:p.quote_asset,...p.fee_totals})),retained_v1_unchanged:Boolean(retainedOld),source_requests_made_by_this_check:0,evidence_gates_changed:false,launch_enabled:false,deploy:false},null,2));
