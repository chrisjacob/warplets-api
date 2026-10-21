import{afterEach,describe,expect,it,vi}from"vitest";
import{DatabaseSync}from"node:sqlite";
import{readFileSync,readdirSync}from"node:fs";
import{sqliteD1}from"../../app/functions/_lib/sqliteTestDb";
import recorded from"../fixtures/recorded/trading-fees.json";
import temporary from"../fixtures/recorded/temporary-wsol-trade.json";
import{WalletTransactionSchema,type WalletTransaction}from"./wallet-rpc";
import{verifiedTrades}from"./wallet-trades";
import{gmgnActivityTarget,runGmgnReview}from"./gmgn";
import{GMGN_USE_AUTHORITY}from"./gmgn-model";
import{gmgnCorroboration}from"./gmgn-corroboration-store";
import{gmgnQuote}from"./gmgn-quote-store";
import{reviewGmgnQuote,replayGmgnQuote}from"./gmgn-quote";
import{reviewGmgnCorroboration}from"./gmgn-corroboration";
import{hashJson,toBase58,fromBase58}from"./solana";
import{tradingFeesForTransaction,decodeFeeEvent}from"./trading-fees";
import{instructions}from"./pump";
import{acquisitionTrade}from"./holder-acquisition-fixtures.test-helper";
import{signature,walletInput}from"./wallet-fixtures.test-helper";
import worker,{type LocalEnv}from"./worker";
const traderId="10000000-0000-4000-8000-000000000001",id="10000000-0000-4000-8000-000000000002",opened:DatabaseSync[]=[];
afterEach(()=>{opened.splice(0).forEach(db=>db.close());vi.restoreAllMocks();});
async function setup(tx:WalletTransaction=WalletTransactionSchema.parse(recorded.samples[0]!.transaction),mint=recorded.mint,pool=recorded.pool,change?:(events:Record<string,unknown>[])=>void){
 const sqlite=new DatabaseSync(":memory:");opened.push(sqlite);for(const f of readdirSync(new URL("../migrations/",import.meta.url)).filter(f=>f.endsWith(".sql")).sort())sqlite.exec(readFileSync(new URL(`../migrations/${f}`,import.meta.url),"utf8"));
 const db=sqliteD1(sqlite),trades=(await verifiedTrades(tx,mint,pool,{temporaryWsol:true})).trades,wallet=trades[0]!.wallet,at=new Date(tx.blockTime!*1000+60_000),later=new Date(at.getTime()+20_000),now=new Date(at.getTime()+60_000);
 const decimals=tx.meta!.postTokenBalances.find(b=>b.mint===mint)!.uiTokenAmount.decimals;
 const decimal=(raw:string)=>{const text=raw.padStart(decimals+1,"0");return decimals?text.slice(0,-decimals)+"."+text.slice(-decimals):text;};
 const events:Record<string,unknown>[]=trades.filter(t=>t.wallet===wallet).map(t=>({tx_hash:t.signature,event_type:t.side,token:{address:mint},timestamp:tx.blockTime,token_amount:decimal(t.base_amount_raw),cost_usd:100}));change?.(events);
 const settings={db,apiKey:"test-only",permissionReference:GMGN_USE_AUTHORITY,marketDailyLimit:600},operation=(request:unknown,request_id:string)=>({request,request_id,reason:"Quote review test fixture",mode:"retained_research"});
 await runGmgnReview(settings,operation({kind:"gmgn_token_traders",address:mint},traderId),async()=>Response.json({code:0,data:{list:[{address:wallet,addr_type:0,buy_volume_cur:100,sell_volume_cur:0}]}}),()=>at);
 const target=await gmgnActivityTarget(db,traderId,later);if(target.state!=="ready")throw Error("fixture target");
 expect(await runGmgnReview(settings,operation(target.request,id),async()=>Response.json({code:0,data:{activities:events,next:null}}),()=>later)).toMatchObject({state:"retained"});
 await db.prepare("INSERT INTO tenx_wallet_transactions(signature,payload_hash,payload,fetched_at) VALUES(?1,?2,?3,?4)").bind(tx.transaction.signatures[0],await hashJson(tx),JSON.stringify(tx),now.toISOString()).run();
 return{db,sqlite,tx,now,comparison:(await gmgnCorroboration(db,id,now))!};
}
describe("saved GMGN quote and fee basis",()=>{
 it.each(recorded.samples)("preserves partial recorded $expected.side fee evidence without double-counting protocol buyback",async(sample)=>{
  const{comparison}=await setup(WalletTransactionSchema.parse(sample.transaction)),report=await reviewGmgnQuote(comparison),g=report.groups[0]!,fee=sample.expected;
  expect(g.fee_status).toBe("partial");expect(g.known_fee_raw).toBe(fee.total_fee_raw);expect(g.event_quote_raw).toBe(fee.quote_amount_raw);expect(g.wallet_swap_cashflow_raw).toBeNull();
  expect(report).toMatchObject({supported_events:1,historical_usd_verified:false,organic_volume_usd:null,scoring_effect:"none"});expect(report[fee.side==="buy"?"sell_pool_quote_transfer_raw":"buy_pool_quote_transfer_raw"]).toBeNull();
 });
 it.each(["buy","sell"])("derives %s swap cash flow only for a synthetic complete known-layout fixture",async(side)=>{
  // These modified test bodies are synthetic, never retained as live evidence.
  const tx=WalletTransactionSchema.parse(side==="buy"?temporary.transaction:recorded.samples[1]!.transaction),mint=side==="buy"?temporary.mint:recorded.mint,pool=side==="buy"?temporary.pool:recorded.pool;
  const original=(await tradingFeesForTransaction(tx,mint,pool)).rows[0]!,event=instructions(tx).find(ix=>ix.path===original.event_instruction_index)!,raw=tx.meta!.innerInstructions!.find(g=>g.index===event.top)!.instructions[event.inner!]!,bytes=fromBase58(raw.data),trailing=decodeFeeEvent(event).trailing;expect(trailing).toBeGreaterThan(0);raw.data=toBase58(bytes.slice(0,bytes.length-trailing));
  const{comparison}=await setup(tx,mint,pool),g=(await reviewGmgnQuote(comparison)).groups[0]!;expect(g.fee_status).toBe("known_layout_complete");expect(g.wallet_swap_cashflow_raw).toBe((side==="buy"?BigInt(original.quote_amount_raw)+BigInt(original.total_fee_raw):BigInt(original.quote_amount_raw)-BigInt(original.total_fee_raw)).toString());
 });
 it("retains known components but withholds wallet cash flow for unknown event extensions",async()=>{
  const{comparison}=await setup(WalletTransactionSchema.parse(temporary.transaction),temporary.mint,temporary.pool),report=await reviewGmgnQuote(comparison);
  expect(report.groups[0]).toMatchObject({fee_status:"partial",event_quote_raw:"223180524",known_fee_raw:"669544",wallet_swap_cashflow_raw:null});expect(report.groups[0]!.gaps).toContain("fee_event_extension_uninterpreted");
 });
 it.each([null,"bad",-100,"-100"])("holds missing, unusable and signed USD %s while retaining token/quote evidence",async(cost)=>{
  const{comparison}=await setup(undefined,undefined,undefined,events=>{events[0]!.cost_usd=cost;});const report=await reviewGmgnQuote(comparison);expect(report.supported_events).toBe(1);expect(report.groups[0]).toMatchObject({reported_usd:null,implied_usd_per_sol:null});
 });
 it("preserves explicit measured zero USD without treating it as a clean price",async()=>{
  const{comparison}=await setup(undefined,undefined,undefined,events=>{events[0]!.cost_usd=0;});expect((await reviewGmgnQuote(comparison)).groups[0]).toMatchObject({reported_usd:0,implied_usd_per_sol:0});
 });
 it("aggregates provider split events once against one instruction and its fees",async()=>{
  const{comparison}=await setup(undefined,undefined,undefined,events=>{const original=events[0]!,text=String(original.token_amount),[a,b=""]=text.split("."),scale=10n**BigInt(b.length),raw=BigInt(a!)*scale+BigInt(b||"0"),half=raw/2n,format=(n:bigint)=>(n/scale).toString()+"."+(n%scale).toString().padStart(b.length,"0");original.token_amount=format(half);original.cost_usd=40;events.push({...original,token_amount:format(raw-half),cost_usd:60});});
  const report=await reviewGmgnQuote(comparison);expect(report.groups[0]).toMatchObject({events:2,token_match:"aggregate_quantity_only",fee_rows:1,reported_usd:100});expect(report.supported_events).toBe(2);expect(report.groups[0]!.known_fee_raw).toBe(recorded.samples[0]!.expected.total_fee_raw);
 });
 it("withholds all side totals when one same-side source signature is missing",async()=>{
  const{comparison}=await setup(undefined,undefined,undefined,events=>{events.push({...events[0],tx_hash:signature(90)});});const report=await reviewGmgnQuote(comparison);expect(report.buy_pool_quote_transfer_raw).toBeNull();expect(report.supported_events).toBe(1);expect(report.groups[1]!.pool_quote_transfer_raw).toBeNull();
 });
 it("does not use token/time conflicts or unsupported source bounds as quote evidence",async()=>{
  for(const reason of["quantity","time","bound"]){const{comparison}=await setup(undefined,undefined,undefined,events=>{if(reason==="quantity")events[0]!.token_amount="1";if(reason==="time")events[0]!.timestamp=Number(events[0]!.timestamp)+1;if(reason==="bound")events.push({...events[0],tx_hash:signature(90)},{...events[0],tx_hash:signature(91)});});const report=await reviewGmgnQuote(comparison);expect(report.supported_events).toBe(0);expect(report.buy_pool_quote_transfer_raw).toBeNull();}
 });
 it("keeps missing quote transfers and unsupported fee layouts unknown",async()=>{
  const tx=await acquisitionTrade(),w=await walletInput();const system=tx.transaction.message.accountKeys.indexOf("11111111111111111111111111111111");tx.meta!.innerInstructions![0]!.instructions=tx.meta!.innerInstructions![0]!.instructions.filter(ix=>ix.programIdIndex!==system);
  const{comparison}=await setup(tx,w.asset.address,w.asset.pool),report=await reviewGmgnQuote(comparison);expect(report.groups[0]).toMatchObject({pool_quote_transfer_raw:null,fee_status:"unavailable",wallet_swap_cashflow_raw:null});expect(report.buy_pool_quote_transfer_raw).toBeNull();
 });
 it("isolates fee-event corruption from independently parsed pool transfers",async()=>{
  const tx=WalletTransactionSchema.parse(temporary.transaction),event=tx.meta!.innerInstructions!.find(g=>g.index===6)!.instructions.find(ix=>fromBase58(ix.data).length>200)!;const bytes=fromBase58(event.data);bytes[16]!^=1;event.data=toBase58(bytes);
  const{comparison}=await setup(tx,temporary.mint,temporary.pool),report=await reviewGmgnQuote(comparison);expect(report.supported_events).toBe(1);expect(report.groups[0]).toMatchObject({fee_status:"unavailable",known_fee_raw:null,wallet_swap_cashflow_raw:null});
 });
 it("fully replays sources, transaction hashes and new reports, rejecting tampering",async()=>{
  const{comparison}=await setup(),report=await reviewGmgnQuote(comparison),record={version:"gmgn-quote-replay-v1",comparison,report};expect(await replayGmgnQuote(record)).toEqual(report);
  const changed=structuredClone(record);changed.report.groups[0]!.known_fee_raw="0";await expect(replayGmgnQuote(changed)).rejects.toThrow("report_mismatch");const forged=structuredClone(record);forged.comparison.inputs.transactions[0]!.payload_hash="f".repeat(64);await expect(replayGmgnQuote(forged)).rejects.toThrow("hash_mismatch");const prior=await reviewGmgnCorroboration(comparison.inputs);expect(prior).toEqual(comparison.report);
 });
 it("exposes read-only public aggregates and authenticated complete replay without IO or writes",async()=>{
  const{db,sqlite,now}=await setup(),calls=vi.spyOn(globalThis,"fetch").mockRejectedValue(Error("no IO")),before=sqlite.prepare("SELECT total_changes() n").get();const saved=await gmgnQuote(db,id,now);expect(await replayGmgnQuote(saved)).toEqual(saved!.report);
  const env={TENX_DB:db,TENX_LOCAL_ONLY:"true",TENX_ADMIN_TOKEN:"a".repeat(64)}as LocalEnv,path=`http://localhost/api/10x/gmgn/quote/${id}`,publicReply=await worker.fetch(new Request(path),env);expect(publicReply.status).toBe(200);const publicBody=JSON.stringify(await publicReply.json());expect(publicBody).not.toContain(recorded.samples[0]!.transaction.transaction.signatures[0]);expect(publicBody).not.toContain('"comparison":');
  const privatePath=path.replace("/10x/","/10x/admin/");expect((await worker.fetch(new Request(privatePath),env)).status).toBe(401);const response=await worker.fetch(new Request(privatePath,{headers:{authorization:`Bearer ${env.TENX_ADMIN_TOKEN}`}}),env);expect(response.status).toBe(200);await replayGmgnQuote(await response.json());expect(calls).not.toHaveBeenCalled();expect(sqlite.prepare("SELECT total_changes() n").get()).toEqual(before);
 });
});
