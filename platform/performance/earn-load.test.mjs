import test from 'node:test';
import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {runLoad} from './earn-load.mjs';

test('one and ten campaign attempted load preserves global and staffed capacity, bounded admission and exports',async()=>{
 const scenarios=[];
 for(const options of [{},{campaignCount:10},{campaignCount:10,staffedMinutes:60}]){
  const r=await runLoad(1000,options);scenarios.push(r);
  const accepted=options.staffedMinutes===60?20:100;
  assert.deepEqual(r.counts,{accepted,capacity:1000-accepted});
  assert.equal(r.errorStates.unexpected,0);assert.equal(r.errorStates.incompleteSourceHeld,true);
  assert.equal(r.globalAdmissionLimit,accepted);
  assert.equal(r.budget.sourceReadsWithSharedClose,accepted*6+r.campaignCount*4);
  for(const row of Object.values(r.byCampaign)){assert.equal(row.attempts,1000/r.campaignCount);assert.equal(row.accepted,accepted/r.campaignCount);}
  // Constant-size admission lookups: a refused or admitted request cannot scan
  // the attempted cohort. These are JS boundary rows, never D1 billed rows.
  assert.ok(r.maxIngressRequest.statements<=50,JSON.stringify(r.maxIngressRequest));
  assert.ok(r.maxIngressRequest.rowsReturned<=30,JSON.stringify(r.maxIngressRequest));
  assert.ok(r.artifactBytes.aggregate<1024*1024);assert.equal(r.artifactBytes.allocations.length,r.campaignCount);
  assert.ok(r.artifactBytes.allocations.every(a=>a.bytes<65536));
  assert.ok(r.memory.samples>=1000);assert.ok(r.memory.sampledPeak.rss>0);
  assert.equal(r.financialExecution,false);assert.equal(r.providerCalls,0);
  for(const plan of Object.values(r.plans))assert.ok(plan.every(row=>!row.includes('SCAN ')),JSON.stringify(plan));
 }
 if(process.env.B20_LOAD_EVIDENCE)await writeFile(process.env.B20_LOAD_EVIDENCE,JSON.stringify({recordedAt:new Date().toISOString(),mode:'synthetic-local-node-sqlite-loopback',node:process.version,platform:process.platform,arch:process.arch,scenarios,limitations:['Memory is sampled process memory, not an isolated exact allocator high-water mark.','Returned SQL rows are not D1 billable rows.','Loopback timing is not geographic p95 or staffed moderation throughput.','No D1 1000-attempt load performed; separate hosted core verifies actual D1 parity.','Ten synthetic Sydney dates preserve original clocks and day1–10 allocation; no launch hour or day11 policy selected.']},null,2));
});
