import {afterEach,expect,it,vi} from "vitest";
import {DatabaseSync} from "node:sqlite";
import {readFileSync,readdirSync} from "node:fs";
import {sqliteD1} from "../../app/functions/_lib/sqliteTestDb";
import {evaluateLaunch,exampleLaunch} from "./launch-math";
import {feeExampleFromNet} from "./launch-fees";
import {routeExampleFromFees} from "./launch-routes";
import {cycleExampleFromRoutes,cycleRouteScenario} from "./launch-cycles";
import {CycleLaunchResult,CycleLaunchScenario,RouteLaunchResult,LaunchList,type CycleLaunchInput} from "./launch-model";
import {createLaunch,launchRecord,launchList,replayLaunch} from "./launch-lab";
import {U64_MAX,ceilDiv} from "./launch-curve";
import {hashJson} from "./solana";
import worker,{type LocalEnv} from "./worker";
import originalV1 from "../fixtures/recorded/launch-curve-v1.json";
import originalV2 from "../fixtures/recorded/launch-fee-v2.json";
import originalV3 from "../fixtures/recorded/launch-route-v3.json";
const now=new Date("2026-10-20T12:00:00.000Z"),opened:DatabaseSync[]=[];
afterEach(()=>{opened.splice(0).forEach(db=>db.close());vi.restoreAllMocks();});
const scenario=()=>cycleExampleFromRoutes(routeExampleFromFees(feeExampleFromNet({...exampleLaunch(),as_of:now.toISOString()})));
const run=(s:CycleLaunchInput)=>CycleLaunchResult.parse(evaluateLaunch(s));
const request=(s=scenario())=>({request_id:crypto.randomUUID(),reason:"Offline independent closed-cycle projection review",scenario:s});
function fixture(){const sql=new DatabaseSync(":memory:");opened.push(sql);for(const n of readdirSync(new URL("../migrations/",import.meta.url)).filter(n=>n.endsWith(".sql")).sort())sql.exec(readFileSync(new URL(`../migrations/${n}`,import.meta.url),"utf8"));
  const db=sqliteD1(sql),batch=db.batch.bind(db);let queue=Promise.resolve<unknown>(null);db.batch=((items:D1PreparedStatement[])=>{const r=queue.then(()=>batch(items));queue=r.catch(()=>null);return r;}) as D1Database["batch"];return {db,sql};}
it("compares changing external prices, finite depth and explicit network costs",()=>{
  const r=run(scenario());expect(r.probes.map(p=>p.status)).toEqual(["profit_minimum_not_met","quote_passed","profit_minimum_not_met","profit_minimum_not_met","profit_minimum_not_met"]);
  const [unit,rise,fall,thin,cost]=r.probes;expect(BigInt(rise!.cycle_output_raw)).toBeGreaterThan(BigInt(unit!.cycle_output_raw));expect(BigInt(fall!.cycle_output_raw)).toBeLessThan(BigInt(unit!.cycle_output_raw));
  expect(BigInt(thin!.cycle_output_raw)).toBeLessThan(BigInt(rise!.cycle_output_raw));expect(BigInt(cost!.profit_native_floor_raw!)).toBeLessThan(0n);
  expect(r).toMatchObject({probes_apply:false,external_execution_verified:false,launch_enabled:false,transfers_enabled:false,policy_approved:false,provider_requests:0});
});
it("never advances baseline inventories or lets earlier passing probes finance later probes",()=>{
  const s=scenario(),baseline=RouteLaunchResult.parse(evaluateLaunch(cycleRouteScenario(s))),r=run(s);
  expect(r.pools).toEqual(baseline.pools);expect(r.traders).toEqual(baseline.traders);expect(r.steps).toEqual(baseline.steps);expect(r.actions).toEqual(baseline.actions);
  for(const p of r.probes)expect(p.before_balances).toEqual(baseline.traders.find(t=>t.id===p.trader)!.final);
  s.probes=[s.probes[1]!,{...s.probes[1]!,id:"repeat"}];expect(run(s).probes.map(({id:_id,...p})=>p)[0]).toEqual(run(s).probes.map(({id:_id,...p})=>p)[1]);
});
it("uses the exact second receipt as external input, rounds input fees up and CP output down",()=>{
  const s=scenario(),r=run(s),p=r.probes[1]!,gross=BigInt(p.route_output_raw),fee=ceilDiv(gross*30n,10000n),net=gross-fee;
  expect(p.external_fee_raw).toBe(fee.toString());expect(p.external_net_input_raw).toBe(net.toString());expect(p.cycle_output_raw).toBe((net*BigInt(p.external.reserve_output_raw)/(BigInt(p.external.reserve_input_raw)+net)).toString());
  const fork=RouteLaunchResult.parse(evaluateLaunch({...cycleRouteScenario(s),actions:[...s.actions,s.probes[1]!.route]}));
  expect(p.intermediate_attn_raw).toBe(fork.steps.at(-2)!.trader_output_raw);expect(fork.steps.at(-1)!.gross_input_raw).toBe(p.intermediate_attn_raw);expect(p.route_output_raw).toBe(fork.steps.at(-1)!.trader_output_raw);
  expect(p.projected_route_fees.map(f=>f.total_fee_raw)).toEqual(fork.steps.slice(-2).map(l=>l.total_fee_raw));
  const x=BigInt(p.external.reserve_input_raw),y=BigInt(p.external.reserve_output_raw),out=BigInt(p.cycle_output_raw);
  expect((x+gross)*(y-out)).toBeGreaterThanOrEqual(x*y);expect(out).toBeLessThan(y);
});
it("requires native cost funding before the route, including gross input when starting in native",()=>{
  const s=scenario();s.traders[1]!.balances.native=s.probes[1]!.route.gross_input_raw;const r=run(s);
  expect(r.probes.every(p=>p.status==="insufficient_network_balance"&&p.route_status===null&&p.projected_balances===null)).toBe(true);
  s.traders[1]!.balances.native=(BigInt(s.probes[1]!.route.gross_input_raw)+BigInt(s.probes[1]!.network_cost_native_raw)).toString();expect(run(s).probes[1]!.status).toBe("quote_passed");
});
it.each(["funding","empty_quote","first_min","second_min"])("retains route rejection and zero external receipt for %s",fault=>{
  const s=scenario();s.probes=[s.probes[1]!];const p=s.probes[0]!;
  if(fault==="funding"){p.route.from_pool="tenx";s.traders[1]!.balances.tenx="0";}
  if(fault==="empty_quote")s.actions=[];
  if(fault==="first_min")p.route.minimum_attn_raw=U64_MAX.toString();if(fault==="second_min")p.route.minimum_output_raw=U64_MAX.toString();
  const r=run(s).probes[0]!;expect(r.status).toBe("route_rejected");expect(r.route_status).not.toBe("simulated");expect(r.cycle_output_raw).toBe("0");expect(r.projected_route_fees).toEqual([]);expect(r.profit_native).toBeNull();expect(r.projected_balances).toBeNull();
});
it("checks independent final receipt and exact after-cost profit minima",()=>{
  const s=scenario();s.probes=[s.probes[1]!];const p=s.probes[0]!,quote=run(s).probes[0]!;
  p.minimum_cycle_output_raw=(BigInt(quote.cycle_output_raw)+1n).toString();expect(run(s).probes[0]!.status).toBe("cycle_minimum_not_met");
  p.minimum_cycle_output_raw=quote.cycle_output_raw;p.minimum_profit_native_raw=(BigInt(quote.profit_native_floor_raw!)+1n).toString();expect(run(s).probes[0]!.status).toBe("profit_minimum_not_met");
  p.minimum_profit_native_raw=quote.profit_native_floor_raw!;expect(run(s).probes[0]!.status).toBe("quote_passed");
});
it("projects only the starting asset and native cost, leaving ATTN and the intermediate asset unchanged",()=>{
  const p=run(scenario()).probes[1]!,projected=p.projected_balances!;
  expect(BigInt(projected.native)-BigInt(p.before_balances.native)).toBe(BigInt(p.cycle_output_raw)-BigInt(p.requested_input_raw)-BigInt(p.network_cost_native_raw));
  expect(projected.attn).toBe(p.before_balances.attn);expect(projected.og).toBe(p.before_balances.og);expect(projected.tenx).toBe(p.before_balances.tenx);
});
it("handles reverse OG and 10X starting cycles with exact native conversion and fractional loss flooring",()=>{
  for(const pool of ["og","tenx"] as const){const s=scenario();s.actions=[];s.traders[1]!.balances[pool]="1000000000000";s.pools[pool].quote_native={numerator:"1",denominator:"3"};s.probes=[s.probes[1]!];const p=s.probes[0]!;
    s.pools[pool].quote_decimals=pool==="og"?6:9;
    p.route.from_pool=pool;p.route.to_pool="native";p.external.reserve_output_raw="1000000000000000";
    let q=run(s).probes[0]!;expect(q.route_status).toBe("simulated");expect(q.status).toBe("profit_minimum_not_met");
    const scale=10n**BigInt(9-s.pools[pool].quote_decimals),n=(BigInt(q.cycle_output_raw)-BigInt(q.requested_input_raw))*scale-BigInt(p.network_cost_native_raw)*3n;
    expect(BigInt(q.profit_native!.numerator)*3n).toBe(n*BigInt(q.profit_native!.denominator));expect(q.profit_native_floor_raw).toBe((-ceilDiv(-n,3n)).toString());
    p.external.reserve_output_raw="2000000000000000";q=run(s).probes[0]!;expect(q.status).toBe("quote_passed");
    expect(q.projected_balances!.native).toBe((BigInt(q.before_balances.native)-BigInt(p.network_cost_native_raw)).toString());
  }
});
it.each(["fee","zero","reserve_bound"])("rejects invalid external capacity without projected balances: %s",fault=>{
  const s=scenario();s.probes=[s.probes[1]!];const p=s.probes[0]!;
  if(fault==="fee"){p.route.gross_input_raw="100";p.external.fee_bps=9999;}
  if(fault==="zero")p.external.reserve_output_raw="1";
  if(fault==="reserve_bound")p.external.reserve_input_raw=U64_MAX.toString();
  const q=run(s).probes[0]!;expect(q.status).toBe(fault==="fee"?"external_fee_consumes_input":fault==="zero"?"external_zero_output":"external_u64_bound");expect(q.projected_balances).toBeNull();
});
it("rejects a profitable cycle whose projected starting-asset wallet would overflow",()=>{
  const s=scenario();s.traders[1]!.balances.native=U64_MAX.toString();expect(run(s).probes[1]!.status).toBe("trader_u64_bound");
});
it.each(["duplicate_probe","unknown_trader","same_pool","too_many_probes","too_many_base_actions","zero_reserve","u64_reserve","unknown_field","duplicate_trader"])("rejects malformed cycle input: %s",fault=>{
  const s:any=scenario();if(fault==="duplicate_probe")s.probes[1].id=s.probes[0].id;if(fault==="unknown_trader")s.probes[0].route.trader="missing";if(fault==="same_pool")s.probes[0].route.to_pool=s.probes[0].route.from_pool;
  if(fault==="too_many_probes")s.probes=Array.from({length:9},(_,i)=>({...s.probes[0],id:`probe_${i}`}));if(fault==="too_many_base_actions")s.actions=Array(12).fill(s.actions[0]);if(fault==="zero_reserve")s.probes[0].external.reserve_input_raw="0";
  if(fault==="u64_reserve")s.probes[0].external.reserve_output_raw=(U64_MAX+1n).toString();if(fault==="unknown_field")s.probes[0].sign=true;if(fault==="duplicate_trader")s.traders[1].id=s.traders[0].id;
  expect(CycleLaunchScenario.safeParse(s).success).toBe(false);expect(()=>evaluateLaunch(s)).toThrow();
});
it("preserves v1/v2/v3 immutable replay and uses zero network requests",async()=>{
  const network=vi.spyOn(globalThis,"fetch").mockRejectedValue(Error("Network forbidden"));for(const r of [originalV1,originalV2,originalV3])expect(await replayLaunch(r)).toEqual(r);run(scenario());expect(network).not.toHaveBeenCalled();
});
it("shares retention, access, immutable replay, tamper detection and admission caps",async()=>{
  const {db}=fixture(),body=request(),record=await createLaunch(db,body,now);expect(await createLaunch(db,body,now)).toEqual(record);expect(await launchRecord(db,record.id)).toEqual(record);
  const list=LaunchList.parse(await launchList(db));expect(list.runs[0]).not.toHaveProperty("inputs");expect(list.runs[0]).not.toHaveProperty("reason");
  const bad=structuredClone(record);if(bad.result.version!=="launch-cycle-lab-v4")throw Error("v4");bad.result.probes[1]!.profit_native_floor_raw="0";
  bad.result_hash=await hashJson(bad.result);const {record_hash:_h,inputs:_i,result:_r,...meta}=bad;bad.record_hash=await hashJson(meta);await expect(replayLaunch(bad)).rejects.toThrow("mismatch");
  await expect(createLaunch(db,{...body,scenario:{...body.scenario,probes:[body.scenario.probes[0]!]}},now)).rejects.toThrow("conflict");
  for(let i=0;i<19;i++)await createLaunch(db,{...request(),scenario:i%2?cycleRouteScenario(scenario()):scenario()},now);
  await expect(createLaunch(db,request(),now)).rejects.toThrow("daily_limit");expect(await createLaunch(db,body,now)).toEqual(record);
});
it("keeps maximum probe/trace counts inside existing record bounds",async()=>{
  const s=scenario();s.traders[1]!.balances.og=U64_MAX.toString();
  for(let i=2;i<8;i++)s.traders.push({id:`trader_${String(i).padStart(17,"0")}`,balances:{attn:"0",native:"0",og:U64_MAX.toString(),tenx:U64_MAX.toString()}});
  const route={...s.probes[1]!.route,from_pool:"og" as const,to_pool:"native" as const,gross_input_raw:"1000000000"};
  s.actions=Array(11).fill(route);s.probes=Array.from({length:8},(_,i)=>({...s.probes[1]!,route,id:`probe_${i}`}));const r=run(s);
  expect(r.steps).toHaveLength(22);expect(r.probes.every(p=>p.route_status==="simulated")).toBe(true);
  expect(new TextEncoder().encode(JSON.stringify(s)+JSON.stringify(r)).length).toBeLessThan(150000);expect(new TextEncoder().encode(JSON.stringify(request(s))).length).toBeLessThan(30000);
  const {db}=fixture();expect((await createLaunch(db,request(s),now)).result.version).toBe("launch-cycle-lab-v4");
});
it("requires local authenticated writes and rejects cross-origin requests",async()=>{
  const {db}=fixture(),env={TENX_DB:db,TENX_ADMIN_TOKEN:"a".repeat(64),TENX_LOCAL_ONLY:"true"} as LocalEnv;
  const send=(token="",origin?:string)=>worker.fetch(new Request("http://127.0.0.1:8794/api/10x/admin/launches/lab",{method:"POST",headers:{"content-type":"application/json",...(token?{authorization:`Bearer ${token}`} :{}),...(origin?{origin}:{})},body:JSON.stringify(request())}),env);
  expect((await send()).status).toBe(401);expect((await send(env.TENX_ADMIN_TOKEN,"https://evil.example")).status).toBe(403);expect((await send(env.TENX_ADMIN_TOKEN)).status).toBe(200);
});
