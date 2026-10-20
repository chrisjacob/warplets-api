import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {parseEnv} from "node:util";
import {ContentOperations} from "../discovery/src/content-operations-model";
import {CONTENT_LIMITS as limits} from "../discovery/src/content-limits";
import {AUTHORSHIP_REVIEW_DAILY_LIMIT} from "../discovery/src/content-authorship-model";

// Read-only loopback check: credentials never leave memory or appear in output.
const url="http://127.0.0.1:8794/api/10x/admin/attention/operations";
const token=parseEnv(readFileSync(new URL("../discovery/.dev.vars",import.meta.url),"utf8")).TENX_ADMIN_TOKEN;
assert(token,"Start the existing local discovery service first");
async function get(headers:Record<string,string>={}){return fetch(url,{headers,redirect:"error",signal:AbortSignal.timeout(30000)});}
const denied=await get();assert.equal(denied.status,401);await denied.body?.cancel();
const headers={authorization:`Bearer ${token}`};
const foreign=await get({...headers,origin:"https://evil.example"});assert.equal(foreign.status,403);await foreign.body?.cancel();
const response=await get(headers);assert.equal(response.status,200);assert.equal(response.headers.get("cache-control"),"no-store");assert.equal(response.headers.get("vary"),"Cookie");
const data=ContentOperations.parse(await response.json());
assert.equal(data.source_requests,0);assert.equal(data.rewards_enabled,false);assert.equal(data.integrity,"projection_counts_only");
assert.deepEqual(data.identity_daily_limits,{submissions:limits.submissions_per_identity_day,reports:limits.reports_per_identity_day,hold_reviews:limits.hold_reviews_per_identity_day});
for(const q of data.quotas)assert.equal(q.remaining,Math.max(0,q.limit-q.used));
for(const q of data.queues){assert(q.waiting_24h<=q.count);assert.equal(q.oldest_updated_at===null,q.count===0);}
for(const t of data.storage.tables){assert(t.sampled_rows<=200);assert(t.sampled_rows<=t.total_rows);assert.equal(t.complete,t.sampled_rows===t.total_rows);}
assert.equal(data.retention.automatic_deletion,false);
assert.equal(data.authorship.manual_review_limit,AUTHORSHIP_REVIEW_DAILY_LIMIT);assert.equal(data.authorship.remaining,Math.max(0,AUTHORSHIP_REVIEW_DAILY_LIMIT-data.authorship.manual_reviews_today));assert.equal(data.authorship.withdrawal_daily_limit,null);
assert(data.storage.tables.some(t=>t.id==="authorship_events"));
console.log(JSON.stringify({manual_authorship_capacity:data.authorship,provider_requests:0,writes:0}));
console.log(JSON.stringify({private_content_operations:"passed",as_of:data.as_of,queue_counts:data.queues.map(q=>({queue:q.id,waiting_on:q.waiting_on,count:q.count,waiting_24h:q.waiting_24h})),quota_counts:data.quotas.map(q=>({resource:q.id,used:q.used,limit:q.limit,remaining:q.remaining})),payload_sample_rows:data.storage.tables.reduce((n,t)=>n+t.sampled_rows,0),unauthorized:"denied",foreign_origin:"denied",source_requests:0,writes:0,policy_gates_changed:false,deploy:false},null,2));
