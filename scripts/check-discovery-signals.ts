import assert from "node:assert/strict";
import { SignalDetailSchema } from "../discovery/src/signal-model";
import { SignalsResponse } from "../app/src/discovery/client";
import { replaySignal, verifySignalOutcome } from "../discovery/src/signal-analysis";
const base = "http://127.0.0.1:8794/api/10x";
const response = await fetch(`${base}/research/signals`, { signal: AbortSignal.timeout(30_000) });
assert.equal(response.status,200);
const summary = SignalsResponse.parse(await response.json());
let replayed = 0;
for (const row of summary.data.recent.slice(0,4)) {
  const response = await fetch(`${base}/research/signals/solana/${row.address}/${row.signal}`,{ signal: AbortSignal.timeout(30_000) });
  assert.equal(response.status,200);
  const detail = SignalDetailSchema.parse(await response.json());
  assert.equal((await replaySignal(detail.record)).record_hash,row.record_hash);
  assert.ok(Date.parse(detail.record.captured_at)<=Date.parse(summary.data.at));
  if (detail.outcome) await verifySignalOutcome(detail.outcome,detail.record.record_hash,detail.record);
  replayed++;
}
assert.equal(summary.data.automatic_policy_changes,false);
assert.equal(summary.data.automation.last_error,null);
console.log(JSON.stringify({ automation:summary.data.automation,totals:summary.data.totals,replayed,validation:summary.data.validation.map(v=>({signal:v.signal,status:v.status,measured:v.measured,activated:v.activated})),source_requests_made_by_this_check:0 },null,2));
