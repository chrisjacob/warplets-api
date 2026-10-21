import assert from "node:assert/strict";
import {mkdirSync,writeFileSync} from "node:fs";
import {CardListResponse,DiscoveryScoreResponse,PoliciesResponse,StatusResponse} from "../app/src/discovery/client";
import {replayDiscoveryScore} from "../discovery/src/discovery-score";
import {DEFAULT_POLICY} from "../discovery/src/model";
const base="http://127.0.0.1:8794/api/10x";
async function get(path:string){const r=await fetch(`${base}/${path}`,{signal:AbortSignal.timeout(30000)});assert.equal(r.status,200,path);assert.equal(r.headers.get("cache-control"),"no-store");return r.json();}
const list=CardListResponse.parse(await get("candidates?age=24h&view=cards&limit=100")),rows=list.data.candidates;
assert.equal(list.data.sort,"score");assert.ok(rows.length<=100);
for(let i=0;i<rows.length;i++){const c=rows[i]!,s=c.discovery_score;assert.ok(s);assert.equal(c.discovery_rank,i+1);if(i){const prev=rows[i-1]!.discovery_score!;assert.ok(prev.value>s.value||prev.value===s.value&&prev.evidence_coverage>=s.evidence_coverage);}}
let artifact:string|null=null;
if(rows.length){const detail=DiscoveryScoreResponse.parse(await get(`discovery/scores/solana/${rows[0]!.address}`));assert.equal((await replayDiscoveryScore(detail.record)).status,"verified");assert.equal(detail.record.inputs.candidate.address,rows[0]!.address);mkdirSync(new URL("../.tmp/",import.meta.url),{recursive:true});artifact=".tmp/discovery-scorecard-local.json";writeFileSync(new URL(`../${artifact}`,import.meta.url),JSON.stringify(detail.record,null,2)+"\n");}
const policy=PoliciesResponse.parse(await get("transparency/policies")),status=StatusResponse.parse(await get("system/status"));assert.ok(policy.data.discovery_scoring);assert.deepEqual(status.data.policy,DEFAULT_POLICY);assert.equal(status.data.capabilities.launches,false);assert.equal(status.data.capabilities.voting,false);
console.log(JSON.stringify({ranked:rows.length,observed:list.data.observed,scored_at:list.data.scored_at,range:rows.length?{highest:rows[0]!.discovery_score!.value,lowest:rows.at(-1)!.discovery_score!.value}:null,top:rows.slice(0,5).map(c=>({address:c.address,symbol:c.symbol,score:c.discovery_score!.value,evidence_coverage:c.discovery_score!.evidence_coverage,action_checks:c.eligibility})),action_counts:list.data.counts,scorecard_artifact:artifact,source_requests:0,eligibility_gates_changed:false,deploy:false},null,2));
