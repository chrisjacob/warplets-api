import { describe, expect, it } from "vitest";
import { assembleGmgnWindow } from "./gmgn-window";
import { corroborateGmgnUnits } from "./gmgn-candle-units";
import { GmgnRequestSchema, gmgnDescriptor } from "./gmgn-request";
import { windowEntries, windowEnd } from "./gmgn-window-fixtures.test-helper";

describe("bounded complete GMGN windows",()=>{
  it("requests four standard 100-minute pages with a declared forty-minute overlap",()=>{
    const entries=windowEntries();
    for(const entry of entries){expect(GmgnRequestSchema.safeParse(entry.request).success).toBe(true);expect(new URL(gmgnDescriptor(entry.request,new Date(windowEnd)).url).searchParams.get("resolution")).toBe("1m");}
    expect(entries.map(v=>(Date.parse(v.request.end_at)-Date.parse(v.request.start_at))/60_000)).toEqual([100,100,100,100]);
    expect(()=>GmgnRequestSchema.parse({...entries[0]!.request,series:{...entries[0]!.request.series,part:1}})).toThrow("part_mismatch");
    expect(()=>gmgnDescriptor(entries[0]!.request,new Date(entries[0]!.request.end_at))).toThrow("open_candle_window");
  });
  it("reconciles overlap once, measures the full 359 adjacent pairs, corroborates actual field orientation and replays deterministically",async()=>{
    const entries=windowEntries(),report=await assembleGmgnWindow(entries);
    expect(report).toMatchObject({candle_count:360,expected_count:360,missing_minutes:0,complete_window:true,overlap_conflicts:0,
      succeeded_parts:4,activity:{adjacent_pairs:359,longest_rising_run_pairs:359},units:{state:"price_consistent",usd_field:"volume",token_field:"amount",informative_candles:360,volume_usd_consistent:360,amount_usd_consistent:0},scoring_effect:"none",organic_demand_certified:false});
    expect(report.reported_window_volume_usd).toBe(4320);
    expect(await assembleGmgnWindow([...entries].reverse())).toEqual(report);
  });
  it("keeps missing/failed parts partial without turning absent volume into zero",async()=>{
    const entries=windowEntries();
    const partial=await assembleGmgnWindow(entries.slice(0,3));expect(partial).toMatchObject({candle_count:300,missing_minutes:60,complete_window:false,reported_window_volume_usd:null});
    const failed=[...entries.slice(0,3),{...entries[3]!,state:"failed" as const,response:null}];
    expect(await assembleGmgnWindow(failed)).toMatchObject({failed_parts:1,missing_minutes:60,complete_window:false});
  });
  it("excludes conflicting overlap minutes and makes no full-window turnover claim",async()=>{
    const entries=windowEntries();entries[3]!.response.data.list[0]!.volume="9999";
    expect(await assembleGmgnWindow(entries)).toMatchObject({candle_count:359,missing_minutes:1,overlap_conflicts:1,complete_window:false,reported_window_volume_usd:null});
  });
  it("rejects duplicate slots, different mints/windows, malformed pages and missing receipt proof",async()=>{
    const entries=windowEntries();
    await expect(assembleGmgnWindow([entries[0],entries[0]])).rejects.toThrow("duplicate");
    await expect(assembleGmgnWindow([entries[0],{...entries[1],request:{...entries[1]!.request,address:"11111111111111111111111111111111"}}])).rejects.toThrow("identity");
    await expect(assembleGmgnWindow([{...entries[0],receipt_hash:null}])).rejects.toThrow("receipt_required");
    const bad=windowEntries();bad[1]!.response.data.list[0]!.low=100;
    await expect(assembleGmgnWindow(bad)).rejects.toThrow("shape_or_ohlc");
  });
  it("retains a long capture-span gap and independent pool/trade evidence holds even with complete candles",async()=>{
    const entries=windowEntries();entries[3]!.received_at="2026-10-21T07:08:00.000Z";
    const report=await assembleGmgnWindow(entries);expect(report.complete_window).toBe(true);expect(report.gaps).toContain("receipt_span_exceeds_five_minutes");
    expect(report.independent_pool_binding_verified).toBe(false);expect(report.units.independent_trade_verification).toBe(false);
  });
});

describe("price-dimensional candle unit corroboration",()=>{
  const bars=()=>Array.from({length:12},(_,i)=>({time:i*60,open:.01,high:.011,low:.009,close:.01,volume:10,amount:1000}));
  it("supports either orientation only when all informative bars agree and the reverse fits none",()=>{
    expect(corroborateGmgnUnits(bars())).toMatchObject({state:"price_consistent",usd_field:"volume"});
    expect(corroborateGmgnUnits(bars().map(v=>({...v,volume:v.amount,amount:v.volume})))).toMatchObject({state:"price_consistent",usd_field:"amount"});
  });
  it("holds missing, short, dollar-pegged, mixed-orientation and contradictory zero-flow samples unknown",()=>{
    const mixed=bars();mixed[0]={...mixed[0]!,volume:1000,amount:10};
    for(const list of [bars().slice(1),bars().map(v=>({...v,amount:null})),bars().map(v=>({...v,low:.99,high:1.01,open:1,close:1,volume:10,amount:10})),mixed,bars().map(v=>({...v,volume:0}))])expect(corroborateGmgnUnits(list).state).toBe("unknown");
  });
});
