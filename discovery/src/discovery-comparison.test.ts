import {afterEach,describe,expect,it,vi} from "vitest";
import {DatabaseSync} from "node:sqlite";
import {readFileSync,readdirSync} from "node:fs";
import {sqliteD1} from "../../app/functions/_lib/sqliteTestDb";
import {fixtureCandidates} from "./fixtures";
import {unavailableTradeSample} from "./trade-sample";
import {key,signature} from "./wallet-fixtures.test-helper";
import type {Candidate} from "./model";
import {ActivityObservation,activityObservation,activityRecordKey} from "./activity-observation";
import {commonActivity,commonActivityBundle} from "./activity-observation-store";
import {discoveryComparison} from "./discovery-comparison";
import {ComparisonAddresses,verifyDiscoveryComparison} from "./discovery-comparison-model";
import {gmgnActivityTarget,runGmgnReview} from "./gmgn";
import {GMGN_USE_AUTHORITY} from "./gmgn-model";
import {windowEntries,windowAddress,windowEnd} from "./gmgn-window-fixtures.test-helper";
import {holderHistoryFixture} from "./holder-history-fixtures.test-helper";
import {HolderEvidenceSchema} from "./holders";
import {hashJson} from "./solana";
import worker,{type LocalEnv} from "./worker";

const at=new Date("2026-10-21T09:05:00.000Z"),opened:DatabaseSync[]=[];
afterEach(()=>{opened.splice(0).forEach(db=>db.close());vi.restoreAllMocks();vi.useRealTimers();});
async function setup(now=at){const sqlite=new DatabaseSync(":memory:");opened.push(sqlite);for(const f of readdirSync(new URL("../migrations/",import.meta.url)).filter(f=>f.endsWith(".sql")).sort())sqlite.exec(readFileSync(new URL(`../migrations/${f}`,import.meta.url),"utf8"));const db=sqliteD1(sqlite),candidate:Candidate={...(await fixtureCandidates(now))[0]!,mode:"live"};return {sqlite,db,candidate,settings:{db,apiKey:"test-only-query-key",permissionReference:GMGN_USE_AUTHORITY,marketDailyLimit:600}};}
async function put(db:D1Database,c:Candidate){await db.prepare("INSERT INTO tenx_candidates(mode,address,pool,payload,checked_at) VALUES(?1,?2,?3,?4,?5)").bind(c.mode,c.address,c.pool,JSON.stringify(c),c.checked_at).run();if(c.market)await db.prepare("INSERT OR IGNORE INTO tenx_market_history VALUES(?1,?2,?3)").bind(c.address,c.market.fetched_at,JSON.stringify(c.market)).run();}
async function source(settings:Awaited<ReturnType<typeof setup>>["settings"],request:unknown,data:unknown,now:Date,id:string=crypto.randomUUID(),status=200){return runGmgnReview(settings,{request_id:id,mode:"retained_research",reason:"Synthetic comparison source fixture",request},async()=>Response.json({code:0,data},{status}),()=>now);}
const metric=(rows:Awaited<ReturnType<typeof commonActivity>>,name:string)=>rows.find(r=>r.metric===name)!;

describe("common activity observation boundaries",()=>{
  it("forbids positive qualified metrics, numeric held values and future measurements",()=>{
    const base=activityObservation({address:key(1),cutoff_at:at.toISOString(),metric:"organic_volume_24h",source:"unavailable",unit:"USD"},{qualification:"held"});
    for(const patch of [{value:1},{value:1,qualification:"reported_only"},{value:1,metric:"token_reported_volume_24h",qualification:"reported_only",fetched_at:new Date(at.getTime()+1).toISOString()}])expect(ActivityObservation.safeParse({...base,...patch}).success).toBe(false);
  });
  it("keeps pool and token reports separate, leaves actual rolling endpoints unknown and uses verified archive references",async()=>{
    const {db,candidate,settings,sqlite}=await setup();candidate.market={...candidate.market!,volume_24h_usd:0,observed_at:new Date(at.getTime()-30000).toISOString()};await put(db,candidate);
    await source(settings,{kind:"gmgn_token_info",address:candidate.address},{address:candidate.address,holder_count:500,price:{volume_24h:"1000",volume_1h:"10"}},new Date(at.getTime()-300000));
    const changes=sqlite.prepare("SELECT total_changes() n").get(),network=vi.spyOn(globalThis,"fetch").mockRejectedValue(Error("forbidden")),records=await commonActivity(db,candidate,at);
    expect(records).toHaveLength(13);expect(metric(records,"pool_reported_volume_24h")).toMatchObject({value:0,source:candidate.market.source,scope:{kind:"pool",address:candidate.pool},references:[{integrity:"content_hash_only"}],window:{duration_seconds:86400,end_at:null}});
    expect(metric(records,"token_reported_volume_24h")).toMatchObject({value:1000,source:"gmgn",scope:{kind:"token"},freshness:"stale",window:{start_at:null,end_at:null,duration_seconds:86400},references:[{integrity:"archived_hash_verified"}],qualification:"reported_only"});
    expect(metric(records,"meaningful_holder_growth_24h").value).toBeNull();expect(metric(records,"organic_volume_24h").value).toBeNull();expect(network).not.toHaveBeenCalled();expect(sqlite.prepare("SELECT total_changes() n").get()).toEqual(changes);
    expect(await activityRecordKey(records[0]!)).not.toBe(await activityRecordKey(metric(records,"token_reported_volume_24h")));
  });
  it("retains latest rejection rather than selecting an older positive report, and rejects corrupt hashes",async()=>{
    const {db,candidate,settings,sqlite}=await setup();await put(db,candidate);
    await source(settings,{kind:"gmgn_token_info",address:candidate.address},{address:candidate.address,price:{volume_24h:1000}},new Date(at.getTime()-60000));
    const failed=crypto.randomUUID();await source(settings,{kind:"gmgn_token_info",address:candidate.address},{},new Date(at.getTime()-30000),failed,429);
    const rejected=metric(await commonActivity(db,candidate,at),"token_reported_volume_24h");expect(rejected).toMatchObject({value:null,qualification:"rejected",references:[{id:failed,integrity:"archived_hash_verified"}]});expect(rejected.gaps).toContain("latest_source_attempt_failed_no_clean_fallback");
    sqlite.prepare("UPDATE tenx_source_reservations SET receipt_hash='corrupt' WHERE id=?").run(failed);
    expect(metric(await commonActivity(db,candidate,at),"token_reported_volume_24h")).toMatchObject({value:null,qualification:"rejected",references:[],gaps:["gmgn_info_integrity_or_schema_failed"]});
  });
  it("never uses receipts or completed window parts which became available after the common cutoff",async()=>{
    const end=new Date(Date.parse(windowEnd)+60000),{db,candidate,settings}=await setup(end);candidate.address=windowAddress;candidate.creation={...candidate.creation!,block_time:new Date(Date.parse(windowEnd)-8*3600000).toISOString()};await put(db,candidate);
    for(const e of windowEntries())expect(await source(settings,e.request,e.response.data,new Date(e.received_at),e.id)).toMatchObject({state:"retained"});
    const complete=await commonActivity(db,candidate,end);expect(metric(complete,"candle_window_volume")).toMatchObject({value:4320,qualification:"reported_only",coverage:{observed:360,expected:360,status:"complete_requested_window"},references:expect.any(Array)});
    expect(metric(complete,"candle_longest_rising_run")).toMatchObject({value:359,qualification:"supported_sample"});
    const bundle=await commonActivityBundle(db,candidate,end);expect(bundle.records).toEqual(complete);expect(bundle.recent).toMatchObject({state:"available",address:windowAddress,cutoff_at:end.toISOString(),periods:[{recent:{reported_volume_usd:60}},{recent:{reported_volume_usd:720}},{recent:{reported_volume_usd:4320}}]});
    const earlier=await commonActivity(db,candidate,new Date(Date.parse(windowEnd)+40000));expect(metric(earlier,"candle_window_volume")).toMatchObject({value:null,qualification:"held",coverage:{observed:200,expected:360,status:"partial"}});expect(metric(earlier,"candle_window_volume").references).toHaveLength(2);
    const infoTime=new Date(end.getTime()+20000);await source(settings,{kind:"gmgn_token_info",address:windowAddress},{address:windowAddress,price:{volume_24h:999}},infoTime);
    expect(metric(await commonActivity(db,candidate,end),"token_reported_volume_24h").value).toBeNull();
  });
  it("keeps raw owner changes tied to their real interval and denominator, without daily/meaningful growth credit",async()=>{
    const {db,candidate}=await setup(),history=await holderHistoryFixture();candidate.address=history.address;candidate.pool=HolderEvidenceSchema.parse(history.samples[0]!.evidence).pool;await put(db,candidate);
    for(let i=0;i<history.samples.length;i++){const s=history.samples[i]!,meta=history.index[i]!;await db.prepare("INSERT INTO tenx_holder_evidence VALUES(?1,?2,?3,?4,?5)").bind(s.payload_hash,history.address,meta.slot,JSON.stringify(s.evidence),meta.observed_at).run();}
    const observations=await commonActivity(db,candidate,at),raw=metric(observations,"raw_owner_net_change");expect(raw).toMatchObject({value:0,qualification:"supported_sample",unit:"owners",window:{start_at:"2026-10-21T08:00:00.000Z",end_at:"2026-10-21T09:00:00.000Z",duration_seconds:3600},coverage:{denominator_value:2},references:expect.any(Array)});
    expect(raw.references).toHaveLength(3);expect(metric(observations,"meaningful_holder_growth_24h").value).toBeNull();
    const bundle=await commonActivityBundle(db,candidate,at);expect(bundle.participation).toMatchObject({address:candidate.address,cutoff_at:at.toISOString(),state:"available",since_first:{status:"held",screened_retained_entrants:null},meaningful_holder_growth_24h:null});expect(bundle.records).toEqual(observations);
    expect(metric(await commonActivity(db,{...candidate,pool:key(99)},at),"raw_owner_net_change")).toMatchObject({value:null,qualification:"held"});
  });
  it("keeps a selected-wallet page separate from token volume and rechecks its frozen selection",async()=>{
    const {db,candidate,settings,sqlite}=await setup(),id=crypto.randomUUID(),start=new Date(at.getTime()-60000);
    await source(settings,{kind:"gmgn_token_traders",address:candidate.address},{list:[{address:key(1),addr_type:0,buy_volume_cur:100,sell_volume_cur:90}]},start,id);
    const target=await gmgnActivityTarget(db,id,new Date(start.getTime()+20000));if(target.state!=="ready")throw Error("fixture selection");
    await source(settings,target.request,{activities:[{tx_hash:signature(1),token:{address:candidate.address},event_type:"buy",timestamp:start.getTime()/1000,token_amount:10,cost_usd:2}]},new Date(start.getTime()+20000));
    const record=metric(await commonActivity(db,candidate,at),"wallet_reported_buy_usd");expect(record).toMatchObject({value:2,scope:{kind:"wallet",address:key(1)},coverage:{observed:1,expected:20,status:"partial"},qualification:"reported_only"});expect(record.references).toHaveLength(2);
    sqlite.prepare("UPDATE tenx_source_reservations SET receipt_hash='corrupt' WHERE id=?").run(id);
    expect(metric(await commonActivity(db,candidate,at),"wallet_reported_buy_usd")).toMatchObject({value:null,qualification:"rejected"});
  });
});

describe("three-token cached comparison",()=>{
  it("keeps exact order, unknown tokens and one common v4 cutoff without a fabricated global rank or writes",async()=>{
    const {db,candidate,sqlite}=await setup();await put(db,candidate);const other={...candidate,address:key(90),market:null};await put(db,other);
    const changes=sqlite.prepare("SELECT total_changes() n").get(),network=vi.spyOn(globalThis,"fetch").mockRejectedValue(Error("forbidden")),addresses=[other.address,key(92),candidate.address];
    const report=await discoveryComparison(db,addresses,"live",at);expect(await verifyDiscoveryComparison(report)).toEqual(report);expect(report.rows.map(r=>r.address)).toEqual(addresses);expect(report.rows[1]).toMatchObject({state:"not_found",candidate:null,observations:[]});
    expect(report.rows[0]!.recent_activity).toMatchObject({state:"missing",address:other.address,cutoff_at:at.toISOString(),periods:[]});
    for(const row of [report.rows[0]!,report.rows[2]!]){expect(row.candidate?.discovery_score?.as_of).toBe(at.toISOString());expect(row.candidate?.discovery_score?.version).toBe("discovery-score-v4");expect(row.candidate?.discovery_rank).toBeUndefined();expect(row.observations.every(o=>o.cutoff_at===at.toISOString())).toBe(true);}
    expect(sqlite.prepare("SELECT total_changes() n").get()).toEqual(changes);expect(network).not.toHaveBeenCalled();await expect(verifyDiscoveryComparison({...report,report_hash:"a".repeat(64)})).rejects.toThrow();
    const legacyPayload={...report,rows:report.rows.map(({recent_activity:_,...row})=>row)}, {report_hash:_,...legacyBody}=legacyPayload;
    expect(await verifyDiscoveryComparison({...legacyBody,report_hash:await hashJson(legacyBody)})).toMatchObject({rows:expect.any(Array)});
    const mismatched={...report,rows:report.rows.map((row,i)=>i?row:{...row,recent_activity:{...row.recent_activity!,address:candidate.address}})}, {report_hash:omitted,...badBody}=mismatched;
    await expect(verifyDiscoveryComparison({...badBody,report_hash:await hashJson(badBody)})).rejects.toThrow();
  });
  it("withholds future/malformed candidates and isolates scoring failures",async()=>{
    const {db,candidate,sqlite}=await setup();await put(db,{...candidate,checked_at:new Date(at.getTime()+1).toISOString()});
    expect((await discoveryComparison(db,[candidate.address],"live",at)).rows[0]).toMatchObject({state:"held",candidate:null,observations:[]});
    sqlite.prepare("UPDATE tenx_candidates SET payload=json_set(payload,'$.checked_at',?)").run(at.toISOString());sqlite.prepare("UPDATE tenx_market_history SET payload=json_set(payload,'$.fetched_at','2000-01-01T00:00:00.000Z')").run();
    const report=await discoveryComparison(db,[candidate.address],"live",at);expect(report.rows[0]).toMatchObject({state:"available",candidate:null,gaps:["score_inputs_unusable_grade_withheld"]});expect(report.rows[0]!.observations).toHaveLength(13);
  });
  it("preserves comparisons without the additive trade sample and binds new samples to the shared mint/cutoff",async()=>{
    const {db,candidate}=await setup();await put(db,candidate);
    const report=await discoveryComparison(db,[candidate.address],"live",at);
    expect(report.rows[0]!.trade_sample).toMatchObject({address:candidate.address,cutoff_at:at.toISOString(),state:"missing"});
    const {report_hash:_,...legacy}={...report,rows:report.rows.map(({trade_sample:omitted,...row})=>row)};
    expect(await verifyDiscoveryComparison({...legacy,report_hash:await hashJson(legacy)})).toMatchObject({rows:expect.any(Array)});
    const wrong=await unavailableTradeSample(key(99),at,"missing","test_missing");
    const {report_hash:old,...bad}={...report,rows:report.rows.map(row=>({...row,trade_sample:wrong}))};
    await expect(verifyDiscoveryComparison({...bad,report_hash:await hashJson(bad)})).rejects.toThrow("comparison_trade_sample_mismatch");
  });
  it("isolates fixture mode and rejects excessive/duplicate/arbitrary API scope before provider IO",async()=>{
    const {db,candidate}=await setup();await put(db,candidate);await put(db,{...candidate,mode:"fixture"});
    const report=await discoveryComparison(db,[candidate.address],"fixture",at);expect(await verifyDiscoveryComparison(report)).toEqual(report);expect(report.rows[0]!.observations.every(o=>o.source==="simulation"||o.source==="unavailable")).toBe(true);
    expect(report.rows[0]!.recent_activity?.state).toBe("simulation");
    expect(report.rows[0]!.holder_participation?.state).toBe("simulation");
    const{report_hash:_,...crossMode}={...report,mode:"live"};await expect(verifyDiscoveryComparison({...crossMode,report_hash:await hashJson(crossMode)})).rejects.toThrow("recent_activity_mismatch");
    const env={TENX_DB:db,TENX_LOCAL_ONLY:"true"} as LocalEnv,base="http://localhost/api/10x/discovery/compare?addresses=";
    for(const query of ["",candidate.address+","+candidate.address,[1,2,3,4].map(key).join(","),candidate.address+"&url=https://evil.test",candidate.address+"&cutoff=2000-01-01T00:00:00Z"]){const response=await worker.fetch(new Request(base+query),env);expect(response.status).toBe(400);}
    expect(ComparisonAddresses.safeParse([key(1),key(2),key(3)]).success).toBe(true);
  });
});
