import { afterEach, describe, expect, it, vi } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import { sqliteD1 } from "../../app/functions/_lib/sqliteTestDb";
import { fixtureCandidates } from "./fixtures";
import { DEFAULT_POLICY, type Candidate, type Market } from "./model";
import { saveCandidate } from "./store";
import { hashJson, toBase58 } from "./solana";
import { freezeSignal, measureSignalOutcome, OUTCOME_DELAY_MS, replaySignal, validateSignal, verifySignalOutcome, type SignalSummary } from "./signal-analysis";
import { runSignalCycle, saveSignal, signalCohort, signalDetail, signalResearch } from "./signal-research";
import worker, { type LocalEnv } from "./worker";
import sealedSignal from "../fixtures/signal-v1.json";
import { SignalCohortSchema } from "./signal-model";

const at = new Date("2026-10-20T00:00:00Z"), opened: DatabaseSync[] = [];
afterEach(() => { opened.splice(0).forEach(d => d.close()); vi.restoreAllMocks(); });
function database() {
  const sqlite = new DatabaseSync(":memory:"); opened.push(sqlite);
  for (const name of readdirSync(new URL("../migrations/",import.meta.url)).filter(f=>f.endsWith(".sql")).sort()) sqlite.exec(readFileSync(new URL(`../migrations/${name}`,import.meta.url),"utf8"));
  return { sqlite, db: sqliteD1(sqlite) };
}
async function sample() {
  const c: Candidate = { ...(await fixtureCandidates(at))[0]!, mode: "live" };
  c.creation = { ...c.creation!, block_time: new Date(at.getTime()-3*3_600_000).toISOString() };
  c.graduation = { ...c.graduation!, block_time: new Date(at.getTime()-2*3_600_000).toISOString() };
  const history: Market[] = Array.from({length:21},(_,i)=>({ ...c.market!, price_usd: 1+i/100, fetched_at: new Date(at.getTime()-(60-i*3)*60_000).toISOString(), market_cap_usd: 20_000_000, liquidity_usd: 50_000 }));
  c.market = history.at(-1)!;
  const input = { version: "signal-input-v1" as const, signal: "smooth_price_rise" as const, at: at.toISOString(), candidate: c, policy: DEFAULT_POLICY, history };
  return { c, history, input };
}
const endpoint = (p: Market, offset=86_400_000, price=.2, liquidity=10_000): Market => ({ ...p, fetched_at: new Date(at.getTime()+offset).toISOString(), price_usd:price, liquidity_usd:liquidity });

describe("time-safe diagnostic research",()=>{
  it("replays the sealed synthetic v1 snapshot without changing its retained hashes",async()=>{
    const r=SignalCohortSchema.parse(sealedSignal.record);
    expect((await replaySignal(r)).record_hash).toBe(sealedSignal.record.record_hash);
  });
  it("freezes measured flags and unflagged controls at their own baseline without altering selections",async()=>{
    const { input, c }=await sample(), before=JSON.stringify(c), rule=JSON.stringify(DEFAULT_POLICY);
    const line=await freezeSignal(input);
    expect(line.feature).toMatchObject({ flagged:true,rule_version:"sampled-linear-rise-v1",eligibility:"provisional",pattern:{samples:21,span_minutes:60} });
    expect(await replaySignal(line)).toEqual(line);
    const cap=await freezeSignal({...input,signal:"new_token_high_cap",history:[]}); expect(cap.feature.flagged).toBe(true);
    const control=await freezeSignal({...input,signal:"new_token_high_cap",history:[],candidate:{...c,market:{...c.market!,market_cap_usd:10_000_000}}}); expect(control.feature.flagged).toBe(false);
    expect(JSON.stringify(c)).toBe(before); expect(JSON.stringify(DEFAULT_POLICY)).toBe(rule);
    const falseLine=await freezeSignal({...input,history:input.history.map(p=>({...p,price_usd:1.2}))}); expect(falseLine.feature.flagged).toBe(false); expect(falseLine.feature.pattern!.linear_r_squared).toBeNull();
  });
  it("leaves missing/stale/insufficient evidence unknown and rejects future/post-baseline history",async()=>{
    const {input,c}=await sample();
    await expect(freezeSignal({...input,history:input.history.slice(-3)})).rejects.toThrow("not_ready");
    await expect(freezeSignal({...input,at:new Date(at.getTime()+180_001).toISOString()})).rejects.toThrow("fresh_positive_price");
    await expect(freezeSignal({...input,signal:"new_token_high_cap",history:[],candidate:{...c,market:{...c.market!,market_cap_usd:null,fdv_usd:1e12}}})).rejects.toThrow("market_cap_unavailable");
    await expect(freezeSignal({...input,candidate:{...c,creation:null}})).rejects.toThrow("verified_origin");
    await expect(freezeSignal({...input,candidate:{...c,market:{...c.market!,fetched_at:new Date(at.getTime()+1).toISOString()}}})).rejects.toThrow("future_snapshot");
    await expect(freezeSignal({...input,history:[...input.history,endpoint(c.market!,1)]})).rejects.toThrow("post_baseline");
    await expect(freezeSignal({...input,history:[{...input.history[0]!,observed_at:new Date(at.getTime()+1).toISOString()},...input.history.slice(1)]})).rejects.toThrow("post_baseline");
  });
  it("does not repair an old first observation with later price history",async()=>{
    const {db}=database(),{input,c,history}=await sample(); await saveCandidate(db,c);
    const original=await db.prepare("SELECT input_hash,payload FROM tenx_cohorts").all();
    await expect(freezeSignal({...input,at:history[0]!.fetched_at,candidate:{...c,market:history[0]!}})).rejects.toThrow();
    await saveSignal(db,await freezeSignal(input));
    expect(await db.prepare("SELECT input_hash,payload FROM tenx_cohorts").all()).toEqual(original);
    expect((await signalCohort(db,c.address,"smooth_price_rise"))!.captured_at).toBe(at.toISOString());
  });
  it("keeps the first usable observation on retry or later warning changes, with one audit",async()=>{
    const {db}=database(),{input,c}=await sample(), first=await freezeSignal(input); await saveSignal(db,first);
    const later=new Date(at.getTime()+60_000).toISOString(), p={...c.market!,fetched_at:later};
    const next=await freezeSignal({...input,at:later,candidate:{...c,market:p},history:[...input.history,p]});
    expect(await saveSignal(db,next)).toEqual(first);
    expect(await db.prepare("SELECT COUNT(*) AS n FROM tenx_signal_cohorts").first()).toMatchObject({n:1});
    expect(await db.prepare("SELECT COUNT(*) AS n FROM tenx_audit WHERE action='signal_snapshot'").first()).toMatchObject({n:1});
    const bad=structuredClone(first); bad.feature.flagged=false; await expect(replaySignal(bad)).rejects.toThrow("mismatch");
  });
  it("waits for the complete grace window, then measures a comparable endpoint without future leakage",async()=>{
    const {input,c}=await sample(), record=await freezeSignal(input), p=endpoint(c.market!);
    expect(await measureSignalOutcome(record,[p],new Date(at.getTime()+OUTCOME_DELAY_MS-1))).toBeNull();
    const o=(await measureSignalOutcome(record,[p,endpoint(c.market!,OUTCOME_DELAY_MS+1,10,1e6)],new Date(at.getTime()+OUTCOME_DELAY_MS)))!;
    expect(o).toMatchObject({status:"measured",severe_loss_signal:true,liquidity_change_pct:-80}); expect(o.price_return_pct).toBeCloseTo(-83.3333);
    expect(await verifySignalOutcome(o,record.record_hash,record)).toEqual(o);
    const bad={...o,price_return_pct:100}; const {outcome_hash:_,...body}=bad; bad.outcome_hash=await hashJson(body);
    await expect(verifySignalOutcome(bad,record.record_hash,record)).rejects.toThrow("calculation_mismatch");
  });
  it("never treats a missing, zero, duplicate or source-switched endpoint as zero return or a rug",async()=>{
    const {input,c}=await sample(),record=await freezeSignal(input),later=new Date(at.getTime()+OUTCOME_DELAY_MS);
    const p=endpoint(c.market!);
    for(const points of [[],[{...p,price_usd:0}],[{...p,liquidity_usd:null}],[{...p,source:"dexscreener" as const}],[p,p],[endpoint(c.market!,86_400_000-1_800_001)]]){
      const o=(await measureSignalOutcome(record,points,later))!;expect(o).toMatchObject({status:"insufficient_data",price_return_pct:null,liquidity_change_pct:null,severe_loss_signal:null});
    }
  });
  it("captures and finalizes automatically with bounded/idempotent local work and no source requests",async()=>{
    const {db}=database(),{c,history}=await sample();await saveCandidate(db,c);
    for(const p of history)await db.prepare("INSERT OR IGNORE INTO tenx_market_history(address,fetched_at,payload) VALUES(?1,?2,?3)").bind(c.address,p.fetched_at,JSON.stringify(p)).run();
    const provider=vi.spyOn(globalThis,"fetch");
    expect(await runSignalCycle(db,at)).toMatchObject({state:"succeeded",captured:2,finalized:0,provider_requests:0});
    expect(await runSignalCycle(db,at)).toMatchObject({state:"waiting"});
    const summary=await signalResearch(db,at); expect(summary.totals.map(t=>t.captured)).toEqual([1,1]);expect(summary.totals.every(t=>t.pending===1)).toBe(true);
    const p=endpoint(c.market!);await db.prepare("INSERT INTO tenx_market_history(address,fetched_at,payload) VALUES(?1,?2,?3)").bind(c.address,p.fetched_at,JSON.stringify(p)).run();
    const later=new Date(at.getTime()+OUTCOME_DELAY_MS);
    expect(await runSignalCycle(db,later)).toMatchObject({state:"succeeded",captured:0,finalized:2});
    expect((await signalResearch(db,later)).totals.every(t=>t.measured===1&&t.pending===0)).toBe(true);
    expect((await signalDetail(db,c.address,"smooth_price_rise"))!.replay).toBe("verified");
    expect(provider).not.toHaveBeenCalled();
  });
  it("honors pause and exposes corrupt retained snapshots as errors",async()=>{
    const {db}=database(),{input,c}=await sample();await saveSignal(db,await freezeSignal(input));
    await db.prepare("UPDATE tenx_control SET paused=1").run();expect(await runSignalCycle(db,at)).toMatchObject({state:"paused"});
    await db.prepare("UPDATE tenx_signal_cohorts SET payload=json_set(payload,'$.inputs.candidate.market.price_usd',5) WHERE address=?1").bind(c.address).run();
    await expect(signalDetail(db,c.address,"smooth_price_rise")).rejects.toThrow("mismatch");
  });
  it("rejects oversized frozen rows without a partial snapshot or audit",async()=>{
    const {db}=database(),{input,c}=await sample(); const r=await freezeSignal({...input,candidate:{...c,verification_reasons:["x".repeat(1_900_000)]}});
    await expect(saveSignal(db,r)).rejects.toThrow("size_limit");expect(await db.prepare("SELECT COUNT(*) AS n FROM tenx_signal_cohorts").first()).toMatchObject({n:0});
  });
  it("requires distinct tokens, later holdouts and available training outcomes before an inactive proposal",async()=>{
    const {input,c}=await sample(),record=await freezeSignal({...input,signal:"new_token_high_cap",history:[]}),outcome=(await measureSignalOutcome(record,[endpoint(c.market!)],new Date(at.getTime()+OUTCOME_DELAY_MS)))!;
    const rows:SignalSummary[]=Array.from({length:40},(_,i)=>{
      const captured=new Date(at.getTime()+i*48*3_600_000).toISOString(),flagged=i%2===0,address=toBase58(new Uint8Array(32).fill(i+1));
      const {inputs:unusedInputs,...r}=record;
      return {...r,address,captured_at:captured,feature:{...r.feature,flagged},outcome:{...outcome,address,captured_at:captured,finalized_at:new Date(Date.parse(captured)+OUTCOME_DELAY_MS).toISOString(),severe_loss_signal:flagged}};
    });
    expect(validateSignal(rows,"new_token_high_cap")).toMatchObject({status:"review_proposal",train_count:28,validation_count:12,activated:false,flagged_loss_rate:1,control_loss_rate:0});
    const overlap=rows.map(r=>({...r,captured_at:at.toISOString(),outcome:{...r.outcome!,finalized_at:new Date(at.getTime()+OUTCOME_DELAY_MS).toISOString()}}));
    expect(validateSignal(overlap,"new_token_high_cap")).toMatchObject({status:"collecting",train_count:0,purged_count:28,activated:false});
    expect(validateSignal(Array(40).fill(rows[0]!),"new_token_high_cap")).toMatchObject({status:"collecting",measured:1});
    expect(validateSignal(rows.map(r=>({...r,outcome:{...r.outcome!,severe_loss_signal:false}})),"new_token_high_cap").status).toBe("not_supported");
  });
  it("serves read-only research and replay from the local API without providers or public writes",async()=>{
    const {db}=database(),{input,c}=await sample();await saveSignal(db,await freezeSignal(input));
    const env:LocalEnv={TENX_DB:db,TENX_LOCAL_ONLY:"true",TENX_ADMIN_TOKEN:"a".repeat(64),TENX_NODE_RELAY:"false",TENX_RPC_URL:"https://api.mainnet-beta.solana.com",TENX_RPC_DAILY_LIMIT:"5000",TENX_MARKET_DAILY_LIMIT:"600",TENX_MARKET_PROVIDER:"dexscreener",TENX_QUALITY_ENABLED:"true",TENX_QUALITY_RPC_DAILY_LIMIT:"1800",TENX_MARKET_ENABLED:"false",TENX_WALLET_ANALYSIS_ENABLED:"true",TENX_WALLET_RPC_DAILY_LIMIT:"800"};
    const provider=vi.spyOn(globalThis,"fetch"),get=(path:string,init?:RequestInit)=>worker.fetch(new Request(`http://127.0.0.1:8794/api/10x/${path}`,init),env);
    expect((await get("research/signals")).status).toBe(200);
    const response=await get(`research/signals/solana/${c.address}/smooth_price_rise`);expect(response.status).toBe(200);expect(await response.json()).toMatchObject({replay:"verified",provider_requests:0});
    expect(response.headers.get("cache-control")).toBe("no-store");expect((await get("research/signals",{method:"POST"})).status).toBe(404);expect(provider).not.toHaveBeenCalled();
  });
});
