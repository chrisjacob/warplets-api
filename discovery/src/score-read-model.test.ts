import {afterEach,describe,expect,it,vi} from "vitest";
import {DatabaseSync} from "node:sqlite";
import {readFileSync,readdirSync} from "node:fs";
import {sqliteD1} from "../../app/functions/_lib/sqliteTestDb";
import {fixtureCandidates} from "./fixtures";
import {buildScoreReadModel,readScoreReadModel} from "./score-read-model";
import {rankedDiscovery} from "./discovery-score-store";
import {candidateCard} from "./candidate-card";
import {hashJson,toBase58} from "./solana";
import {handle,type LocalEnv} from "./worker";
import {expireCandidates} from "./candidate-expiry";
import type {Candidate} from "./model";

const at=new Date("2026-10-22T01:00:00.000Z"),opened:DatabaseSync[]=[];
const key=(n:number)=>{const bytes=new Uint8Array(32).fill(7);new DataView(bytes.buffer).setUint32(0,n);return toBase58(bytes);};
afterEach(()=>{opened.splice(0).forEach(db=>db.close());vi.restoreAllMocks();vi.useRealTimers();});
async function setup(n=1){
  const sqlite=new DatabaseSync(":memory:");opened.push(sqlite);
  for(const f of readdirSync(new URL("../migrations/",import.meta.url)).filter(f=>f.endsWith(".sql")).sort())sqlite.exec(readFileSync(new URL(`../migrations/${f}`,import.meta.url),"utf8"));
  const db=sqliteD1(sqlite),fixtures=await fixtureCandidates(at),items:Candidate[]=[];
  for(let i=0;i<n;i++){
    const c={...fixtures[i%fixtures.length]!,mode:"live" as const,address:key(i+1)};items.push(c);
    await db.prepare("INSERT INTO tenx_candidates(mode,address,pool,payload,checked_at) VALUES('live',?1,?2,?3,?4)").bind(c.address,c.pool,JSON.stringify(c),c.checked_at).run();
  }
  return{sqlite,db,items};
}
async function edit(sqlite:DatabaseSync,patch:(v:any)=>void,rehash=true){
  const row=sqlite.prepare("SELECT payload FROM tenx_score_read_model").get() as {payload:string};
  const value=JSON.parse(row.payload);patch(value);
  sqlite.prepare("UPDATE tenx_score_read_model SET payload=?,payload_hash=CASE WHEN ? THEN ? ELSE payload_hash END").run(JSON.stringify(value),rehash?1:0,await hashJson(value));
}
describe("private persisted scoring read experiment",()=>{
  it("matches every compact v4 card at the cutoff and reads once without evaluator IO, writes or providers",async()=>{
    const {sqlite,db,items}=await setup(105),expected=(await rankedDiscovery(db,items,at,"score","all",{maximum:500})).rows.map(candidateCard);
    const network=vi.spyOn(globalThis,"fetch").mockRejectedValue(Error("forbidden"));
    expect(await readScoreReadModel(db,at)).toMatchObject({state:"held",reason:"missing"});
    const built=await buildScoreReadModel(db,at);expect(built).toMatchObject({state:"built",candidates:105});
    const prepare=vi.spyOn(db,"prepare"),before=sqlite.prepare("SELECT total_changes() n").get();
    const result=await readScoreReadModel(db,new Date(at.getTime()+1000));
    expect(result.state).toBe("available");if(result.state!=="available")throw Error("held");
    expect(result.snapshot.candidates).toEqual(expected);expect(result.snapshot).toMatchObject({semantics:"frozen_at_cutoff",action_authority:false,scope:"current_evaluation",cutoff:at.toISOString()});
    expect(prepare).toHaveBeenCalledTimes(1);expect(prepare.mock.calls[0]![0]).not.toMatch(/tenx_(?:candidates|market_history|proofs)/);
    expect(sqlite.prepare("SELECT total_changes() n").get()).toEqual(before);expect(network).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).not.toContain('"wallet_analysis"');expect(JSON.stringify(result)).not.toContain('"raw_accounts"');
    expect(sqlite.prepare("SELECT count(*) n FROM tenx_score_cohorts").get()).toEqual({n:0});
  });
  it("invalidates same-timestamp candidate edits and all mutable market events",async()=>{
    const {sqlite,db,items}=await setup();
    const statements=["UPDATE tenx_candidates SET payload=json_set(payload,'$.name','Different')",
      `INSERT INTO tenx_market_history(address,fetched_at,payload) VALUES('${items[0]!.address}','${at.toISOString()}','${JSON.stringify(items[0]!.market)}')`,
      "UPDATE tenx_market_history SET payload=json_set(payload,'$.price_usd',2)","DELETE FROM tenx_market_history",
      "DELETE FROM tenx_candidates"];
    for(const sql of statements){expect(await buildScoreReadModel(db,at)).toMatchObject({state:"built"});sqlite.exec(sql);expect(await readScoreReadModel(db,at)).toMatchObject({state:"held",reason:"source_changed"});}
    expect(await buildScoreReadModel(db,at)).toMatchObject({state:"built",candidates:0});
    sqlite.prepare("INSERT INTO tenx_candidates(mode,address,pool,payload,checked_at) VALUES('live',?,?,?,?)").run(items[0]!.address,items[0]!.pool,JSON.stringify(items[0]),items[0]!.checked_at);
    expect(await readScoreReadModel(db,at)).toMatchObject({reason:"source_changed"});
  });
  it("expiry receipts invalidate without discarding source evidence",async()=>{
    const {sqlite,db,items}=await setup(),c=items.find(c=>c.creation)!;
    const p=c.creation!;
    sqlite.prepare("INSERT INTO tenx_proofs(address,kind,signature,instruction_index,slot,payload,payload_hash) VALUES(?,'creation',?,?,?,?,?)").run(c.address,p.signature,p.instruction_index,p.slot,JSON.stringify(p),p.payload_hash);
    expect(await buildScoreReadModel(db,at)).toMatchObject({state:"built"});
    expect(await expireCandidates(db,new Date(at.getTime()+86400001))).toMatchObject({expired:1});
    expect(await readScoreReadModel(db,at)).toMatchObject({reason:"source_changed"});
    expect(sqlite.prepare("SELECT count(*) n FROM tenx_candidates").get()).toEqual({n:1});
  });
  it("holds expired and future cutoffs, corrupt bytes, changed policies and repinned invalid inventories",async()=>{
    const {sqlite,db}=await setup(3);
    await buildScoreReadModel(db,at);
    for(const delta of [-1,60000])expect(await readScoreReadModel(db,new Date(at.getTime()+delta))).toMatchObject({reason:"cutoff_expired_or_future"});
    expect(await readScoreReadModel(db,new Date(at.getTime()+59999))).toMatchObject({state:"available"});
    await edit(sqlite,v=>v.candidates[0].name="Corrupt",false);expect(await readScoreReadModel(db,at)).toMatchObject({reason:"integrity_mismatch"});
    await buildScoreReadModel(db,at);await edit(sqlite,v=>v.policy_hash="0".repeat(64));expect(await readScoreReadModel(db,at)).toMatchObject({reason:"policy_changed"});
    for(const patch of [(v:any)=>v.candidates[1]=v.candidates[0],(v:any)=>v.counts.eligible++,(v:any)=>v.expires_at=new Date(at.getTime()+60001).toISOString(),(v:any)=>v.candidates[0].wallet_analysis={}]){
      await buildScoreReadModel(db,at);await edit(sqlite,patch);expect(await readScoreReadModel(db,at)).toMatchObject({state:"held"});
    }
  });
  it("refuses mixed-source, pause races and older concurrent builders",async()=>{
    const {sqlite,db}=await setup();
    const original=db.prepare.bind(db);
    for(const sql of ["UPDATE tenx_candidates SET checked_at=checked_at","UPDATE tenx_control SET paused=1"]){
      vi.spyOn(db,"prepare").mockImplementation((query:string)=>{if(query.startsWith("INSERT INTO tenx_score_read_model"))sqlite.exec(sql);return original(query);});
      expect(await buildScoreReadModel(db,at)).toMatchObject({state:"held",reason:"source_changed_paused_or_newer_snapshot"});vi.restoreAllMocks();
      sqlite.exec("UPDATE tenx_control SET paused=0");
    }
    const newer=new Date(at.getTime()+1000);await buildScoreReadModel(db,newer);
    expect(await buildScoreReadModel(db,at)).toMatchObject({state:"held"});expect(await readScoreReadModel(db,newer)).toMatchObject({state:"available",snapshot:{cutoff:newer.toISOString()}});
    sqlite.exec("UPDATE tenx_control SET paused=1");expect(await buildScoreReadModel(db,at)).toMatchObject({reason:"paused"});
  });
  it("keeps the 500-input guard and leaves an existing snapshot held after overflow",async()=>{
    const {db,items,sqlite}=await setup(500);
    expect(await buildScoreReadModel(db,at)).toMatchObject({state:"built",candidates:500});
    const c={...items[0]!,address:key(501)};sqlite.prepare("INSERT INTO tenx_candidates(mode,address,pool,payload,checked_at) VALUES('live',?,?,?,?)").run(c.address,c.pool,JSON.stringify(c),c.checked_at);
    await expect(buildScoreReadModel(db,at)).rejects.toThrow("discovery_score_inventory_limit");expect(await readScoreReadModel(db,at)).toMatchObject({reason:"source_changed"});
  },20000);
  it("keeps both experiment methods behind existing admin/host/origin guards",async()=>{
    const {db}=await setup(),token="a".repeat(64),env={TENX_DB:db,TENX_LOCAL_ONLY:"true",TENX_ADMIN_TOKEN:token} as LocalEnv,url="http://localhost/api/10x/admin/score-read-model";
    vi.useFakeTimers();vi.setSystemTime(at);
    for(const method of ["GET","POST"])expect((await handle(new Request(url,{method}),env)).status).toBe(401);
    const headers={authorization:`Bearer ${token}`,"content-type":"application/json"};
    expect((await handle(new Request(url,{headers:{...headers,origin:"https://evil.test"}}),env)).status).toBe(403);
    expect((await handle(new Request(url.replace("localhost","example.com"),{headers}),env)).status).toBe(503);
    const built=await handle(new Request(url,{method:"POST",headers,body:JSON.stringify({reason:"Read-model fixture"})}),env);expect(await built.json()).toMatchObject({state:"built"});
    const read=await handle(new Request(url,{headers}),env);expect(read.headers.get("cache-control")).toBe("no-store");expect(await read.json()).toMatchObject({state:"available"});
    expect((await handle(new Request("http://localhost/api/10x/score-read-model"),env)).status).toBe(404);
  });
  it("holds missing migration without a raw-store fallback",async()=>{
    const {sqlite,db}=await setup();sqlite.exec("DROP TABLE tenx_score_read_model; DROP TABLE tenx_score_source_revision");
    expect(await readScoreReadModel(db,at)).toMatchObject({state:"held",reason:"read_model_unavailable"});
    expect(await buildScoreReadModel(db,at)).toMatchObject({state:"held",reason:"read_model_unavailable"});
  });
});
