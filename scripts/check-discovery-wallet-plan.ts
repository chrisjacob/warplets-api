import assert from "node:assert/strict";
import { WalletPlansResponseSchema } from "../discovery/src/wallet-plan-model";
import { CoverageResponse, StatusResponse } from "../app/src/discovery/client";
import { DEFAULT_POLICY } from "../discovery/src/model";
import { analyzeWalletEvidence, WalletEvidenceSchema } from "../discovery/src/wallet-analysis";
import { hashJson } from "../discovery/src/solana";
const base="http://127.0.0.1:8794/api/10x";
async function get(path:string){const r=await fetch(`${base}/${path}`,{signal:AbortSignal.timeout(30_000)});assert.equal(r.status,200,path);assert.equal(r.headers.get("cache-control"),"no-store");return r.json();}
const plans=WalletPlansResponseSchema.parse(await get("discovery/wallet-plan")).data;
const status=StatusResponse.parse(await get("system/status")).data;
const coverage=CoverageResponse.parse(await get("discovery/coverage")).data;
assert.deepEqual(status.policy,DEFAULT_POLICY);assert.equal(plans.provider_requests,0);assert.equal(plans.evidence_gates_changed,false);
assert.ok(status.wallet_automation && status.wallet_automation.daily_used<=status.wallet_automation.daily_limit);
for(const usage of status.usage){const cap=status.daily_limits[usage.provider as keyof typeof status.daily_limits];assert.ok(cap!==undefined && usage.used<=cap);}
assert.equal(status.capabilities.signing,false);assert.equal(status.capabilities.launches,false);
let replayed=0;
for(const plan of plans.plans.filter(p=>p.source_evidence_hash).slice(0,4)){
  const saved=await get(`wallet-evidence/${plan.source_evidence_hash}`),input=WalletEvidenceSchema.parse(saved.data.payload);
  assert.equal(await hashJson(input),plan.source_evidence_hash);assert.equal(input.asset.address,plan.address);
  const analysis=await analyzeWalletEvidence(input);assert.equal(analysis.evidence_hash,plan.source_evidence_hash);assert.equal(analysis.observed_at,plan.snapshot_at);replayed++;
}
for(const p of plans.plans){assert.ok(p.examined_windows<=p.windows);if(p.stage==="direct_funding")assert.ok(p.minimum_rpc_calls!==null && p.minimum_rpc_calls>0);if(p.stage==="source_limited")assert.equal(p.minimum_rpc_calls,null);}
console.log(JSON.stringify({eligible:coverage.eligible,target:coverage.target,stages:plans.plans.reduce<Record<string,number>>((a,p)=>(a[p.stage]=(a[p.stage]??0)+1,a),{}),measurement:plans.yield,wallet_snapshots_replayed:replayed,wallet_used:status.wallet_automation.daily_used,wallet_limit:status.wallet_automation.daily_limit,source_requests_made_by_this_check:0,evidence_gates_changed:false},null,2));
