import{z}from"zod";
import{Signature}from"./model";
import{replayGmgnActivityRecord}from"./gmgn-activity-replay";
import{WalletTransactionSchema}from"./wallet-rpc";
import{compareGmgnEventGroups}from"./gmgn-event-comparison";
import{hashJson}from"./solana";
import{boundedJsonValue}from"./source-pilot";
import{GmgnCorroborationInputSchema,GmgnCorroborationReportSchema,GMGN_CORROBORATION_BYTES,GMGN_CORROBORATION_CACHE_BYTES}from"./gmgn-corroboration-model";
export * from "./gmgn-corroboration-model";
const Time=z.string().datetime();
export async function activityForCorroboration(raw:unknown){
  const verified=await replayGmgnActivityRecord(raw);
  // The complete research page has its own contract. Do not expand the
  // original 20-event/two-signature RPC comparison or silently slice its input.
  if(z.object({version:z.string()}).parse(verified.observation.metrics).version!=="gmgn-wallet-activity-v1")throw Error("gmgn_rpc_research_page_comparison_held");
  const record=z.object({request:z.object({address:z.string(),wallet:z.string()}),receipt:z.object({received_at:Time,response:z.object({data:z.object({activities:z.array(z.object({tx_hash:Signature,event_type:z.string().optional(),type:z.string().optional(),timestamp:z.union([z.number(),z.string().transform(Number)]).nullable().optional(),token_amount:z.unknown()}).passthrough()).max(20)})})})}).parse(raw);
  return{...record,report_hash:verified.report_hash,signatures:[...new Set(record.receipt.response.data.activities.map(row=>row.tx_hash))].sort()};
}
export async function reviewGmgnCorroboration(raw:unknown){
  boundedJsonValue(raw,GMGN_CORROBORATION_BYTES);const input=GmgnCorroborationInputSchema.parse(raw),source=await activityForCorroboration(input.activity_record),cutoff=Date.parse(input.cutoff_at);
  if(Date.parse(source.receipt.received_at)>cutoff)throw Error("gmgn_rpc_source_from_future");
  if(new Set(input.transactions.map(row=>row.signature)).size!==input.transactions.length)throw Error("gmgn_rpc_duplicate_cache_entry");
  const cache=new Map<string,z.infer<typeof WalletTransactionSchema>>();let bytes=0;
  for(const row of input.transactions){
    if(!source.signatures.includes(row.signature)||Date.parse(row.fetched_at)>cutoff)throw Error("gmgn_rpc_cache_scope_or_time");
    bytes+=new TextEncoder().encode(JSON.stringify(row.transaction)).length;if(bytes>GMGN_CORROBORATION_CACHE_BYTES)throw Error("gmgn_rpc_cache_bytes");
    const tx=WalletTransactionSchema.parse(row.transaction);
    if(await hashJson(row.transaction)!==row.raw_hash||await hashJson(tx)!==row.payload_hash||tx.transaction.signatures[0]!==row.signature)throw Error("gmgn_rpc_cache_hash_mismatch");
    if(tx.blockTime===null||tx.blockTime*1000>Date.parse(row.fetched_at))throw Error("gmgn_rpc_transaction_time");cache.set(row.signature,tx);
  }
  const held=source.signatures.length>2,gaps=["rpc_body_not_independent_finality_attestation","usd_valuation_unverified","population_trade_coverage_unknown","later_evidence_does_not_enrich_archived_scores"];
  if(held)gaps.push("two_signature_bound_exceeded");if(!cache.size)gaps.push("matching_rpc_bodies_missing");
  const events=source.receipt.response.data.activities,tradeEvents=events.filter(row=>["buy","sell"].includes(row.event_type??row.type??""));
  const {groups,exact,aggregate}=await compareGmgnEventGroups({events,address:source.request.address,wallet:source.request.wallet,cache,held});
  const report={version:"gmgn-rpc-comparison-v1" as const,address:source.request.address,cutoff_at:input.cutoff_at,activity_received_at:source.receipt.received_at,activity_report_hash:source.report_hash,status:held?"held":"compared_sample",required_transactions:source.signatures.length,cached_transactions:cache.size,reported_trade_events:tradeEvents.length,non_trade_events:events.length-tradeEvents.length,exact_quantity_events:exact,aggregate_only_events:aggregate,groups,gaps,finality_independently_attested:false,usd_volume_verified:false,organic_volume_usd:null,scoring_effect:"none",evidence_gates_changed:false,provider_requests:0,database_writes:0,input_hash:await hashJson(input)};
  const identified={...report,activity_id:input.activity_id};return GmgnCorroborationReportSchema.parse({...identified,report_hash:await hashJson(identified)});
}
export async function replayGmgnCorroboration(raw:unknown){
  boundedJsonValue(raw,GMGN_CORROBORATION_BYTES+100_000);const record=z.object({inputs:GmgnCorroborationInputSchema,report:GmgnCorroborationReportSchema}).strict().parse(raw),report=await reviewGmgnCorroboration(record.inputs);
  if(await hashJson(report)!==await hashJson(record.report))throw Error("gmgn_rpc_report_mismatch");return report;
}
