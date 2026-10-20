import {afterEach,expect,it,vi} from "vitest";
import {DatabaseSync} from "node:sqlite";
import {readFileSync,readdirSync} from "node:fs";
import {sqliteD1} from "../../app/functions/_lib/sqliteTestDb";
import {amountA,amountB,curveSwap,liquidityFromA,Q64,U128_MAX} from "./launch-curve";
import {evaluateLaunch,exampleLaunch} from "./launch-math";
import {LaunchRaw,LaunchScenario,LaunchList,LAUNCH_MATH_REVISION,METEORA_REVISION} from "./launch-model";
import {createLaunch,replayLaunch,launchRecord,launchList} from "./launch-lab";
import {hashJson} from "./solana";
import worker,{type LocalEnv} from "./worker";
import vectors from "../fixtures/recorded/meteora-cl-math.json";
const now=new Date("2026-10-20T12:00:00.000Z"),opened:DatabaseSync[]=[];
afterEach(()=>{opened.splice(0).forEach(db=>db.close());vi.restoreAllMocks();});
function fixture(){
  const sql=new DatabaseSync(":memory:");opened.push(sql);
  for(const f of readdirSync(new URL("../migrations/",import.meta.url)).filter(f=>f.endsWith(".sql")).sort())sql.exec(readFileSync(new URL(`../migrations/${f}`,import.meta.url),"utf8"));
  const db=sqliteD1(sql),batch=db.batch.bind(db);let queue=Promise.resolve<unknown>(null);
  db.batch=((statements:D1PreparedStatement[])=>{const run=queue.then(()=>batch(statements));queue=run.catch(()=>null);return run;}) as D1Database["batch"];
  return {db,sql};
}
const input=()=>({...exampleLaunch(),as_of:now.toISOString()});
const request=()=>({request_id:crypto.randomUUID(),reason:"Offline three-pool curve review",scenario:input()});
it("matches pinned independent SDK deposit, rounding and 256 exact-input swap vectors",()=>{
  expect(vectors.source_commit).toBe(METEORA_REVISION);expect(vectors.sdk_version).toBe("1.5.1");expect(vectors.math_source_sha256).toBe("238f3b84fcc02d34b057d54fadade17a610d9e4c213840cb3dd26e8b763a3941");
  for(const c of vectors.cases){
    const lo=BigInt(c.lower),hi=BigInt(c.upper),s=BigInt(c.current),l=liquidityFromA(BigInt(c.amount_a_raw),s,hi);
    expect(l.toString()).toBe(c.liquidity);expect(amountA(s,hi,l,true).toString()).toBe(c.seed_a);expect(amountB(lo,s,l,true).toString()).toBe(c.seed_b);
    expect(amountA(s,hi,l).toString()).toBe(c.amount_a_down);expect(amountB(lo,s,l).toString()).toBe(c.amount_b_down);
    for(const t of c.directions){const result=curveSwap(lo,hi,s,l,BigInt(t.net_input_raw),t.a_for_b);if(t.status==="range_exhausted")expect(result).toBeNull();else expect(result).toEqual({next:BigInt(t.next_sqrt_price!),output:BigInt(t.output_raw!)});}
  }
});
it("preserves exactly 50/20/20/10 including allocation dust without floating point",()=>{
  const s=input();s.trades=[];s.supply_raw="18446744073709551610";s.native_quote_budget_raw="18446744073709551615";
  const r=evaluateLaunch(s),supply=BigInt(s.supply_raw);
  expect(r.pools.map(p=>BigInt(p.allocated_attn_raw))).toEqual([supply/2n,supply/5n,supply/5n]);expect(BigInt(r.campaign_reserve_raw)).toBe(supply/10n);
  expect(r.pools.reduce((sum,p)=>sum+BigInt(p.initial.attn_raw)+BigInt(p.unseeded_attn_raw),BigInt(r.campaign_reserve_raw))).toBe(supply);
  expect(r.pools.slice(1).map(p=>p.initial.quote_raw)).toEqual(["0","0"]);expect(r.math_revision).toBe(LAUNCH_MATH_REVISION);
  expect(r).toMatchObject({launch_enabled:false,transfers_enabled:false,fees_modeled:false,locks_verified:false,external_prices_verified:false,provider_requests:0});
});
it("allows ATTN-only native inception as an explicit scenario",()=>{
  const s=input();s.pools.native.sqrt_initial=s.pools.native.sqrt_min;s.native_quote_budget_raw="0";
  expect(evaluateLaunch(s).native_quote_required_raw).toBe("0");
});
it("holds an immediate ATTN exit, then applies a buy and reverse sell without inventing quote funds",()=>{
  const s=input(),r=evaluateLaunch(s),og=r.pools[1]!;
  expect(r.steps[0]).toMatchObject({status:"range_exhausted",curve_output_raw:"0"});expect(r.steps[0]!.after).toEqual(r.steps[0]!.before);
  expect(r.steps[1]!.status).toBe("simulated");expect(r.steps[2]!.status).toBe("simulated");
  expect(BigInt(r.steps[1]!.after.attn_raw)).toBe(BigInt(og.initial.attn_raw)-BigInt(r.steps[1]!.curve_output_raw));
  expect(BigInt(r.steps[2]!.after.quote_raw)).toBe(BigInt(r.steps[1]!.after.quote_raw)-BigInt(r.steps[2]!.curve_output_raw));
  expect(r.steps.at(-1)!.status).toBe("range_exhausted");expect(r.steps.at(-1)!.after).toEqual(r.steps.at(-1)!.before);
});
it("uses asset decimals and exact rational references, exposing opening mismatch without claiming arbitrage profit",()=>{
  const s=input();s.trades=[];s.pools.og.quote_decimals=6;s.pools.og.quote_native={numerator:"1",denominator:"1000"};
  expect(evaluateLaunch(s).pools[1]!.opening_divergence_exceeded).toBe(false);
  s.pools.og.quote_native.numerator="2";const r=evaluateLaunch(s);expect(r.pools[1]).toMatchObject({opening_divergence_exceeded:true,opening_deviation_bps:"10000.00000000"});
  expect(r).not.toHaveProperty("arbitrage_profit");
  s.max_opening_divergence_bps=10000;expect(evaluateLaunch(s).pools[1]!.opening_divergence_exceeded).toBe(false);
});
it("compares exact opening tolerance before rounding the displayed basis points",()=>{
  const s=input();s.trades=[];s.max_opening_divergence_bps=0;s.pools.og.quote_native={numerator:"1000000000000000001",denominator:"1000000000000000000"};
  const p=evaluateLaunch(s).pools[1]!;expect(p.opening_deviation_bps).toBe("0.00000000");expect(p.opening_divergence_exceeded).toBe(true);
});
it.each(["split","single_sided","native_decimals","native_ratio","budget","range","liquidity","chain","asset","unknown","too_many_steps","version"])("rejects invalid or unsupported assumptions: %s",fault=>{
  const s:any=input();
  if(fault==="split")s.supply_raw="11";
  if(fault==="single_sided")s.pools.og.sqrt_initial=(Q64+1n).toString();
  if(fault==="native_decimals")s.pools.native.quote_decimals=6;
  if(fault==="native_ratio")s.pools.native.quote_native.numerator="2";
  if(fault==="budget")s.native_quote_budget_raw="0";
  if(fault==="range")s.pools.og.sqrt_max=s.pools.og.sqrt_min;
  if(fault==="liquidity"){s.pools.og.sqrt_min="79226673521066979257578248090";s.pools.og.sqrt_initial=s.pools.og.sqrt_min;s.pools.og.sqrt_max="79226673521066979257578248091";}
  if(fault==="chain")s.chain="base";
  if(fault==="asset")s.attn_asset="ACTUAL";
  if(fault==="unknown")s.execution_enabled=true;
  if(fault==="too_many_steps")s.trades=Array.from({length:25},()=>s.trades[0]);
  if(fault==="version")s.version="future";
  expect(()=>evaluateLaunch(s)).toThrow();
});
it("rejects malformed integer inputs as schema failures rather than throwing BigInt conversion errors",()=>{
  for(const raw of ["-1","1.1","1e6","01","bad","18446744073709551616","9".repeat(300),1,Infinity,NaN])expect(LaunchRaw.safeParse(raw).success).toBe(false);
  const s=input();s.reference_attn_native.denominator="0";expect(LaunchScenario.safeParse(s).success).toBe(false);
});
it("keeps pool probes ordered and rejects zero-output probes without changing inventory",()=>{
  const s=input();s.trades=[{pool:"og",direction:"quote_to_attn",net_input_raw:"1"}];
  const r=evaluateLaunch(s);expect(r.steps[0]!.status).toBe("zero_output");expect(r.steps[0]!.after).toEqual(r.steps[0]!.before);
  const reversed=input();reversed.trades=[reversed.trades[2]!,reversed.trades[1]!];expect(evaluateLaunch(reversed).steps[0]!.status).toBe("range_exhausted");
});
it("rejects u64 inventory overflow even when the curve price remains within range",()=>{
  const s=input();s.pools.native.sqrt_min="4295048016";s.trades=[{pool:"native",direction:"attn_to_quote",net_input_raw:"18446744073709551615"}];
  const step=evaluateLaunch(s).steps[0]!;expect(step.status).toBe("inventory_or_u64_bound");expect(step.after).toEqual(step.before);
});
it("conserves independent ATTN and quote balances across varied sequential scenarios",()=>{
  for(let n=1;n<=35;n++){
    const s=input();s.trades=Array.from({length:24},(_,i)=>({pool:(["native","og","tenx"] as const)[i%3]!,direction:i%2?"attn_to_quote" as const:"quote_to_attn" as const,net_input_raw:String(BigInt(n)*1000000000n)}));
    const r=evaluateLaunch(s);
    for(const step of r.steps){if(step.status!=="simulated"){expect(step.after).toEqual(step.before);continue;}const aForB=step.direction==="attn_to_quote",net=BigInt(step.net_input_raw),out=BigInt(step.curve_output_raw);
      expect(BigInt(step.after.attn_raw)-BigInt(step.before.attn_raw)).toBe(aForB?net:-out);expect(BigInt(step.after.quote_raw)-BigInt(step.before.quote_raw)).toBe(aForB?-out:net);
      const p=r.pools.find(p=>p.pool===step.pool)!;expect(BigInt(step.after.sqrt_price)>=BigInt(p.sqrt_min)&&BigInt(step.after.sqrt_price)<=BigInt(p.sqrt_max)).toBe(true);expect(BigInt(p.liquidity_q64)<=U128_MAX).toBe(true);
    }
    for(const p of r.pools)expect(p.final).toEqual(r.steps.filter(step=>step.pool===p.pool).at(-1)?.after??p.initial);
  }
});
it("freezes deterministic inputs, protects immutable records and publishes no reason or private request",async()=>{
  const {db,sql}=fixture(),outside=vi.spyOn(globalThis,"fetch").mockRejectedValue(Error("Network forbidden")),body=request();
  const r=await createLaunch(db,body,now);expect(await createLaunch(db,body,new Date(now.getTime()+86400000))).toEqual(r);expect(await launchRecord(db,r.id)).toEqual(r);
  expect(await hashJson(evaluateLaunch(r.inputs))).toBe(r.result_hash);expect(await replayLaunch(r)).toEqual(r);
  expect(()=>sql.exec("UPDATE tenx_launch_curve_labs SET result='{}'")).toThrow("immutable");expect(()=>sql.exec("DELETE FROM tenx_launch_curve_labs")).toThrow("immutable");
  const list=await launchList(db);expect(LaunchList.parse(list).runs).toHaveLength(1);expect(list.runs[0]).not.toHaveProperty("inputs");expect(list.runs[0]).not.toHaveProperty("reason");expect(list.runs[0]).not.toHaveProperty("request_hash");
  await expect(createLaunch(db,{...body,reason:"Different reason"},now)).rejects.toThrow("launch_request_conflict");
  const bad=structuredClone(r);bad.result.steps[1]!.curve_output_raw="1";await expect(replayLaunch(bad)).rejects.toThrow("mismatch");
  const future=structuredClone(r);future.inputs.as_of="2099-01-01T00:00:00.000Z";await expect(replayLaunch(future)).rejects.toThrow("mismatch");expect(outside).not.toHaveBeenCalled();
});
it("atomically enforces twenty records per UTC day including concurrent admission and retries",async()=>{
  const {db,sql}=fixture(),bodies=Array.from({length:23},request),results=await Promise.allSettled(bodies.map(body=>createLaunch(db,body,now)));
  expect(results.filter(r=>r.status==="fulfilled")).toHaveLength(20);expect(results.filter(r=>r.status==="rejected")).toHaveLength(3);
  expect(sql.prepare("SELECT COUNT(*) n FROM tenx_audit WHERE action='launch_curve_lab'").get()!.n).toBe(20);
  expect((await createLaunch(db,bodies[0],now)).id).toBe(bodies[0]!.request_id);
  expect((await createLaunch(db,request(),new Date(now.getTime()+86400000))).result.launch_enabled).toBe(false);
});
it("rolls back scenario and audit together on an interrupted write",async()=>{
  const {db,sql}=fixture();sql.exec("CREATE TRIGGER fault_audit BEFORE INSERT ON tenx_audit BEGIN SELECT RAISE(ABORT,'simulated'); END;");
  await expect(createLaunch(db,request(),now)).rejects.toThrow("simulated");expect(sql.prepare("SELECT COUNT(*) n FROM tenx_launch_curve_labs").get()!.n).toBe(0);
});
it("requires local operator and origin checks for saved runs, while public summaries remain read-only",async()=>{
  const {db}=fixture(),env={TENX_DB:db,TENX_ADMIN_TOKEN:"a".repeat(64),TENX_LOCAL_ONLY:"true"} as LocalEnv,body=request();
  const send=(path:string,method="GET",token="",value?:unknown,extra:Record<string,string>={})=>worker.fetch(new Request(`http://127.0.0.1:8794/api/10x/${path}`,{method,headers:{"content-type":"application/json",...(token?{authorization:`Bearer ${token}`} :{}),...extra},...(value?{body:JSON.stringify(value)}:{})}),env);
  expect((await send("admin/launches/lab","POST","",body)).status).toBe(401);expect((await send(`admin/launches/lab/${body.request_id}`)).status).toBe(401);
  expect((await send("admin/launches/lab","POST",env.TENX_ADMIN_TOKEN,body,{origin:"https://evil.example"})).status).toBe(403);
  expect((await send("admin/launches/lab","POST",env.TENX_ADMIN_TOKEN,{...body,unexpected:true})).status).toBe(400);
  const future=request();future.scenario.as_of="2099-01-01T00:00:00.000Z";expect((await send("admin/launches/lab","POST",env.TENX_ADMIN_TOKEN,future)).status).toBe(400);
  expect((await send("admin/launches/lab","POST",env.TENX_ADMIN_TOKEN,body)).status).toBe(200);
  expect((await send(`admin/launches/lab/${body.request_id}`,"GET",env.TENX_ADMIN_TOKEN)).status).toBe(200);
  expect((await send("launches/lab")).status).toBe(200);expect((await send("launches/lab","POST","",body)).status).toBe(404);
  expect((await send("admin/launches/lab","POST",env.TENX_ADMIN_TOKEN,body,{"content-length":"32001"})).status).toBe(413);
  const remote=await worker.fetch(new Request("https://remote.example/api/10x/launches/lab"),env);expect(remote.status).toBe(503);
});
