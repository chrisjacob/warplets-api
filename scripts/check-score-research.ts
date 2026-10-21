import assert from "node:assert/strict";
import {mkdirSync,writeFileSync} from "node:fs";
import {ScoreResearchResponse} from "../app/src/discovery/client";
import {ScoreResearchDetailSchema} from "../discovery/src/score-research-model";
import {replayScoreCohort,replayScoreOutcome} from "../discovery/src/score-research-analysis";
const base="http://127.0.0.1:8794/api/10x/research/scores";
async function get(url:string){const r=await fetch(url,{signal:AbortSignal.timeout(30000)});assert.equal(r.status,200,url);assert.equal(r.headers.get("cache-control"),"no-store");return r.json();}
const model=process.argv[2]??"discovery-score-v3";
const summary=ScoreResearchResponse.parse(await get(`${base}?model=${model}`)).data;assert.equal(summary.model,model);assert.equal(summary.automatic_policy_changes,false);assert.ok(summary.today.records<=summary.limits.daily_records);assert.ok(summary.today.bytes<=summary.limits.daily_bytes);
assert.equal(summary.counts.captured,summary.counts.pending+summary.counts.measured+summary.counts.insufficient);assert.equal(summary.bands.reduce((n,b)=>n+b.captured,0),summary.counts.captured);
const first=summary.recent[0];let artifact:string|null=null;
if(first){const detail=ScoreResearchDetailSchema.parse(await get(`${base}/solana/${first.cohort.address}?model=${model}`));assert.deepEqual((await replayScoreCohort(detail.cohort)).summary,first.cohort);if(detail.outcome)await replayScoreOutcome(detail.outcome,first.cohort);mkdirSync(new URL("../.tmp/",import.meta.url),{recursive:true});artifact=`.tmp/score-research-${model}-local.json`;writeFileSync(new URL(`../${artifact}`,import.meta.url),JSON.stringify(detail,null,2)+"\n");}
console.log(JSON.stringify({at:summary.at,model:summary.model,counts:summary.counts,today:summary.today,automation:summary.automation,first:first?{address:first.cohort.address,score:first.cohort.score.value,cohort_hash:first.cohort.cohort_hash}:null,artifact,provider_requests:0,automatic_policy_changes:false,deploy:false},null,2));
