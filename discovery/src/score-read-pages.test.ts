import {afterEach,describe,expect,it,vi} from "vitest";
import {DatabaseSync} from "node:sqlite";
import {readFileSync,readdirSync} from "node:fs";
import {sqliteD1} from "../../app/functions/_lib/sqliteTestDb";
import {fixtureCandidates} from "./fixtures";
import {buildScoreReadPages,readScoreReadPages} from "./score-read-pages";
import {rankedDiscovery} from "./discovery-score-store";
import {candidateCard} from "./candidate-card";
import {createdWithinWindow} from "./priority";
import {hashJson,toBase58} from "./solana";
import {handle,type LocalEnv} from "./worker";
import {DEFAULT_POLICY,type Candidate} from "./model";
import {DISCOVERY_SCORE_POLICY_V4} from "./discovery-score-v4-model";
import {PackedScoreInventorySchema,packScoreInventory,unpackScoreInventory} from "./score-read-index";
import {PackedScoreSummariesSchema,packScoreSummaries,unpackScoreSummaries} from "./score-read-summaries";
import {expireCandidates} from "./candidate-expiry";

const at=new Date("2026-10-22T01:00:00.000Z"),opened:DatabaseSync[]=[];
afterEach(()=>{opened.splice(0).forEach(db=>db.close());vi.restoreAllMocks();vi.useRealTimers();});
const key=(i:number)=>{const b=new Uint8Array(32).fill(7);new DataView(b.buffer).setUint32(0,i);return toBase58(b);};
async function setup(n=5,incremental=true){
  const sqlite=new DatabaseSync(":memory:");opened.push(sqlite);
  for(const f of readdirSync(new URL("../migrations/",import.meta.url)).filter(f=>f.endsWith(".sql")&&(incremental||f<"0046")).sort())sqlite.exec(readFileSync(new URL(`../migrations/${f}`,import.meta.url),"utf8"));
  const db=sqliteD1(sqlite),fixtures=await fixtureCandidates(at),items:Candidate[]=[];
  const put=(c:Candidate)=>sqlite.prepare("INSERT INTO tenx_candidates(mode,address,pool,payload,checked_at) VALUES('live',?,?,?,?)").run(c.address,c.pool,JSON.stringify(c),c.checked_at);
  for(let i=0;i<n;i++){
    const c:Candidate={...fixtures[i%fixtures.length]!,mode:"live",address:key(i+1),name:`Observed ${i}`,symbol:`OBS${i}`};
    if(i%7===0)c.creation=null;
    if(c.market){if(i%5===0)c.market=null;else c.market={...c.market,liquidity_usd:i%3===0?null:i*1000,fetched_at:new Date(at.getTime()+(i%4===0?1:i%4===1?-180001:0)).toISOString()};}
    items.push(c);put(c);
  }
  return{sqlite,db,items,put};
}
async function editManifest(sqlite:DatabaseSync,patch:(v:any)=>void,rehash=true){
  const old=sqlite.prepare("SELECT manifest_hash,payload FROM tenx_score_page_manifest").get() as {manifest_hash:string;payload:string},value=JSON.parse(old.payload);
  value.entries=unpackScoreInventory(value.inventory);patch(value);value.inventory=packScoreInventory(value.entries);delete value.entries;
  const hash=rehash?await hashJson(value):old.manifest_hash;
  sqlite.prepare("UPDATE tenx_score_page_manifest SET payload=?,manifest_hash=?").run(JSON.stringify(value),hash);
  if(rehash)sqlite.prepare("UPDATE tenx_score_page_cards SET manifest_hash=?").run(hash);
}
describe("independently verified scoring card pages",()=>{
  it("holds old v2/v3 generations until explicit rebuild, preserving bodies and original summary hashes",async()=>{
    const {sqlite,db}=await setup(30);
    for(const version of ["discovery-score-read-pages-v2","discovery-score-read-pages-v3"]){
      await buildScoreReadPages(db,at);
      const previous=await readScoreReadPages(db,{limit:1},at);if(previous.state!=="available")throw Error("held");
      const saved=sqlite.prepare("SELECT address,payload,body_hash FROM tenx_score_page_cards ORDER BY address").all();
      const scores=sqlite.prepare("SELECT page,payload FROM tenx_score_page_summaries ORDER BY page").all() as {page:number;payload:string}[];
      const original=scores.map(row=>({page:row.page,payload:JSON.stringify(unpackScoreSummaries(PackedScoreSummariesSchema.parse(JSON.parse(row.payload))))}));
      for(const row of original)sqlite.prepare("UPDATE tenx_score_page_summaries SET payload=? WHERE page=?").run(row.payload,row.page);
      const row=sqlite.prepare("SELECT payload FROM tenx_score_page_manifest").get() as {payload:string},old=JSON.parse(row.payload);
      old.version=version;old.policy_hash=await hashJson({contract:version,score:DISCOVERY_SCORE_POLICY_V4,actions:DEFAULT_POLICY});
      if(version.endsWith("v2")){old.entries=unpackScoreInventory(old.inventory);delete old.inventory;}
      const hash=await hashJson(old);sqlite.prepare("UPDATE tenx_score_page_manifest SET payload=?,manifest_hash=?").run(JSON.stringify(old),hash);
      const before=sqlite.prepare("SELECT total_changes() n").get();
      expect(await readScoreReadPages(db,{},at)).toMatchObject({reason:"invalid_manifest"});
      expect(sqlite.prepare("SELECT total_changes() n").get()).toEqual(before);
      expect(await buildScoreReadPages(db,at)).toMatchObject({state:"built",writes:{changed_bodies:0,changed_summary_pages:2,manifest:1}});
      expect(sqlite.prepare("SELECT address,payload,body_hash FROM tenx_score_page_cards ORDER BY address").all()).toEqual(saved);
      const current=JSON.parse((sqlite.prepare("SELECT payload FROM tenx_score_page_manifest").get() as {payload:string}).payload);
      expect(current.summary_pages).toEqual(old.summary_pages);
      for(const row of original){const packed=JSON.parse((sqlite.prepare("SELECT payload FROM tenx_score_page_summaries WHERE page=?").get(row.page) as {payload:string}).payload);
        expect(JSON.stringify(unpackScoreSummaries(PackedScoreSummariesSchema.parse(packed)))).toBe(row.payload);}
      expect(await readScoreReadPages(db,{limit:1,cursor:btoa(JSON.stringify({manifest_hash:hash,offset:1,identity:JSON.parse(atob(previous.next_cursor!)).identity}))},at)).toMatchObject({reason:"cursor_refresh_required"});
    }
  });
  it("rejects malformed packed fields even when the manifest is repinned",async()=>{
    const {sqlite,db}=await setup();
    for(const patch of [(v:any)=>v.inventory.rows[0].push("extra"),(v:any)=>v.inventory.rows[0][1]=999,(v:any)=>v.inventory.text.push("unused"),(v:any)=>v.inventory.rows[0][6]=101]){
      await buildScoreReadPages(db,at);const row=sqlite.prepare("SELECT payload FROM tenx_score_page_manifest").get() as {payload:string},value=JSON.parse(row.payload);patch(value);
      sqlite.prepare("UPDATE tenx_score_page_manifest SET payload=?,manifest_hash=?").run(JSON.stringify(value),await hashJson(value));
      expect(await readScoreReadPages(db,{},at)).toMatchObject({reason:"invalid_manifest"});
    }
  });
  it("verifies all twenty summary pages for a scattered 100-card query with full-evaluator parity",async()=>{
    const {sqlite,db,items}=await setup(500);await buildScoreReadPages(db,at);
    const row=sqlite.prepare("SELECT payload FROM tenx_score_page_manifest").get() as {payload:string};
    const inventory=PackedScoreInventorySchema.parse(JSON.parse(row.payload).inventory),chosen=new Set(unpackScoreInventory(inventory).filter((_,i)=>i%25<5).map(e=>e.address));
    const put=sqlite.prepare("UPDATE tenx_candidates SET payload=? WHERE address=?");
    for(const c of items){c.name=chosen.has(c.address)?"Scatter sample":"Other";put.run(JSON.stringify(c),c.address);}
    await buildScoreReadPages(db,at);
    const before=sqlite.prepare("SELECT total_changes() n").get(),prepare=db.prepare.bind(db);let pages:number[]=[];
    vi.spyOn(db,"prepare").mockImplementation(sql=>{const statement=prepare(sql),bind=statement.bind.bind(statement);
      if(sql.startsWith("SELECT s.page,"))vi.spyOn(statement,"bind").mockImplementation((...args)=>{pages=JSON.parse(args[0] as string);return bind(...args);});return statement;});
    const actual=await readScoreReadPages(db,{q:"Scatter sample",browse:"inventory",limit:100},at);expect(pages).toHaveLength(20);
    const expected=await rankedDiscovery(db,items,at,"score","all",{search:"Scatter sample",maximum:500});
    expect(actual).toMatchObject({state:"available",action_authority:false});if(actual.state==="available")expect(actual.data.candidates).toEqual(expected.rows.map(candidateCard));
    expect(sqlite.prepare("SELECT total_changes() n").get()).toEqual(before);
  },30000);
  it("matches full evaluation across sort, action status, first-day window and browse filters",async()=>{
    const {db,items}=await setup(30);expect(await buildScoreReadPages(db,at)).toMatchObject({state:"built",candidates:30});
    for(const age of ["all","24h"] as const)for(const sort of ["score","liquidity"] as const)for(const status of ["all","eligible","provisional","excluded"] as const){
      const source=age==="all"?items:items.filter(c=>createdWithinWindow(c,at));
      const expected=await rankedDiscovery(db,source,at,sort,status,{maximum:500});
      const actual=await readScoreReadPages(db,{age,sort,status,browse:"inventory",limit:100},at);
      expect(actual.state).toBe("available");if(actual.state!=="available")throw Error("held");
      expect(actual.data.candidates).toEqual(expected.rows.map(candidateCard));expect(actual.data.counts).toEqual(expected.counts);expect(actual.data.observed).toBe(expected.observed);
    }
    for(const filter of [{q:"observed 2"},{freshness:"missing"},{freshness:"fresh"},{freshness:"stale"},{min_liquidity:10000},{min_coverage:80},{q:items[25]!.address,min_coverage:0}]){
      const expected=await rankedDiscovery(db,items,at,"score","all",{search:filter.q,freshness:filter.freshness as "fresh"|"stale"|"missing"|undefined,min_liquidity:filter.min_liquidity,min_coverage:filter.min_coverage,maximum:500});
      const actual=await readScoreReadPages(db,{...filter,browse:"inventory",limit:100},at);
      expect(actual.state).toBe("available");if(actual.state==="available")expect(actual.data.candidates).toEqual(expected.rows.map(candidateCard));
    }
  },20000);
  it("pages 205 unique mints at one cutoff and binds cursors to all filters and generation",async()=>{
    const {db,items}=await setup(205);await buildScoreReadPages(db,at);
    const all=[];let cursor:string|undefined;
    do {const result=await readScoreReadPages(db,{browse:"inventory",limit:100,...cursor?{cursor}:{}},new Date(at.getTime()+1000));if(result.state!=="available")throw Error(result.reason);all.push(...result.data.candidates);cursor=result.next_cursor??undefined;}while(cursor);
    expect(all).toHaveLength(205);expect(new Set(all.map(c=>c.address)).size).toBe(205);expect(all.map(c=>c.discovery_rank)).toEqual(Array.from({length:205},(_,i)=>i+1));
    const first=await readScoreReadPages(db,{limit:1,browse:"inventory"},at);if(first.state!=="available")throw Error("held");
    for(const patch of [{q:"other"},{age:"24h"},{sort:"liquidity"},{status:"excluded"},{freshness:"fresh"},{min_liquidity:1},{min_coverage:1},{browse:"top100"}])expect(await readScoreReadPages(db,{limit:1,browse:"inventory",cursor:first.next_cursor,...patch},at)).toMatchObject({reason:"cursor_refresh_required"});
    const hidden=all[150]!;expect(await readScoreReadPages(db,{q:hidden.address},at)).toMatchObject({state:"available",data:{candidates:[{address:hidden.address,discovery_rank:151}]}});
    await buildScoreReadPages(db,new Date(at.getTime()+1000));expect(await readScoreReadPages(db,{limit:1,browse:"inventory",cursor:first.next_cursor},new Date(at.getTime()+1000))).toMatchObject({reason:"cursor_refresh_required"});
    expect(items).toHaveLength(205);
  },20000);
  it("reads selected bodies and bounded score pages with three queries, no full evidence, writes, or providers",async()=>{
    const {sqlite,db}=await setup(105);await buildScoreReadPages(db,at);
    const network=vi.spyOn(globalThis,"fetch").mockRejectedValue(Error("forbidden")),prepare=vi.spyOn(db,"prepare"),before=sqlite.prepare("SELECT total_changes() n").get();
    const webCrypto=vi.spyOn(crypto.subtle,"digest").mockRejectedValue(Error("read must verify without async hashing"));
    const result=await readScoreReadPages(db,{limit:3},at);expect(result).toMatchObject({state:"available",action_authority:false,semantics:"frozen_at_cutoff"});
    expect(prepare).toHaveBeenCalledTimes(3);for(const [sql]of prepare.mock.calls)expect(sql).not.toMatch(/tenx_(?:candidates|market_history|proofs|wallet|holder)/);
    expect(prepare.mock.calls[1]![0]).toContain("json_each(?1)");if(result.state==="available")expect(result.data.candidates).toHaveLength(3);
    expect(network).not.toHaveBeenCalled();expect(sqlite.prepare("SELECT total_changes() n").get()).toEqual(before);
    expect(webCrypto).not.toHaveBeenCalled();
  });
  it("holds off-page changes and source/generation races between the index and card lookups, even for empty matches",async()=>{
    const {sqlite,db}=await setup(105);await buildScoreReadPages(db,at);
    sqlite.prepare("UPDATE tenx_candidates SET checked_at=checked_at WHERE address=?").run(key(105));expect(await readScoreReadPages(db,{limit:1},at)).toMatchObject({reason:"source_changed"});
    for(const q of ["","no match"])for(const mutation of ["UPDATE tenx_candidates SET checked_at=checked_at","UPDATE tenx_score_page_manifest SET manifest_hash='"+"0".repeat(64)+"'"]){
      await buildScoreReadPages(db,at);const original=db.prepare.bind(db);
      vi.spyOn(db,"prepare").mockImplementation(sql=>{if(sql.startsWith("SELECT c.address,"))sqlite.exec(mutation);return original(sql);});
      expect(await readScoreReadPages(db,{limit:1,q},at)).toMatchObject({reason:"source_or_generation_changed"});vi.restoreAllMocks();
    }
  });
  it("rejects corrupt, missing, substituted and repinned inconsistent cards/manifests",async()=>{
    const {sqlite,db}=await setup();
    for(const sql of ["UPDATE tenx_score_page_cards SET payload=json_set(payload,'$.name','tampered')",
      "UPDATE tenx_score_page_cards SET payload=json_set(payload,'$.discovery_score',json('{}'))",
      "UPDATE tenx_score_page_cards SET payload=json_remove(payload,'$.reasons')",
      "UPDATE tenx_score_page_summaries SET payload=json_remove(payload,'$.rows[0][7]')",
      "DELETE FROM tenx_score_page_cards","UPDATE tenx_score_page_cards SET body_hash='"+"0".repeat(64)+"'"]){
      await buildScoreReadPages(db,at);sqlite.exec(sql);expect(await readScoreReadPages(db,{},at)).toMatchObject({state:"held"});
    }
    await buildScoreReadPages(db,at);await editManifest(sqlite,v=>v.entries[0].name="bad",false);expect(await readScoreReadPages(db,{},at)).toMatchObject({reason:"manifest_integrity_mismatch"});
    for(const patch of [(v:any)=>v.policy_hash="0".repeat(64),(v:any)=>v.entries[1]=v.entries[0],(v:any)=>v.entries[0].score=100,(v:any)=>v.expires_at=new Date(at.getTime()+60001).toISOString()]){
      await buildScoreReadPages(db,at);await editManifest(sqlite,patch);expect(await readScoreReadPages(db,{limit:100},at)).toMatchObject({state:"held"});
    }
  });
  it("publishes all cards/manifest atomically and refuses mixed, paused or older builders",async()=>{
    const {sqlite,db}=await setup();const built=await buildScoreReadPages(db,at);expect(built.state).toBe("built");
    const original=sqlite.prepare("SELECT payload FROM tenx_score_page_manifest").get();
    sqlite.exec("CREATE TRIGGER reject_card BEFORE INSERT ON tenx_score_page_cards BEGIN SELECT RAISE(ABORT,'test_failure'); END");
    await expect(buildScoreReadPages(db,new Date(at.getTime()+1))).rejects.toThrow("test_failure");expect(sqlite.prepare("SELECT payload FROM tenx_score_page_manifest").get()).toEqual(original);expect(await readScoreReadPages(db,{},at)).toMatchObject({state:"available"});sqlite.exec("DROP TRIGGER reject_card");
    for(const sql of ["UPDATE tenx_candidates SET checked_at=checked_at","UPDATE tenx_control SET paused=1"]){
      const batch=db.batch.bind(db);vi.spyOn(db,"batch").mockImplementation(async statements=>{sqlite.exec(sql);return batch(statements);});
      expect(await buildScoreReadPages(db,new Date(at.getTime()+1))).toMatchObject({reason:"source_changed_paused_or_newer_snapshot"});vi.restoreAllMocks();sqlite.exec("UPDATE tenx_control SET paused=0");
    }
    await buildScoreReadPages(db,new Date(at.getTime()+1000));expect(await buildScoreReadPages(db,at)).toMatchObject({state:"held"});
    expect(await readScoreReadPages(db,{},new Date(at.getTime()+1000))).toMatchObject({state:"available"});
  });
  it("retains time/input/size bounds and holds missing migration or invalid cursors",async()=>{
    const {sqlite,db,items,put}=await setup(500);expect(await buildScoreReadPages(db,at)).toMatchObject({state:"built",candidates:500});
    for(const delta of [-1,60000])expect(await readScoreReadPages(db,{},new Date(at.getTime()+delta))).toMatchObject({reason:"cutoff_expired_or_future"});
    expect(await readScoreReadPages(db,{cursor:"bad"},at)).toMatchObject({reason:"invalid_cursor"});
    for(const query of [{limit:101},{min_coverage:101},{min_liquidity:-1},{freshness:"organic"},{q:"a".repeat(101)}])await expect(readScoreReadPages(db,query,at)).rejects.toThrow();
    put({...items[0]!,address:key(501)});await expect(buildScoreReadPages(db,at)).rejects.toThrow("discovery_score_inventory_limit");expect(await readScoreReadPages(db,{},at)).toMatchObject({reason:"source_changed"});
    sqlite.exec("DROP TABLE tenx_score_page_manifest");expect(await buildScoreReadPages(db,at)).toMatchObject({reason:"read_pages_unavailable"});expect(await readScoreReadPages(db,{},at)).toMatchObject({reason:"read_pages_unavailable"});
  },20000);
  it("requires existing admin guards and keeps public adoption closed",async()=>{
    const {db}=await setup(),token="a".repeat(64),env={TENX_DB:db,TENX_LOCAL_ONLY:"true",TENX_ADMIN_TOKEN:token} as LocalEnv,url="http://localhost/api/10x/admin/score-read-pages";
    vi.useFakeTimers();vi.setSystemTime(at);const headers={authorization:`Bearer ${token}`,"content-type":"application/json"};
    for(const method of ["GET","POST"])expect((await handle(new Request(url,{method}),env)).status).toBe(401);
    expect((await handle(new Request(url,{headers:{...headers,origin:"https://evil.test"}}),env)).status).toBe(403);
    expect(await(await handle(new Request(url,{method:"POST",headers,body:JSON.stringify({reason:"Page fixture"})}),env)).json()).toMatchObject({state:"built"});
    const response=await handle(new Request(url+"?limit=2",{headers}),env);expect(response.headers.get("cache-control")).toBe("no-store");expect(await response.json()).toMatchObject({state:"available",data:{candidates:expect.any(Array)}});
    expect((await handle(new Request("http://localhost/api/10x/score-read-pages"),env)).status).toBe(404);
  });
  it("holds excessive individual and aggregate card payloads without replacing a generation",async()=>{
    const {sqlite,db}=await setup();await buildScoreReadPages(db,at);
    const original=sqlite.prepare("SELECT manifest_hash FROM tenx_score_page_manifest").get();
    sqlite.prepare("UPDATE tenx_candidates SET payload=json_set(payload,'$.verification_reasons',json(?))").run(JSON.stringify(["x".repeat(17000)]));
    expect(await buildScoreReadPages(db,at)).toMatchObject({reason:"card_size_limit"});expect(sqlite.prepare("SELECT manifest_hash FROM tenx_score_page_manifest").get()).toEqual(original);
    const large=await setup(500);large.sqlite.prepare("UPDATE tenx_candidates SET payload=json_set(payload,'$.verification_reasons',json(?))").run(JSON.stringify(['"'.repeat(1000)]));
    const result=await buildScoreReadPages(large.db,at);expect(result.state).toBe("held");if(result.state==="held")expect(["card_size_limit","card_batch_size_limit"]).toContain(result.reason);
    expect(large.sqlite.prepare("SELECT count(*) n FROM tenx_score_page_manifest").get()).toEqual({n:0});
  },20000);
  it("writes nothing on identical replay and only the changed body/page on a same-cutoff source edit",async()=>{
    const {sqlite,db}=await setup(60);await buildScoreReadPages(db,at);
    const before=sqlite.prepare("SELECT total_changes() n").get();
    expect(await buildScoreReadPages(db,at)).toMatchObject({state:"built",writes:{removed_bodies:0,changed_bodies:0,removed_summary_pages:0,changed_summary_pages:0,manifest:0}});
    expect(sqlite.prepare("SELECT total_changes() n").get()).toEqual(before);
    sqlite.prepare("UPDATE tenx_candidates SET payload=json_set(payload,'$.name','Changed identity') WHERE address=?").run(key(30));
    expect(await readScoreReadPages(db,{},at)).toMatchObject({reason:"source_changed"});
    expect(await buildScoreReadPages(db,at)).toMatchObject({state:"built",writes:{removed_bodies:0,changed_bodies:1,removed_summary_pages:0,changed_summary_pages:1,manifest:1}});
    expect(await readScoreReadPages(db,{q:key(30)},at)).toMatchObject({state:"available",data:{candidates:[{name:"Changed identity"}]}});
  });
  it("refreshes every dated score at a new cutoff while reusing stable body bytes",async()=>{
    const {sqlite,db,items}=await setup(60);
    const stable=items.map(c=>({...c,market:null,creation:null,graduation:null,holders:null,wallet_analysis:null,risk:{...c.risk,observed_at:null}}));
    for(const c of stable)sqlite.prepare("UPDATE tenx_candidates SET payload=? WHERE address=?").run(JSON.stringify(c),c.address);
    await buildScoreReadPages(db,at);const bodies=sqlite.prepare("SELECT address,payload,body_hash FROM tenx_score_page_cards ORDER BY address").all();
    const later=new Date(at.getTime()+1000);
    expect(await buildScoreReadPages(db,later)).toMatchObject({writes:{changed_bodies:0,changed_summary_pages:3,manifest:1}});
    expect(sqlite.prepare("SELECT address,payload,body_hash FROM tenx_score_page_cards ORDER BY address").all()).toEqual(bodies);
    const result=await readScoreReadPages(db,{limit:100},later);expect(result.state).toBe("available");if(result.state!=="available")throw Error("held");
    expect(result.data.candidates).toEqual((await rankedDiscovery(db,stable,later,"score","all")).rows.map(candidateCard));
    expect(result.data.candidates.every(c=>c.discovery_score.as_of===later.toISOString())).toBe(true);
  });
  it("recomputes time-sensitive evidence at its boundary instead of reusing an old grade",async()=>{
    const {sqlite,db,items}=await setup(1),base=(await fixtureCandidates(at))[0]!;
    const c={...items[0]!,market:{...base.market!,fetched_at:new Date(at.getTime()-179999).toISOString(),observed_at:null}};
    sqlite.prepare("UPDATE tenx_candidates SET payload=?").run(JSON.stringify(c));await buildScoreReadPages(db,at);
    const later=new Date(at.getTime()+2),built=await buildScoreReadPages(db,later);expect(built).toMatchObject({state:"built",writes:{changed_bodies:1,changed_summary_pages:1}});
    const result=await readScoreReadPages(db,{},later);if(result.state!=="available")throw Error("held");
    expect(result.data.candidates).toEqual((await rankedDiscovery(db,[c],later,"score","all")).rows.map(candidateCard));
    expect(await readScoreReadPages(db,{freshness:"fresh"},later)).toMatchObject({state:"available",data:{candidates:[]}});
  });
  it("repairs altered bodies/pages despite unchanged pins and rolls back late failures",async()=>{
    const {sqlite,db}=await setup(30);await buildScoreReadPages(db,at);
    sqlite.prepare("UPDATE tenx_score_page_cards SET payload=json_set(payload,'$.name','corrupt') WHERE address=?").run(key(1));
    sqlite.exec("UPDATE tenx_score_page_summaries SET payload=json_set(payload,'$.rows[0][2]',99) WHERE page=0");
    expect(await readScoreReadPages(db,{limit:100},at)).toMatchObject({state:"held"});
    expect(await buildScoreReadPages(db,at)).toMatchObject({writes:{changed_bodies:1,changed_summary_pages:1,manifest:0}});
    expect(await readScoreReadPages(db,{limit:100},at)).toMatchObject({state:"available"});
    const page=unpackScoreSummaries(PackedScoreSummariesSchema.parse(JSON.parse((sqlite.prepare("SELECT payload FROM tenx_score_page_summaries WHERE page=0").get() as {payload:string}).payload)));
    page[24].discovery_score.as_of=new Date(at.getTime()-1).toISOString();
    sqlite.prepare("UPDATE tenx_score_page_summaries SET payload=? WHERE page=0").run(JSON.stringify(packScoreSummaries(page)));
    const pageHash=await hashJson(page);await editManifest(sqlite,v=>v.summary_pages[0].hash=pageHash);
    expect(await readScoreReadPages(db,{q:page[0].address},at)).toMatchObject({reason:"summary_page_integrity_mismatch"});
    await buildScoreReadPages(db,at);
    const saved=sqlite.prepare("SELECT payload FROM tenx_score_page_summaries ORDER BY page").all();
    sqlite.exec("CREATE TRIGGER fail_manifest BEFORE UPDATE ON tenx_score_page_manifest BEGIN SELECT RAISE(ABORT,'late_failure'); END");
    await expect(buildScoreReadPages(db,new Date(at.getTime()+10))).rejects.toThrow("late_failure");
    expect(sqlite.prepare("SELECT payload FROM tenx_score_page_summaries ORDER BY page").all()).toEqual(saved);
    expect(await readScoreReadPages(db,{},at)).toMatchObject({state:"available"});
  });
  it("holds compact pages that expand past the original 100 KB summary bound before hashing them",async()=>{
    const {sqlite,db}=await setup(25);await buildScoreReadPages(db,at);
    const row=sqlite.prepare("SELECT payload FROM tenx_score_page_summaries WHERE page=0").get() as {payload:string};
    const page=unpackScoreSummaries(PackedScoreSummariesSchema.parse(JSON.parse(row.payload)));
    for(const item of page)item.discovery_score.risk_flags=Array.from({length:24},()=>({code:"\u0000".repeat(100),ceiling:25,observed_at:null}));
    const compact=PackedScoreSummariesSchema.parse(packScoreSummaries(page));
    expect(Buffer.byteLength(JSON.stringify(compact))).toBeLessThan(100000);expect(Buffer.byteLength(JSON.stringify(page))).toBeGreaterThan(100000);
    sqlite.prepare("UPDATE tenx_score_page_summaries SET payload=? WHERE page=0").run(JSON.stringify(compact));
    await editManifest(sqlite,v=>v.summary_pages[0].hash="0".repeat(64));
    expect(await readScoreReadPages(db,{limit:1},at)).toMatchObject({reason:"summary_page_size_limit"});
  });
  it("removes obsolete derived bodies after verified expiry while retaining every source candidate",async()=>{
    const {sqlite,db,items}=await setup(26),c=items.find(c=>c.creation)!;const p=c.creation!;
    sqlite.prepare("INSERT INTO tenx_proofs(address,kind,signature,instruction_index,slot,payload_hash,payload) VALUES(?,'creation',?,?,?,?,?)").run(c.address,p.signature,p.instruction_index,p.slot,p.payload_hash,JSON.stringify(p));
    await buildScoreReadPages(db,at);const later=new Date(at.getTime()+86400001);
    expect(await expireCandidates(db,later)).toMatchObject({expired:1});
    expect(await buildScoreReadPages(db,later)).toMatchObject({writes:{removed_bodies:1,removed_summary_pages:1}});
    expect(sqlite.prepare("SELECT count(*) n FROM tenx_candidates").get()).toEqual({n:26});
    expect(sqlite.prepare("SELECT count(*) n FROM tenx_score_page_cards").get()).toEqual({n:25});
    expect(await readScoreReadPages(db,{q:c.address},later)).toMatchObject({state:"available",data:{candidates:[]}});
  });
  it("preserves old projection bytes on migration and holds them until an explicit rebuild",async()=>{
    const {sqlite,db,items}=await setup(1,false),card=candidateCard((await rankedDiscovery(db,items,at,"score","all")).rows[0]!);
    const payload=JSON.stringify(card),legacy=JSON.stringify({version:"discovery-score-read-pages-v1",cutoff:at.toISOString()});
    sqlite.prepare("INSERT INTO tenx_score_page_cards(address,manifest_hash,payload) VALUES(?,?,?)").run(card.address,"0".repeat(64),payload);
    sqlite.prepare("INSERT INTO tenx_score_page_manifest VALUES(1,1,?,?,?)").run(at.toISOString(),"0".repeat(64),legacy);
    expect(await buildScoreReadPages(db,at)).toMatchObject({reason:"read_pages_unavailable"});
    sqlite.exec(readFileSync(new URL("../migrations/0046_incremental_score_pages.sql",import.meta.url),"utf8"));
    expect(sqlite.prepare("SELECT payload FROM tenx_score_page_cards").get()).toEqual({payload});expect(sqlite.prepare("SELECT payload FROM tenx_score_page_manifest").get()).toEqual({payload:legacy});
    expect(await readScoreReadPages(db,{},at)).toMatchObject({state:"held"});
    expect(await buildScoreReadPages(db,at)).toMatchObject({state:"built",writes:{changed_bodies:1,changed_summary_pages:1}});
    expect(await readScoreReadPages(db,{},at)).toMatchObject({state:"available",data:{candidates:[card]}});
  });
});
