import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {StatusResponse} from "../app/src/discovery/client";
import {MarketBatchDetailSchema} from "../discovery/src/market-batch-model";
import {replayMarketBatch} from "../discovery/src/market-batch";
const base="http://127.0.0.1:8794/api/10x";
const token=readFileSync(new URL("../discovery/.dev.vars",import.meta.url),"utf8").match(/^TENX_ADMIN_TOKEN=([a-f0-9]{64})\s*$/m)?.[1];assert.ok(token);
const status=await fetch(`${base}/system/status`,{signal:AbortSignal.timeout(30000)});assert.equal(status.status,200);
const batches=StatusResponse.parse(await status.json()).data.market_batches;assert.ok(batches);assert.equal(batches.provider_requests,0);
const unauthorized=await fetch(`${base}/admin/market/batches/latest`,{signal:AbortSignal.timeout(30000)});assert.equal(unauthorized.status,401);
const checked=[];
for(const slot of ["latest","latest_issue"] as const){
  if(!batches[slot])continue;
  const response=await fetch(`${base}/admin/market/batches/${slot}`,{headers:{authorization:`Bearer ${token}`},signal:AbortSignal.timeout(30000)});
  assert.equal(response.status,200);assert.equal(response.headers.get("cache-control"),"no-store");
  const saved=MarketBatchDetailSchema.parse(await response.json()),replay=await replayMarketBatch(saved.record);assert.equal(replay.status,"verified");
  const r=saved.record.report;assert.equal(r.requested,r.accepted+r.rejected+r.not_reported);
  checked.push({slot,at:r.at,requested:r.requested,accepted:r.accepted,rejected:r.rejected,not_reported:r.not_reported,ignored_pairs:r.ignored_pairs,unscoped_pairs:r.unscoped_pairs,
    issues:r.rows.filter(row=>row.state!=="accepted").map(({address,code,fields})=>({address,code,fields})),input_bytes:new TextEncoder().encode(JSON.stringify(saved.record.inputs)).length,input_hash:saved.record.input_hash,record_hash:saved.record.record_hash,replay:replay.status});
}
console.log(JSON.stringify({retention:batches.retention,checked,source_requests:0,evidence_gates_changed:false,deploy:false},null,2));
