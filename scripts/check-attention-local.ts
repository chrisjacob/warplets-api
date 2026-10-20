import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { exampleRewards, evaluateRewards } from "../discovery/src/reward-math";
import { RewardList, RewardRecord } from "../discovery/src/reward-model";
import { hashJson } from "../discovery/src/solana";
const base = "http://127.0.0.1:8794/api/10x", file = new URL("../.tmp/attention-local.json", import.meta.url);
const token = readFileSync(new URL("../discovery/.dev.vars", import.meta.url), "utf8").match(/^TENX_ADMIN_TOKEN=([a-f0-9]{64})\s*$/m)?.[1];
assert(token, "Local operator token required");
let body: unknown;
if (existsSync(file)) body = JSON.parse(readFileSync(file, "utf8")).request;
else { body = { request_id: crypto.randomUUID(), reason: "Review hypothetical ten-campaign accounting; no live policy", scenario: exampleRewards() }; mkdirSync(new URL("../.tmp/", import.meta.url), { recursive: true }); writeFileSync(file, JSON.stringify({ request: body }, null, 2)); }
async function post() { const r = await fetch(`${base}/admin/rewards/lab`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${token}` }, body: JSON.stringify(body) }); assert.equal(r.status, 200, await r.clone().text()); return RewardRecord.parse((await r.json() as { record: unknown }).record); }
const record = await post(); assert.deepEqual(await post(), record);
const get = await fetch(`${base}/admin/rewards/lab/${record.id}`, { headers: { authorization: `Bearer ${token}` } }); assert.equal(get.status, 200);
assert.deepEqual(RewardRecord.parse((await get.json() as { record: unknown }).record), record);
assert.equal(await hashJson(evaluateRewards(record.inputs)), record.result_hash);
assert.equal((await fetch(`${base}/admin/rewards/lab/${record.id}`)).status, 401);
const list = RewardList.parse(await (await fetch(`${base}/rewards/lab`)).json()); assert(list.runs.some(r => r.id === record.id));
assert.equal(record.result.max_overlap, 10); assert.equal(record.result.provider_requests, 0);
writeFileSync(file, JSON.stringify({ request: body, record, checks: { retry: "identical", replay: "verified", private_access_without_token: 401, provider_requests: 0, deploy: false } }, null, 2));
console.log(JSON.stringify({ id: record.id, campaigns: record.result.campaigns.length, max_overlap: record.result.max_overlap, active_at_snapshot: record.result.active_campaigns, replay: "verified", provider_requests: 0, claims: false, deploy: false }, null, 2));
