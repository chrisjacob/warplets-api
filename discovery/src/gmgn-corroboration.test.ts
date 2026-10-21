import{afterEach,describe,expect,it,vi}from"vitest";
import{DatabaseSync}from"node:sqlite";
import{readFileSync,readdirSync}from"node:fs";
import{sqliteD1}from"../../app/functions/_lib/sqliteTestDb";
import{acquisitionTrade}from"./holder-acquisition-fixtures.test-helper";
import{key,signature,walletInput}from"./wallet-fixtures.test-helper";
import{gmgnActivityTarget,runGmgnReview}from"./gmgn";
import{GMGN_USE_AUTHORITY}from"./gmgn-model";
import{gmgnCorroboration,collectGmgnCorroboration}from"./gmgn-corroboration-store";
import{reviewGmgnCorroboration,replayGmgnCorroboration}from"./gmgn-corroboration";
import{WalletTransactionSchema}from"./wallet-rpc";
import{hashJson}from"./solana";
import{MAINNET_GENESIS}from"./rpc";
import worker,{type LocalEnv}from"./worker";
const at=new Date("2026-10-21T09:00:00.000Z"),activityAt=new Date(at.getTime()+20_000),now=new Date(at.getTime()+60_000);
const traderId="10000000-0000-4000-8000-000000000001",id="10000000-0000-4000-8000-000000000002";
const opened:DatabaseSync[]=[];afterEach(()=>{opened.splice(0).forEach(db=>db.close());vi.restoreAllMocks();});
async function setup(change?:(rows:Record<string,unknown>[])=>void){
 const sqlite=new DatabaseSync(":memory:");opened.push(sqlite);for(const f of readdirSync(new URL("../migrations/",import.meta.url)).filter(f=>f.endsWith(".sql")).sort())sqlite.exec(readFileSync(new URL(`../migrations/${f}`,import.meta.url),"utf8"));
 const db=sqliteD1(sqlite),tx=await acquisitionTrade(),address=(await walletInput()).asset.address;
 const gmgn={db,apiKey:"test-only",permissionReference:GMGN_USE_AUTHORITY,marketDailyLimit:600};
 const operation=(request:unknown,request_id:string)=>({request,request_id,reason:"Bounded corroboration fixture",mode:"retained_research"});
 await runGmgnReview(gmgn,operation({kind:"gmgn_token_traders",address},traderId),async()=>Response.json({code:0,data:{list:[{address:key(3),addr_type:0,buy_volume_cur:100,sell_volume_cur:0}]}}),()=>at);
 const target=await gmgnActivityTarget(db,traderId,activityAt);if(target.state!=="ready")throw Error("fixture target");
 const events:Record<string,unknown>[]=[{tx_hash:tx.transaction.signatures[0],event_type:"buy",token:{address},timestamp:tx.blockTime,token_amount:"0.000100",cost_usd:100}];change?.(events);
 expect(await runGmgnReview(gmgn,operation(target.request,id),async()=>Response.json({code:0,data:{activities:events,next:null}}),()=>activityAt)).toMatchObject({state:"retained"});
 const transport=vi.fn(async(_url:unknown,init?:RequestInit)=>{const b=JSON.parse(String(init?.body));return Response.json({jsonrpc:"2.0",id:b.id,result:b.method==="getGenesisHash"?MAINNET_GENESIS:tx});});
 const settings={db,rpcUrl:"https://rpc.example",rpcDailyLimit:5000,walletDailyLimit:800,marketDailyLimit:600,marketEnabled:false,walletEnabled:true,transport};
 const cached=async(value=tx)=>{const normalized=WalletTransactionSchema.parse(value);await db.prepare("INSERT INTO tenx_wallet_transactions(signature,payload_hash,payload,fetched_at) VALUES(?1,?2,?3,?4)").bind(value.transaction.signatures[0],await hashJson(normalized),JSON.stringify(value),now.toISOString()).run();};
 return{db,sqlite,tx,settings,transport,cached};
}
describe("source-bound GMGN / RPC comparison",()=>{
 it("matches exact raw instruction quantities and replays without writes or source IO",async()=>{
  const{db,sqlite,cached}=await setup();await cached();const before=sqlite.prepare("SELECT total_changes() n").get(),fetch=vi.spyOn(globalThis,"fetch").mockRejectedValue(Error("no IO"));
  const saved=await gmgnCorroboration(db,id,now);expect(saved!.report).toMatchObject({cached_transactions:1,exact_quantity_events:1,aggregate_only_events:0,organic_volume_usd:null,scoring_effect:"none",finality_independently_attested:false});
  expect(await replayGmgnCorroboration(saved)).toEqual(saved!.report);expect(fetch).not.toHaveBeenCalled();expect(sqlite.prepare("SELECT total_changes() n").get()).toEqual(before);
  const forged=structuredClone(saved!);forged.report.exact_quantity_events=0;await expect(replayGmgnCorroboration(forged)).rejects.toThrow("report_mismatch");
 });
 it("counts aggregate-only events without reusing one instruction as two exact matches",async()=>{
  const{db,cached}=await setup(rows=>{rows[0]!.token_amount="0.000060";rows.push({...rows[0],token_amount:"0.000040"});});await cached();
  expect((await gmgnCorroboration(db,id,now))!.report).toMatchObject({exact_quantity_events:0,aggregate_only_events:2,groups:[{events:2,parsed_instructions:1,status:"aggregate_quantity_only"}]});
 });
 it.each(["quantity","time","numeric_fraction","failed","signer","decimals"])("holds %s without inventing corroboration",async(reason)=>{
  const{db,cached,tx}=await setup(rows=>{if(reason==="quantity")rows[0]!.token_amount="0.000101";if(reason==="numeric_fraction")rows[0]!.token_amount=.0001;if(reason==="time")rows[0]!.timestamp=Number(rows[0]!.timestamp)+1;});
  if(reason==="failed")tx.meta!.err={InstructionError:[0,"Custom"]};if(reason==="signer")tx.transaction.message.header.numRequiredSignatures=2;
  if(reason==="decimals")tx.meta!.postTokenBalances[0]!.uiTokenAmount.decimals++;
  await cached(tx);const report=(await gmgnCorroboration(db,id,now))!.report;expect(report.exact_quantity_events).toBe(0);expect(report.aggregate_only_events).toBe(0);expect(report.groups[0]!.status).not.toBe("exact_instruction_quantities");
 });
 it("accepts previously validated timestamp strings and leaves missing cache unknown",async()=>{
  const{db,cached}=await setup(rows=>{rows[0]!.timestamp=String(rows[0]!.timestamp);});expect((await gmgnCorroboration(db,id,now))!.report.groups[0]!.status).toBe("cache_missing");await cached();expect((await gmgnCorroboration(db,id,now))!.report.exact_quantity_events).toBe(1);
 });
 it("rejects forged cache hashes, unrelated signatures, future bodies and modified source receipts",async()=>{
  const{db,cached}=await setup();await cached();const saved=(await gmgnCorroboration(db,id,now))!;
  for(const reason of["hash","raw","signature","future","source"]){const input=structuredClone(saved.inputs);if(reason==="hash")input.transactions[0]!.payload_hash="f".repeat(64);if(reason==="raw")input.transactions[0]!.raw_hash="f".repeat(64);if(reason==="signature")input.transactions[0]!.signature=signature(99);if(reason==="future")input.transactions[0]!.fetched_at="2026-10-21T09:02:00.000Z";if(reason==="source")input.activity_record.report_hash="f".repeat(64);await expect(reviewGmgnCorroboration(input)).rejects.toThrow();}
 });
 it("holds the entire source above two signatures before RPC or quota",async()=>{
  const{db,settings,transport}=await setup(rows=>{rows.push({...rows[0],tx_hash:signature(81)},{...rows[0],tx_hash:signature(82)});});expect((await gmgnCorroboration(db,id,now))!.report.status).toBe("held");expect(await collectGmgnCorroboration(settings,id,()=>now)).toMatchObject({state:"held",rpc_calls:0});expect(transport).not.toHaveBeenCalled();
 });
 it("collects only bound finalized bodies under existing quota, journals once and keeps reads cache-only",async()=>{
  const{db,sqlite,settings,transport}=await setup(),before=sqlite.prepare("SELECT * FROM tenx_candidates").all();
  expect(await collectGmgnCorroboration(settings,id,()=>now)).toMatchObject({state:"collected",rpc_calls:2,new_cache_bodies:1});
  const calls=transport.mock.calls.map(([,init])=>JSON.parse(String(init?.body)));expect(calls.map(c=>c.method)).toEqual(["getGenesisHash","getTransaction"]);expect(calls[1].params[1].commitment).toBe("finalized");
  expect(sqlite.prepare("SELECT used FROM tenx_usage WHERE provider='rpc'").get()).toEqual({used:2});expect(sqlite.prepare("SELECT used FROM tenx_wallet_usage").get()).toEqual({used:2});expect(sqlite.prepare("SELECT * FROM tenx_candidates").all()).toEqual(before);
  expect(await collectGmgnCorroboration(settings,id,()=>now)).toMatchObject({state:"cached",rpc_calls:0});expect(transport).toHaveBeenCalledTimes(2);expect((await gmgnCorroboration(db,id,now))!.report.exact_quantity_events).toBe(1);
 });
 it("uses at most three calls for two signatures and never refetches or overwrites an existing body",async()=>{
  const{db,settings,transport,tx,cached}=await setup(rows=>{rows.push({...rows[0],tx_hash:signature(72),event_type:"add"});});
  const second=structuredClone(tx);second.transaction.signatures[0]=signature(72);const original=transport.getMockImplementation()!;transport.mockImplementation(async(url,init)=>{const b=JSON.parse(String(init?.body));return b.method==="getTransaction"&&b.params[0]===signature(72)?Response.json({jsonrpc:"2.0",id:b.id,result:second}):original(url,init);});
  await cached();const before=await db.prepare("SELECT * FROM tenx_wallet_transactions").first();expect(await collectGmgnCorroboration(settings,id,()=>now)).toMatchObject({rpc_calls:2,new_cache_bodies:1});expect(await db.prepare("SELECT * FROM tenx_wallet_transactions WHERE signature=?1").bind(tx.transaction.signatures[0]).first()).toEqual(before);expect((await gmgnCorroboration(db,id,now))!.report).toMatchObject({cached_transactions:2,non_trade_events:1,exact_quantity_events:1});
  const fresh=await setup(rows=>{rows.push({...rows[0],tx_hash:signature(72),event_type:"add"});});fresh.transport.mockImplementation(transport.getMockImplementation()!);expect(await collectGmgnCorroboration(fresh.settings,id,()=>now)).toMatchObject({rpc_calls:3,new_cache_bodies:2});
 });
 it.each(["subset","global"])("reserves every call and stops when the %s allowance runs out",async(reason)=>{
  const{settings,transport,db}=await setup();if(reason==="subset")settings.walletDailyLimit=1;else settings.rpcDailyLimit=1;
  expect(await collectGmgnCorroboration(settings,id,()=>now)).toMatchObject({state:"failed",rpc_calls:1,new_cache_bodies:0});expect(transport).toHaveBeenCalledTimes(1);expect(await db.prepare("SELECT * FROM tenx_wallet_transactions").all()).toMatchObject({results:[]});
 });
 it("rejects a future RPC transaction before publishing it to the shared cache",async()=>{
  const{settings,tx,db}=await setup();tx.blockTime=now.getTime()/1000+1;expect(await collectGmgnCorroboration(settings,id,()=>now)).toMatchObject({state:"failed",rpc_calls:2,new_cache_bodies:0,error:"gmgn_rpc_transaction_time"});expect(await db.prepare("SELECT * FROM tenx_wallet_transactions").all()).toMatchObject({results:[]});
 });
 it("journals invalid RPC configuration and releases its own lease without calls",async()=>{
  const{settings,db,transport}=await setup();settings.rpcUrl="http://invalid.example";expect(await collectGmgnCorroboration(settings,id,()=>now)).toMatchObject({state:"failed",rpc_calls:0,error:"invalid_rpc_configuration"});expect(transport).not.toHaveBeenCalled();expect(await db.prepare("SELECT lease_owner FROM tenx_wallet_control").first()).toEqual({lease_owner:null});
 });
 it("admits one attempt when two operators race for the same immutable source",async()=>{
  const{settings,transport,db}=await setup();const results=await Promise.all([collectGmgnCorroboration(settings,id,()=>now),collectGmgnCorroboration(settings,id,()=>now)]);expect(results.filter(r=>r.state==="collected")).toHaveLength(1);expect(transport).toHaveBeenCalledTimes(2);expect(await db.prepare("SELECT count(*) n FROM tenx_jobs WHERE kind='gmgn_rpc_corroboration'").first()).toEqual({n:1});
 });
 it.each(["disabled","pause","backoff","lease","pacing","subset","global","stale"])("preserves %s gates",async(reason)=>{
  const{db,settings,transport}=await setup();if(reason==="disabled")settings.walletEnabled=false;if(reason==="pause")await db.prepare("UPDATE tenx_control SET paused=1").run();if(reason==="backoff")await db.prepare("UPDATE tenx_control SET retry_after='2026-10-21T09:02:00.000Z'").run();if(reason==="lease")await db.prepare("UPDATE tenx_wallet_control SET lease_owner='other',lease_until='2026-10-21T09:02:00.000Z'").run();if(reason==="pacing")await db.prepare("UPDATE tenx_wallet_control SET next_refresh_at='2026-10-21T09:02:00.000Z'").run();if(reason==="subset")settings.walletDailyLimit=0;if(reason==="global")settings.rpcDailyLimit=0;
  const result=await collectGmgnCorroboration(settings,id,()=>reason==="stale"?new Date(now.getTime()+86_400_000):now);expect(result.rpc_calls).toBe(0);expect(transport).not.toHaveBeenCalled();expect(await db.prepare("SELECT * FROM tenx_wallet_transactions").all()).toMatchObject({results:[]});
 });
 it.each(["wrong_cluster","429","missing"])("journals %s without blind retries",async(reason)=>{
  const{db,settings,transport}=await setup();transport.mockImplementation(async(_url,init)=>{const b=JSON.parse(String(init?.body));if(reason==="429")return new Response("",{status:429,headers:{"retry-after":"120"}});return Response.json({jsonrpc:"2.0",id:b.id,result:b.method==="getGenesisHash"?(reason==="wrong_cluster"?"wrong":MAINNET_GENESIS):null});});
  const first=await collectGmgnCorroboration(settings,id,()=>now);expect(first.rpc_calls).toBe(reason==="missing"?2:1);expect(await collectGmgnCorroboration(settings,id,()=>now)).toMatchObject({state:"already_attempted",rpc_calls:0});if(reason==="429")expect(await db.prepare("SELECT retry_after FROM tenx_control").first()).toEqual({retry_after:"2026-10-21T09:06:00.000Z"});
 });
 it("does not publish a body after a pause or lease expiry during the request",async()=>{
  for(const reason of["pause","expiry","day"]){const{db,settings,transport}=await setup();let current=now;const original=transport.getMockImplementation()!;transport.mockImplementation(async(url,init)=>{const response=await original(url,init);if(JSON.parse(String(init?.body)).method==="getTransaction"){if(reason==="pause")await db.prepare("UPDATE tenx_control SET paused=1").run();else current=new Date(reason==="day"?"2026-10-22T00:00:00.000Z":now.getTime()+100_000);}return response;});expect(await collectGmgnCorroboration(settings,id,()=>current)).toMatchObject({state:"failed",rpc_calls:2,new_cache_bodies:0});expect(await db.prepare("SELECT * FROM tenx_wallet_transactions").all()).toMatchObject({results:[]});}
 });
 it("keeps public report and authenticated private export read-only",async()=>{
  const{db,sqlite,cached}=await setup();await cached();const env={TENX_DB:db,TENX_LOCAL_ONLY:"true",TENX_ADMIN_TOKEN:"a".repeat(64)}as LocalEnv,calls=vi.spyOn(globalThis,"fetch").mockRejectedValue(Error("no IO")),before=sqlite.prepare("SELECT total_changes() n").get();
  const path=`http://localhost/api/10x/gmgn/corroboration/${id}`,publicReply=await worker.fetch(new Request(path),env);expect(publicReply.status).toBe(200);const report=await publicReply.json();expect(JSON.stringify(report)).not.toContain(signature(71));
  const privatePath=path.replace("/10x/","/10x/admin/");expect((await worker.fetch(new Request(privatePath),env)).status).toBe(401);const reply=await worker.fetch(new Request(privatePath,{headers:{authorization:`Bearer ${env.TENX_ADMIN_TOKEN}`}}),env);expect(reply.status).toBe(200);await replayGmgnCorroboration(await reply.json());expect(calls).not.toHaveBeenCalled();expect(sqlite.prepare("SELECT total_changes() n").get()).toEqual(before);
  expect((await worker.fetch(new Request("http://localhost/api/10x/admin/gmgn/corroboration/collect",{method:"POST",body:JSON.stringify({activity_id:id,reason:"test"})}),env)).status).toBe(401);
 });
});
