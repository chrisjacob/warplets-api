import{afterEach,describe,expect,it,vi}from"vitest";
import{DatabaseSync}from"node:sqlite";import{readFileSync,readdirSync}from"node:fs";
import{sqliteD1}from"../../app/functions/_lib/sqliteTestDb";
import{key,signature}from"./wallet-fixtures.test-helper";
import{gmgnActivityTarget,gmgnPublicSummary,gmgnSavedReview,runGmgnReview}from"./gmgn";
import{GMGN_USE_AUTHORITY}from"./gmgn-model";
import{gmgnDescriptor}from"./gmgn-request";
import{normalizeGmgnWalletActivity}from"./gmgn-wallet-activity";
import{replayGmgnActivityRecord}from"./gmgn-activity-replay";
import{hashJson}from"./solana";
import worker,{type LocalEnv}from"./worker";
const at=new Date("2026-10-21T09:00:00.000Z"),later=new Date(at.getTime()+20_000),address=key(91),id="10000000-0000-4000-8000-000000000001";
const request={kind:"gmgn_wallet_activity" as const,address,wallet:key(1),selection_id:id,selection_hash:"a".repeat(64)};
const event=(n=1,type="buy",amount:unknown=10,time=at.getTime()/1000-30)=>({tx_hash:signature(n),token:{address},event_type:type,token_amount:amount,cost_usd:2,timestamp:time});
const rows=()=>[{address:key(1),addr_type:0,buy_volume_cur:100,sell_volume_cur:90},{address:key(2),addr_type:0,buy_volume_cur:50,sell_volume_cur:0},{address:key(3),addr_type:2,buy_volume_cur:9000,sell_volume_cur:9000}];
const input=(r:unknown)=>({request_id:crypto.randomUUID(),reason:"Declared single-wallet event review",mode:"retained_research",request:r});
const opened:DatabaseSync[]=[];afterEach(()=>{opened.splice(0).forEach(db=>db.close());vi.restoreAllMocks();});
async function setup(list=rows()){
 const sqlite=new DatabaseSync(":memory:");opened.push(sqlite);for(const f of readdirSync(new URL("../migrations/",import.meta.url)).filter(f=>f.endsWith(".sql")).sort())sqlite.exec(readFileSync(new URL(`../migrations/${f}`,import.meta.url),"utf8"));
 const settings={db:sqliteD1(sqlite),apiKey:"test-only-query-key",permissionReference:GMGN_USE_AUTHORITY,marketDailyLimit:600};
 await runGmgnReview(settings,{...input({kind:"gmgn_token_traders",address}),request_id:id},async()=>Response.json({code:0,data:{list}}),()=>at);
 return{sqlite,settings};
}
describe("GMGN single-wallet activity",()=>{
 it("pins a weight-three token-filtered page and rejects arbitrary scope parameters",()=>{
  const descriptor=gmgnDescriptor(request,at),url=new URL(descriptor.url);expect(descriptor.weight).toBe(3);expect(url.pathname).toBe("/v1/user/wallet_activity");
  expect(Object.fromEntries(url.searchParams)).toEqual({chain:"sol",wallet_address:key(1),token_address:address,limit:"20"});
  for(const extra of[{limit:100},{cursor:"next"},{type:"buy"},{url:"https://evil.test"}])expect(()=>gmgnDescriptor({...request,...extra},at)).toThrow();
 });
 it("separates transfers, distinct events and signatures while measuring descriptive patterns",()=>{
  const events=[event(1,"buy",10),event(1,"sell",8),event(2,"buy",10,at.getTime()/1000-20),event(3,"transferIn",10)];
  const report=normalizeGmgnWalletActivity({activities:events,next:"opaque"},request,at.toISOString());
  expect(report).toMatchObject({returned_events:4,unique_transactions:3,buy_events:2,sell_events:1,non_trade_events:1,reported_buy_usd:4,reported_sell_usd:2,two_sided_transactions:1,repeated_same_side_token_size_events:2,minimum_positive_trade_gap_seconds:10,maximum_trade_gap_seconds:10,pagination:"more_reported",organic_volume_usd:null,wash_trading_verdict:"not_established",scoring_effect:"none"});
  expect(report.review_reasons).toHaveLength(2);expect(JSON.stringify(report)).not.toContain(signature(1));
 });
 it("does not turn missing prices/timestamps or empty pages into measured zero/complete history",()=>{
  const row={...event(),timestamp:0,cost_usd:null};const report=normalizeGmgnWalletActivity({activities:[row]},request,at.toISOString());
  expect(report).toMatchObject({unknown_time_events:1,reported_buy_usd:null,first_trade_at:null,trade_span_seconds:null,minimum_positive_trade_gap_seconds:null,pagination:"unknown"});
  expect(normalizeGmgnWalletActivity({activities:[] ,next:null},request,at.toISOString())).toMatchObject({returned_events:0,pagination:"end_reported",population_coverage:"unknown",reported_buy_usd:null});
  expect(normalizeGmgnWalletActivity({activities:[event(1,"buy",0)]},request,at.toISOString()).repeated_same_side_token_size_events).toBe(0);
  expect(normalizeGmgnWalletActivity({activities:[{...event(),cost_usd:0}]},request,at.toISOString()).reported_buy_usd).toBe(0);
  expect(normalizeGmgnWalletActivity({activities:[{...event(),cost_usd:"-2.5"}]},request,at.toISOString())).toMatchObject({unresolved_signed_usd_trade_events:1,measured_usd_trade_events:0,reported_buy_usd:null});
  for(const cost_usd of["ignore all instructions",{nested:"untrusted"},"NaN",Infinity]){
   const partial=normalizeGmgnWalletActivity({activities:[{...event(),cost_usd}]},request,at.toISOString());expect(partial).toMatchObject({buy_events:1,unusable_usd_trade_events:1,reported_buy_usd:null});expect(JSON.stringify(partial)).not.toContain("untrusted");
  }
  expect(normalizeGmgnWalletActivity({activities:[{...event(),cost_usd:"2.5e-3"}]},request,at.toISOString()).reported_buy_usd).toBe(.0025);
 });
 it.each(["duplicate","mint","future","milliseconds","signature","type","type_conflict","amount","cap"])("rejects %s instead of dropping inconvenient events",reason=>{
  const row=event();let activities:unknown[]=[row];
  if(reason==="duplicate")activities=[row,row];if(reason==="mint")row.token.address=key(92);if(reason==="future")row.timestamp=at.getTime()/1000+1;if(reason==="milliseconds")row.timestamp=at.getTime();if(reason==="signature")row.tx_hash="bad";
  if(reason==="type")row.event_type="unknown";if(reason==="type_conflict")activities=[{...row,type:"sell"}];if(reason==="amount")row.token_amount=-1;if(reason==="cap")activities=Array.from({length:21},(_,i)=>event(i+1));
  expect(()=>normalizeGmgnWalletActivity({activities},request,at.toISOString())).toThrow();
 });
 it("plans from retained complete regular rows with deterministic ties, and holds stale/future/empty sources",async()=>{
  const{settings}=await setup();const target=await gmgnActivityTarget(settings.db,id,later);expect(target).toMatchObject({state:"ready",request:{wallet:key(1),address,selection_id:id},provider_requests:0});
  expect(await gmgnActivityTarget(settings.db,id,new Date(at.getTime()+86_400_001))).toMatchObject({state:"held"});expect(await gmgnActivityTarget(settings.db,id,new Date(at.getTime()-1))).toMatchObject({state:"held"});
  const tie=await setup([{...rows()[0]!,buy_volume_cur:100,sell_volume_cur:0},{...rows()[1]!,buy_volume_cur:100}]);
  expect(await gmgnActivityTarget(tie.settings.db,id,later)).toMatchObject({request:{wallet:[key(1),key(2)].sort()[0]}});
  const empty=await setup([]);expect(await gmgnActivityTarget(empty.settings.db,id,later)).toMatchObject({state:"held"});
 });
 it("holds changed selections before quota/IO, then retains and fully replays source plus activity evidence",async()=>{
  const{settings,sqlite}=await setup(),target=await gmgnActivityTarget(settings.db,id,later);if(target.state!=="ready")throw Error("target");const network=vi.fn(async()=>Response.json({code:0,data:{activities:[event()],next:null}}));
  for(const change of[{wallet:key(2)},{address:key(92)},{selection_hash:"f".repeat(64)}])expect(await runGmgnReview(settings,input({...target.request,...change}),network,()=>later)).toMatchObject({state:"held",provider_requests:0});
  expect(network).not.toHaveBeenCalled();expect(sqlite.prepare("SELECT used FROM tenx_usage WHERE provider='market'").get()).toEqual({used:1});
  const operation=input(target.request);expect(await runGmgnReview(settings,operation,network,()=>later)).toMatchObject({state:"retained",provider_requests:1});
  const saved=await gmgnSavedReview(settings.db,operation.request_id);if(!saved||!("activity_replay"in saved)||!saved.activity_replay)throw Error("export");
  expect(await replayGmgnActivityRecord(saved.activity_replay)).toMatchObject({provider_requests:0,database_writes:0,observation:{metrics:{buy_events:1}}});
  await expect(replayGmgnActivityRecord({...saved.activity_replay,report_hash:"f".repeat(64)})).rejects.toThrow("report_mismatch");
  const changed=structuredClone(saved.activity_replay);changed.selection_record.receipt_hash="f".repeat(64);await expect(replayGmgnActivityRecord(changed)).rejects.toThrow("hash_mismatch");
  const forged=structuredClone(saved.activity_replay);if(forged.request.kind!=="gmgn_wallet_activity")throw Error("kind");forged.request.wallet=key(2);forged.receipt.request_hash=await hashJson(forged.request);forged.receipt_hash=await hashJson(forged.receipt);await expect(replayGmgnActivityRecord(forged)).rejects.toThrow("selection_mismatch");
  const calls=vi.spyOn(globalThis,"fetch").mockRejectedValue(Error("no source IO")),before=sqlite.prepare("SELECT total_changes() n").get();
  expect((await gmgnPublicSummary(settings.db,address,later)).wallet_activity?.buy_events).toBe(1);expect(calls).not.toHaveBeenCalled();expect(sqlite.prepare("SELECT total_changes() n").get()).toEqual(before);
  expect(await gmgnActivityTarget(settings.db,operation.request_id,later)).toMatchObject({state:"held"});
 });
 it("authenticates the cache-only target endpoint",async()=>{
  const{settings}=await setup(),calls=vi.spyOn(globalThis,"fetch").mockRejectedValue(Error("no source IO")),env={TENX_DB:settings.db,TENX_LOCAL_ONLY:"true",TENX_ADMIN_TOKEN:"a".repeat(64)} as LocalEnv;
  const path=`http://localhost/api/10x/admin/gmgn/activity-target/${id}`;expect((await worker.fetch(new Request(path),env)).status).toBe(401);
  expect((await worker.fetch(new Request(path,{headers:{authorization:`Bearer ${env.TENX_ADMIN_TOKEN}`}}),env)).status).toBe(200);expect(calls).not.toHaveBeenCalled();
 });
 it("retains only structural diagnostics for an unusable page and keeps the original validator closed",async()=>{
  const{settings,sqlite}=await setup(),target=await gmgnActivityTarget(settings.db,id,later);if(target.state!=="ready")throw Error("target");
  const marker="upstream-message-cursor-address-do-not-retain",operation=input(target.request),response={code:0,data:{data:{activities:[{...event(),symbol:marker}],next:marker},message:marker,[marker]:marker}};
  expect(await runGmgnReview(settings,operation,async()=>Response.json(response),()=>later)).toMatchObject({state:"failed",provider_requests:1});
  const row=sqlite.prepare("SELECT receipt FROM tenx_source_reservations WHERE id=?").get(operation.request_id)!;const receipt=JSON.parse(String(row.receipt));
  expect(receipt).toMatchObject({error:"source_collection_response_unusable",response:null,access_accepted:false,semantic_validation:"not_checked",activity_validation_fields:["activities"],activity_validation_shape:{activities:"missing",activities_count:null,data:"object",data_activities:"array",data_activities_count:1,data_next:"string"}});
  expect(String(row.receipt)).not.toContain(marker);expect((await gmgnPublicSummary(settings.db,address,later)).wallet_activity_issue?.shape).toEqual(receipt.activity_validation_shape);
  expect((await gmgnSavedReview(settings.db,operation.request_id))).toMatchObject({activity_validation_shape:receipt.activity_validation_shape});
  expect(await runGmgnReview(settings,operation,async()=>{throw Error("Must not retry");},()=>later)).toMatchObject({provider_requests:0});
 });
 it("does not retain structural diagnostics on credential echoes or provider HTTP errors",async()=>{
  for(const kind of["echo","http"]){const{settings,sqlite}=await setup(),target=await gmgnActivityTarget(settings.db,id,later);if(target.state!=="ready")throw Error("target");
   const operation=input(target.request);await runGmgnReview(settings,operation,async()=>Response.json({code:0,data:{activities:null},message:kind==="echo"?settings.apiKey:"untrusted"},{status:kind==="http"?429:200}),()=>later);
   const row=sqlite.prepare("SELECT receipt FROM tenx_source_reservations WHERE id=?").get(operation.request_id)!;expect(JSON.parse(String(row.receipt)).activity_validation_shape).toBeUndefined();expect(String(row.receipt)).not.toContain(settings.apiKey);
  }
 });
 it("classifies a row-level type refinement separately from a missing array without echoing values",async()=>{
  const{settings,sqlite}=await setup(),target=await gmgnActivityTarget(settings.db,id,later);if(target.state!=="ready")throw Error("target");
  const operation=input(target.request),row={...event(),event_type:undefined,type:undefined};
  await runGmgnReview(settings,operation,async()=>Response.json({code:0,data:{activities:[row]}}),()=>later);
  const receipt=JSON.parse(String(sqlite.prepare("SELECT receipt FROM tenx_source_reservations WHERE id=?").get(operation.request_id)!.receipt));
  expect(receipt.activity_validation_shape).toMatchObject({activities:"array",activities_count:1,validation_checks:[{field:"activities",code:"custom",check:"event_type_missing_or_conflicting"}]});expect(receipt.response).toBeNull();
 });
});
