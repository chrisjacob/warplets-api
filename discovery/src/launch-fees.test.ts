import {afterEach,expect,it,vi} from "vitest";
import {DatabaseSync} from "node:sqlite";
import {readFileSync,readdirSync} from "node:fs";
import {sqliteD1} from "../../app/functions/_lib/sqliteTestDb";
import {quoteOnlySwap} from "./launch-fee-kernel";
import {evaluateLaunch,exampleLaunch} from "./launch-math";
import {feeExampleFromNet} from "./launch-fees";
import {FeeLaunchResult,FeeLaunchScenario,LaunchRecord,LaunchList,FEE_MATH_REVISION} from "./launch-model";
import {createLaunch,launchRecord,launchList,replayLaunch} from "./launch-lab";
import {hashJson} from "./solana";
import {MIN_SQRT,U64_MAX} from "./launch-curve";
import worker,{type LocalEnv} from "./worker";
import sdkVectors from "../fixtures/recorded/meteora-onlyb-fees.json";
import originalV1 from "../fixtures/recorded/launch-curve-v1.json";
const now=new Date("2026-10-20T12:00:00.000Z"),opened:DatabaseSync[]=[];
afterEach(()=>{opened.splice(0).forEach(db=>db.close());vi.restoreAllMocks();});
const scenario=()=>feeExampleFromNet({...exampleLaunch(),as_of:now.toISOString()});
const request=()=>({request_id:crypto.randomUUID(),reason:"Offline static fee accounting review",scenario:scenario()});
function fixture(){const sql=new DatabaseSync(":memory:");opened.push(sql);for(const name of readdirSync(new URL("../migrations/",import.meta.url)).filter(n=>n.endsWith(".sql")).sort())sql.exec(readFileSync(new URL(`../migrations/${name}`,import.meta.url),"utf8"));
  const db=sqliteD1(sql),batch=db.batch.bind(db);let queue=Promise.resolve<unknown>(null);db.batch=((items:D1PreparedStatement[])=>{const run=queue.then(()=>batch(items));queue=run.catch(()=>null);return run;}) as D1Database["batch"];return {db,sql};}
it("matches 240 independently generated SDK exact-input OnlyB quotes, fee splits and range failures",()=>{
  expect(sdkVectors.sdk_version).toBe("1.5.1");expect(sdkVectors.source_hashes["../src/math/feeMath.ts"]).toBe("1252cf633943a77033e0bbf8d7c5bcc4315ad5add15fc37904f0f4ede71ddbdb");
  for(const v of sdkVectors.cases){const q=quoteOnlySwap(BigInt(v.lower),BigInt(v.upper),BigInt(v.current),BigInt(v.liquidity),BigInt(v.gross_input_raw),v.a_for_b,BigInt(v.fee_numerator),v.protocol_percent,v.referral_percent,v.has_referral);
    if(v.status==="range_exhausted"){expect(q.status).toBe("range_exhausted");continue;}
    if(v.net_input_raw==="0"){expect(q.status).toBe("fee_consumes_input");continue;}
    expect(q.status).toBe("quoted");if(q.status!=="quoted")throw Error("Expected SDK-parity quote");
    expect({next:q.next.toString(),net:q.netInput.toString(),output:q.traderOutput.toString(),lp:q.lpClaiming.toString(),protocol:q.protocol.toString(),referral:q.referral.toString(),feesOnInput:q.feesOnInput})
      .toEqual({next:v.next_sqrt_price,net:v.net_input_raw,output:v.trader_output_raw,lp:v.lp_claiming_fee_raw,protocol:v.protocol_fee_raw,referral:v.referral_fee_raw,feesOnInput:v.fees_on_input});
    expect(q.totalFee).toBe(q.lpClaiming+q.protocol+q.referral);expect(v.compounding_fee_raw).toBe("0");
    expect(q.feesOnInput?BigInt(v.gross_input_raw)-q.netInput:q.curveOutput-q.traderOutput).toBe(q.totalFee);
  }
});
it("charges buys on quote input and sells on quote output without mixing fees into principal",()=>{
  const r=FeeLaunchResult.parse(evaluateLaunch(scenario()));expect(r.math_revision).toBe(FEE_MATH_REVISION);
  const buy=r.steps[1]!,sell=r.steps[2]!;expect(buy.status).toBe("simulated");expect(sell.status).toBe("simulated");
  expect(buy.fees_on_input).toBe(true);expect(BigInt(buy.trader_debit_raw)).toBe(BigInt(buy.net_input_raw)+BigInt(buy.total_fee_raw));expect(buy.trader_output_raw).toBe(buy.curve_output_raw);
  expect(BigInt(buy.after.quote_raw)-BigInt(buy.before.quote_raw)).toBe(BigInt(buy.net_input_raw));
  expect(sell.fees_on_input).toBe(false);expect(sell.trader_debit_raw).toBe(sell.net_input_raw);expect(BigInt(sell.curve_output_raw)).toBe(BigInt(sell.trader_output_raw)+BigInt(sell.total_fee_raw));
  expect(BigInt(sell.before.quote_raw)-BigInt(sell.after.quote_raw)).toBe(BigInt(sell.curve_output_raw));
  expect(r.pools[1]!.initial.quote_raw).toBe("0");expect(r.pools[2]!.initial.quote_raw).toBe("0");expect(r).toMatchObject({launch_enabled:false,transfers_enabled:false,program_execution_verified:false,external_prices_verified:false,locks_verified:false,provider_requests:0});
});
it("takes referrals from the protocol portion and preserves LP claiming fee and total fee",()=>{
  const withRef=scenario();withRef.trades=withRef.trades.slice(1,2);const without=structuredClone(withRef);without.trades[0]!.has_referral=false;
  const a=FeeLaunchResult.parse(evaluateLaunch(withRef)).steps[0]!,b=FeeLaunchResult.parse(evaluateLaunch(without)).steps[0]!;
  expect(a.lp_claiming_fee_raw).toBe(b.lp_claiming_fee_raw);expect(a.total_fee_raw).toBe(b.total_fee_raw);expect(BigInt(a.protocol_fee_raw)+BigInt(a.referral_fee_raw)).toBe(BigInt(b.protocol_fee_raw));expect(b.referral_fee_raw).toBe("0");expect(a.trader_output_raw).toBe(b.trader_output_raw);
});
it.each(["range","minimum","dust","fee_consumed","inventory"])("keeps principal and all charged amounts unchanged on %s failure",failure=>{
  const s=scenario();s.trades=[{pool:"og",direction:failure==="range"?"attn_to_quote":"quote_to_attn",gross_input_raw:"1000000000",minimum_output_raw:"0",has_referral:true}];
  if(failure==="minimum")s.trades[0]!.minimum_output_raw=U64_MAX.toString();
  if(failure==="dust"){s.trades[0]!.gross_input_raw="2";s.pools.og.fees.fee_numerator="500000000";}
  if(failure==="fee_consumed")s.trades[0]!.gross_input_raw="1";
  if(failure==="inventory"){s.pools.native.sqrt_min=MIN_SQRT.toString();s.trades[0]={pool:"native",direction:"attn_to_quote",gross_input_raw:U64_MAX.toString(),minimum_output_raw:"0",has_referral:true};}
  const r=FeeLaunchResult.parse(evaluateLaunch(s)),step=r.steps[0]!,expected={range:"range_exhausted",minimum:"minimum_output_not_met",dust:"zero_output",fee_consumed:"fee_consumes_input",inventory:"inventory_or_u64_bound"}[failure];
  expect(step.status).toBe(expected);expect(step.after).toEqual(step.before);
  for(const key of ["trader_debit_raw","trader_output_raw","net_input_raw","curve_output_raw","total_fee_raw","lp_claiming_fee_raw","protocol_fee_raw","referral_fee_raw"] as const)expect(step[key]).toBe("0");
  for(const p of r.pools){expect(p.final).toEqual(p.initial);expect(p.fee_totals).toEqual({total_fee_raw:"0",lp_claiming_fee_raw:"0",protocol_fee_raw:"0",referral_fee_raw:"0"});}
});
it("accepts a minimum exactly equal to the net trader receipt and rejects one raw unit higher",()=>{
  const s=scenario();s.trades=s.trades.slice(1,2);const quoted=FeeLaunchResult.parse(evaluateLaunch(s)).steps[0]!;s.trades[0]!.minimum_output_raw=quoted.trader_output_raw;
  expect(FeeLaunchResult.parse(evaluateLaunch(s)).steps[0]!.status).toBe("simulated");s.trades[0]!.minimum_output_raw=(BigInt(quoted.trader_output_raw)+1n).toString();expect(FeeLaunchResult.parse(evaluateLaunch(s)).steps[0]!.status).toBe("minimum_output_not_met");
});
it.each(["compounding","both_tokens","dynamic","schedule","version","zero_fee","too_high","protocol","referral","net_input","unknown"])("rejects unsupported or invalid fee assumptions: %s",fault=>{
  const s:any=scenario(),f=s.pools.og.fees;
  if(fault==="compounding")f.compounding_fee_bps=1;if(fault==="both_tokens")f.collect_fee_mode="both_tokens";if(fault==="dynamic")f.dynamic_fee_enabled=true;if(fault==="schedule")f.base_fee_schedule="decaying";if(fault==="version")f.fee_version=0;
  if(fault==="zero_fee")f.fee_numerator="0";if(fault==="too_high")f.fee_numerator="990000001";if(fault==="protocol")f.protocol_fee_percent=101;if(fault==="referral")f.referral_fee_percent=-1;if(fault==="net_input")s.trades[0].net_input_raw="10";if(fault==="unknown")f.creator_entitlement_percent=100;
  expect(FeeLaunchScenario.safeParse(s).success).toBe(false);expect(()=>evaluateLaunch(s)).toThrow();
});
it("conserves gross debits, net receipts, separate principal and fee allocations over varied sequences",()=>{
  for(let n=1;n<=30;n++){
    const s=scenario();for(const p of Object.values(s.pools)){p.fees.fee_numerator=String(100000+n*317000);p.fees.protocol_fee_percent=n%2?20:100;p.fees.referral_fee_percent=n%3?20:100;}
    s.trades=Array.from({length:24},(_,i)=>({pool:(["native","og","tenx"] as const)[i%3]!,direction:i%2?"attn_to_quote" as const:"quote_to_attn" as const,gross_input_raw:String(BigInt(n+i+1)*1000000000n),minimum_output_raw:"0",has_referral:Boolean(i%2)}));
    const r=FeeLaunchResult.parse(evaluateLaunch(s));
    for(const step of r.steps){if(step.status!=="simulated"){expect(step.after).toEqual(step.before);continue;}
      const aForB=step.direction==="attn_to_quote",gross=BigInt(step.trader_debit_raw),net=BigInt(step.net_input_raw),out=BigInt(step.trader_output_raw),curveOut=BigInt(step.curve_output_raw),fees=BigInt(step.total_fee_raw);
      expect(BigInt(step.after.attn_raw)-BigInt(step.before.attn_raw)).toBe(aForB?net:-curveOut);expect(BigInt(step.after.quote_raw)-BigInt(step.before.quote_raw)).toBe(aForB?-curveOut:net);
      expect(aForB?curveOut-out:gross-net).toBe(fees);expect(fees).toBe(BigInt(step.lp_claiming_fee_raw)+BigInt(step.protocol_fee_raw)+BigInt(step.referral_fee_raw));
    }
    for(const p of r.pools){const rows=r.steps.filter(step=>step.pool===p.pool);for(const key of ["total_fee_raw","lp_claiming_fee_raw","protocol_fee_raw","referral_fee_raw"] as const)expect(BigInt(p.fee_totals[key])).toBe(rows.reduce((sum,s)=>sum+BigInt(s[key]),0n));expect(p.final).toEqual(rows.at(-1)?.after??p.initial);}
    expect(r.pools.reduce((n,p)=>n+BigInt(p.allocated_attn_raw),BigInt(r.campaign_reserve_raw))).toBe(BigInt(r.supply_raw));
  }
});
it("replays the original retained v1 record with exactly its original hashes and no new fields",async()=>{
  const outside=vi.spyOn(globalThis,"fetch").mockRejectedValue(Error("Network forbidden")),r=await replayLaunch(originalV1);expect(r).toEqual(originalV1);expect(await hashJson(evaluateLaunch(r.inputs))).toBe(originalV1.result_hash);
  expect(r.inputs.version).toBe("launch-curve-lab-v1");expect(r.result.fees_modeled).toBe(false);expect(r.result).not.toHaveProperty("program_execution_verified");expect(r.result.pools[0]).not.toHaveProperty("fees");expect(outside).not.toHaveBeenCalled();
});
it("shares immutable storage and quota across both versions without changing old records",async()=>{
  const {db}=fixture(),v1=LaunchRecord.parse(originalV1),old=await createLaunch(db,{request_id:v1.id,reason:v1.reason,scenario:v1.inputs},new Date(v1.created_at));expect(old).toEqual(v1);
  const outside=vi.spyOn(globalThis,"fetch").mockRejectedValue(Error("Network forbidden")),body=request(),v2=await createLaunch(db,body,now);expect(await createLaunch(db,body,now)).toEqual(v2);expect(await launchRecord(db,v2.id)).toEqual(v2);expect(await launchRecord(db,v1.id)).toEqual(v1);
  expect(await hashJson(evaluateLaunch(v2.inputs))).toBe(v2.result_hash);expect(LaunchList.parse(await launchList(db)).runs.map(r=>r.result.version).sort()).toEqual(["launch-curve-lab-v1","launch-fee-lab-v2"]);
  await expect(createLaunch(db,{...body,request_id:v1.id},now)).rejects.toThrow("conflict");const bad=structuredClone(v2);if(bad.result.version!=="launch-fee-lab-v2")throw Error("Expected v2");bad.result.pools[1]!.fee_totals.total_fee_raw="0";await expect(replayLaunch(bad)).rejects.toThrow("mismatch");expect(outside).not.toHaveBeenCalled();
});
it("atomically shares the twenty-run cap between net-only and fee-aware scenarios",async()=>{
  const {db}=fixture(),bodies=Array.from({length:23},(_,i)=>({request_id:crypto.randomUUID(),reason:"Mixed-version quota review",scenario:i%2?scenario():{...exampleLaunch(),as_of:now.toISOString()}})),runs=await Promise.allSettled(bodies.map(body=>createLaunch(db,body,now)));
  expect(runs.filter(r=>r.status==="fulfilled")).toHaveLength(20);expect(runs.filter(r=>r.status==="rejected")).toHaveLength(3);expect(await createLaunch(db,bodies[0],now)).toEqual((runs[0] as PromiseFulfilledResult<unknown>).value);
});
it("uses existing local authenticated write/replay guards for fee scenarios",async()=>{
  const {db}=fixture(),env={TENX_DB:db,TENX_ADMIN_TOKEN:"a".repeat(64),TENX_LOCAL_ONLY:"true"} as LocalEnv,body=request();
  const send=(token="",origin?:string)=>worker.fetch(new Request("http://127.0.0.1:8794/api/10x/admin/launches/lab",{method:"POST",headers:{"content-type":"application/json",...(token?{authorization:`Bearer ${token}`} :{}),...(origin?{origin}:{})},body:JSON.stringify(body)}),env);
  expect((await send()).status).toBe(401);expect((await send(env.TENX_ADMIN_TOKEN,"https://evil.example")).status).toBe(403);const response=await send(env.TENX_ADMIN_TOKEN);expect(response.status).toBe(200);const r=LaunchRecord.parse((await response.json() as {record:unknown}).record);expect(r.result.fees_modeled).toBe(true);expect(r.result.launch_enabled).toBe(false);
});
