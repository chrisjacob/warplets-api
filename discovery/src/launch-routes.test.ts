import {afterEach,expect,it,vi} from "vitest";
import {DatabaseSync} from "node:sqlite";
import {readFileSync,readdirSync} from "node:fs";
import {sqliteD1} from "../../app/functions/_lib/sqliteTestDb";
import {evaluateLaunch,exampleLaunch} from "./launch-math";
import {feeExampleFromNet} from "./launch-fees";
import {routeExampleFromFees} from "./launch-routes";
import {RouteLaunchResult,RouteLaunchScenario,LaunchRecord,LaunchList,ROUTE_MATH_REVISION,type RouteLaunchInput} from "./launch-model";
import {createLaunch,launchRecord,launchList,replayLaunch} from "./launch-lab";
import {U64_MAX} from "./launch-curve";
import {hashJson} from "./solana";
import worker,{type LocalEnv} from "./worker";
import originalV1 from "../fixtures/recorded/launch-curve-v1.json";
import originalV2 from "../fixtures/recorded/launch-fee-v2.json";
const now=new Date("2026-10-20T12:00:00.000Z"),opened:DatabaseSync[]=[];
afterEach(()=>{opened.splice(0).forEach(db=>db.close());vi.restoreAllMocks();});
const scenario=(race=true)=>routeExampleFromFees(feeExampleFromNet({...exampleLaunch(),as_of:now.toISOString()}),race);
const run=(s:RouteLaunchInput)=>RouteLaunchResult.parse(evaluateLaunch(s));
const request=(s=scenario())=>({request_id:crypto.randomUUID(),reason:"Offline funded-route and ordering review",scenario:s});
function fixture(){const sql=new DatabaseSync(":memory:");opened.push(sql);for(const name of readdirSync(new URL("../migrations/",import.meta.url)).filter(n=>n.endsWith(".sql")).sort())sql.exec(readFileSync(new URL(`../migrations/${name}`,import.meta.url),"utf8"));
  const db=sqliteD1(sql),batch=db.batch.bind(db);let queue=Promise.resolve<unknown>(null);db.batch=((items:D1PreparedStatement[])=>{const r=queue.then(()=>batch(items));queue=r.catch(()=>null);return r;}) as D1Database["batch"];return {db,sql};}
it("funds only explicit trader balances and records ordered route failures and successes",()=>{
  const r=run(scenario());expect(r.math_revision).toBe(ROUTE_MATH_REVISION);
  expect(r.actions.map(a=>a.status)).toEqual(["insufficient_balance","range_exhausted","simulated","simulated","simulated","minimum_output_not_met","simulated","simulated"]);
  expect(r.actions[0]!.attempted_leg_statuses).toEqual([]);expect(r.actions[1]!.attempted_leg_statuses).toEqual(["simulated","range_exhausted"]);expect(r.actions[1]!.rejected_leg_index).toBe(1);
  expect(r.traders.every(t=>t.initial.attn==="0")).toBe(true);expect(r).toMatchObject({launch_enabled:false,transfers_enabled:false,policy_approved:false,route_execution_verified:false,program_execution_verified:false,provider_requests:0});
});
it("passes each route's actual first receipt through its second leg and commits both fees",()=>{
  const r=run(scenario()),action=r.actions[3]!;expect(action.committed_step_indexes).toHaveLength(2);
  const [first,second]=action.committed_step_indexes.map(i=>r.steps[i]!);expect(first!.trader_output_raw).toBe(second!.gross_input_raw);expect(second!.trader_debit_raw).toBe(first!.trader_output_raw);
  expect(action.trader_output_raw).toBe(second!.trader_output_raw);expect(action.trader_debit_raw).toBe(first!.gross_input_raw);
  expect(action.after_balances.attn).toBe(action.before_balances.attn);expect(BigInt(first!.total_fee_raw)).toBeGreaterThan(0n);expect(BigInt(second!.total_fee_raw)).toBeGreaterThan(0n);
  expect(BigInt(first!.referral_fee_raw)).toBeGreaterThan(0n);expect(BigInt(second!.referral_fee_raw)).toBeGreaterThan(0n);
});
it.each(["first_range","second_range","first_minimum","second_minimum"])("rolls back all principal, trader funds and fees on %s route failure",failure=>{
  const s=scenario();s.actions=s.actions.slice(1,2);const a=s.actions[0]!;if(a.kind!=="route")throw Error("route");
  if(failure==="first_range"){a.gross_input_raw=U64_MAX.toString();s.traders[1]!.balances.native=U64_MAX.toString();}
  if(failure==="first_minimum")a.minimum_attn_raw=U64_MAX.toString();
  if(failure==="second_minimum"){s.actions.unshift(scenario().actions[2]!);a.gross_input_raw="500000000000";a.minimum_output_raw=U64_MAX.toString();}
  const base=structuredClone(s);base.actions=base.actions.slice(0,-1);const before=run(base),after=run(s),action=after.actions.at(-1)!;
  expect(action.status).toBe(failure.includes("minimum")?"minimum_output_not_met":"range_exhausted");expect(action.rejected_leg_index).toBe(failure.startsWith("first")?0:1);
  expect(after.pools).toEqual(before.pools);expect(after.traders).toEqual(before.traders);expect(after.steps).toEqual(before.steps);expect(action.committed_step_indexes).toEqual([]);expect(action.trader_debit_raw).toBe("0");expect(action.trader_output_raw).toBe("0");
});
it("makes the same minimum receipt fail after a competing buy without silently loosening it",()=>{
  const withRace=run(scenario()),without=run(scenario(false));const a=withRace.actions[5]!,b=without.actions[4]!;
  expect(a.minimum_output_raw).toBe(b.minimum_output_raw);expect(a.status).toBe("minimum_output_not_met");expect(b.status).toBe("simulated");
  expect(a.after_balances).toEqual(a.before_balances);expect(a.trader_debit_raw).toBe("0");expect(BigInt(b.trader_output_raw)).toBeGreaterThanOrEqual(BigInt(b.minimum_output_raw));
});
it("rejects a larger cross-pool exit even after an OG buy supplies some quote inventory",()=>{
  const s=scenario();s.actions=s.actions.slice(2,4);const a=s.actions[1]!;if(a.kind!=="route")throw Error("route");
  expect(run(s).actions[1]!.status).toBe("simulated");a.gross_input_raw="1000000000000";
  const before=structuredClone(s);before.actions.pop();const r=run(s);expect(r.actions[1]!.status).toBe("range_exhausted");expect(r.actions[1]!.rejected_leg_index).toBe(1);expect(r.pools).toEqual(run(before).pools);
});
it("does not borrow from another trader or spend the same quote balance twice",()=>{
  const s=scenario(false);s.actions=[s.actions[2]!,s.actions[2]!];const r=run(s);expect(r.actions.map(a=>a.status)).toEqual(["simulated","insufficient_balance"]);
  expect(r.traders[0]!.final.og).toBe("0");expect(r.traders[1]!.final).toEqual(r.traders[1]!.initial);expect(r.actions[1]!.attempted_leg_statuses).toEqual([]);
});
it("permits a later reverse swap only from ATTN actually acquired by that trader",()=>{
  const s=scenario();const sell={kind:"swap" as const,trader:"early_holder",pool:"native" as const,direction:"attn_to_quote" as const,gross_input_raw:"500000000000",minimum_output_raw:"0",has_referral:false};
  s.actions=[sell,s.actions[2]!,sell];const r=run(s);expect(r.actions.map(a=>a.status)).toEqual(["insufficient_balance","simulated","simulated"]);
  expect(BigInt(r.traders[0]!.final.attn)).toBe(BigInt(r.steps[0]!.trader_output_raw)-500000000000n);
});
it("rejects output that would overflow a trader u64 balance without keeping provisional fees",()=>{
  const s=scenario();s.traders[0]!.balances.native=U64_MAX.toString();s.actions=[s.actions[2]!,{kind:"swap",trader:"early_holder",pool:"native",direction:"attn_to_quote",gross_input_raw:"500000000000",minimum_output_raw:"0",has_referral:false}];
  const baseline=structuredClone(s);baseline.actions.pop();const before=run(baseline),after=run(s);expect(after.actions[1]!.status).toBe("trader_u64_bound");expect(after.pools).toEqual(before.pools);expect(after.traders).toEqual(before.traders);expect(after.steps).toEqual(before.steps);
});
it("conserves ATTN supply and each quote asset across pool principal, traders and fee accruals",()=>{
  for(let n=1;n<=20;n++){
    const s=scenario();s.traders.forEach(t=>{t.balances.native=String(BigInt(t.balances.native)*BigInt(n));});s.pools.native.fees.fee_numerator=String(100000+n*731000);
    const r=run(s),sum=(xs:string[])=>xs.reduce((n,v)=>n+BigInt(v),0n);
    expect(sum(r.pools.map(p=>p.final.attn_raw))+sum(r.pools.map(p=>p.unseeded_attn_raw))+sum(r.traders.map(t=>t.final.attn))+BigInt(r.campaign_reserve_raw)).toBe(BigInt(r.supply_raw));
    for(const pool of r.pools){const initial=BigInt(pool.initial.quote_raw)+sum(r.traders.map(t=>t.initial[pool.pool])),final=BigInt(pool.final.quote_raw)+sum(r.traders.map(t=>t.final[pool.pool]))+BigInt(pool.fee_totals.total_fee_raw);expect(final).toBe(initial);}
    expect(r.steps.every(s=>s.status==="simulated")).toBe(true);expect(r.actions.flatMap(a=>a.committed_step_indexes)).toEqual(r.steps.map(s=>s.index));
    for(const a of r.actions)if(a.status!=="simulated"){expect(a.after_balances).toEqual(a.before_balances);expect(a.committed_step_indexes).toEqual([]);}
  }
});
it.each(["duplicate","unknown","same_pool","free_attn","negative","u64","alias","too_many_actions","too_many_traders","unknown_field"])("rejects invalid funded scenarios: %s",fault=>{
  const s:any=scenario();if(fault==="duplicate")s.traders[1].id=s.traders[0].id;if(fault==="unknown")s.actions[0].trader="unknown";if(fault==="same_pool")s.actions[0].to_pool=s.actions[0].from_pool;if(fault==="free_attn")s.traders[0].balances.attn="1";
  if(fault==="negative")s.traders[0].balances.native="-1";if(fault==="u64")s.traders[0].balances.native=(U64_MAX+1n).toString();if(fault==="alias")s.traders[0].id="wallet@example.test";
  if(fault==="too_many_actions")s.actions=Array(13).fill(s.actions[0]);if(fault==="too_many_traders")s.traders=Array.from({length:9},(_,i)=>({...s.traders[0],id:`trader_${i}`}));if(fault==="unknown_field")s.actions[0].credit_raw="1";
  expect(RouteLaunchScenario.safeParse(s).success).toBe(false);expect(()=>evaluateLaunch(s)).toThrow();
});
it("retains original v1 and v2 hashes without network access or adding fields",async()=>{
  const outside=vi.spyOn(globalThis,"fetch").mockRejectedValue(Error("Network forbidden"));for(const original of [originalV1,originalV2]){expect(await replayLaunch(original)).toEqual(original);expect(await hashJson(evaluateLaunch(original.inputs))).toBe(original.result_hash);}expect(outside).not.toHaveBeenCalled();
});
it("saves/replays all versions under one admission cap, hides inputs publicly and detects tampering",async()=>{
  const {db}=fixture(),body=request(),record=await createLaunch(db,body,now);expect(await createLaunch(db,body,now)).toEqual(record);expect(await launchRecord(db,record.id)).toEqual(record);
  const publicList=LaunchList.parse(await launchList(db));expect(publicList.runs[0]!.result.version).toBe("launch-route-lab-v3");expect(publicList.runs[0]).not.toHaveProperty("inputs");expect(publicList.runs[0]).not.toHaveProperty("reason");
  const bad=structuredClone(record);if(bad.result.version!=="launch-route-lab-v3")throw Error("v3");bad.result.traders[0]!.final.native="0";await expect(replayLaunch(bad)).rejects.toThrow("mismatch");
  await expect(createLaunch(db,{...body,scenario:scenario(false)},now)).rejects.toThrow("conflict");
  const bodies=Array.from({length:22},(_,i)=>({...request(),scenario:i%3===0?scenario():i%3===1?{...exampleLaunch(),as_of:now.toISOString()}:feeExampleFromNet({...exampleLaunch(),as_of:now.toISOString()})}));
  const runs=await Promise.allSettled(bodies.map(body=>createLaunch(db,body,now)));expect(runs.filter(r=>r.status==="fulfilled")).toHaveLength(19);expect(runs.filter(r=>r.status==="rejected")).toHaveLength(3);expect(await createLaunch(db,body,now)).toEqual(record);
});
it("keeps a maximum twelve-action, twenty-four-leg scenario within existing retention bounds",async()=>{
  const s=scenario();s.traders=Array.from({length:8},(_,i)=>({id:`trader_${String(i).padStart(17,"0")}`,balances:{attn:"0",native:"0",og:U64_MAX.toString(),tenx:U64_MAX.toString()}}));
  s.actions=Array.from({length:12},()=>({kind:"route",trader:s.traders[0]!.id,from_pool:"og",to_pool:"native",gross_input_raw:"1000000000",minimum_attn_raw:"0",minimum_output_raw:"0",has_referral:true}));
  const result=run(s);expect(result.actions).toHaveLength(12);expect(result.actions.every(a=>a.status==="simulated")).toBe(true);expect(result.steps).toHaveLength(24);
  expect(new TextEncoder().encode(JSON.stringify(s)+JSON.stringify(result)).length).toBeLessThan(150000);const {db}=fixture();expect((await createLaunch(db,request(s),now)).result.version).toBe("launch-route-lab-v3");
});
it("preserves local authenticated write and cross-origin guards for route scenarios",async()=>{
  const {db}=fixture(),env={TENX_DB:db,TENX_ADMIN_TOKEN:"a".repeat(64),TENX_LOCAL_ONLY:"true"} as LocalEnv,body=request();
  const send=(token="",origin?:string)=>worker.fetch(new Request("http://127.0.0.1:8794/api/10x/admin/launches/lab",{method:"POST",headers:{"content-type":"application/json",...(token?{authorization:`Bearer ${token}`} :{}),...(origin?{origin}:{})},body:JSON.stringify(body)}),env);
  expect((await send()).status).toBe(401);expect((await send(env.TENX_ADMIN_TOKEN,"https://evil.example")).status).toBe(403);const response=await send(env.TENX_ADMIN_TOKEN);expect(response.status).toBe(200);const r=LaunchRecord.parse((await response.json() as {record:unknown}).record);expect(r.result.version).toBe("launch-route-lab-v3");expect(r.result.launch_enabled).toBe(false);
});
