import assert from "node:assert/strict";
import {OperationsResponse,StatusResponse,ElectionsResponse,ElectionDetailResponse} from "../app/src/discovery/client";
import {DEFAULT_POLICY} from "../discovery/src/model";
import {replayElection} from "../discovery/src/elections";
const base="http://127.0.0.1:8794/api/10x";
async function get(path:string){const response=await fetch(`${base}/${path}`,{signal:AbortSignal.timeout(30000)});assert.equal(response.status,200,path);assert.equal(response.headers.get("cache-control"),"no-store");return response.json();}
const status=StatusResponse.parse(await get("system/status")),health=OperationsResponse.parse(await get("system/operations"));
assert.deepEqual(status.data.policy,DEFAULT_POLICY);assert.equal(health.data.provider_requests,0);assert.equal(health.data.timer,"recent");
assert.equal(health.data.watchdog.fresh,true);assert.ok(health.data.watchdog.last);assert.equal(health.data.watchdog.last.restart_recommended,false);assert.equal(health.data.watchdog.external_channels_configured,false);
for(const row of status.data.usage){const limit=status.data.daily_limits[row.provider as keyof typeof status.data.daily_limits];assert.ok(limit!==undefined && row.used<=limit);}
const elections=ElectionsResponse.parse(await get("elections"));let replayed=0;
for(const row of elections.data.runs.slice(0,3)){const saved=ElectionDetailResponse.parse(await get(`elections/${row.id}`));assert.equal((await replayElection(saved.data.record)).status,"verified");replayed++;}
assert.equal(status.data.capabilities.signing,false);assert.equal(status.data.capabilities.launches,false);
console.log(JSON.stringify({state:health.data.state,timer:health.data.timer,heartbeat_at:health.data.heartbeat_at,independent_watchdog:health.data.watchdog.last,watchdog_fresh:health.data.watchdog.fresh,issues:health.data.issues,retained_rehearsals_replayed:replayed,source_requests_made_by_this_check:0},null,2));
