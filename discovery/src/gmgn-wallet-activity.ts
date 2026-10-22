import {z} from "zod";
import {Address,Signature} from "./model";
import {GmgnTraderSourceId} from "./gmgn-receipt-id";
import {GmgnActivityShape,GmgnActivityCheck,type GmgnActivityCheckResult} from "./gmgn-activity-shape";
export const GMGN_ACTIVITY_EVENT_LIMIT=20;
const NumberValue=z.union([z.number().finite(),z.string().max(100).regex(/^\d+(?:\.\d+)?$/).transform(Number)]).pipe(z.number().finite().nonnegative());
const SignedValue=z.union([z.number().finite(),z.string().max(100).regex(/^-?\d+(?:\.\d+)?(?:[eE][+-]?\d{1,3})?$/).transform(Number)]).pipe(z.number().finite());
const Cost=z.unknown().transform(value=>{
  const parsed=SignedValue.safeParse(value);
  return{value:parsed.success?parsed.data:null,missing:value===null||value===undefined,unusable:value!==null&&value!==undefined&&!parsed.success};
});
// Reuse precisely the archived optional-USD semantics in later comparisons.
export function gmgnActivityUsd(value:unknown){return Cost.parse(value);}
const optional=<T extends z.ZodType>(schema:T)=>schema.nullish().transform(v=>v??null);
const EventType=z.enum(["buy","sell","transferIn","transferOut","add","remove"]);
const Event=z.object({tx_hash:Signature,token:z.object({address:Address}),event_type:EventType.optional(),type:EventType.optional(),
  timestamp:optional(NumberValue.pipe(z.number().int().safe())),token_amount:optional(NumberValue),cost_usd:Cost})
  .refine(v=>(v.event_type??v.type)!==undefined&&(!v.event_type||!v.type||v.event_type===v.type),"gmgn_activity_type_missing_or_conflicting");
const Count=z.number().int().min(0).max(GMGN_ACTIVITY_EVENT_LIMIT),Amount=z.number().finite().nonnegative().nullable();
export class GmgnActivityError extends Error{
  readonly reason="activity_schema_invalid";
  constructor(readonly fields:string[],readonly checks:GmgnActivityCheckResult[]=[]){super("gmgn_activity_schema_invalid");}
}
export const GmgnWalletActivitySchema=z.object({version:z.literal("gmgn-wallet-activity-v1"),
  selection:z.literal("largest_complete_regular_wallet_flow_in_saved_trader_sample"),source_request_id:GmgnTraderSourceId,source_receipt_hash:z.string().regex(/^[a-f0-9]{64}$/),
  received_at:z.string().datetime(),requested_limit:z.literal(20),returned_events:Count,limit_reached:z.boolean(),
  pagination:z.enum(["more_reported","end_reported","unknown"]),population_coverage:z.literal("unknown"),
  buy_events:Count,sell_events:Count,non_trade_events:Count,unique_transactions:Count,unknown_time_events:Count,
  first_trade_at:z.string().datetime().nullable(),last_trade_at:z.string().datetime().nullable(),trade_span_seconds:Amount,
  measured_usd_trade_events:Count,missing_usd_trade_events:Count,unusable_usd_trade_events:Count,unresolved_signed_usd_trade_events:Count,reported_buy_usd:Amount,reported_sell_usd:Amount,
  measured_token_trade_events:Count,repeated_same_side_token_size_events:Count,two_sided_transactions:Count,
  distinct_trade_seconds:Count,minimum_positive_trade_gap_seconds:Amount,maximum_trade_gap_seconds:Amount,
  review_reasons:z.array(z.enum(["reported_buy_and_sell_in_same_transaction","repeated_same_side_token_sizes"])).max(2),
  independent_transaction_verification:z.literal(false),organic_volume_usd:z.null(),wash_trading_verdict:z.literal("not_established"),scoring_effect:z.literal("none")}).strict();
export type GmgnWalletActivity=z.infer<typeof GmgnWalletActivitySchema>;
export const GmgnActivityIssueSchema=z.object({received_at:z.string().datetime(),http_status:z.number().int().min(100).max(599).nullable(),
  error:z.enum(["source_collection_timeout","source_collection_http_error","source_collection_response_unusable"]),
  shape:GmgnActivityShape.optional(),
  fields:z.array(z.string().regex(/^(?:root|(?:activities|next|tx_hash|token|address|event_type|type|timestamp|token_amount|cost_usd)(?:\.(?:activities|next|tx_hash|token|address|event_type|type|timestamp|token_amount|cost_usd))*)$/)).max(12)}).strict();
export function normalizeGmgnWalletActivity(raw:unknown,request:{address:string;selection_id:string;selection_hash:string},receivedAt:string){
  const result=z.object({activities:z.array(Event).max(GMGN_ACTIVITY_EVENT_LIMIT),next:z.string().max(2000).nullable().optional()}).safeParse(raw);
  if(!result.success){
    const allowed=new Set(["activities","next","tx_hash","token","address","event_type","type","timestamp","token_amount","cost_usd"]);
    const fields=[...new Set(result.error.issues.map(issue=>issue.path.filter(part=>typeof part==="string"&&allowed.has(part)).join(".")||"root"))].slice(0,12);
    const checks=result.error.issues.slice(0,12).map(issue=>GmgnActivityCheck.parse({field:issue.path.filter(part=>typeof part==="string"&&allowed.has(part)).join(".")||"root",
      code:GmgnActivityCheck.shape.code.safeParse(issue.code).success?issue.code:"other",check:issue.code==="custom"&&issue.message==="gmgn_activity_type_missing_or_conflicting"?"event_type_missing_or_conflicting":"unspecified"}));
    throw new GmgnActivityError(fields,checks);
  }
  const data=result.data;
  const events=data.activities.map(row=>({...row,kind:row.event_type??row.type!}));
  if(events.some(row=>row.token.address!==request.address))throw Error("gmgn_activity_mint_mismatch");
  if(events.some(row=>row.timestamp!==null&&row.timestamp*1000>Date.parse(receivedAt)))throw Error("gmgn_activity_future_time");
  // No event index is documented. Exact selected-field duplicates are unusable;
  // distinct events in one transaction are retained and counted as such.
  const keys=events.map(row=>JSON.stringify([row.tx_hash,row.kind,row.timestamp,row.token_amount,row.cost_usd]));
  if(new Set(keys).size!==keys.length)throw Error("gmgn_activity_duplicate_event");
  const trades=events.filter(row=>row.kind==="buy"||row.kind==="sell"),unknown=trades.filter(row=>!row.timestamp).length;
  const known=trades.filter(row=>row.timestamp!==null&&row.timestamp>0),seconds=[...new Set(known.map(row=>row.timestamp!))].sort((a,b)=>a-b);
  const gaps=seconds.slice(1).map((t,i)=>t-seconds[i]!);
  // The vendor field reference does not define signed cost semantics. Retain
  // negative numeric reports as unresolved; never take abs() or net them away.
  const total=(side:string)=>{const rows=trades.filter(row=>row.kind===side);if(!rows.length||rows.some(row=>row.cost_usd.value===null||row.cost_usd.value<0))return null;const n=rows.reduce((sum,row)=>sum+row.cost_usd.value!,0);if(!Number.isFinite(n))throw Error("gmgn_activity_overflow");return n;};
  const sizes=new Map<string,number>();for(const row of trades)if(row.token_amount!==null&&row.token_amount>0){const key=row.kind+":"+row.token_amount;sizes.set(key,(sizes.get(key)??0)+1);}
  const twoSided=[...new Set(trades.map(row=>row.tx_hash))].filter(signature=>trades.some(row=>row.tx_hash===signature&&row.kind==="buy")&&trades.some(row=>row.tx_hash===signature&&row.kind==="sell")).length;
  const repeated=[...sizes.values()].filter(n=>n>1).reduce((sum,n)=>sum+n,0),reasons=[];
  if(twoSided)reasons.push("reported_buy_and_sell_in_same_transaction");if(repeated)reasons.push("repeated_same_side_token_sizes");
  return GmgnWalletActivitySchema.parse({version:"gmgn-wallet-activity-v1",selection:"largest_complete_regular_wallet_flow_in_saved_trader_sample",source_request_id:request.selection_id,source_receipt_hash:request.selection_hash,
    received_at:receivedAt,requested_limit:20,returned_events:events.length,limit_reached:events.length===20,pagination:data.next===undefined?"unknown":data.next?"more_reported":"end_reported",population_coverage:"unknown",
    buy_events:trades.filter(row=>row.kind==="buy").length,sell_events:trades.filter(row=>row.kind==="sell").length,non_trade_events:events.length-trades.length,unique_transactions:new Set(events.map(row=>row.tx_hash)).size,unknown_time_events:unknown,
    first_trade_at:seconds.length?new Date(seconds[0]!*1000).toISOString():null,last_trade_at:seconds.length?new Date(seconds.at(-1)!*1000).toISOString():null,trade_span_seconds:unknown||seconds.length<2?null:seconds.at(-1)!-seconds[0]!,
    measured_usd_trade_events:trades.filter(row=>row.cost_usd.value!==null&&row.cost_usd.value>=0).length,missing_usd_trade_events:trades.filter(row=>row.cost_usd.missing).length,unusable_usd_trade_events:trades.filter(row=>row.cost_usd.unusable).length,unresolved_signed_usd_trade_events:trades.filter(row=>row.cost_usd.value!==null&&row.cost_usd.value<0).length,reported_buy_usd:total("buy"),reported_sell_usd:total("sell"),
    measured_token_trade_events:trades.filter(row=>row.token_amount!==null).length,repeated_same_side_token_size_events:repeated,two_sided_transactions:twoSided,distinct_trade_seconds:seconds.length,
    minimum_positive_trade_gap_seconds:unknown||!gaps.length?null:Math.min(...gaps),maximum_trade_gap_seconds:unknown||!gaps.length?null:Math.max(...gaps),review_reasons:reasons,
    independent_transaction_verification:false,organic_volume_usd:null,wash_trading_verdict:"not_established",scoring_effect:"none"});
}
