import{afterEach,expect,it,vi}from"vitest";
import{key,signature,walletInput}from"./wallet-fixtures.test-helper";
import{acquisitionTrade}from"./holder-acquisition-fixtures.test-helper";
import{normalizeGmgn}from"./gmgn-normalize";
import{GMGN_USE_AUTHORITY}from"./gmgn-model";
import{GMGN_ACTIVITY_RESEARCH_VALIDATION}from"./gmgn-wallet-activity";
import{hashJson}from"./solana";
import{WalletTransactionSchema}from"./wallet-rpc";
import{planGmgnEventSample,reviewGmgnEventSample,replayGmgnEventSample}from"./gmgn-event-sample";
import{reviewGmgnCorroboration}from"./gmgn-corroboration";

const traderId="10000000-0000-4000-8000-000000000001",activityId="10000000-0000-4000-8000-000000000002",at="2026-10-21T09:00:00.000Z",received="2026-10-21T09:00:20.000Z",cutoff="2026-10-21T09:01:00.000Z";
type Event={tx_hash:string;token:{address:string};event_type:string;token_amount:unknown;cost_usd:number;timestamp:number};
afterEach(()=>vi.restoreAllMocks());
async function fixture(change?:(events:Event[])=>void,legacy=false){
 const tx=await acquisitionTrade(),address=(await walletInput()).asset.address,wallet=key(3),request={kind:"gmgn_token_traders",address};
 const receipt=async(req:unknown,response:unknown,time:string,validation="gmgn_selected_fields_v2")=>({version:"source-fetch-receipt-v1",request_hash:await hashJson(req),response_hash:await hashJson(response),reserved_at:time,received_at:time,status:200,error:null,response,access_probe:false,access_accepted:true,research_permission_reference:GMGN_USE_AUTHORITY,semantic_validation:validation,canonical_pool_proof:"not_checked",scoring_effect:"none"});
 const traderReceipt=await receipt(request,{code:0,data:{list:[{address:wallet,addr_type:0,buy_volume_cur:100,sell_volume_cur:10}]}},at),selection={version:"gmgn-trader-replay-v1",request,receipt:traderReceipt,receipt_hash:await hashJson(traderReceipt),report_hash:await hashJson(normalizeGmgn(request,traderReceipt.response,at))};
 const activityRequest={kind:"gmgn_wallet_activity",address,wallet,selection_id:traderId,selection_hash:selection.receipt_hash};
 const events:Event[]=Array.from({length:legacy?1:50},(_,i)=>({tx_hash:i===0?tx.transaction.signatures[0]!:signature(i+100),token:{address},event_type:i===0?"buy":"transferIn",token_amount:i===0?"0.000100":i+1,cost_usd:100,timestamp:tx.blockTime!}));change?.(events);
 const activityReceipt=await receipt(activityRequest,{code:0,data:{activities:events,next:"opaque"}},received,legacy?"gmgn_selected_fields_v2":GMGN_ACTIVITY_RESEARCH_VALIDATION);
 const activityRecord={version:"gmgn-wallet-activity-replay-v1",request:activityRequest,receipt:activityReceipt,receipt_hash:await hashJson(activityReceipt),report_hash:await hashJson(normalizeGmgn(activityRequest,activityReceipt.response,received,undefined,undefined,"v2",legacy?"v1":"v2")),selection_record:selection};
 const transaction=async(value=tx)=>({signature:value.transaction.signatures[0]!,payload_hash:await hashJson(WalletTransactionSchema.parse(value)),raw_hash:await hashJson(value),fetched_at:cutoff,transaction:value});
 return{activityRecord,events,tx,transaction,address};
}
async function inputs(record:unknown,transactions:unknown[]=[]) {return{version:"gmgn-event-sample-input-v1",activity_id:activityId,activity_record:record,cutoff_at:cutoff,plan:await planGmgnEventSample(activityId,record,cutoff),transactions};}

it("plans against the complete page and preserves all selected signature events including non-trades",async()=>{
 const{activityRecord,events}=await fixture(rows=>{rows[0]!.event_type="buy";rows[49]!.tx_hash=rows[0]!.tx_hash;rows[49]!.event_type="sell";rows[48]!.tx_hash=rows[0]!.tx_hash;});
 const plan=await planGmgnEventSample(activityId,activityRecord,cutoff);expect(plan).toMatchObject({page_events:50,page_transactions:48,page_trade_events:2,selected_events:3,selected_trade_events:2,unselected_events:47,selected:[{signature:events[0]!.tx_hash,event_indices:[0,48,49],reason:"two_sided"}],state:"ready",representative_sample:false,live_collection_enabled:false,provider_requests:0});
 expect(await planGmgnEventSample(activityId,structuredClone(activityRecord),cutoff)).toEqual(plan);
});
it("ranks repeated same-side quantities before signature order with deterministic lexical ties",async()=>{
 const{activityRecord,events}=await fixture(rows=>{for(let i=0;i<5;i++){rows[i]!.event_type="buy";rows[i]!.token_amount=i<2?10:i+20;}}),plan=await planGmgnEventSample(activityId,activityRecord,cutoff);
 expect(plan.selected.map(s=>s.signature)).toEqual([events[0]!.tx_hash,events[1]!.tx_hash].sort());expect(plan.selected.every(s=>s.reason==="repeated_same_side_size")).toBe(true);expect(plan.selected_events).toBe(2);
});
it("holds the whole chosen sample above twenty events without substituting smaller transactions",async()=>{
 const{activityRecord,transaction}=await fixture(rows=>{for(let i=1;i<25;i++)rows[i]!.tx_hash=rows[0]!.tx_hash;rows[24]!.event_type="sell";rows[49]!.event_type="buy";});
 const input=await inputs(activityRecord);expect(input.plan).toMatchObject({state:"held",hold_reason:"selected_event_bound_exceeded",selected_events:26});
 expect(await reviewGmgnEventSample(input)).toMatchObject({state:"held",page_events:50,selected_events:26,groups:[],exact_quantity_events:0,provider_requests:0,database_writes:0});
 await expect(reviewGmgnEventSample({...input,transactions:[await transaction()]})).rejects.toThrow("held_with_cache");
});
it("holds a page without trade transactions and cannot turn missing bodies into matched quantities",async()=>{
 const noTrades=await fixture(rows=>{rows[0]!.event_type="transferIn";});expect(await reviewGmgnEventSample(await inputs(noTrades.activityRecord))).toMatchObject({state:"held",required_transactions:0,groups:[]});
 const source=await fixture();expect(await reviewGmgnEventSample(await inputs(source.activityRecord))).toMatchObject({state:"cache_missing",required_transactions:1,cached_transactions:0,exact_quantity_events:0,groups:[{status:"cache_missing"}]});
});
it("compares exact selected quantities and replays without IO while leaving the unselected page unverified",async()=>{
 const source=await fixture(),input=await inputs(source.activityRecord,[await source.transaction()]),fetcher=vi.spyOn(globalThis,"fetch").mockRejectedValue(Error("No source IO")),report=await reviewGmgnEventSample(input);
 expect(report).toMatchObject({state:"compared_sample",page_events:50,selected_events:1,unselected_events:49,exact_quantity_events:1,organic_volume_usd:null,usd_volume_verified:false,finality_independently_attested:false,representative_sample:false,live_collection_enabled:false,provider_requests:0,database_writes:0,scoring_effect:"none"});
 expect(report.gaps).toContain("unselected_events_not_compared");expect(await replayGmgnEventSample({inputs:input,report})).toEqual(report);expect(fetcher).not.toHaveBeenCalled();
 await expect(replayGmgnEventSample({inputs:input,report:{...report,exact_quantity_events:0}})).rejects.toThrow("report_mismatch");
});
it("uses no more than two cached transactions and retains aggregate-only matching as weaker evidence",async()=>{
 const second=await acquisitionTrade("buy",72),source=await fixture(rows=>{rows[1]!.tx_hash=second.transaction.signatures[0]!;rows[1]!.event_type="buy";rows[1]!.token_amount="0.000100";});
 const cache=[await source.transaction(),await source.transaction(second)],input=await inputs(source.activityRecord,cache);
 expect(await reviewGmgnEventSample(input)).toMatchObject({required_transactions:2,cached_transactions:2,selected_events:2,exact_quantity_events:2});
 await expect(reviewGmgnEventSample({...input,transactions:[...cache,cache[0]]})).rejects.toThrow();
 const aggregate=await fixture(rows=>{rows[0]!.token_amount="0.000060";rows[1]!.tx_hash=rows[0]!.tx_hash;rows[1]!.event_type="buy";rows[1]!.token_amount="0.000040";});
 expect(await reviewGmgnEventSample(await inputs(aggregate.activityRecord,[await aggregate.transaction()]))).toMatchObject({exact_quantity_events:0,aggregate_only_events:2,selected_events:2});
});
it.each(["quantity","time","failed","signer","numeric_fraction"])("holds %s rather than manufacturing a selected match",async kind=>{
 const source=await fixture(rows=>{if(kind==="quantity")rows[0]!.token_amount="0.000101";if(kind==="time")rows[0]!.timestamp++;if(kind==="numeric_fraction")rows[0]!.token_amount=.0001;});
 if(kind==="failed")source.tx.meta!.err={InstructionError:[0,"Custom"]};if(kind==="signer")source.tx.transaction.message.header.numRequiredSignatures=2;
 const report=await reviewGmgnEventSample(await inputs(source.activityRecord,[await source.transaction()]));expect(report.exact_quantity_events).toBe(0);expect(report.groups[0]!.status).not.toBe("exact_instruction_quantities");
});
it("rejects modified plans, forged source selection and future source cutoffs",async()=>{
 const source=await fixture(),input=await inputs(source.activityRecord),changed=structuredClone(input);changed.plan.selected[0]!.event_indices=[49];const{plan_hash:_,...body}=changed.plan;changed.plan.plan_hash=await hashJson(body);await expect(reviewGmgnEventSample(changed)).rejects.toThrow("plan_mismatch");
 const forged=structuredClone(source.activityRecord);forged.selection_record.receipt_hash="f".repeat(64);await expect(planGmgnEventSample(activityId,forged,cutoff)).rejects.toThrow();
 await expect(planGmgnEventSample(activityId,source.activityRecord,at)).rejects.toThrow("source_from_future");
});
it("rejects unrelated, duplicate, forged and future RPC bodies",async()=>{
 const source=await fixture(),record=await source.transaction(),input=await inputs(source.activityRecord,[record]);
 await expect(reviewGmgnEventSample({...input,transactions:[record,record]})).rejects.toThrow("duplicate_cache");
 await expect(reviewGmgnEventSample({...input,transactions:[{...record,signature:source.events[49]!.tx_hash}]})).rejects.toThrow("scope_or_time");
 await expect(reviewGmgnEventSample({...input,transactions:[{...record,raw_hash:"f".repeat(64)}]})).rejects.toThrow("hash_mismatch");
 await expect(reviewGmgnEventSample({...input,transactions:[{...record,fetched_at:"2026-10-22T00:00:00.000Z"}]})).rejects.toThrow("scope_or_time");
 await expect(reviewGmgnEventSample({...input,transactions:[{...record,transaction:{...record.transaction,padding:"x".repeat(1_800_001)}}]})).rejects.toThrow("cache_bytes");
 const future=structuredClone(source.tx);future.blockTime=Date.parse(cutoff)/1000+1;await expect(reviewGmgnEventSample({...input,transactions:[await source.transaction(future)]})).rejects.toThrow("transaction_time");
});
it("keeps the legacy replay/comparison contracts separate",async()=>{
 const legacy=await fixture(undefined,true);await expect(planGmgnEventSample(activityId,legacy.activityRecord,cutoff)).rejects.toThrow();
 const report=await reviewGmgnCorroboration({version:"gmgn-rpc-input-v1",activity_id:activityId,activity_record:legacy.activityRecord,cutoff_at:cutoff,transactions:[await legacy.transaction()]});expect(report).toMatchObject({version:"gmgn-rpc-comparison-v1",exact_quantity_events:1,report_hash:"7c833b4721301111c2f9e9a6d02ba7a345866c3982d1b9006c6248d78072209f"});
});
