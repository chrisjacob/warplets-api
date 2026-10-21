import {afterEach,beforeEach,describe,expect,it,vi} from "vitest";
import {DatabaseSync} from "node:sqlite";
import {readFileSync,readdirSync} from "node:fs";
import {sqliteD1} from "../../app/functions/_lib/sqliteTestDb";
import {advanceMintReview,enqueueMintReview,mintReviews} from "./mint-review";
import {MintReviewRequest} from "./mint-review-model";
import {syntheticBundle} from "./fixtures";
import {signature,key} from "./wallet-fixtures.test-helper";
import {MAINNET_GENESIS,RpcClient,TransactionSchema} from "./rpc";
import {reserveQuota} from "./store";
import {canonicalPool,curveAddress,WSOL} from "./pump";
import {hashJson} from "./solana";
import {runCycle} from "./ingest";
import worker,{type LocalEnv} from "./worker";

const opened:DatabaseSync[]=[],now=new Date("2026-10-21T00:05:00.000Z"),clock=()=>new Date();
beforeEach(()=>{vi.useFakeTimers({toFake:["Date"]});vi.setSystemTime(now);});
afterEach(()=>{opened.splice(0).forEach(db=>db.close());vi.useRealTimers();vi.restoreAllMocks();});
function setup(){const sqlite=new DatabaseSync(":memory:");opened.push(sqlite);for(const f of readdirSync(new URL("../migrations/",import.meta.url)).filter(f=>f.endsWith(".sql")).sort())sqlite.exec(readFileSync(new URL(`../migrations/${f}`,import.meta.url),"utf8"));return {sqlite,db:sqliteD1(sqlite)};}
async function owner(db:D1Database){await db.prepare("UPDATE tenx_control SET lease_owner='job',lease_until=?1 WHERE id=1").bind(new Date(now.getTime()+600000).toISOString()).run();}
const entry=(n:number,slot=20000)=>({signature:signature(n),slot,blockTime:Math.floor(now.getTime()/1000)-1800,err:null,confirmationStatus:"finalized"});
function client(db:D1Database,answer:(method:string,params:unknown[])=>unknown|Promise<unknown>,globalLimit=5000){
  const transport=vi.fn(async(_url:RequestInfo|URL,init?:RequestInit)=>{const req=JSON.parse(String(init?.body));return Response.json({jsonrpc:"2.0",id:req.id,result:await answer(req.method,req.params)});});
  return {transport,rpc:new RpcClient("https://rpc.invalid",reserveQuota(db,{rpc:globalLimit,market:600},now),transport)};
}
async function queued(db:D1Database,address=key(41)){await enqueueMintReview(db,{address,reason:"Test exact mint"},now);await owner(db);return address;}
const saved=(db:D1Database)=>db.prepare("SELECT * FROM tenx_mint_reviews LIMIT 1").first<Record<string,unknown>>();

describe("bounded exact-mint review intake",()=>{
  it("validates canonical mint identity, rejects URLs/extra fields and idempotently audits only a new request without source work",async()=>{
    const {db}=setup(),outside=vi.spyOn(globalThis,"fetch").mockRejectedValue(new Error("network forbidden"));
    for(const raw of [{address:"Kimchi",reason:"Test"},{address:"https://pump.fun/coin/x",reason:"Test"},{address:key(41),reason:"Test",eligible:true}])expect(MintReviewRequest.safeParse(raw).success).toBe(false);
    expect(await enqueueMintReview(db,{address:key(41),reason:"Private reason"},now)).toMatchObject({duplicate:false,state:"queued",provider_requests:0});
    expect(await enqueueMintReview(db,{address:key(41),reason:"Retry reason"},now)).toMatchObject({duplicate:true,state:"queued"});
    expect((await mintReviews(db,now)).reviews[0]).toMatchObject({curve:await curveAddress(key(41)),candidate_present:false});
    expect(JSON.stringify(await mintReviews(db,now))).not.toContain("Private reason");
    expect(await db.prepare("SELECT count(*) n FROM tenx_audit").first()).toEqual({n:1});expect(await db.prepare("SELECT count(*) n FROM tenx_usage").first()).toEqual({n:0});expect(outside).not.toHaveBeenCalled();
  });
  it("bounds active and retained requests, and keeps duplicates readable when full",async()=>{
    const {db}=setup();for(let n=1;n<=8;n++)await enqueueMintReview(db,{address:key(n),reason:"Test"},now);
    await expect(enqueueMintReview(db,{address:key(9),reason:"Test"},now)).rejects.toThrow("mint_review_queue_full");
    expect(await enqueueMintReview(db,{address:key(1),reason:"Test"},now)).toMatchObject({duplicate:true});
    await db.prepare("UPDATE tenx_mint_reviews SET state='not_found'").run();
    for(let n=9;n<=100;n++){await enqueueMintReview(db,{address:key(n),reason:"Test"},now);await db.prepare("UPDATE tenx_mint_reviews SET state='not_found' WHERE address=?1").bind(key(n)).run();}
    await expect(enqueueMintReview(db,{address:key(101),reason:"Test"},now)).rejects.toThrow("mint_review_queue_full");expect((await mintReviews(db,now)).reviews).toHaveLength(100);
  });
  it.each(["paused","expired","replacement"])("makes no source calls under a %s lease",async(kind)=>{
    const {db}=setup();await queued(db);
    if(kind==="paused")await db.prepare("UPDATE tenx_control SET paused=1").run();
    if(kind==="expired")await db.prepare("UPDATE tenx_control SET lease_until=?1").bind(now.toISOString()).run();
    if(kind==="replacement")await db.prepare("UPDATE tenx_control SET lease_owner='other'").run();
    const {rpc,transport}=client(db,()=>[]);await expect(advanceMintReview(db,rpc,"job",clock)).rejects.toThrow("discovery_lease_lost");expect(transport).not.toHaveBeenCalled();expect((await saved(db))?.state).toBe("queued");
  });
  it("expires requests without source work and does not reset them on duplicate submission",async()=>{
    const {db}=setup();await queued(db);await db.prepare("UPDATE tenx_mint_reviews SET queued_at=?1").bind(new Date(now.getTime()-86400000).toISOString()).run();
    const {rpc,transport}=client(db,()=>[]);expect(await advanceMintReview(db,rpc,"job",clock)).toBe(0);expect((await saved(db))?.state).toBe("expired");expect(await enqueueMintReview(db,{address:key(41),reason:"Retry"},now)).toMatchObject({duplicate:true,state:"expired"});expect(transport).not.toHaveBeenCalled();
  });
  it("resumes saved pending bodies across turns without refetching the signature page",async()=>{
    const {db}=setup();await queued(db);const {rpc,transport}=client(db,m=>m==="getSignaturesForAddress"?[entry(61),entry(62),entry(63)]:null);
    expect(await advanceMintReview(db,rpc,"job",clock)).toBe(2);expect((await saved(db))?.state).toBe("scanning");expect(JSON.parse(String((await saved(db))?.pending))).toHaveLength(1);
    expect(await advanceMintReview(db,rpc,"job",clock)).toBe(1);expect((await saved(db))?.state).toBe("not_found");
    expect(transport.mock.calls.filter(([,init])=>JSON.parse(String(init?.body)).method==="getSignaturesForAddress")).toHaveLength(1);
    expect((await mintReviews(db,now))).toMatchObject({reserved_today:4,reviews:[{bodies_checked:3}]});
    expect(await db.prepare("SELECT count(*) n FROM tenx_candidates").first()).toEqual({n:0});
  });
  it("retains a finalized exact-mint migration as an ordinary lead, with its receipt and raw body",async()=>{
    const {db}=setup(),b=await syntheticBundle(now);await queued(db,b.mint);
    const item={...entry(20),signature:b.graduation.transaction.signatures[0]!,slot:b.graduation.slot};
    const {rpc}=client(db,m=>m==="getSignaturesForAddress"?[item]:b.graduation);
    expect(await advanceMintReview(db,rpc,"job",clock)).toBe(1);expect((await saved(db))?.state).toBe("admitted");
    const lead=await db.prepare("SELECT migration_tx FROM tenx_leads WHERE address=?1").bind(b.mint).first<{migration_tx:string}>();expect(JSON.parse(lead!.migration_tx)).toEqual(b.graduation);
    expect(await db.prepare("SELECT payload_hash,outcome FROM tenx_mint_review_reads").first()).toEqual({payload_hash:await hashJson(TransactionSchema.parse(b.graduation)),outcome:"migration_verified"});
    expect(await db.prepare("SELECT count(*) n FROM tenx_candidates").first()).toEqual({n:0});expect((await mintReviews(db,now)).reviews[0]?.candidate_present).toBe(false);
  });
  it("does not admit a different mint's canonical migration",async()=>{
    const {db}=setup(),b=await syntheticBundle(now,42);await queued(db,key(41));
    const {rpc}=client(db,m=>m==="getSignaturesForAddress"?[{...entry(20),signature:b.graduation.transaction.signatures[0]!,slot:b.graduation.slot}]:b.graduation);
    await advanceMintReview(db,rpc,"job",clock);expect((await saved(db))?.state).toBe("not_found");expect(await db.prepare("SELECT count(*) n FROM tenx_leads").first()).toEqual({n:0});
  });
  it("records a canonical non-WSOL migration as unsupported, retaining its body without admitting a lead",async()=>{
    const {db}=setup(),b=await syntheticBundle(now);await queued(db,b.mint);
    const quote=key(89),pool=await canonicalPool(b.mint,quote),tx=structuredClone(b.graduation);
    tx.transaction.message.accountKeys=tx.transaction.message.accountKeys.map(k=>k===WSOL?quote:k===b.pool?pool.pool:k);
    const {rpc}=client(db,m=>m==="getSignaturesForAddress"?[{...entry(20),signature:tx.transaction.signatures[0]!,slot:tx.slot}]:tx);
    await advanceMintReview(db,rpc,"job",clock);expect(await saved(db)).toMatchObject({state:"unsupported_quote",quote,last_error:"unsupported_quote"});expect(await db.prepare("SELECT count(*) n FROM tenx_leads").first()).toEqual({n:0});expect(await db.prepare("SELECT count(*) n FROM tenx_evidence").first()).toEqual({n:1});
  });
  it.each(["wrong_slot","future_time","wrong_signature"])("rejects %s bodies without advancing the checkpoint",async(kind)=>{
    const {db}=setup(),b=await syntheticBundle(now);await queued(db,b.mint);const tx=structuredClone(b.graduation);
    if(kind==="wrong_slot")tx.slot++;if(kind==="future_time")tx.blockTime=Math.floor(now.getTime()/1000)+1;if(kind==="wrong_signature")tx.transaction.signatures[0]=signature(99);
    const {rpc}=client(db,m=>m==="getSignaturesForAddress"?[{...entry(20),signature:b.graduation.transaction.signatures[0]!,slot:b.graduation.slot}]:tx);
    await expect(advanceMintReview(db,rpc,"job",clock)).rejects.toThrow(kind==="wrong_signature"?"transaction_signature_mismatch":"mint_review_transaction_identity_or_time_mismatch");expect(JSON.parse(String((await saved(db))?.pending))).toHaveLength(1);expect(await db.prepare("SELECT count(*) n FROM tenx_leads").first()).toEqual({n:0});
  });
  it("reuses hash-verified cached migration bodies without reserving another source call",async()=>{
    const {db}=setup(),b=await syntheticBundle(now);await queued(db,b.mint);
    const body=TransactionSchema.parse(b.graduation);
    await db.prepare("INSERT INTO tenx_evidence(signature,payload_hash,payload,fetched_at) VALUES(?1,?2,?3,?4)").bind(body.transaction.signatures[0]!,await hashJson(body),JSON.stringify(body),now.toISOString()).run();
    const {rpc}=client(db,()=>[{...entry(20),signature:b.graduation.transaction.signatures[0]!,slot:b.graduation.slot}]);await advanceMintReview(db,rpc,"job",clock);expect(rpc.calls).toBe(1);expect((await mintReviews(db,now)).reserved_today).toBe(1);
  });
  it("does not write a response after a replacement owner, pause or lease expiry",async()=>{
    for(const change of ["lease_owner='replacement'","paused=1",`lease_until='${now.toISOString()}'`]){
      const {db}=setup();await queued(db);const {rpc}=client(db,async()=>{await db.prepare(`UPDATE tenx_control SET ${change}`).run();return [entry(70)];});
      await expect(advanceMintReview(db,rpc,"job",clock)).rejects.toThrow("discovery_lease_lost");expect((await saved(db))?.pages).toBe(0);expect(await db.prepare("SELECT count(*) n FROM tenx_mint_review_pages").first()).toEqual({n:0});
    }
  });
  it("retains pending work and surfaces rate limits rather than consuming it",async()=>{
    const {db}=setup();await queued(db);
    const transport:typeof fetch=async(_url,init)=>{const req=JSON.parse(String(init?.body));return req.method==="getTransaction"?new Response(null,{status:429,headers:{"retry-after":"900"}}):Response.json({jsonrpc:"2.0",id:req.id,result:[entry(70)]});};
    const rpc=new RpcClient("https://rpc.invalid",reserveQuota(db,{rpc:5000,market:600},now),transport);
    await expect(advanceMintReview(db,rpc,"job",clock)).rejects.toThrow("rpc_rate_limited");expect((await saved(db))?.last_error).toBe("rpc_rate_limited");expect(JSON.parse(String((await saved(db))?.pending))).toHaveLength(1);
  });
  it("stops after three pages without widening the scan",async()=>{
    const {db}=setup();await queued(db);await db.prepare("UPDATE tenx_mint_reviews SET pages=3").run();
    const {rpc,transport}=client(db,()=>[]);await advanceMintReview(db,rpc,"job",clock);expect((await saved(db))?.state).toBe("not_found");expect(transport).not.toHaveBeenCalled();
  });
  it("does not commit a transaction body after ownership changes during its read",async()=>{
    const {db}=setup(),b=await syntheticBundle(now);await queued(db,b.mint);
    const {rpc}=client(db,async m=>{if(m==="getSignaturesForAddress")return [{...entry(20),signature:b.graduation.transaction.signatures[0]!,slot:b.graduation.slot}];await db.prepare("UPDATE tenx_control SET lease_owner='replacement'").run();return b.graduation;});
    await expect(advanceMintReview(db,rpc,"job",clock)).rejects.toThrow("discovery_lease_lost");expect((await saved(db))?.pages).toBe(1);expect(JSON.parse(String((await saved(db))?.pending))).toHaveLength(1);expect(await db.prepare("SELECT count(*) n FROM tenx_mint_review_reads").first()).toEqual({n:0});expect(await db.prepare("SELECT count(*) n FROM tenx_leads").first()).toEqual({n:0});
  });
  it.each(["duplicate","future","out_of_order"])("rejects %s signature pages without saving a cursor",async kind=>{
    const {db}=setup();await queued(db);const rows=kind==="duplicate"?[entry(70),entry(70)]:kind==="future"?[{...entry(70),blockTime:Math.floor(now.getTime()/1000)+1}]:[entry(70,10),entry(71,20)];
    const {rpc}=client(db,()=>rows);await expect(advanceMintReview(db,rpc,"job",clock)).rejects.toThrow("mint_review_page_invalid");expect((await saved(db))?.pages).toBe(0);
  });
  it("unpaced manual refreshes do not advance queued intake",async()=>{
    const {db}=setup();await enqueueMintReview(db,{address:key(41),reason:"Test"},now);await db.prepare("UPDATE tenx_control SET last_harvest=?1").bind(now.toISOString()).run();
    const {transport}=client(db,()=>MAINNET_GENESIS);expect(await runCycle({db,rpcUrl:"https://rpc.invalid",rpcDailyLimit:5000,marketDailyLimit:600,marketEnabled:false,transport,paced:false},now)).toMatchObject({state:"succeeded",rpc_calls:1});expect((await saved(db))?.pages).toBe(0);
  });
  it.each(["subset","global"])("honors the %s cap before sending source requests",async(kind)=>{
    const {db}=setup();await queued(db);await db.prepare("INSERT INTO tenx_usage(provider,day,used) VALUES(?1,?2,?3)").bind(kind==="subset"?"mint_intake":"rpc",now.toISOString().slice(0,10),kind==="subset"?20:5000).run();
    const {rpc,transport}=client(db,()=>[]);if(kind==="subset")expect(await advanceMintReview(db,rpc,"job",clock)).toBe(0);else await expect(advanceMintReview(db,rpc,"job",clock)).rejects.toThrow("rpc_daily_budget_exhausted");expect(transport).not.toHaveBeenCalled();expect((await saved(db))?.pages).toBe(0);
  });
  it("shares the ordinary six-body turn ceiling with inbox work and rejects duplicate cycle delivery",async()=>{
    const {db}=setup();await enqueueMintReview(db,{address:key(41),reason:"Test"},now);await db.prepare("UPDATE tenx_control SET last_harvest=?1").bind(now.toISOString()).run();
    for(let n=71;n<=76;n++)await db.prepare("INSERT INTO tenx_pending_signatures(signature,slot,queued_at) VALUES(?1,?2,?3)").bind(signature(n),10000-n,now.toISOString()).run();
    const {transport}=client(db,m=>m==="getGenesisHash"?MAINNET_GENESIS:m==="getSignaturesForAddress"?[entry(61),entry(62),entry(63)]:null);
    const settings={db,rpcUrl:"https://rpc.invalid",rpcDailyLimit:5000,marketDailyLimit:600,marketEnabled:false,transport,paced:true};
    expect(await runCycle(settings,now)).toMatchObject({state:"succeeded",rpc_calls:8});
    const bodies=transport.mock.calls.filter(([,init])=>JSON.parse(String(init?.body)).method==="getTransaction");expect(bodies).toHaveLength(6);
    const count=transport.mock.calls.length;expect(["duplicate","waiting"]).toContain((await runCycle(settings,now)).state);expect(transport).toHaveBeenCalledTimes(count);
  });
  it("normal pacing, source backoff, pause and contender reservation prevent intake source work",async()=>{
    for(const mode of ["pace","backoff","pause","reserved"]){
      const {db}=setup();await enqueueMintReview(db,{address:key(41),reason:"Test"},now);
      if(mode==="pace")await db.prepare("UPDATE tenx_control SET next_refresh_at=?1").bind(new Date(now.getTime()+60000).toISOString()).run();
      if(mode==="backoff")await db.prepare("UPDATE tenx_control SET retry_after=?1").bind(new Date(now.getTime()+60000).toISOString()).run();
      if(mode==="pause")await db.prepare("UPDATE tenx_control SET paused=1").run();
      const {transport}=client(db,()=>MAINNET_GENESIS);const result=await runCycle({db,rpcUrl:"https://rpc.invalid",rpcDailyLimit:100,marketDailyLimit:600,marketEnabled:false,transport,paced:true,...(mode==="reserved"?{qualityEnabled:true,qualityDailyLimit:100}:{})},now);
      expect(["waiting","skipped"]).toContain(result.state);expect(transport).not.toHaveBeenCalled();expect((await saved(db))?.pages).toBe(0);
    }
  });
  it("keeps writes operator-authenticated, validates bodies and serves cached public status with zero provider work",async()=>{
    const {db}=setup(),outside=vi.spyOn(globalThis,"fetch").mockRejectedValue(new Error("network forbidden"));
    const env={TENX_DB:db,TENX_LOCAL_ONLY:"true",TENX_ADMIN_TOKEN:"a".repeat(64)} as LocalEnv;
    const request=(path:string,body?:unknown,headers:Record<string,string>={})=>new Request(`http://127.0.0.1:8794/api/10x/${path}`,body===undefined?{}:{method:"POST",headers:{"content-type":"application/json",...headers},body:JSON.stringify(body)});
    const payload={address:key(41),reason:"Test"},auth={authorization:`Bearer ${"a".repeat(64)}`};
    expect((await worker.fetch(request("admin/mint-reviews",payload),env)).status).toBe(401);
    expect((await worker.fetch(request("admin/mint-reviews",payload,{...auth,origin:"https://evil.invalid"}),env)).status).toBe(403);
    expect((await worker.fetch(request("admin/mint-reviews",{...payload,eligible:true},auth),env)).status).toBe(400);
    expect((await worker.fetch(request("admin/mint-reviews",payload,auth),env)).status).toBe(200);
    const response=await worker.fetch(request("discovery/mint-reviews"),env);expect(response.status).toBe(200);expect(response.headers.get("cache-control")).toBe("no-store");expect((await response.json() as {data:{reviews:unknown[]}}).data.reviews).toHaveLength(1);
    expect((await worker.fetch(request("discovery/mint-reviews",payload),env)).status).toBe(404);expect(outside).not.toHaveBeenCalled();
  });
});
