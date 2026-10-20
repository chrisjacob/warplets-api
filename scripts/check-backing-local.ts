import assert from "node:assert/strict";
import { mkdirSync,readFileSync,writeFileSync,existsSync } from "node:fs";
import { BackingListResponse,BackingRecord,BackingSummary } from "../discovery/src/backing-model";
import { evaluateBacking } from "../discovery/src/backing";
import { hashJson } from "../discovery/src/solana";

const base="http://127.0.0.1:8794/api/10x",file=new URL("../.tmp/backing-local-review.json",import.meta.url);
const token=readFileSync(new URL("../discovery/.dev.vars",import.meta.url),"utf8").match(/^TENX_ADMIN_TOKEN=([a-f0-9]{64})\s*$/m)?.[1];
assert(token,"Start the local discovery service first");
let list=BackingListResponse.parse(await (await fetch(`${base}/backing`)).json());
if(process.argv.includes("--open")&&!list.runs.some(r=>r.state==="open")){
  const result=await fetch(`${base}/admin/backing/open`,{method:"POST",headers:{authorization:`Bearer ${token}`,"content-type":"application/json"},body:JSON.stringify({request_id:crypto.randomUUID(),reason:"Local PRD review: prospective window, hypothetical assumptions only, all gates unchanged",duration_minutes:1,assumptions:{assumed_sol_usd:100,minimum_trade_usd:1,per_identity_cap_usd:100}})});
  assert.equal(result.status,200,await result.clone().text());
  const run=BackingSummary.parse(await result.json());mkdirSync(new URL("../.tmp/",import.meta.url),{recursive:true});writeFileSync(file,JSON.stringify({id:run.id,starts_at:run.starts_at,deadline:run.deadline},null,2));
  list=BackingListResponse.parse(await (await fetch(`${base}/backing`)).json());
}
const saved=existsSync(file)?JSON.parse(readFileSync(file,"utf8")) as {id:string}:null;
const run=list.runs.find(r=>r.id===saved?.id)??list.runs[0];assert(run,"Open a prospective window with --open");
assert.equal(list.voting_enabled,false);assert.equal(run.outcome,"withheld");
let replay="pending_source_deadline";
if(run.state==="frozen"){
  assert.equal((await fetch(`${base}/admin/backing/${run.id}`)).status,401);
  const response=await fetch(`${base}/admin/backing/${run.id}`,{headers:{authorization:`Bearer ${token}`}});assert.equal(response.status,200);
  const value=await response.json() as {record:unknown;replay:string},record=BackingRecord.parse(value.record);
  assert.equal(value.replay,"verified");assert.equal(await hashJson(await evaluateBacking(record.opening,record.evidence)),record.result_hash);
  assert.equal(record.result.winner_address,null);assert.equal(record.result.voting_enabled,false);replay="verified_from_frozen_transactions";
}
console.log(JSON.stringify({id:run.id,state:run.state,eligible_at_open:run.eligible_at_open,frozen_wallets:run.frozen_wallet_count,decoded_instructions:run.entries,identity_token_groups:run.groups,replay,source_deadline:run.deadline,outcome:run.outcome,votes:false,source_requests_made_by_this_check:0,policy_gates_changed:false,deploy:false},null,2));
