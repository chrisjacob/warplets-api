import { z } from "zod";
import { Address } from "./model";

const Amount=z.union([z.number().finite(),z.string().max(100).regex(/^\d+(?:\.\d+)?$/).transform(Number)]).pipe(z.number().finite().nonnegative());
const optional=<T extends z.ZodType>(schema:T)=>schema.nullish().transform(v=>v??null);
const Trader=z.object({address:Address,addr_type:optional(z.number().int().nonnegative()),
  buy_volume_cur:optional(Amount),sell_volume_cur:optional(Amount),
  buy_tx_count_cur:optional(Amount.pipe(z.number().int().safe())),sell_tx_count_cur:optional(Amount.pipe(z.number().int().safe()))});
const Count=z.number().int().min(0).max(100),Money=z.number().finite().nonnegative().nullable(),Share=z.number().min(0).max(100).nullable();
export const GmgnTraderSampleSchema=z.object({version:z.literal("gmgn-trader-sample-v1"),
  selection:z.literal("top_100_by_reported_buy_volume_desc_no_tag_filter"),requested_limit:z.literal(100),
  received_at:z.string().datetime(),window_start:z.null(),window_end:z.null(),time_scope:z.literal("provider_aggregate_period_unknown"),
  returned_rows:Count,limit_reached:z.boolean(),regular_wallet_rows:Count,excluded_non_wallet_rows:Count,unknown_address_type_rows:Count,
  complete_volume_rows:Count,missing_volume_rows:Count,complete_count_rows:Count,
  reported_buy_volume_usd:Money,reported_sell_volume_usd:Money,reported_combined_flow_usd:Money,
  largest_wallet_flow_share_pct:Share,top_five_wallet_flow_share_pct:Share,two_sided_wallet_rows:Count,
  two_sided_smaller_leg_usd:Money,reported_buy_transactions:z.number().int().safe().nonnegative().nullable(),reported_sell_transactions:z.number().int().safe().nonnegative().nullable(),
  population_coverage:z.literal("unknown"),organic_volume_usd:z.null(),wash_trading_verdict:z.literal("not_established"),scoring_effect:z.literal("none")}).strict();
export type GmgnTraderSample=z.infer<typeof GmgnTraderSampleSchema>;

// These aggregates have no documented exact time boundary. Never compare them
// with candle totals or call them 24h/organic volume. Ranking is sample-biased.
export function gmgnTraderRows(raw:unknown){
  const {list}=z.object({list:z.array(Trader).max(100)}).parse(raw);
  if(new Set(list.map(row=>row.address)).size!==list.length)throw Error("gmgn_duplicate_trader");
  return list;
}
export function normalizeGmgnTraders(raw:unknown,receivedAt:string){
  const list=gmgnTraderRows(raw);
  const wallets=list.filter(row=>row.addr_type===0),volume=wallets.filter(row=>row.buy_volume_cur!==null&&row.sell_volume_cur!==null),counts=wallets.filter(row=>row.buy_tx_count_cur!==null&&row.sell_tx_count_cur!==null);
  const sum=(values:number[])=>{const n=values.reduce((a,b)=>a+b,0);if(!Number.isFinite(n))throw Error("gmgn_trader_overflow");return n;};
  const buys=volume.length?sum(volume.map(row=>row.buy_volume_cur!)):null,sells=volume.length?sum(volume.map(row=>row.sell_volume_cur!)):null;
  const flows=volume.map(row=>sum([row.buy_volume_cur!,row.sell_volume_cur!])).sort((a,b)=>b-a),total=volume.length?sum(flows):null;
  const share=(n:number)=>total!==null&&total>0?Math.min(100,n/total*100):null;
  const buyCount=counts.length?sum(counts.map(row=>row.buy_tx_count_cur!)):null,sellCount=counts.length?sum(counts.map(row=>row.sell_tx_count_cur!)):null;
  if(buyCount!==null&&!Number.isSafeInteger(buyCount)||sellCount!==null&&!Number.isSafeInteger(sellCount))throw Error("gmgn_trader_count_overflow");
  return GmgnTraderSampleSchema.parse({version:"gmgn-trader-sample-v1",selection:"top_100_by_reported_buy_volume_desc_no_tag_filter",requested_limit:100,
    received_at:receivedAt,window_start:null,window_end:null,time_scope:"provider_aggregate_period_unknown",returned_rows:list.length,limit_reached:list.length===100,
    regular_wallet_rows:wallets.length,excluded_non_wallet_rows:list.filter(row=>row.addr_type===2).length,unknown_address_type_rows:list.filter(row=>row.addr_type!==0&&row.addr_type!==2).length,
    complete_volume_rows:volume.length,missing_volume_rows:wallets.length-volume.length,complete_count_rows:counts.length,
    reported_buy_volume_usd:buys,reported_sell_volume_usd:sells,reported_combined_flow_usd:total,largest_wallet_flow_share_pct:share(flows[0]??0),top_five_wallet_flow_share_pct:share(sum(flows.slice(0,5))),
    two_sided_wallet_rows:volume.filter(row=>row.buy_volume_cur!>0&&row.sell_volume_cur!>0).length,two_sided_smaller_leg_usd:volume.length?sum(volume.map(row=>Math.min(row.buy_volume_cur!,row.sell_volume_cur!))):null,
    reported_buy_transactions:buyCount,reported_sell_transactions:sellCount,population_coverage:"unknown",organic_volume_usd:null,wash_trading_verdict:"not_established",scoring_effect:"none"});
}
