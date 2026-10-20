import assert from "node:assert/strict";
import {mkdirSync,readFileSync,writeFileSync} from "node:fs";
import {z} from "zod";
import {StatusResponse,CoverageResponse,DetailResponse} from "../app/src/discovery/client";
import {WalletPlansResponseSchema} from "../discovery/src/wallet-plan-model";
import {DEFAULT_POLICY} from "../discovery/src/model";
import {potential} from "../discovery/src/priority";
const base="http://127.0.0.1:8794/api/10x",newSnapshotOnly=process.argv.includes("--new-snapshot-one-turn"),maxCalls=newSnapshotOnly?18:36,maxTurns=newSnapshotOnly?1:6;
const token=readFileSync(new URL("../discovery/.dev.vars",import.meta.url),"utf8").match(/^TENX_ADMIN_TOKEN=([a-f0-9]{64})\s*$/m)?.[1];assert(token,"Local operator token required");
async function get(path:string){const r=await fetch(`${base}/${path}`,{signal:AbortSignal.timeout(30000)});assert.equal(r.status,200,`Local ${path} status`);return r.json();}
async function snapshot(){const status=StatusResponse.parse(await get("system/status")).data,plans=WalletPlansResponseSchema.parse(await get("discovery/wallet-plan")).data,coverage=CoverageResponse.parse(await get("discovery/coverage")).data;assert.deepEqual(status.policy,DEFAULT_POLICY);assert.equal(status.local_only,true);assert.equal(status.capabilities.signing,false);assert.equal(status.capabilities.launches,false);assert.equal(status.capabilities.rewards,false);assert.equal(status.daily_limits.rpc,5000);assert.equal(status.wallet_automation?.daily_limit,800);assert.equal(plans.evidence_gates_changed,false);return {status,plans,coverage};}
const before=await snapshot(),target=before.plans.plans.find(p=>newSnapshotOnly?p.stage==="new_snapshot":p.direct_wallet_limit===20&&["direct_funding","refresh_required"].includes(p.stage)),turns:unknown[]=[];
let spent=0,stop="no_finishable_expanded_scope";
if(target)for(let i=0;i<maxTurns;i++){
  const current=await snapshot(),p=current.plans.plans.find(p=>p.address===target.address),s=current.status;
  if(!p||!["direct_funding","refresh_required",...(newSnapshotOnly?["new_snapshot"]:[])].includes(p.stage)){stop=p?.stage??"not_current_contender";break;}
  if(s.paused||s.retry_after&&Date.parse(s.retry_after)>Date.now()){stop="paused_or_backoff";break;}
  if(spent+18>maxCalls||800-(s.wallet_automation?.daily_used??800)<18||5000-(s.usage.find(u=>u.provider==="rpc")?.used??5000)<18){stop="bounded_budget_headroom";break;}
  const detail=DetailResponse.parse(await get(`candidates/solana/${target.address}?mode=live`)).data;assert(potential(detail,DEFAULT_POLICY,new Date()),"Must remain a current contender");
  const r=await fetch(`${base}/admin/wallet-refresh`,{method:"POST",headers:{authorization:`Bearer ${token}`,"content-type":"application/json"},body:JSON.stringify({address:target.address,reason:"Local bounded funding coverage continuation; unchanged gates and free caps"}),signal:AbortSignal.timeout(180000)});assert.equal(r.status,200,"Local wallet collection admission");
  const result=z.object({state:z.string(),rpc_calls:z.number().int().min(0).max(18).optional(),error_code:z.string().optional(),snapshot_updated:z.boolean().optional(),progress:z.object({windows:z.number(),examined_windows:z.number(),stage:z.string()}).passthrough().optional()}).passthrough().parse(await r.json());
  spent+=result.rpc_calls??0;assert(spent<=maxCalls);turns.push({before:{stage:p.stage,windows:p.windows,examined_windows:p.examined_windows,source_evidence_hash:p.source_evidence_hash},state:result.state,rpc_calls:result.rpc_calls??0,progress:result.progress,snapshot_updated:result.snapshot_updated,error_code:result.error_code});
  if(result.state==="failed"||result.state==="waiting"){stop=result.error_code??result.state;break;}stop="turn_bound";
}
const after=await snapshot();assert(after.status.wallet_automation!.daily_used<=800);assert(after.status.usage.find(u=>u.provider==="rpc")!.used<=5000);
const receipt={at:new Date().toISOString(),address:target?.address??null,limits:{max_script_rpc:maxCalls,max_turns:maxTurns,per_turn:18,wallet_daily:800,global_rpc_daily:5000},source_requests_made_by_this_script:spent,stop,turns,before:{eligible:before.coverage.eligible,plan:target,wallet_used:before.status.wallet_automation?.daily_used},after:{eligible:after.coverage.eligible,plan:after.plans.plans.find(p=>p.address===target?.address),wallet_used:after.status.wallet_automation?.daily_used},evidence_gates_changed:false,deploy:false};
mkdirSync(new URL("../.tmp/",import.meta.url),{recursive:true});const output=JSON.stringify(receipt,null,2);writeFileSync(new URL(`../.tmp/wallet-scope-${crypto.randomUUID()}.json`,import.meta.url),output);writeFileSync(new URL("../.tmp/wallet-scope-local.json",import.meta.url),output);console.log(output);
