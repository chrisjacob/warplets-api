import {afterEach,expect,it,vi} from "vitest";
import {DatabaseSync} from "node:sqlite";
import {readFileSync,readdirSync} from "node:fs";
import {sqliteD1} from "../../app/functions/_lib/sqliteTestDb";
import {evaluateLaunch,exampleLaunch} from "./launch-math";
import {feeExampleFromNet} from "./launch-fees";
import {routeExampleFromFees} from "./launch-routes";
import {openingFeeAt,timedExampleFromRoutes,timedFeeScenario} from "./launch-timed";
import {TimedLaunchResult,TimedLaunchScenario,OpeningFeeConfig,LaunchList,type TimedLaunchInput} from "./launch-model";
import {quoteOnlySwap} from "./launch-fee-kernel";
import {createLaunch,launchRecord,launchList,replayLaunch} from "./launch-lab";
import {U64_MAX} from "./launch-curve";
import {hashJson} from "./solana";
import worker,{type LocalEnv} from "./worker";
import sdkVectors from "../fixtures/recorded/meteora-linear-opening.json";
import v1 from "../fixtures/recorded/launch-curve-v1.json";
import v2 from "../fixtures/recorded/launch-fee-v2.json";
import v3 from "../fixtures/recorded/launch-route-v3.json";
import v4 from "../fixtures/recorded/launch-cycle-v4.json";
const now=new Date("2026-10-20T12:00:00.000Z"),opened:DatabaseSync[]=[];
afterEach(()=>{opened.splice(0).forEach(db=>db.close());vi.restoreAllMocks();});
const scenario=()=>timedExampleFromRoutes(routeExampleFromFees(feeExampleFromNet({...exampleLaunch(),as_of:now.toISOString()})));
const run=(s:TimedLaunchInput)=>TimedLaunchResult.parse(evaluateLaunch(s));
const request=(s=scenario())=>({request_id:crypto.randomUUID(),reason:"Offline linear opening-fee and activation rehearsal",scenario:s});
function fixture(){const sql=new DatabaseSync(":memory:");opened.push(sql);for(const n of readdirSync(new URL("../migrations/",import.meta.url)).filter(n=>n.endsWith(".sql")).sort())sql.exec(readFileSync(new URL(`../migrations/${n}`,import.meta.url),"utf8"));
  const db=sqliteD1(sql),batch=db.batch.bind(db);let queue=Promise.resolve<unknown>(null);db.batch=((items:D1PreparedStatement[])=>{const r=queue.then(()=>batch(items));queue=r.catch(()=>null);return r;}) as D1Database["batch"];return {db,sql};}
it("matches independently generated SDK schedule boundaries and 136 scheduled swap vectors",()=>{
  expect(sdkVectors.cases).toHaveLength(136);expect(sdkVectors.source_hashes["../src/math/poolFees/baseFee/feeTimeScheduler.ts"]).toBe("7443aec6479dc38533c815fef684dc90c28e644ca30de7bc26e98e473e173944");
  for(const v of sdkVectors.cases){const config=OpeningFeeConfig.parse({...scenario().pools.native.fees,...v.schedule});
    const fee=openingFeeAt(config,BigInt(v.point),BigInt(v.activation_point));expect(fee.toString()).toBe(v.fee_numerator);
    const q=quoteOnlySwap(BigInt(v.lower),BigInt(v.upper),BigInt(v.current),BigInt(v.liquidity),BigInt(v.gross_input_raw),v.a_for_b,fee,20,20,true);
    if(v.status==="range_exhausted"){expect(q.status).toBe("range_exhausted");continue;}
    if(v.net_input_raw==="0"){expect(q.status).toBe("fee_consumes_input");continue;}
    expect(q.status).toBe("quoted");if(q.status!=="quoted")throw Error("Expected quote");
    expect({next:q.next.toString(),net:q.netInput.toString(),receipt:q.traderOutput.toString(),lp:q.lpClaiming.toString(),protocol:q.protocol.toString(),referral:q.referral.toString()}).toEqual({next:v.next_sqrt_price,net:v.net_input_raw,receipt:v.trader_output_raw,lp:v.lp_claiming_fee_raw,protocol:v.protocol_fee_raw,referral:v.referral_fee_raw});
  }
});
it("rejects before-start actions separately from the SDK's preactivation terminal-fee quote",()=>{
  const s=scenario(),r=run(s);expect(openingFeeAt(s.pools.native.fees,BigInt(s.activation_point)-1n,BigInt(s.activation_point))).toBe(10000000n);
  expect(r.actions.map(a=>a.status)).toEqual(["not_active","minimum_output_not_met","simulated","simulated","simulated","simulated","simulated"]);
  expect(r.actions[0]).toMatchObject({attempted_fees:[],attempted_leg_statuses:[],trader_debit_raw:"0",trader_output_raw:"0",committed_step_indexes:[]});expect(r.actions[0]!.after_balances).toEqual(r.actions[0]!.before_balances);
  expect(r.actions[1]!.attempted_fees[0]!.fee_numerator).toBe("500000000");expect(r.actions[2]!.attempted_fees[0]!.fee_numerator).toBe("500000000");expect(r.actions[3]!.attempted_fees[0]!.fee_numerator).toBe("377500000");expect(r.actions[4]!.attempted_fees[0]!.fee_numerator).toBe("10000000");
  expect(r).toMatchObject({launch_enabled:false,transfers_enabled:false,policy_approved:false,activation_verified:false,program_execution_verified:false,route_execution_verified:false,provider_requests:0});
});
it("clamps periods at the terminal fee, including zero activation and maximum timestamps",()=>{
  const s=scenario(),f=s.pools.native.fees;expect(openingFeeAt(f,0n,0n)).toBe(500000000n);expect(openingFeeAt(f,59n,0n)).toBe(500000000n);expect(openingFeeAt(f,60n,0n)).toBe(377500000n);
  expect(openingFeeAt(f,240n,0n)).toBe(10000000n);expect(openingFeeAt(f,U64_MAX,0n)).toBe(10000000n);
});
it("never reprices an earlier fill when a later action crosses a fee boundary",()=>{
  const s=scenario();s.actions=s.actions.slice(2,5);const first=structuredClone(s);first.actions=first.actions.slice(0,1);
  const before=run(first),after=run(s);expect(after.steps[0]).toEqual(before.steps[0]);expect(after.actions[0]).toEqual(before.actions[0]);expect(after.steps.map(s=>s.effective_fee_numerator)).toEqual(["500000000","377500000","10000000"]);
  expect(after.pools[0]!.initial).toEqual(before.pools[0]!.initial);expect(after.pools[0]!.fee_totals.total_fee_raw).toBe(after.steps.reduce((n,s)=>n+BigInt(s.total_fee_raw),0n).toString());
});
it("matches the frozen static evaluator when every action uses one timestamp and rate",()=>{
  const s=scenario();s.actions=s.actions.slice(2);s.actions.forEach(a=>a.point=(BigInt(s.activation_point)+240n).toString());
  const r=run(s),base=timedFeeScenario(s,BigInt(s.actions[0]!.point)),{version:_v,trades:_t,...rest}=base;
  const staticResult=evaluateLaunch({...rest,version:"launch-route-lab-v3",traders:s.traders,actions:s.actions.map(a=>a.action)});
  if(staticResult.version!=="launch-route-lab-v3")throw Error("v3");
  expect(r.traders).toEqual(staticResult.traders);expect(r.steps.map(({point:_p,effective_fee_numerator:_f,...step})=>step)).toEqual(staticResult.steps);
  for(const [i,p] of r.pools.entries()){expect(p.final).toEqual(staticResult.pools[i]!.final);expect(p.fee_totals).toEqual(staticResult.pools[i]!.fee_totals);}
});
it.each(["empty_second","first_minimum","second_minimum","wallet_bound"])("rolls back complete timed routes on %s",fault=>{
  const s=scenario();s.actions=s.actions.slice(5);s.actions[0]!.point=s.actions[1]!.point;const action=s.actions[1]!.action;if(action.kind!=="route")throw Error("route");
  if(fault==="empty_second")s.actions.shift();if(fault==="first_minimum")action.minimum_attn_raw=U64_MAX.toString();if(fault==="second_minimum")action.minimum_output_raw=U64_MAX.toString();if(fault==="wallet_bound")s.traders[1]!.balances.og=U64_MAX.toString();
  const before=structuredClone(s);before.actions.pop();const initial=run(before),after=run(s),a=after.actions.at(-1)!;
  expect(a.status).toBe(fault==="empty_second"?"range_exhausted":fault==="wallet_bound"?"trader_u64_bound":"minimum_output_not_met");expect(a.after_balances).toEqual(a.before_balances);expect(a.committed_step_indexes).toEqual([]);expect(a.trader_debit_raw).toBe("0");expect(a.trader_output_raw).toBe("0");
  expect(after.pools).toEqual(initial.pools);expect(after.steps).toEqual(initial.steps);expect(after.traders).toEqual(initial.traders);
});
it("allows different per-pool schedules on two legs at the same point",()=>{
  const s=scenario();s.actions=s.actions.slice(5);s.pools.og.fees.reduction_factor="120000000";const r=run(s),a=r.actions[1]!;
  expect(a.status).toBe("simulated");expect(a.attempted_fees).toEqual([{pool:"native",fee_numerator:"10000000"},{pool:"og",fee_numerator:"20000000"}]);
  const [first,second]=a.committed_step_indexes.map(i=>r.steps[i]!);expect(first!.point).toBe(second!.point);expect(first!.trader_output_raw).toBe(second!.gross_input_raw);
});
it("preserves stable same-point ordering, funding isolation and reverse-sell inventory",()=>{
  const s=scenario();s.actions=s.actions.slice(2,3);const buy=s.actions[0]!,sell={point:buy.point,action:{...buy.action,kind:"swap" as const,pool:"native" as const,direction:"attn_to_quote" as const,gross_input_raw:"1000000000",minimum_output_raw:"0"}};
  s.actions=[sell,buy,sell,{...buy,action:{...buy.action,trader:"competitor"}}];const r=run(s);expect(r.actions.map(a=>a.status)).toEqual(["insufficient_balance","simulated","simulated","simulated"]);expect(r.actions[0]!.attempted_fees).toEqual([]);
  expect(r.actions[2]!.input_asset).toBe("attn");expect(r.actions[2]!.before_balances.attn).toBe(r.steps[0]!.trader_output_raw);
});
it("conserves every asset across traders, principal, rounding dust, reserve and fee accruals",()=>{
  for(let n=1;n<=12;n++){const s=scenario();s.pools.native.fees.reduction_factor=String(120000000+n*100000);const r=run(s),sum=(xs:string[])=>xs.reduce((a,v)=>a+BigInt(v),0n);
    expect(sum(r.pools.map(p=>p.final.attn_raw))+sum(r.pools.map(p=>p.unseeded_attn_raw))+sum(r.traders.map(t=>t.final.attn))+BigInt(r.campaign_reserve_raw)).toBe(BigInt(r.supply_raw));
    for(const p of r.pools)expect(BigInt(p.initial.quote_raw)+sum(r.traders.map(t=>t.initial[p.pool]))).toBe(BigInt(p.final.quote_raw)+sum(r.traders.map(t=>t.final[p.pool]))+BigInt(p.fee_totals.total_fee_raw));
  }
});
it.each(["negative_terminal","below_minimum","zero_frequency","zero_reduction","too_many_periods","end_overflow","reverse_time","duplicate","unknown","same_pool","bad_raw","unknown_field"])("rejects malformed schedule/action data: %s",fault=>{
  const s:any=scenario(),f=s.pools.native.fees;if(fault==="negative_terminal")f.reduction_factor="500000000";if(fault==="below_minimum")f.reduction_factor="125000000";if(fault==="zero_frequency")f.period_frequency="0";if(fault==="zero_reduction")f.reduction_factor="0";if(fault==="too_many_periods")f.number_of_periods=65536;
  if(fault==="end_overflow")s.activation_point=U64_MAX.toString();if(fault==="reverse_time")s.actions[1].point="0";if(fault==="duplicate")s.traders[1].id=s.traders[0].id;if(fault==="unknown")s.actions[0].action.trader="missing";if(fault==="same_pool")s.actions[6].action.to_pool="native";if(fault==="bad_raw")f.reduction_factor="bad";if(fault==="unknown_field")f.dynamic_fee_enabled=true;
  expect(TimedLaunchScenario.safeParse(s).success).toBe(false);expect(()=>evaluateLaunch(s)).toThrow();
});
it("replays immutable v1–v4 records unchanged without network calls",async()=>{
  const network=vi.spyOn(globalThis,"fetch").mockRejectedValue(Error("Network forbidden"));for(const old of [v1,v2,v3,v4])expect(await replayLaunch(old)).toEqual(old);run(scenario());expect(network).not.toHaveBeenCalled();
});
it("shares immutable persistence, mixed-version quota and public redaction",async()=>{
  const {db}=fixture(),body=request(),record=await createLaunch(db,body,now);expect(await createLaunch(db,body,now)).toEqual(record);expect(await launchRecord(db,record.id)).toEqual(record);const list=LaunchList.parse(await launchList(db));expect(list.runs[0]).not.toHaveProperty("inputs");expect(list.runs[0]).not.toHaveProperty("reason");
  const bad=structuredClone(record);if(bad.result.version!=="launch-timed-lab-v5")throw Error("v5");bad.result.steps[0]!.effective_fee_numerator="1";bad.result_hash=await hashJson(bad.result);const {record_hash:_h,inputs:_i,result:_r,...meta}=bad;bad.record_hash=await hashJson(meta);await expect(replayLaunch(bad)).rejects.toThrow("mismatch");
  await expect(createLaunch(db,{...body,reason:"Changed reason"},now)).rejects.toThrow("conflict");
  for(let i=0;i<19;i++)await createLaunch(db,{...request(),scenario:i%2?{...v4.inputs,as_of:now.toISOString()}:scenario()},now);await expect(createLaunch(db,request(),now)).rejects.toThrow("daily_limit");expect(await createLaunch(db,body,now)).toEqual(record);
});
it("keeps eight traders and twelve successful two-leg actions within existing retention bounds",async()=>{
  const s=scenario();s.traders[1]!.balances.og=U64_MAX.toString();for(let i=2;i<8;i++)s.traders.push({id:`trader_${String(i).padStart(17,"0")}`,balances:{attn:"0",native:"0",og:U64_MAX.toString(),tenx:U64_MAX.toString()}});
  s.actions=Array.from({length:12},()=>({point:(BigInt(s.activation_point)+240n).toString(),action:{kind:"route",trader:"competitor",from_pool:"og",to_pool:"native",gross_input_raw:"1000000000",minimum_attn_raw:"0",minimum_output_raw:"0",has_referral:true}}));const r=run(s);expect(r.steps).toHaveLength(24);
  expect(new TextEncoder().encode(JSON.stringify(s)+JSON.stringify(r)).length).toBeLessThan(150000);expect(new TextEncoder().encode(JSON.stringify(request(s))).length).toBeLessThan(30000);const {db}=fixture();expect((await createLaunch(db,request(s),now)).result.version).toBe("launch-timed-lab-v5");
});
it("preserves authenticated local writes and cross-origin protection",async()=>{
  const {db}=fixture(),env={TENX_DB:db,TENX_ADMIN_TOKEN:"a".repeat(64),TENX_LOCAL_ONLY:"true"} as LocalEnv;
  const send=(token="",origin?:string)=>worker.fetch(new Request("http://127.0.0.1:8794/api/10x/admin/launches/lab",{method:"POST",headers:{"content-type":"application/json",...(token?{authorization:`Bearer ${token}`} :{}),...(origin?{origin}:{})},body:JSON.stringify(request())}),env);
  expect((await send()).status).toBe(401);expect((await send(env.TENX_ADMIN_TOKEN,"https://evil.example")).status).toBe(403);expect((await send(env.TENX_ADMIN_TOKEN)).status).toBe(200);
});
