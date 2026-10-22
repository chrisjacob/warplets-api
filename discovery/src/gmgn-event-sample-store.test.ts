import{afterEach,expect,it,vi}from"vitest";
import{DatabaseSync}from"node:sqlite";
import{readFileSync,readdirSync}from"node:fs";
import{sqliteD1}from"../../app/functions/_lib/sqliteTestDb";
import{acquisitionTrade}from"./holder-acquisition-fixtures.test-helper";
import{key,signature,walletInput}from"./wallet-fixtures.test-helper";
import{gmgnActivityTarget,runGmgnReview}from"./gmgn";
import{GMGN_USE_AUTHORITY}from"./gmgn-model";
import{gmgnEventSample}from"./gmgn-event-sample-store";
import{replayGmgnEventSample}from"./gmgn-event-sample";
import{WalletTransactionSchema}from"./wallet-rpc";
import{hashJson}from"./solana";
import worker,{type LocalEnv}from"./worker";

const at=new Date("2026-10-21T09:00:00.000Z"),received=new Date(at.getTime()+20_000),now=new Date(at.getTime()+60_000);
const traderId="10000000-0000-4000-8000-000000000001",id="10000000-0000-4000-8000-000000000002";
const opened:DatabaseSync[]=[];afterEach(()=>{opened.splice(0).forEach(db=>db.close());vi.restoreAllMocks();});
async function setup(change?:(rows:Record<string,unknown>[])=>void){
  const sqlite=new DatabaseSync(":memory:");opened.push(sqlite);
  for(const f of readdirSync(new URL("../migrations/",import.meta.url)).filter(f=>f.endsWith(".sql")).sort())sqlite.exec(readFileSync(new URL(`../migrations/${f}`,import.meta.url),"utf8"));
  const db=sqliteD1(sqlite),tx=await acquisitionTrade(),address=(await walletInput()).asset.address;
  const settings={db,apiKey:"test-only",permissionReference:GMGN_USE_AUTHORITY,marketDailyLimit:600};
  const input=(request:unknown,request_id:string)=>({request,request_id,reason:"Cache-only sample fixture",mode:"retained_research"});
  await runGmgnReview(settings,input({kind:"gmgn_token_traders",address},traderId),async()=>Response.json({code:0,data:{list:[{address:key(3),addr_type:0,buy_volume_cur:100,sell_volume_cur:10}]}}),()=>at);
  const target=await gmgnActivityTarget(db,traderId,received);if(target.state!=="ready")throw Error("fixture target");
  const events:Record<string,unknown>[]=Array.from({length:50},(_,i)=>({tx_hash:i===0?tx.transaction.signatures[0]:signature(i+100),event_type:i===0?"buy":"transferIn",token:{address},timestamp:tx.blockTime,token_amount:i===0?"0.000100":i+1,cost_usd:100}));change?.(events);
  expect(await runGmgnReview(settings,input(target.request,id),async()=>Response.json({code:0,data:{activities:events,next:null}}),()=>received)).toMatchObject({state:"retained"});
  const cached=async(value=tx,fetched=now.toISOString())=>db.prepare("INSERT INTO tenx_wallet_transactions(signature,payload_hash,payload,fetched_at) VALUES(?1,?2,?3,?4)").bind(value.transaction.signatures[0],await hashJson(WalletTransactionSchema.parse(value)),JSON.stringify(value),fetched).run();
  return{db,sqlite,tx,address,cached};
}

it("replays the whole saved page and original selection, reads at most two chosen bodies and never writes or fetches",async()=>{
  const second=await acquisitionTrade("buy",72),{db,sqlite,cached}=await setup(rows=>{rows[1]!.tx_hash=second.transaction.signatures[0]!;rows[1]!.event_type="buy";rows[1]!.token_amount="0.000100";});
  await cached();await cached(second);const before=sqlite.prepare("SELECT total_changes() n").get(),prepare=vi.spyOn(db,"prepare"),fetcher=vi.spyOn(globalThis,"fetch").mockRejectedValue(Error("no source IO"));
  const saved=await gmgnEventSample(db,id,now);expect(saved!.report).toMatchObject({state:"compared_sample",page_events:50,selected_events:2,unselected_events:48,required_transactions:2,cached_transactions:2,exact_quantity_events:2,provider_requests:0,database_writes:0,live_collection_enabled:false,scoring_effect:"none"});
  expect(await replayGmgnEventSample(saved)).toEqual(saved!.report);expect(fetcher).not.toHaveBeenCalled();expect(sqlite.prepare("SELECT total_changes() n").get()).toEqual(before);
  expect(prepare.mock.calls.filter(([sql])=>sql.includes("FROM tenx_wallet_transactions"))).toHaveLength(2);
});
it("keeps absent and future cache bodies unknown and never searches for replacement transactions",async()=>{
  const{db,cached}=await setup();await cached(undefined,"2026-10-21T09:02:00.000Z");
  const saved=await gmgnEventSample(db,id,now);expect(saved!.inputs.transactions).toEqual([]);expect(saved!.report).toMatchObject({state:"cache_missing",page_events:50,unselected_events:49,required_transactions:1,cached_transactions:0,exact_quantity_events:0,groups:[{status:"cache_missing"}]});
});
it.each(["too_many_events","no_trades"])("skips all RPC cache reads for a %s held plan",async(reason)=>{
  const{db}=await setup(rows=>{if(reason==="no_trades")rows[0]!.event_type="transferIn";else for(let i=1;i<25;i++)rows[i]!.tx_hash=rows[0]!.tx_hash;});
  const prepare=vi.spyOn(db,"prepare"),saved=await gmgnEventSample(db,id,now);
  expect(saved!.report).toMatchObject({state:"held",cached_transactions:0,exact_quantity_events:0,groups:[]});expect(prepare.mock.calls.some(([sql])=>sql.includes("tenx_wallet_transactions"))).toBe(false);
});
it.each(["hash","invalid_json","oversized"])("withholds a %s cache body without returning partial support",async(reason)=>{
  const{db,cached}=await setup();await cached();
  if(reason==="hash")await db.prepare("UPDATE tenx_wallet_transactions SET payload_hash=?1").bind("f".repeat(64)).run();
  else await db.prepare("UPDATE tenx_wallet_transactions SET payload=?1").bind(reason==="oversized"?"!".repeat(1_800_001):"invalid").run();
  await expect(gmgnEventSample(db,id,now)).rejects.toThrow(reason==="hash"?"hash_mismatch":reason==="oversized"?"cache_bytes":undefined);
});
it("serves only a sanitized report under the local gate; failures are fixed, GET-only and read-only",async()=>{
  const{db,sqlite,tx,address,cached}=await setup();await cached();const before=sqlite.prepare("SELECT total_changes() n").get(),fetcher=vi.spyOn(globalThis,"fetch").mockRejectedValue(Error("no source IO"));
  const env={TENX_DB:db,TENX_LOCAL_ONLY:"true"}as LocalEnv,path=`http://localhost/api/10x/gmgn/event-sample/${id}`;
  const response=await worker.fetch(new Request(path),env);expect(response.status).toBe(200);const report=await response.json();expect(report).toMatchObject({address,page_events:50,exact_quantity_events:1});
  for(const privateValue of[tx.transaction.signatures[0]!,key(3),"activity_record","event_indices","selection_record","token_amount"])expect(JSON.stringify(report)).not.toContain(privateValue);
  expect((await worker.fetch(new Request(path,{method:"POST"}),env)).status).toBe(404);
  expect((await worker.fetch(new Request(path),{...env,TENX_LOCAL_ONLY:"false"})).status).toBe(503);
  expect((await worker.fetch(new Request(path.replace("localhost","public.example")),env)).status).toBe(503);
  expect((await worker.fetch(new Request(path.replace(id,"ffffffff-ffff-4fff-8fff-ffffffffffff")),env)).status).toBe(404);
  expect((await worker.fetch(new Request(path.replace(id,"------------------------------------")),env)).status).toBe(400);
  expect(sqlite.prepare("SELECT total_changes() n").get()).toEqual(before);expect(fetcher).not.toHaveBeenCalled();
  await db.prepare("UPDATE tenx_wallet_transactions SET payload=?1").bind("private invalid cache text").run();
  const failure=await worker.fetch(new Request(path),env);expect(failure.status).toBe(503);expect(await failure.json()).toEqual({error:"gmgn_event_sample_unavailable"});
});
it("does not reinterpret a trader receipt, pending or missing activity as a research sample",async()=>{
  const{db}=await setup();expect(await gmgnEventSample(db,traderId,now)).toBeNull();expect(await gmgnEventSample(db,"ffffffff-ffff-4fff-8fff-ffffffffffff",now)).toBeNull();
  await db.prepare("UPDATE tenx_source_reservations SET state='fetching',receipt=NULL,receipt_hash=NULL WHERE id=?1").bind(id).run();expect(await gmgnEventSample(db,id,now)).toBeNull();
});
it("keeps legacy accepted activity separate from the fifty-event contract",async()=>{
  const{db}=await setup(),row=await db.prepare("SELECT receipt FROM tenx_source_reservations WHERE id=?1").bind(id).first<{receipt:string}>(),receipt=JSON.parse(row!.receipt);
  receipt.semantic_validation="gmgn_selected_fields_v2";receipt.response.data.activities=receipt.response.data.activities.slice(0,1);receipt.response_hash=await hashJson(receipt.response);
  const payload=JSON.stringify(receipt);await db.prepare("UPDATE tenx_source_reservations SET receipt=?1,receipt_hash=?2,bytes=?3 WHERE id=?4").bind(payload,await hashJson(receipt),new TextEncoder().encode(payload).length,id).run();
  expect(await gmgnEventSample(db,id,now)).toBeNull();
});
it("rejects an altered original selection before reading cached transaction bodies",async()=>{
  const{db}=await setup();await db.prepare("UPDATE tenx_source_reservations SET receipt_hash=?1 WHERE id=?2").bind("f".repeat(64),traderId).run();
  const prepare=vi.spyOn(db,"prepare");await expect(gmgnEventSample(db,id,now)).rejects.toThrow("receipt_mismatch");expect(prepare.mock.calls.some(([sql])=>sql.includes("tenx_wallet_transactions"))).toBe(false);
});
