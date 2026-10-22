import {z} from "zod";
import {Address,Signature} from "./model";
import {replayGmgnActivityRecord} from "./gmgn-activity-replay";
import {GmgnWalletActivityResearchSchema,GMGN_ACTIVITY_RESEARCH_VALIDATION} from "./gmgn-wallet-activity";
import {GmgnComparisonEvent,compareGmgnEventGroups} from "./gmgn-event-comparison";
import {GmgnCorroborationInputSchema,GmgnCorroborationReportSchema,GMGN_CORROBORATION_BYTES,GMGN_CORROBORATION_CACHE_BYTES} from "./gmgn-corroboration-model";
import {WalletTransactionSchema} from "./wallet-rpc";
import {boundedJsonValue} from "./source-pilot";
import {hashJson} from "./solana";

const Hash=z.string().regex(/^[a-f0-9]{64}$/),Time=z.string().datetime(),Count=z.number().int().min(0).max(50);
export const GmgnEventSamplePlanSchema=z.object({version:z.literal("gmgn-event-sample-plan-v1"),activity_id:z.uuid(),cutoff_at:Time,
  activity_received_at:Time,source_receipt_hash:Hash,source_report_hash:Hash,
  selection:z.literal("two_sided_then_repeated_same_side_size_then_signature"),
  selected:z.array(z.object({signature:Signature,event_indices:z.array(z.number().int().min(0).max(49)).min(1).max(50),reason:z.enum(["two_sided","repeated_same_side_size","signature_order"])}).strict()).max(2),
  page_events:Count,page_transactions:Count,page_trade_events:Count,selected_events:Count,selected_trade_events:Count,unselected_events:Count,unselected_trade_events:Count,
  state:z.enum(["ready","held"]),hold_reason:z.enum(["selected_event_bound_exceeded","no_trade_transactions"]).nullable(),
  representative_sample:z.literal(false),live_collection_enabled:z.literal(false),provider_requests:z.literal(0),database_writes:z.literal(0),scoring_effect:z.literal("none"),plan_hash:Hash}).strict();
export const GmgnEventSampleInputSchema=GmgnCorroborationInputSchema.extend({version:z.literal("gmgn-event-sample-input-v1"),plan:GmgnEventSamplePlanSchema});
const SampleReport=z.object({version:z.literal("gmgn-event-sample-comparison-v1"),activity_id:z.uuid(),address:Address,cutoff_at:Time,
  source_report_hash:Hash,plan_hash:Hash,state:z.enum(["held","cache_missing","compared_sample"]),page_events:Count,selected_events:Count,selected_trade_events:Count,unselected_events:Count,unselected_trade_events:Count,
  required_transactions:z.number().int().min(0).max(2),cached_transactions:z.number().int().min(0).max(2),
  exact_quantity_events:z.number().int().min(0).max(20),aggregate_only_events:z.number().int().min(0).max(20),groups:GmgnCorroborationReportSchema.shape.groups,
  gaps:z.array(z.string()).max(12),representative_sample:z.literal(false),finality_independently_attested:z.literal(false),usd_volume_verified:z.literal(false),organic_volume_usd:z.null(),
  live_collection_enabled:z.literal(false),provider_requests:z.literal(0),database_writes:z.literal(0),scoring_effect:z.literal("none"),evidence_gates_changed:z.literal(false),input_hash:Hash,report_hash:Hash}).strict();

async function sampleSource(raw:unknown) {
  const replay=await replayGmgnActivityRecord(raw);GmgnWalletActivityResearchSchema.parse(replay.observation.metrics);
  const record=z.object({request:z.object({address:Address,wallet:Address}),receipt:z.object({semantic_validation:z.literal(GMGN_ACTIVITY_RESEARCH_VALIDATION),received_at:Time,response:z.object({data:z.object({activities:z.array(GmgnComparisonEvent).max(50)})})})}).parse(raw);
  return{record,replay,events:record.receipt.response.data.activities};
}
const isTrade=(row:z.infer<typeof GmgnComparisonEvent>)=>["buy","sell"].includes(row.event_type??row.type??"");
const sizeKey=(row:z.infer<typeof GmgnComparisonEvent>)=>{const n=Number(row.token_amount);return isTrade(row)&&Number.isFinite(n)&&n>0?`${row.event_type??row.type}:${n}`:null;};

// Offline only. Select before looking at RPC availability or comparison results.
// Keep every event for each selected signature; never trim a large transaction
// or substitute a lower-ranked transaction merely to make the sample fit.
export async function planGmgnEventSample(activityId:string,raw:unknown,cutoffAt:string) {
  return planFromSource(activityId,await sampleSource(raw),cutoffAt);
}
async function planFromSource(activityId:string,{record,replay,events}:Awaited<ReturnType<typeof sampleSource>>,cutoffAt:string) {
  z.uuid().parse(activityId);Time.parse(cutoffAt);
  if(Date.parse(record.receipt.received_at)>Date.parse(cutoffAt))throw Error("gmgn_sample_source_from_future");
  const sizes=new Map<string,number>();for(const event of events){const key=sizeKey(event);if(key)sizes.set(key,(sizes.get(key)??0)+1);}
  const signatures=[...new Set(events.map(e=>e.tx_hash))];
  const ranked=signatures.map(signature=>{const own=events.filter(e=>e.tx_hash===signature),sides=new Set(own.filter(isTrade).map(e=>e.event_type??e.type));
    const priority=sides.has("buy")&&sides.has("sell")?0:own.some(e=>(sizes.get(sizeKey(e)??"")??0)>1)?1:2;
    return{signature,priority,has_trade:own.some(isTrade)};
  }).filter(v=>v.has_trade).sort((a,b)=>a.priority-b.priority||(a.signature<b.signature?-1:a.signature>b.signature?1:0));
  const selected=ranked.slice(0,2).map(v=>({signature:v.signature,event_indices:events.flatMap((e,i)=>e.tx_hash===v.signature?[i]:[]),reason:v.priority===0?"two_sided":v.priority===1?"repeated_same_side_size":"signature_order"}));
  const selectedSignatures=new Set(selected.map(v=>v.signature)),chosen=events.filter(e=>selectedSignatures.has(e.tx_hash)),trades=events.filter(isTrade).length,chosenTrades=chosen.filter(isTrade).length;
  const holdReason=!selected.length?"no_trade_transactions":chosen.length>20?"selected_event_bound_exceeded":null;
  const body={version:"gmgn-event-sample-plan-v1",activity_id:activityId,cutoff_at:cutoffAt,activity_received_at:record.receipt.received_at,source_receipt_hash:replay.receipt_hash,source_report_hash:replay.report_hash,
    selection:"two_sided_then_repeated_same_side_size_then_signature",selected,page_events:events.length,page_transactions:signatures.length,page_trade_events:trades,selected_events:chosen.length,selected_trade_events:chosenTrades,unselected_events:events.length-chosen.length,unselected_trade_events:trades-chosenTrades,
    state:holdReason?"held":"ready",hold_reason:holdReason,representative_sample:false,live_collection_enabled:false,provider_requests:0,database_writes:0,scoring_effect:"none"};
  return GmgnEventSamplePlanSchema.parse({...body,plan_hash:await hashJson(body)});
}

export async function reviewGmgnEventSample(raw:unknown) {
  boundedJsonValue(raw,GMGN_CORROBORATION_BYTES);const input=GmgnEventSampleInputSchema.parse(raw),source=await sampleSource(input.activity_record),plan=await planFromSource(input.activity_id,source,input.cutoff_at);
  if(await hashJson(plan)!==await hashJson(input.plan))throw Error("gmgn_sample_plan_mismatch");
  if(plan.state==="held"&&input.transactions.length)throw Error("gmgn_sample_held_with_cache");
  const {record,events}=source,signatures=plan.selected.map(v=>v.signature),cache=new Map<string,z.infer<typeof WalletTransactionSchema>>();let bytes=0;
  for(const row of input.transactions){
    if(cache.has(row.signature))throw Error("gmgn_sample_duplicate_cache");
    if(!signatures.includes(row.signature)||Date.parse(row.fetched_at)>Date.parse(input.cutoff_at))throw Error("gmgn_sample_cache_scope_or_time");
    bytes+=new TextEncoder().encode(JSON.stringify(row.transaction)).length;if(bytes>GMGN_CORROBORATION_CACHE_BYTES)throw Error("gmgn_sample_cache_bytes");
    const tx=WalletTransactionSchema.parse(row.transaction);
    if(await hashJson(row.transaction)!==row.raw_hash||await hashJson(tx)!==row.payload_hash||tx.transaction.signatures[0]!==row.signature)throw Error("gmgn_sample_cache_hash_mismatch");
    if(tx.blockTime===null||tx.blockTime*1000>Date.parse(row.fetched_at))throw Error("gmgn_sample_transaction_time");cache.set(row.signature,tx);
  }
  const selectedEvents=events.filter(e=>signatures.includes(e.tx_hash));
  const result=plan.state==="held"?{groups:[],exact:0,aggregate:0}:await compareGmgnEventGroups({events:selectedEvents,address:record.request.address,wallet:record.request.wallet,cache,held:false});
  const gaps=["targeted_sample_not_population","unselected_events_not_compared","rpc_body_not_independent_finality_attestation","usd_valuation_unverified","organic_volume_unknown","live_collection_not_connected"];
  if(plan.hold_reason)gaps.push(plan.hold_reason);if(cache.size<signatures.length)gaps.push("selected_rpc_bodies_missing");
  const body={version:"gmgn-event-sample-comparison-v1",activity_id:input.activity_id,address:record.request.address,cutoff_at:input.cutoff_at,source_report_hash:plan.source_report_hash,plan_hash:plan.plan_hash,
    state:plan.state==="held"?"held":cache.size<signatures.length?"cache_missing":"compared_sample",page_events:plan.page_events,selected_events:plan.selected_events,selected_trade_events:plan.selected_trade_events,unselected_events:plan.unselected_events,unselected_trade_events:plan.unselected_trade_events,
    required_transactions:signatures.length,cached_transactions:cache.size,exact_quantity_events:result.exact,aggregate_only_events:result.aggregate,groups:result.groups,gaps,representative_sample:false,finality_independently_attested:false,usd_volume_verified:false,organic_volume_usd:null,live_collection_enabled:false,provider_requests:0,database_writes:0,scoring_effect:"none",evidence_gates_changed:false,input_hash:await hashJson(input)};
  return SampleReport.parse({...body,report_hash:await hashJson(body)});
}
export async function replayGmgnEventSample(raw:unknown) {
  boundedJsonValue(raw,GMGN_CORROBORATION_BYTES+100_000);const bundle=z.object({inputs:GmgnEventSampleInputSchema,report:SampleReport}).strict().parse(raw),report=await reviewGmgnEventSample(bundle.inputs);
  if(await hashJson(report)!==await hashJson(bundle.report))throw Error("gmgn_sample_report_mismatch");return report;
}
