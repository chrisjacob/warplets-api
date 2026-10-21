import {afterEach,describe,expect,it,vi} from "vitest";
import {DatabaseSync} from "node:sqlite";
import {readFileSync,readdirSync} from "node:fs";
import {sqliteD1} from "../../app/functions/_lib/sqliteTestDb";
import {fixtureCandidates} from "./fixtures";
import {key} from "./wallet-fixtures.test-helper";
import {rankedDiscovery} from "./discovery-score-store";
import {handle,type LocalEnv} from "./worker";
import {CardListResponse} from "../../app/src/discovery/client";
import type {Candidate} from "./model";

const at=new Date("2026-10-21T01:00:00.000Z"),opened:DatabaseSync[]=[];
afterEach(()=>{opened.splice(0).forEach(db=>db.close());vi.restoreAllMocks();vi.useRealTimers();});
async function setup(){const sqlite=new DatabaseSync(":memory:");opened.push(sqlite);for(const f of readdirSync(new URL("../migrations/",import.meta.url)).filter(f=>f.endsWith(".sql")).sort())sqlite.exec(readFileSync(new URL(`../migrations/${f}`,import.meta.url),"utf8"));const db=sqliteD1(sqlite),base=(await fixtureCandidates(at))[0]!;return{sqlite,db,base:{...base,mode:"live" as const},env:{TENX_DB:db,TENX_LOCAL_ONLY:"true"} as LocalEnv};}
describe("searchable cached discovery inventory",()=>{
  it("searches exact mints and case-insensitive names/symbols before the top 100, preserving original rank and honest scope",async()=>{
    const {db,base,env,sqlite}=await setup(),items=Array.from({length:105},(_,i):Candidate=>({...base,address:key(i+1),name:`Saved ${i}`,symbol:`OBS${i}`}));
    for(const c of items)await db.prepare("INSERT INTO tenx_candidates(mode,address,pool,payload,checked_at) VALUES('live',?1,?2,?3,?4)").bind(c.address,c.pool,JSON.stringify(c),c.checked_at).run();
    vi.useFakeTimers();vi.setSystemTime(at);const network=vi.spyOn(globalThis,"fetch").mockRejectedValue(Error("forbidden")),url="http://localhost/api/10x/candidates?view=cards&limit=100";
    const all=CardListResponse.parse(await(await handle(new Request(url),env)).json());expect(all.data.scope).toMatchObject({stored:105,matched:105,available:100,truncated:true,search_before_limit:true});
    const hidden=items.find(c=>!all.data.candidates.some(row=>row.address===c.address))!;expect(hidden).toBeDefined();
    const exact=CardListResponse.parse(await(await handle(new Request(url+`&q=${hidden.address}`),env)).json());expect(exact.data.candidates).toHaveLength(1);expect(exact.data.candidates[0]!.address).toBe(hidden.address);expect(exact.data.candidates[0]!.discovery_rank).toBeGreaterThan(100);expect(exact.data.scope).toMatchObject({matched:1,truncated:false});
    const named=await rankedDiscovery(db,items,at,"score","all",{search:hidden.name.toUpperCase()});expect(named.rows.some(c=>c.address===hidden.address)).toBe(true);
    const symbol=await rankedDiscovery(db,items,at,"score","all",{search:hidden.symbol.toLowerCase()});expect(symbol.rows.some(c=>c.address===hidden.address)).toBe(true);
    expect(network).not.toHaveBeenCalled();expect(sqlite.prepare("SELECT count(*) n FROM tenx_usage").get()).toEqual({n:0});expect(sqlite.prepare("SELECT count(*) n FROM tenx_score_cohorts").get()).toEqual({n:0});
  });
  it("keeps missing liquidity distinct from zero, and missing/stale/future/fresh snapshots separate",async()=>{
    const {db,base}=await setup(),market=base.market!;
    const items:Candidate[]=[{...base,address:key(1),market:null},{...base,address:key(2),market:{...market,liquidity_usd:0}},{...base,address:key(3),market:{...market,liquidity_usd:null}},{...base,address:key(4),market:{...market,fetched_at:new Date(at.getTime()-180001).toISOString()}},{...base,address:key(5),market:{...market,observed_at:new Date(at.getTime()+1).toISOString()}}];
    expect((await rankedDiscovery(db,items,at,"score","all",{freshness:"missing"})).rows.map(c=>c.address)).toEqual([key(1)]);
    expect((await rankedDiscovery(db,items,at,"score","all",{freshness:"fresh"})).rows.map(c=>c.address).sort()).toEqual([key(2),key(3)].sort());
    expect((await rankedDiscovery(db,items,at,"score","all",{freshness:"stale"})).rows.map(c=>c.address).sort()).toEqual([key(4),key(5)].sort());
    expect((await rankedDiscovery(db,items,at,"score","all",{min_liquidity:1})).rows.map(c=>c.address).sort()).toEqual([key(4),key(5)].sort());
    expect((await rankedDiscovery(db,items,at,"score","all",{min_coverage:100})).rows).toHaveLength(0);
  });
  it("binds pagination to every filter and fails closed on invalid query values",async()=>{
    const {db,base,env}=await setup();for(let i=0;i<3;i++){const c={...base,address:key(i+1),name:"Same search"};await db.prepare("INSERT INTO tenx_candidates(mode,address,pool,payload,checked_at) VALUES('live',?1,?2,?3,?4)").bind(c.address,c.pool,JSON.stringify(c),c.checked_at).run();}
    vi.useFakeTimers();vi.setSystemTime(at);const url="http://localhost/api/10x/candidates?view=cards&limit=1&q=same";
    const first=CardListResponse.parse(await(await handle(new Request(url),env)).json());expect(first.next_cursor).not.toBeNull();
    const next=url+`&cursor=${encodeURIComponent(first.next_cursor!)}`;expect((await handle(new Request(next),env)).status).toBe(200);
    for(const patch of ["&q=other","&freshness=fresh","&min_liquidity=1","&min_coverage=1"]){const change=new URL(next);for(const[k,v]of new URLSearchParams(patch.slice(1)))change.searchParams.set(k,v);expect((await handle(new Request(change),env)).status).toBe(409);}
    for(const patch of ["&min_coverage=101","&min_liquidity=-1","&freshness=organic","&q="+"a".repeat(101)])await expect(handle(new Request(url+patch),env)).rejects.toThrow();
  });
  it("pages beyond the legacy top 100 with one cutoff, global ranks, no duplicate mints and no provider requests or writes",async()=>{
    const {db,base,env,sqlite}=await setup();
    for(let i=0;i<205;i++){const c={...base,address:key(i+1),name:`Paged ${i}`};await db.prepare("INSERT INTO tenx_candidates(mode,address,pool,payload,checked_at) VALUES('live',?1,?2,?3,?4)").bind(c.address,c.pool,JSON.stringify(c),c.checked_at).run();}
    const before=sqlite.prepare("SELECT total_changes() n").get();
    vi.useFakeTimers();vi.setSystemTime(at);const network=vi.spyOn(globalThis,"fetch").mockRejectedValue(Error("forbidden"));
    const url="http://localhost/api/10x/candidates?view=cards&limit=100&browse=inventory";
    const first=CardListResponse.parse(await(await handle(new Request(url),env)).json());
    expect(first.data.scope).toMatchObject({maximum:500,available:205,matched:205,truncated:false});
    vi.setSystemTime(new Date(at.getTime()+30000));
    const second=CardListResponse.parse(await(await handle(new Request(url+`&cursor=${encodeURIComponent(first.next_cursor!)}`),env)).json());
    const third=CardListResponse.parse(await(await handle(new Request(url+`&cursor=${encodeURIComponent(second.next_cursor!)}`),env)).json());
    expect([first,second,third].map(p=>p.data.candidates.length)).toEqual([100,100,5]);
    expect(second.data.scored_at).toBe(first.data.scored_at);expect(third.data.scored_at).toBe(first.data.scored_at);expect(third.next_cursor).toBeNull();
    const rows=[...first.data.candidates,...second.data.candidates,...third.data.candidates];
    expect(new Set(rows.map(c=>c.address)).size).toBe(205);expect(rows.map(c=>c.discovery_rank)).toEqual(Array.from({length:205},(_,i)=>i+1));
    const legacy=CardListResponse.parse(await(await handle(new Request(url.replace("&browse=inventory","")),env)).json());
    expect(legacy.data.scope).toMatchObject({maximum:100,available:100,truncated:true});expect(legacy.next_cursor).toBeNull();
    expect(network).not.toHaveBeenCalled();expect(sqlite.prepare("SELECT total_changes() n").get()).toEqual(before);
  });
  it("rejects a changed off-page candidate, expired cutoff or a different inventory window instead of merging snapshots",async()=>{
    const {db,base,env}=await setup();
    for(let i=0;i<105;i++){const c={...base,address:key(i+1),name:`Snapshot ${i}`};await db.prepare("INSERT INTO tenx_candidates(mode,address,pool,payload,checked_at) VALUES('live',?1,?2,?3,?4)").bind(c.address,c.pool,JSON.stringify(c),c.checked_at).run();}
    vi.useFakeTimers();vi.setSystemTime(at);const url="http://localhost/api/10x/candidates?view=cards&limit=100&browse=inventory";
    const first=CardListResponse.parse(await(await handle(new Request(url),env)).json()),next=url+`&cursor=${encodeURIComponent(first.next_cursor!)}`;
    expect((await handle(new Request(next.replace("browse=inventory","browse=top100")),env)).status).toBe(409);
    vi.setSystemTime(new Date(at.getTime()+300001));expect((await handle(new Request(next),env)).status).toBe(409);vi.setSystemTime(at);
    const hidden=Array.from({length:105},(_,i)=>key(i+1)).find(address=>!first.data.candidates.some(c=>c.address===address))!;
    await db.prepare("UPDATE tenx_candidates SET payload=json_set(payload,'$.name','Changed outside page one') WHERE address=?1").bind(hidden).run();
    expect((await handle(new Request(next),env)).status).toBe(409);
  });
});
