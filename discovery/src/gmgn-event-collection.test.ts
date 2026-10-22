import{afterEach,expect,it,vi}from"vitest";
import{DatabaseSync}from"node:sqlite";
import{readFileSync,readdirSync}from"node:fs";
import{sqliteD1}from"../../app/functions/_lib/sqliteTestDb";
import{acquisitionTrade}from"./holder-acquisition-fixtures.test-helper";
import{key,signature,walletInput}from"./wallet-fixtures.test-helper";
import{gmgnActivityTarget,runGmgnReview}from"./gmgn";
import{GMGN_USE_AUTHORITY}from"./gmgn-model";
import{gmgnEventSample}from"./gmgn-event-sample-store";
import{replayGmgnEventSampleCurrent,reviewGmgnEventSampleCurrent}from"./gmgn-event-sample";
import{collectGmgnEventSample,gmgnEventCollection}from"./gmgn-event-collection";
import{MAINNET_GENESIS}from"./rpc";
import{WalletTransactionSchema}from"./wallet-rpc";
import{hashJson}from"./solana";
import worker,{type LocalEnv}from"./worker";

const at=new Date("2026-10-21T09:00:00.000Z"),received=new Date(at.getTime()+20_000),now=new Date(at.getTime()+60_000);
const traderId="10000000-0000-4000-8000-000000000001",id="10000000-0000-4000-8000-000000000002";
const opened:DatabaseSync[]=[];afterEach(()=>{opened.splice(0).forEach(db=>db.close());vi.restoreAllMocks();vi.useRealTimers();});
async function setup(change?:(rows:Record<string,unknown>[])=>void){
  const sqlite=new DatabaseSync(":memory:");opened.push(sqlite);
  for(const f of readdirSync(new URL("../migrations/",import.meta.url)).filter(f=>f.endsWith(".sql")).sort())sqlite.exec(readFileSync(new URL(`../migrations/${f}`,import.meta.url),"utf8"));
  const db=sqliteD1(sqlite),tx=await acquisitionTrade(),address=(await walletInput()).asset.address;
  const gmgnSettings={db,apiKey:"test-only",permissionReference:GMGN_USE_AUTHORITY,marketDailyLimit:600};
  const input=(request:unknown,request_id:string)=>({request,request_id,reason:"Cache-only sample fixture",mode:"retained_research"});
  await runGmgnReview(gmgnSettings,input({kind:"gmgn_token_traders",address},traderId),async()=>Response.json({code:0,data:{list:[{address:key(3),addr_type:0,buy_volume_cur:100,sell_volume_cur:10}]}}),()=>at);
  const target=await gmgnActivityTarget(db,traderId,received);if(target.state!=="ready")throw Error("fixture target");
  const events:Record<string,unknown>[]=Array.from({length:50},(_,i)=>({tx_hash:i===0?tx.transaction.signatures[0]:signature(i+100),event_type:i===0?"buy":"transferIn",token:{address},timestamp:tx.blockTime,token_amount:i===0?"0.000100":i+1,cost_usd:100}));change?.(events);
  expect(await runGmgnReview(gmgnSettings,input(target.request,id),async()=>Response.json({code:0,data:{activities:events,next:null}}),()=>received)).toMatchObject({state:"retained"});
  const cached=async(value=tx,fetched=now.toISOString())=>db.prepare("INSERT INTO tenx_wallet_transactions(signature,payload_hash,payload,fetched_at) VALUES(?1,?2,?3,?4)").bind(value.transaction.signatures[0],await hashJson(WalletTransactionSchema.parse(value)),JSON.stringify(value),fetched).run();
  const transport=vi.fn(async(_url:unknown,init?:RequestInit)=>{const body=JSON.parse(String(init?.body)),transaction=structuredClone(tx);if(body.method==="getTransaction")transaction.transaction.signatures[0]=body.params[0];return Response.json({jsonrpc:"2.0",id:body.id,result:body.method==="getGenesisHash"?MAINNET_GENESIS:transaction});});
  const settings={db,rpcUrl:"https://rpc.example",rpcDailyLimit:5000,walletDailyLimit:800,marketDailyLimit:600,marketEnabled:false,walletEnabled:true,transport};
  return{db,sqlite,tx,address,cached,settings,transport};
}
it("retains the original plan before dispatch, meters at most three calls and never repeats a spent activity",async()=>{
  const{db,sqlite,settings,transport}=await setup(rows=>{rows[1]!.event_type="buy";rows[1]!.token_amount="0.000100";});
  const candidates=sqlite.prepare("SELECT * FROM tenx_candidates").all(),original=transport.getMockImplementation()!;
  transport.mockImplementation(async(url,init)=>{const retained=await gmgnEventCollection(db,id);expect(retained).toMatchObject({state:"running",dispatch_plan:{page_events:50,selected_events:2,unselected_events:48,cutoff_at:now.toISOString()}});return original(url,init);});
  expect(await collectGmgnEventSample(settings,id,()=>now)).toMatchObject({state:"collected",rpc_calls:3,new_cache_bodies:2,error:null});
  const calls=transport.mock.calls.map(([,init])=>JSON.parse(String(init?.body)));expect(calls.map(c=>c.method)).toEqual(["getGenesisHash","getTransaction","getTransaction"]);expect(calls.slice(1).every(c=>c.params[1].commitment==="finalized")).toBe(true);
  expect(sqlite.prepare("SELECT used FROM tenx_usage WHERE provider='rpc'").get()).toEqual({used:3});expect(sqlite.prepare("SELECT used FROM tenx_wallet_usage").get()).toEqual({used:3});expect(sqlite.prepare("SELECT * FROM tenx_candidates").all()).toEqual(candidates);
  expect(await collectGmgnEventSample(settings,id,()=>new Date(now.getTime()+3600000))).toMatchObject({state:"already_attempted",rpc_calls:0});expect(transport).toHaveBeenCalledTimes(3);
  const count=sqlite.prepare("SELECT total_changes() n").get(),saved=await gmgnEventSample(db,id,now,"v2");expect(saved!.report).toMatchObject({version:"gmgn-event-sample-comparison-v2",collection_mode:"explicit_operator_only",exact_quantity_events:2,provider_requests:0,database_writes:0,scoring_effect:"none"});expect(saved!.report.gaps).not.toContain("live_collection_not_connected");expect(await replayGmgnEventSampleCurrent(saved)).toEqual(saved!.report);const forged=structuredClone(saved!);forged.report.exact_quantity_events=0;await expect(replayGmgnEventSampleCurrent(forged)).rejects.toThrow("report_mismatch");expect(sqlite.prepare("SELECT total_changes() n").get()).toEqual(count);
  await expect(db.prepare("UPDATE tenx_gmgn_event_collections SET plan_hash='changed'").run()).rejects.toThrow("immutable");
  await expect(db.prepare("DELETE FROM tenx_gmgn_event_collections").run()).rejects.toThrow("immutable");
});
it("reuses one existing body without overwriting it and skips collection when all selected bodies are cached",async()=>{
  const{db,settings,cached,transport}=await setup(rows=>{rows[1]!.event_type="buy";});await cached();const before=await db.prepare("SELECT * FROM tenx_wallet_transactions").first();
  expect(await collectGmgnEventSample(settings,id,()=>now)).toMatchObject({rpc_calls:2,new_cache_bodies:1});expect(await db.prepare("SELECT * FROM tenx_wallet_transactions WHERE signature=?1").bind(before!.signature).first()).toEqual(before);
  const all=await setup();await all.cached();expect(await collectGmgnEventSample(all.settings,id,()=>now)).toMatchObject({state:"cached",rpc_calls:0});expect(all.transport).not.toHaveBeenCalled();expect(await gmgnEventCollection(all.db,id)).toBeNull();expect(transport).toHaveBeenCalledTimes(2);
});
it.each(["disabled","pause","backoff","lease","pacing","subset_zero","global_zero","stale","oversized_selection","no_trades"])("holds %s before a job or RPC spend",async(reason)=>{
  const{db,settings,transport}=await setup(rows=>{if(reason==="no_trades")rows[0]!.event_type="transferIn";if(reason==="oversized_selection")for(let i=1;i<25;i++)rows[i]!.tx_hash=rows[0]!.tx_hash;});
  if(reason==="disabled")settings.walletEnabled=false;if(reason==="pause")await db.prepare("UPDATE tenx_control SET paused=1").run();if(reason==="backoff")await db.prepare("UPDATE tenx_control SET retry_after='2026-10-21T09:02:00.000Z'").run();if(reason==="lease")await db.prepare("UPDATE tenx_wallet_control SET lease_owner='other',lease_until='2026-10-21T09:02:00.000Z'").run();if(reason==="pacing")await db.prepare("UPDATE tenx_wallet_control SET next_refresh_at='2026-10-21T09:02:00.000Z'").run();if(reason==="subset_zero")settings.walletDailyLimit=0;if(reason==="global_zero")settings.rpcDailyLimit=0;
  expect(await collectGmgnEventSample(settings,id,()=>reason==="stale"?new Date(now.getTime()+86400001):now)).toMatchObject({state:"held",rpc_calls:0});expect(transport).not.toHaveBeenCalled();expect(await gmgnEventCollection(db,id)).toBeNull();
});
it.each(["subset","global"])("keeps spent %s quota and a failed immutable job without a second attempt",async(reason)=>{
  const{settings,db,transport}=await setup();if(reason==="subset")settings.walletDailyLimit=1;else settings.rpcDailyLimit=1;
  expect(await collectGmgnEventSample(settings,id,()=>now)).toMatchObject({state:"failed",rpc_calls:1,new_cache_bodies:0});expect(await gmgnEventCollection(db,id)).toMatchObject({state:"failed",rpc_calls:1});
  expect(await collectGmgnEventSample(settings,id,()=>now)).toMatchObject({state:"already_attempted",rpc_calls:0});expect(transport).toHaveBeenCalledTimes(1);expect(await db.prepare("SELECT * FROM tenx_wallet_transactions").first()).toBeNull();
});
it.each(["wrong_cluster","429","missing","future_block","oversized_body","invalid_rpc"])("journals %s without blind retries or substituted signatures",async(reason)=>{
  const{db,settings,transport,tx}=await setup(),original=transport.getMockImplementation()!;
  if(reason==="invalid_rpc")settings.rpcUrl="http://invalid.example";
  transport.mockImplementation(async(url,init)=>{const body=JSON.parse(String(init?.body));if(reason==="429")return new Response("",{status:429,headers:{"retry-after":"120"}});if(reason==="wrong_cluster")return Response.json({jsonrpc:"2.0",id:body.id,result:"wrong"});if(body.method==="getTransaction"){
    if(reason==="missing")return Response.json({jsonrpc:"2.0",id:body.id,result:null});const value=structuredClone(tx);if(reason==="future_block")value.blockTime=now.getTime()/1000+1;if(reason==="oversized_body")value.meta!.err="x".repeat(1_800_000);return Response.json({jsonrpc:"2.0",id:body.id,result:value});
  }return original(url,init);});
  const result=await collectGmgnEventSample(settings,id,()=>now);expect(result).toMatchObject({state:reason==="missing"?"collected":"failed",new_cache_bodies:0});expect(await collectGmgnEventSample(settings,id,()=>now)).toMatchObject({state:"already_attempted",rpc_calls:0});expect(await db.prepare("SELECT * FROM tenx_wallet_transactions").first()).toBeNull();
  if(reason==="429")expect(await db.prepare("SELECT retry_after FROM tenx_control").first()).toEqual({retry_after:"2026-10-21T09:06:00.000Z"});
  if(reason==="invalid_rpc")expect(transport).not.toHaveBeenCalled();
});
it("admits one operator when two race for the same original plan",async()=>{
  const{db,settings,transport}=await setup(),results=await Promise.all([collectGmgnEventSample(settings,id,()=>now),collectGmgnEventSample(settings,id,()=>now)]);expect(results.filter(r=>r.state==="collected")).toHaveLength(1);expect(transport).toHaveBeenCalledTimes(2);expect(await db.prepare("SELECT count(*) n FROM tenx_gmgn_event_collections").first()).toEqual({n:1});
});
it.each(["pause","expiry","day","source","selection","job"])("withholds publication after %s changes during a transaction response",async(reason)=>{
  const{db,settings,transport}=await setup();let current=now;const original=transport.getMockImplementation()!;
  transport.mockImplementation(async(url,init)=>{const response=await original(url,init),body=JSON.parse(String(init?.body));if(body.method==="getTransaction"){
    if(reason==="pause")await db.prepare("UPDATE tenx_control SET paused=1").run();if(reason==="expiry")current=new Date(now.getTime()+100000);if(reason==="day")current=new Date("2026-10-22T00:00:00.000Z");if(reason==="source"||reason==="selection")await db.prepare("UPDATE tenx_source_reservations SET receipt_hash=?1 WHERE id=?2").bind("f".repeat(64),reason==="source"?id:traderId).run();if(reason==="job")await db.prepare("UPDATE tenx_jobs SET state='failed' WHERE kind='gmgn_event_sample'").run();
  }return response;});
  expect(await collectGmgnEventSample(settings,id,()=>current)).toMatchObject({state:"failed",rpc_calls:2,new_cache_bodies:0});expect(await db.prepare("SELECT * FROM tenx_wallet_transactions").first()).toBeNull();expect(await collectGmgnEventSample(settings,id,()=>current)).toMatchObject({state:"already_attempted",rpc_calls:0});
});
it("does not repair or redispatch a spent journal with missing dispatch-plan history",async()=>{
  const{db,settings,transport}=await setup();await db.prepare("INSERT INTO tenx_jobs(id,kind,state,started_at) VALUES(?1,'gmgn_event_sample','running',?2)").bind("gmgn-event-rpc-"+id,now.toISOString()).run();expect(await collectGmgnEventSample(settings,id,()=>now)).toMatchObject({state:"already_attempted",rpc_calls:0});expect(transport).not.toHaveBeenCalled();await expect(gmgnEventCollection(db,id)).rejects.toThrow("plan_missing");
});
it.each(["source","pacing"])("does not write a cache body if %s changes between ownership check and INSERT",async(reason)=>{
  const{db,sqlite,settings}=await setup(),prepare=db.prepare.bind(db);vi.spyOn(db,"prepare").mockImplementation(sql=>{if(sql.includes("INSERT OR IGNORE INTO tenx_wallet_transactions")){if(reason==="source")sqlite.prepare("UPDATE tenx_source_reservations SET receipt_hash=? WHERE id=?").run("f".repeat(64),id);else sqlite.exec("UPDATE tenx_wallet_control SET next_refresh_at='2026-10-21T12:00:00.000Z'");}return prepare(sql);});
  expect(await collectGmgnEventSample(settings,id,()=>now)).toMatchObject({state:"failed",rpc_calls:2,new_cache_bodies:0});expect(await db.prepare("SELECT * FROM tenx_wallet_transactions").first()).toBeNull();
});
it("preserves a newer wallet backoff on completion and does not overwrite it with the five-minute pacing floor",async()=>{
  const{db,settings,transport}=await setup(),original=transport.getMockImplementation()!;transport.mockImplementation(async(url,init)=>{const response=await original(url,init);await db.prepare("UPDATE tenx_wallet_control SET next_refresh_at='2026-10-21T12:00:00.000Z'").run();return response;});
  expect(await collectGmgnEventSample(settings,id,()=>now)).toMatchObject({state:"failed",rpc_calls:1,new_cache_bodies:0});expect(await db.prepare("SELECT next_refresh_at FROM tenx_wallet_control").first()).toEqual({next_refresh_at:"2026-10-21T12:00:00.000Z"});
});
it("keeps collection and retained plan inspection private while public reads are v2 and cache-only",async()=>{
  const{db,sqlite,settings,transport}=await setup(),token="a".repeat(64),env={TENX_DB:db,TENX_LOCAL_ONLY:"true",TENX_ADMIN_TOKEN:token,TENX_WALLET_ANALYSIS_ENABLED:"false",TENX_RPC_URL:"https://rpc.example",TENX_RPC_DAILY_LIMIT:"5000",TENX_MARKET_DAILY_LIMIT:"600",TENX_MARKET_PROVIDER:"dexscreener",TENX_WALLET_RPC_DAILY_LIMIT:"800",TENX_QUALITY_RPC_DAILY_LIMIT:"1800"}as LocalEnv;
  vi.useFakeTimers({toFake:["Date"]});vi.setSystemTime(now);
  const path="http://localhost/api/10x/admin/gmgn/event-sample/collect",body=JSON.stringify({activity_id:id,reason:"Explicit bounded sample review"});
  expect((await worker.fetch(new Request(path,{method:"POST",body,headers:{"content-type":"application/json"}}),env)).status).toBe(401);
  expect((await worker.fetch(new Request(path,{method:"POST",body,headers:{"content-type":"application/json",authorization:`Bearer ${token}`,origin:"https://evil.example"}}),env)).status).toBe(403);
  const blocked=await worker.fetch(new Request(path,{method:"POST",body,headers:{"content-type":"application/json",authorization:`Bearer ${token}`}}),env);expect(await blocked.json()).toMatchObject({state:"held",reason:"wallet_collection_disabled",rpc_calls:0});expect(transport).not.toHaveBeenCalled();
  await collectGmgnEventSample(settings,id,()=>now);const privatePath=`http://localhost/api/10x/admin/gmgn/event-sample/${id}`;
  expect((await worker.fetch(new Request(privatePath),env)).status).toBe(401);const before=sqlite.prepare("SELECT total_changes() n").get(),record=await worker.fetch(new Request(privatePath,{headers:{authorization:`Bearer ${token}`}}),env);expect(record.status).toBe(200);expect(await record.json()).toMatchObject({operator_only:true,maximum_rpc_calls:3,state:"succeeded"});
  const publicReply=await worker.fetch(new Request(`http://localhost/api/10x/gmgn/event-sample/${id}`),env),report=await publicReply.json();expect(report).toMatchObject({version:"gmgn-event-sample-comparison-v2",collection_mode:"explicit_operator_only",provider_requests:0,database_writes:0});expect(JSON.stringify(report)).not.toContain(signature(71));expect(sqlite.prepare("SELECT total_changes() n").get()).toEqual(before);
  const saved=await gmgnEventSample(db,id,now);expect(await reviewGmgnEventSampleCurrent(saved!.inputs)).toMatchObject({version:"gmgn-event-sample-comparison-v2",scoring_effect:"none"});
});
it("retains a partial first body and the failed job when the existing allowance ends before the second body",async()=>{
 const{db,settings,transport}=await setup(rows=>{rows[1]!.event_type="buy";rows[1]!.token_amount="0.000100";});settings.walletDailyLimit=2;
 expect(await collectGmgnEventSample(settings,id,()=>now)).toMatchObject({state:"failed",rpc_calls:2,new_cache_bodies:1});expect((await gmgnEventSample(db,id,now,"v2"))!.report).toMatchObject({state:"cache_missing",cached_transactions:1,required_transactions:2,exact_quantity_events:1});expect(await collectGmgnEventSample(settings,id,()=>now)).toMatchObject({state:"already_attempted",rpc_calls:0});expect(transport).toHaveBeenCalledTimes(2);
});
it("holds dispatch after a pause during quota reservation while keeping both reservations spent",async()=>{
 const{db,sqlite,settings,transport}=await setup();sqlite.exec("CREATE TRIGGER test_pause_after_rpc_quota AFTER INSERT ON tenx_usage WHEN NEW.provider='rpc' BEGIN UPDATE tenx_control SET paused=1 WHERE id=1; END;");
 expect(await collectGmgnEventSample(settings,id,()=>now)).toMatchObject({state:"failed",rpc_calls:0,error:"gmgn_event_lease_source_or_pause"});expect(transport).not.toHaveBeenCalled();expect(await db.prepare("SELECT used FROM tenx_usage WHERE provider='rpc'").first()).toEqual({used:1});expect(await db.prepare("SELECT used FROM tenx_wallet_usage").first()).toEqual({used:1});
});
