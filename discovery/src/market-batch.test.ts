import {afterEach,describe,expect,it,vi} from "vitest";
import {DatabaseSync} from "node:sqlite";
import {readFileSync,readdirSync} from "node:fs";
import {sqliteD1} from "../../app/functions/_lib/sqliteTestDb";
import {fixtureCandidates} from "./fixtures";
import {toBase58,hashJson} from "./solana";
import {WSOL} from "./pump";
import {decodeMarketBatch,freezeMarketBatch,replayMarketBatch} from "./market-batch";
import {marketBatchRecord,marketBatches} from "./market-batch-store";
import {runMarketCycle} from "./market-cycle";
import {handle,type LocalEnv} from "./worker";
import type {MarketBatchInput} from "./market-batch-model";

const opened:DatabaseSync[]=[],at=new Date("2026-10-21T00:00:00.000Z"),key=(i:number)=>toBase58(new Uint8Array(32).fill(i));
afterEach(()=>{opened.splice(0).forEach(db=>db.close());vi.restoreAllMocks();});
function setup(){const sqlite=new DatabaseSync(":memory:");opened.push(sqlite);for(const f of readdirSync(new URL("../migrations/",import.meta.url)).filter(f=>f.endsWith(".sql")).sort())sqlite.exec(readFileSync(new URL(`../migrations/${f}`,import.meta.url),"utf8"));return {sqlite,db:sqliteD1(sqlite)};}
const rows=[{address:key(31),pool:key(41)},{address:key(32),pool:key(42)}];
const pair=(i=0)=>({chainId:"solana",pairAddress:rows[i]!.pool,baseToken:{address:rows[i]!.address},quoteToken:{address:WSOL},priceUsd:".01",marketCap:200000,fdv:999999,liquidity:{usd:50000},volume:{h24:20000}});
const input=(pairs:unknown[]):MarketBatchInput=>({version:"dex-market-input-v1",at:at.toISOString(),rows,pairs});
async function seed(db:D1Database){const base=(await fixtureCandidates(at))[0]!;for(const row of rows)await db.prepare("INSERT INTO tenx_candidates(mode,address,pool,payload,checked_at) VALUES('live',?1,?2,?3,?4)").bind(row.address,row.pool,JSON.stringify({...base,...row,mode:"live",verification_reasons:["market_unavailable","origin_gap"]}),base.checked_at).run();return base;}
const settings=(db:D1Database,transport:typeof fetch)=>({db,rpcUrl:"https://rpc.invalid",rpcDailyLimit:5000,marketDailyLimit:600,marketEnabled:true,marketProvider:"dexscreener" as const,transport});
const saved=(db:D1Database)=>db.prepare("SELECT address,payload FROM tenx_candidates ORDER BY address").all<{address:string;payload:string}>();
describe("bounded per-pool market validation",()=>{
  it("isolates malformed and mismatched targets while retaining strict exact-pool identity",async()=>{
    for(const bad of [{...pair(1),quoteToken:{address:null}},{...pair(1),quoteToken:{address:rows[0]!.address}},{...pair(1),baseToken:{address:rows[0]!.address}},{...pair(1),volume:null}]){
      const {markets,record}=await freezeMarketBatch(input([pair(),bad]));expect([...markets.keys()]).toEqual([rows[0]!.address]);expect(record.report).toMatchObject({accepted:1,rejected:1,not_reported:0});expect((await replayMarketBatch(record)).status).toBe("verified");
    }
  });
  it("ignores identified unrelated malformed pools and foreign chains without substituting them",()=>{
    const {markets,report}=decodeMarketBatch(input([pair(),{chainId:"solana",pairAddress:key(90),quoteToken:{address:null}},{chainId:"ethereum",pairAddress:rows[0]!.pool,baseToken:{address:"0xinvalid"}}]));
    expect(markets.size).toBe(1);expect(report).toMatchObject({ignored_pairs:2,accepted:1,not_reported:1,rejected:0});
  });
  it("rejects a conflicting duplicate before accepting any version of that pool",()=>{
    const {markets,report}=decodeMarketBatch(input([pair(),{chainId:"solana",pairAddress:rows[0]!.pool,quoteToken:null},pair(1)]));
    expect([...markets.keys()]).toEqual([rows[1]!.address]);expect(report.rows[0]).toMatchObject({state:"rejected",code:"market_duplicate_pool"});
  });
  it.each([null,{}, {chainId:"solana",pairAddress:"bad"},{pairAddress:rows[0]!.pool}])("holds every target when a record's identity cannot be assigned: %j",bad=>{
    const {markets,report}=decodeMarketBatch(input([pair(),pair(1),bad]));expect(markets.size).toBe(0);expect(report).toMatchObject({rejected:2,unscoped_pairs:1});expect(report.rows.every(r=>r.code==="market_unscoped_pair_identity")).toBe(true);
  });
  it("keeps unavailable, invalid and FDV-only metrics unknown",()=>{
    const {markets}=decodeMarketBatch(input([{...pair(),marketCap:null,liquidity:{usd:-1},priceUsd:"NaN",volume:{h24:""}}]));
    expect(markets.get(rows[0]!.address)).toMatchObject({market_cap_usd:null,fdv_usd:999999,liquidity_usd:null,price_usd:null,volume_24h_usd:null,fetched_at:at.toISOString(),observed_at:null});
  });
  it("bounds input rows, returned pairs, normalized bytes and replay hashes",async()=>{
    await expect(freezeMarketBatch({...input([]),rows:[rows[0]!,rows[0]!]})).rejects.toThrow("invalid_market_batch");
    await expect(freezeMarketBatch({...input([]),rows:[rows[0]!,{...rows[1]!,pool:rows[0]!.pool}]})).rejects.toThrow("invalid_market_batch");
    await expect(freezeMarketBatch(input(Array(901).fill(pair())))).rejects.toThrow();
    await expect(freezeMarketBatch(input([{...pair(),extra:"x".repeat(1020000)}]))).rejects.toThrow("market_batch_snapshot_size_limit");
    const {record}=await freezeMarketBatch(input([pair()]));record.inputs.pairs.push(pair(1));await expect(replayMarketBatch(record)).rejects.toThrow("market_batch_replay_mismatch");
  });
});
describe("owned atomic market publication and cached replay",()=>{
  it("publishes only validated targets, retains the last issue across a later success and protects raw replay",async()=>{
    const {db}=setup();await seed(db);const before=await saved(db);
    const transport=vi.fn(async()=>Response.json([pair(),{...pair(1),quoteToken:{address:null}}]));
    expect(await runMarketCycle(settings(db,transport),at)).toMatchObject({state:"partial",updated:1,requested:2,error_code:"market_batch_partial"});
    const after=await saved(db),badBefore=before.results.find(r=>r.address===rows[1]!.address)!;
    expect(after.results.find(r=>r.address===rows[1]!.address)).toEqual(badBefore);
    const good=JSON.parse(after.results.find(r=>r.address===rows[0]!.address)!.payload);expect(good.market.price_usd).toBe(.01);expect(good.verification_reasons).toEqual(["origin_gap"]);expect(good.checked_at).toBe(JSON.parse(before.results[0]!.payload).checked_at);
    const issue=(await marketBatchRecord(db,"latest_issue"))!;expect(issue.replay.status).toBe("verified");expect(issue.record.report.rows[1]!.fields).toContain("quoteToken.address");
    const next=new Date(at.getTime()+240000);expect(await runMarketCycle(settings(db,async()=>Response.json([pair(),pair(1)])),next)).toMatchObject({state:"succeeded",updated:2});
    const summaries=await marketBatches(db);expect(summaries.latest?.report.accepted).toBe(2);expect(summaries.latest_issue?.record_hash).toBe(issue.record.record_hash);expect(await db.prepare("SELECT count(*) n FROM tenx_market_batch_cache").first()).toEqual({n:2});
    expect(await db.prepare("SELECT used FROM tenx_usage WHERE provider='market'").first()).toEqual({used:2});
    const env={TENX_DB:db,TENX_LOCAL_ONLY:"true",TENX_ADMIN_TOKEN:"a".repeat(64)} as LocalEnv,url="http://127.0.0.1:8794/api/10x/admin/market/batches/latest_issue";
    expect((await handle(new Request(url),env)).status).toBe(401);
    const network=vi.spyOn(globalThis,"fetch").mockRejectedValue(new Error("provider forbidden"));const response=await handle(new Request(url,{headers:{authorization:`Bearer ${env.TENX_ADMIN_TOKEN}`}}),env);
    expect(response.status).toBe(200);expect(response.headers.get("cache-control")).toBe("no-store");expect((await response.json() as {replay:{status:string}}).replay.status).toBe("verified");expect(network).not.toHaveBeenCalled();
  });
  it("does not freshen any quote or last-success time when all targets are held",async()=>{
    const {db}=setup();await seed(db);const before=await saved(db);
    expect(await runMarketCycle(settings(db,async()=>Response.json([pair(),{}])),at)).toMatchObject({state:"failed",updated:0,error_code:"market_batch_no_usable_quotes"});
    expect(await saved(db)).toEqual(before);expect(await db.prepare("SELECT last_success,last_error,next_refresh_at FROM tenx_market_control").first()).toEqual({last_success:null,last_error:"market_batch_no_usable_quotes",next_refresh_at:new Date(at.getTime()+300000).toISOString()});
    expect(await db.prepare("SELECT count(*) n FROM tenx_market_history").first()).toEqual({n:0});expect((await marketBatchRecord(db,"latest"))?.replay.status).toBe("verified");
  });
  it.each(["pause","replacement","expiry"])("discards a fetched batch after %s without publishing attempts, history or receipts",async change=>{
    const {db}=setup();await seed(db);const before=await saved(db);
    const transport=async()=>{if(change==="pause")await db.prepare("UPDATE tenx_control SET paused=1 WHERE id=1").run();else if(change==="replacement")await db.prepare("UPDATE tenx_market_control SET lease_owner='replacement',last_error='replacement_error'").run();else await db.prepare("UPDATE tenx_market_control SET lease_until=?1").bind(new Date(Date.now()-1000).toISOString()).run();return Response.json([pair(),pair(1)]);};
    expect(await runMarketCycle(settings(db,transport),change==="expiry"?undefined:at)).toMatchObject({state:"discarded",updated:0});expect(await saved(db)).toEqual(before);
    for(const table of ["tenx_market_history","tenx_market_attempts","tenx_market_batch_cache"])expect(await db.prepare(`SELECT count(*) n FROM ${table}`).first()).toEqual({n:0});
    if(change==="replacement")expect(await db.prepare("SELECT lease_owner,last_error FROM tenx_market_control").first()).toEqual({lease_owner:"replacement",last_error:"replacement_error"});
  });
  it("does not overwrite a newer concurrent quote",async()=>{
    const {db}=setup();await seed(db);const fresh=new Date(at.getTime()+1000).toISOString();
    const transport=async()=>{await db.prepare("UPDATE tenx_candidates SET payload=json_set(payload,'$.market.fetched_at',?1,'$.market.price_usd',77) WHERE address=?2").bind(fresh,rows[0]!.address).run();return Response.json([pair(),pair(1)]);};
    expect(await runMarketCycle(settings(db,transport),at)).toMatchObject({state:"succeeded",updated:2});
    expect(JSON.parse((await saved(db)).results.find(r=>r.address===rows[0]!.address)!.payload).market).toMatchObject({price_usd:77,fetched_at:fresh});
  });
  it("rolls back candidate/history/control publication when diagnostic persistence fails",async()=>{
    const {db,sqlite}=setup();await seed(db);const before=await saved(db);sqlite.exec("CREATE TRIGGER batch_cache_fail BEFORE INSERT ON tenx_market_batch_cache BEGIN SELECT RAISE(ABORT,'cache_write_failed'); END");
    expect(await runMarketCycle(settings(db,async()=>Response.json([pair(),pair(1)])),at)).toMatchObject({state:"failed",error_code:"market_persistence_unavailable"});expect(await saved(db)).toEqual(before);expect(await db.prepare("SELECT count(*) n FROM tenx_market_history").first()).toEqual({n:0});expect(await db.prepare("SELECT last_commit_owner,last_success FROM tenx_market_control").first()).toEqual({last_commit_owner:null,last_success:null});
  });
  it("preserves HTTP rate-limit backoff and prevents an older error from releasing another lease",async()=>{
    const {db}=setup();await seed(db);const config=settings(db,async()=>new Response(null,{status:429}));
    expect(await runMarketCycle(config,at)).toMatchObject({state:"failed",error_code:"market_rate_limited"});expect(await runMarketCycle(config,new Date(at.getTime()+1000))).toMatchObject({state:"waiting"});
    const later=new Date(at.getTime()+300001),transport=async()=>{await db.prepare("UPDATE tenx_market_control SET lease_owner='next',last_error='next_error'").run();throw new Error("old transport failed");};
    expect(await runMarketCycle(settings(db,transport),later)).toMatchObject({state:"failed"});expect(await db.prepare("SELECT lease_owner,last_error FROM tenx_market_control").first()).toEqual({lease_owner:"next",last_error:"next_error"});
  });
  it("detects altered retained summaries and full raw-response records",async()=>{
    const {db}=setup();await seed(db);await runMarketCycle(settings(db,async()=>Response.json([pair(),pair(1)])),at);
    await db.prepare("UPDATE tenx_market_batch_cache SET payload=json_set(payload,'$.inputs.pairs[0].priceUsd','77') WHERE slot='latest'").run();await expect(marketBatchRecord(db,"latest")).rejects.toThrow("market_batch_replay_mismatch");
    await db.prepare("UPDATE tenx_market_batch_cache SET payload=json_set(payload,'$.report_hash',?1) WHERE slot='latest'").bind(await hashJson("wrong")).run();await expect(marketBatches(db)).rejects.toThrow("market_batch_summary_hash_mismatch");
  });
});
