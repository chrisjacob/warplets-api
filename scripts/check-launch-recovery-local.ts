import assert from "node:assert/strict";
import {existsSync,mkdirSync,readFileSync,writeFileSync} from "node:fs";
import {RecoveryRecord,RecoveryList,RecoveryRequest} from "../discovery/src/launch-recovery-model";
import {recoveryExample,evaluateRecovery} from "../discovery/src/launch-recovery-math";
import {hashJson} from "../discovery/src/solana";
import {StatusResponse} from "../app/src/discovery/client";
import {DEFAULT_POLICY} from "../discovery/src/model";
const base="http://127.0.0.1:8794/api/10x",file=new URL("../.tmp/launch-recovery-local.json",import.meta.url);
const token=readFileSync(new URL("../discovery/.dev.vars",import.meta.url),"utf8").match(/^TENX_ADMIN_TOKEN=([a-f0-9]{64})\s*$/m)?.[1];assert(token,"Local operator token required");
const call=(path:string,init:RequestInit={})=>fetch(`${base}/${path}`,{...init,signal:AbortSignal.timeout(30000)}),auth={authorization:`Bearer ${token}`};
async function gates(){const status=StatusResponse.parse(await (await call("system/status")).json()).data;assert.equal(status.local_only,true);assert.deepEqual(status.policy,DEFAULT_POLICY);for(const capability of ["launches","signing","rewards","social_publishing"] as const)assert.equal(status.capabilities[capability],false);}
await gates();
const requests=existsSync(file)?JSON.parse(readFileSync(file,"utf8")).requests:["lost_response","missing_lock"].map(kind=>({request_id:crypto.randomUUID(),reason:`Local hypothetical launch recovery review: ${kind}`,scenario:recoveryExample(kind as "lost_response"|"missing_lock")}));
assert.equal(requests.length,2);mkdirSync(new URL("../.tmp/",import.meta.url),{recursive:true});writeFileSync(file,JSON.stringify({requests},null,2));
const records=[];
for(const raw of requests){const request=RecoveryRequest.parse(raw);await gates();const post=()=>call("admin/launches/recovery-lab",{method:"POST",headers:{...auth,"content-type":"application/json"},body:JSON.stringify(request)});
  const response=await post();assert.equal(response.status,200,await response.clone().text());const record=RecoveryRecord.parse((await response.json() as {record:unknown}).record);
  const retry=await post();assert.equal(retry.status,200);assert.deepEqual(RecoveryRecord.parse((await retry.json() as {record:unknown}).record),record);assert.equal(await hashJson(evaluateRecovery(record.inputs)),record.result_hash);
  const replay=await call(`admin/launches/recovery-lab/${record.id}`,{headers:auth});assert.equal(replay.status,200);assert.deepEqual(RecoveryRecord.parse((await replay.json() as {record:unknown}).record),record);assert.equal((await call(`admin/launches/recovery-lab/${record.id}`)).status,401);
  assert(record.result.steps.every(p=>p.attempts===1&&p.effects===1));assert.equal(record.result.steps[0]!.tx_alias,"sim-tx-create_token-1");assert.equal(record.result.launch_enabled,false);assert.equal(record.result.publishing_enabled,false);records.push(record);
}
assert.equal(records[0]!.result.modeled_state,"ACTIVE");assert.equal(records[0]!.result.modeled_announcements,1);assert.equal(records[1]!.result.modeled_announcements,0);
const response=await call("launches/recovery-lab");assert.equal(response.status,200);const list=RecoveryList.parse(await response.json());for(const record of records)assert(list.runs.some(r=>r.id===record.id));for(const r of list.runs){assert(!("inputs" in r));assert(!("reason" in r));}
await gates();writeFileSync(file,JSON.stringify({requests,records,checks:{retries:"identical",replay:"verified",source_requests:0,evidence_gates_changed:false,deploy:false}},null,2));
console.log(JSON.stringify({exercises:records.map(r=>({id:r.id,modeled_state:r.result.modeled_state,mock_token_creations:r.result.steps[0]!.effects,modeled_announcements:r.result.modeled_announcements})),source_requests:0,evidence_gates_changed:false,actual_transactions:0,actual_publications:0,deploy:false},null,2));
