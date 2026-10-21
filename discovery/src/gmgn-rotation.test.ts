import {afterEach,describe,expect,it,vi} from "vitest";
import {DatabaseSync} from "node:sqlite";
import {readFileSync,readdirSync} from "node:fs";
import {sqliteD1} from "../../app/functions/_lib/sqliteTestDb";
import {fixtureCandidates} from "./fixtures";
import {key} from "./wallet-fixtures.test-helper";
import type {Candidate} from "./model";
import {rankedDiscovery} from "./discovery-score-store";
import {freezeGmgnDailyCohort,readGmgnDailyCohort,selectGmgnDailyCohort,GMGN_REGRESSION_MINTS} from "./gmgn-rotation";
import {runGmgnPilot,gmgnPilotHasCapacity,gmgnStatus} from "./gmgn";
import {GMGN_USE_AUTHORITY} from "./gmgn-model";
import {reserveSourceFetch} from "./source-collection-store";
import {gmgnCandlePart} from "./gmgn-request";

const at=new Date("2026-10-21T01:00:00.000Z"),opened:DatabaseSync[]=[];
afterEach(()=>{opened.splice(0).forEach(db=>db.close());vi.restoreAllMocks();});
function setup(){const sqlite=new DatabaseSync(":memory:");opened.push(sqlite);for(const f of readdirSync(new URL("../migrations/",import.meta.url)).filter(f=>f.endsWith(".sql")).sort())sqlite.exec(readFileSync(new URL(`../migrations/${f}`,import.meta.url),"utf8"));const db=sqliteD1(sqlite);return{sqlite,db,settings:{db,apiKey:"test-only-query-credential",permissionReference:GMGN_USE_AUTHORITY,marketDailyLimit:600,researchMode:"local_calibration" as const}};}
async function candidates(){const base=(await fixtureCandidates(at))[0]!;return Array.from({length:9},(_,i):Candidate=>({...base,mode:"live",address:key(i+100),name:`Ordinary ${i}`,verification:i===0?"rejected":"provisional",creation:i%3===0?null:{...base.creation!,block_time:new Date(at.getTime()-(i%3===1?3600000:172800000)).toISOString()},market:i%3===0?null:{...base.market!,liquidity_usd:i%2?1000:50000}}));}
async function put(db:D1Database,items:Candidate[]){for(const c of items)await db.prepare("INSERT INTO tenx_candidates(mode,address,pool,payload,checked_at) VALUES(?1,?2,?3,?4,?5)").bind(c.mode,c.address,c.pool,JSON.stringify(c),c.checked_at).run();}

describe("frozen broad GMGN daily rotation",()=>{
  it("accounts for every candidate, missing/rejected rows and duplicates; separates regression cases with deterministic selection",async()=>{
    const {db}=setup(),items=await candidates();items.push({...items[0]!,address:GMGN_REGRESSION_MINTS[0]});
    const scores=(await rankedDiscovery(db,items,at,"score","all",{maximum:500})).rows;
    const a=await selectGmgnDailyCohort([...items,items[0]!],scores,at),b=await selectGmgnDailyCohort([...items].reverse(),[...scores].reverse(),at);
    expect(a).toEqual(b);expect(a.inventory).toHaveLength(10);expect(a.selected).toHaveLength(3);expect(a.selected).not.toContain(GMGN_REGRESSION_MINTS[0]);
    expect(a.inventory.find(r=>r.address===key(100))).toMatchObject({verification:"rejected",age_band:"unknown",liquidity_band:"unknown"});
    expect(a.inventory.find(r=>r.address===GMGN_REGRESSION_MINTS[0])!.disposition).toBe("regression_fixture");
    expect(new Set(a.inventory.filter(r=>r.disposition==="selected").map(r=>r.age_band)).size).toBe(3);
    const previous=new Map(a.selected.map(address=>[address,"2026-10-20"]));
    const next=await selectGmgnDailyCohort(items,scores,at,previous);expect(next.selected.every(address=>!a.selected.includes(address))).toBe(true);
    await expect(selectGmgnDailyCohort([...items,{...items[0]!,name:"conflict"}],scores,at)).rejects.toThrow("conflicting_duplicate");
  });
  it("freezes before IO, survives changed inventory and rotates on a later UTC day without touching score cohorts",async()=>{
    const {db,sqlite}=setup();await put(db,await candidates());const network=vi.spyOn(globalThis,"fetch").mockRejectedValue(Error("forbidden"));
    const first=await freezeGmgnDailyCohort(db,at);expect(first.manifest.selected).toHaveLength(3);
    sqlite.exec("UPDATE tenx_candidates SET payload=json_set(payload,'$.name','later observation')");
    expect(await freezeGmgnDailyCohort(db,new Date(at.getTime()+60000))).toEqual(first);
    const next=await freezeGmgnDailyCohort(db,new Date(at.getTime()+86400000));expect(next.manifest.selected.every(address=>!first.manifest.selected.includes(address))).toBe(true);
    expect(sqlite.prepare("SELECT count(*) n FROM tenx_score_cohorts").get()).toEqual({n:0});expect(sqlite.prepare("SELECT count(*) n FROM tenx_usage").get()).toEqual({n:0});expect(network).not.toHaveBeenCalled();
    expect(()=>sqlite.exec("UPDATE tenx_gmgn_daily_cohorts SET cutoff='bad'")).toThrow("immutable");expect(()=>sqlite.exec("DELETE FROM tenx_gmgn_daily_cohorts")).toThrow("immutable");
  });
  it("collects cheap info for three unreviewed targets first; failure stays attempted and the manifest precedes every call",async()=>{
    const {db,sqlite,settings}=setup();await put(db,await candidates());
    const fetcher=vi.fn(async(url:string)=>{expect(await readGmgnDailyCohort(db,"2026-10-21")).not.toBeNull();return Response.json({code:0,data:{address:new URL(url).searchParams.get("address")}});});
    for(let i=0;i<3;i++)expect(await runGmgnPilot(settings,2,fetcher,()=>new Date(at.getTime()+i*120000))).toMatchObject({state:"retained",provider_requests:1});
    expect(new Set(fetcher.mock.calls.map(([url])=>new URL(url).searchParams.get("address"))).size).toBe(3);
    expect(fetcher.mock.calls.every(([url])=>new URL(url).pathname==="/v1/token/info")).toBe(true);
    expect(sqlite.prepare("SELECT used FROM tenx_usage WHERE provider='market'").get()).toEqual({used:3});
    expect(await gmgnStatus(settings,at)).toMatchObject({daily_rotation:{manifest:{inventory:expect.any(Array)}},scoring_effect:"none",provider_requests:0});
  });
  it("keeps empty selection immutable and holds without provider IO",async()=>{
    const {db,settings}=setup(),fetcher=vi.fn();expect(await runGmgnPilot(settings,2,fetcher,()=>at)).toMatchObject({provider_requests:0});
    expect((await readGmgnDailyCohort(db,"2026-10-21"))!.manifest.inventory).toHaveLength(0);expect(await gmgnPilotHasCapacity(settings,at)).toBe(false);expect(fetcher).not.toHaveBeenCalled();
  });
  it("rejects a corrupt stored manifest hash rather than using an unverified selection",async()=>{
    const {db,sqlite}=setup(),items=await candidates(),scores=(await rankedDiscovery(db,items,at,"score","all",{maximum:500})).rows;
    const manifest=await selectGmgnDailyCohort(items,scores,at);
    sqlite.prepare("INSERT INTO tenx_gmgn_daily_cohorts(day,cutoff,payload,payload_hash) VALUES(?,?,?,?)").run(manifest.day,manifest.cutoff,JSON.stringify(manifest),"a".repeat(64));
    await expect(readGmgnDailyCohort(db,manifest.day)).rejects.toThrow("hash_mismatch");
  });
  it("does not let another candle series masquerade as the frozen rotation window",async()=>{
    const {db,sqlite,settings}=setup(),candidate=(await candidates())[0]!;await put(db,[candidate]);await freezeGmgnDailyCohort(db,at);
    const series={id:"00000000-0000-4000-8000-000000000001",start_at:new Date(at.getTime()-21600000).toISOString(),end_at:at.toISOString(),part:0};
    const requests=[...(["gmgn_token_info","gmgn_token_security","gmgn_token_pool"] as const).map(kind=>({kind,address:candidate.address})),...[0,1,2,3].map(part=>({kind:"gmgn_token_candles",address:candidate.address,...gmgnCandlePart({...series,part}),series:{...series,part}}))];
    for(let i=0;i<requests.length;i++){expect(await reserveSourceFetch(db,`manual-${i}`,requests[i],600,new Date(at.getTime()+i*120000),"local_calibration")).not.toBeNull();sqlite.prepare("UPDATE tenx_source_reservations SET state='failed' WHERE id=?").run(`manual-${i}`);}
    const later=new Date(at.getTime()+1800000);expect(await gmgnPilotHasCapacity(settings,later)).toBe(true);
    const fetcher=vi.fn(async()=>Response.json({code:0,data:{list:[]}}));expect(await runGmgnPilot(settings,2,fetcher,()=>later)).toMatchObject({state:"retained",provider_requests:1});
    const saved=JSON.parse(sqlite.prepare("SELECT request FROM tenx_source_reservations ORDER BY reserved_at DESC LIMIT 1").get()!.request as string);
    expect(saved.series.id).not.toBe(series.id);expect(saved.series.part).toBe(0);expect(saved.series.end_at).toBe(at.toISOString());
  });
  it("atomically preserves the 21-attempt scheduled baseline and rejects day rollover; operator admission is unchanged",async()=>{
    const {db,sqlite}=setup();
    for(let i=0;i<21;i++){
      const tick=new Date(at.getTime()+i*120000),reservation=await reserveSourceFetch(db,`prior${i}`,{kind:"gmgn_token_info",address:key(i+1)},600,tick,"local_calibration");expect(reservation).not.toBeNull();
      sqlite.prepare("UPDATE tenx_source_reservations SET state='failed' WHERE id=?").run(`prior${i}`);
    }
    const later=new Date(at.getTime()+3600000),request={kind:"gmgn_token_security",address:key(150)};
    expect(await reserveSourceFetch(db,"scheduled",request,600,later,"local_calibration","2026-10-21")).toBeNull();
    expect(await reserveSourceFetch(db,"rolled",request,600,new Date("2026-10-22T01:00:00.000Z"),"local_calibration","2026-10-21")).toBeNull();
    expect(await reserveSourceFetch(db,"operator",request,600,later,"local_calibration")).not.toBeNull();
    expect(sqlite.prepare("SELECT used FROM tenx_usage WHERE provider='market'").get()).toEqual({used:22});
  });
});
