import {describe,expect,it} from "vitest";
import {assembleGmgnWindow,assembleGmgnWindowData} from "./gmgn-window";
import {windowEntries,windowEnd,windowStart,windowAddress} from "./gmgn-window-fixtures.test-helper";
import {reviewRecentActivity,unavailableRecentActivity,verifyRecentActivity} from "./recent-activity";
import {RECENT_ACTIVITY_POLICY as P,RecentActivity} from "./recent-activity-model";
import {hashJson} from "./solana";

const at=new Date(Date.parse(windowEnd)+60000);
type Entries=ReturnType<typeof windowEntries>;
function mapBars(entries:Entries,fn:(bar:Entries[number]["response"]["data"]["list"][number],minute:number)=>void){
  for(const entry of entries)for(const bar of entry.response.data.list)fn(bar,(bar.time-Date.parse(windowStart))/60000);return entries;
}
async function review(entries=windowEntries(),now=at,creation:string|null=null){return reviewRecentActivity(await assembleGmgnWindowData(entries),now,creation);}
describe("fixed recent candle measurement policy",()=>{
  it("preserves original window hashes and derives exact complete periods with equal preceding denominators",async()=>{
    const entries=windowEntries(),data=await assembleGmgnWindowData(entries),legacy=await assembleGmgnWindow(entries);
    expect(data.report).toEqual(legacy);expect(data.candles).toHaveLength(360);
    const report=await reviewRecentActivity(data,at);expect(await verifyRecentActivity(report)).toEqual(report);expect(report.policy_hash).toBe(await hashJson(P));
    expect(report).toMatchObject({address:windowAddress,anchor_at:windowEnd,freshness:"fresh",parent_window_hash:legacy.report_hash,usd_field:"volume",provider_requests:0,database_writes:0,qualified_attention_momentum:null,participant_breadth:null,scoring_effect:"none"});
    for(const [i,total]of [60,720,4320].entries()){const period=report.periods[i]!;expect(period.recent).toMatchObject({status:"complete",observed_minutes:P.window_minutes[i],reported_volume_usd:total,positive_volume_minutes:P.window_minutes[i]});expect(period.recent.price_change_pct).toBeGreaterThan(0);}
    expect(report.periods.slice(0,2).map(p=>p.reported_volume_ratio)).toEqual([1,1]);expect(report.periods[2]!.previous).toBeNull();expect(report.periods[2]!.reported_volume_ratio).toBeNull();
  });
  it("does not fill or slide a missing last minute, but retains complete short intervals when older minutes are missing",async()=>{
    const missing=windowEntries();for(const e of missing)e.response.data.list=e.response.data.list.filter(b=>b.time!==Date.parse(windowEnd)-60000);
    const report=await review(missing);expect(report.periods.map(p=>p.recent.observed_minutes)).toEqual([4,59,359]);for(const p of report.periods)expect(p.recent).toMatchObject({status:"partial",reported_volume_usd:null,price_change_pct:null,positive_volume_minutes:null});
    const oldGap=windowEntries();for(const e of oldGap)e.response.data.list=e.response.data.list.filter(b=>b.time!==Date.parse(windowStart)+20*60000);
    const partial=await review(oldGap);expect(partial.periods[0]!.recent.reported_volume_usd).toBe(60);expect(partial.periods[1]!.reported_volume_ratio).toBe(1);expect(partial.periods[2]!.recent.status).toBe("partial");
  });
  it("withholds a conflicting prior-period minute without losing a complete recent period",async()=>{
    const entries=windowEntries();entries[3]!.response.data.list[20]!.volume="999";
    const report=await review(entries);expect(report.gaps).toContain("overlapping_candle_conflict");expect(report.periods[1]!.recent.status).toBe("complete");expect(report.periods[1]!.previous).toMatchObject({status:"partial",observed_minutes:59,reported_volume_usd:null});expect(report.periods[1]!.reported_volume_ratio).toBeNull();
  });
  it("retains real zero/fading activity but leaves zero-baseline ratios unknown",async()=>{
    const fading=mapBars(windowEntries(),(b,m)=>{if(m>=300){b.volume="0";b.amount="0";}}),report=await review(fading);
    expect(report.periods[1]).toMatchObject({recent:{reported_volume_usd:0,positive_volume_minutes:0},reported_volume_ratio:0});expect(report.periods[0]!.reported_volume_ratio).toBeNull();expect(report.periods[0]!.gaps).toContain("zero_previous_volume_ratio_undefined");
    const fromZero=mapBars(windowEntries(),(b,m)=>{if(m>=350&&m<355){b.volume="0";b.amount="0";}});expect((await review(fromZero)).periods[0]).toMatchObject({recent:{reported_volume_usd:60},previous:{reported_volume_usd:0},reported_volume_ratio:null});
  });
  it("requires target flow pairs and carries the corroborated field in either direction",async()=>{
    const missing=windowEntries();for(const e of missing)for(const b of e.response.data.list)if(b.time===Date.parse(windowEnd)-60000)delete (b as Partial<typeof b>).amount;
    const held=await review(missing);expect(held.usd_field).toBe("volume");expect(held.periods[0]!.recent).toMatchObject({status:"complete",reported_volume_usd:null,positive_volume_minutes:null});expect(held.periods[0]!.recent.price_change_pct).not.toBeNull();
    const reversed=mapBars(windowEntries(),b=>{const volume=b.volume;b.volume=b.amount;b.amount=volume;});expect(await review(reversed)).toMatchObject({usd_field:"amount",periods:[{recent:{reported_volume_usd:60}},{recent:{reported_volume_usd:720}},{recent:{reported_volume_usd:4320}}]});
    const unknown=windowEntries();for(const e of unknown)for(const b of e.response.data.list)delete (b as Partial<typeof b>).amount;
    expect((await review(unknown)).periods.every(p=>p.recent.reported_volume_usd===null&&p.reported_volume_ratio===null)).toBe(true);
  });
  it("labels stale windows, rejects future receipts, holds receipt skew and does not invent pre-creation history",async()=>{
    expect((await review(windowEntries(),new Date(at.getTime()+3600000))).freshness).toBe("stale");await expect(review(windowEntries(),new Date(Date.parse(windowEnd)+40000))).rejects.toThrow("cutoff");
    const skew=windowEntries();skew[3]!.received_at=new Date(Date.parse(windowEnd)+400000).toISOString();const held=await review(skew,new Date(Date.parse(windowEnd)+401000));expect(held.periods.every(p=>p.recent.status==="held"&&p.recent.reported_volume_usd===null)).toBe(true);
    const young=await review(windowEntries(),at,new Date(Date.parse(windowEnd)-30*60000).toISOString());expect(young.periods[0]!.recent.status).toBe("complete");expect(young.periods[1]!.recent).toMatchObject({status:"held",price_change_pct:null,reported_volume_usd:null});expect(young.periods[2]!.recent.gaps).toContain("window_starts_before_verified_creation");
  });
  it("rejects corrupted policy/report identity and keeps missing or simulation reports valueless",async()=>{
    const report=await review();await expect(verifyRecentActivity({...report,policy_hash:"f".repeat(64)})).rejects.toThrow();await expect(verifyRecentActivity({...report,periods:report.periods.map(p=>({...p,reported_volume_ratio:10}))})).rejects.toThrow();
    expect(RecentActivity.safeParse({...report,qualified_attention_momentum:100}).success).toBe(false);expect(RecentActivity.safeParse({...report,cutoff_at:windowStart}).success).toBe(false);
    for(const state of ["missing","rejected","simulation"] as const){const missing=await unavailableRecentActivity(windowAddress,at,state,"test_gap");expect(await verifyRecentActivity(missing)).toEqual(missing);expect(missing.periods).toEqual([]);expect(missing.parent_window_hash).toBeNull();}
    const failed=windowEntries().map(e=>({...e,state:"failed" as const,response:null}));expect(await reviewRecentActivity(await assembleGmgnWindowData(failed),at)).toMatchObject({state:"rejected",periods:[]});
  });
});
