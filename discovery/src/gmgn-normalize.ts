import { z } from "zod";
import { Address } from "./model";
import { gmgnEnvelope, GmgnRequestSchema } from "./gmgn-request";
import { boundedJsonValue } from "./source-pilot";
import { normalizeGmgnCandles } from "./gmgn-candles";
import { normalizeGmgnTraders } from "./gmgn-traders";
import { normalizeGmgnWalletActivity,normalizeGmgnWalletActivityResearch } from "./gmgn-wallet-activity";

const Decimal = z.union([z.number().finite(), z.string().regex(/^\d+(?:\.\d+)?$/).max(100).transform(Number)]).pipe(z.number().finite().nonnegative());
const Ratio = Decimal.pipe(z.number().max(1));
const Count = Decimal.pipe(z.number().int().safe());
const nullable = <T extends z.ZodType>(schema: T) => schema.nullish().transform(v => v ?? null);
const Flag = z.union([z.boolean(), z.literal(0), z.literal(1), z.enum(["true", "false", "0", "1"])]).transform(v => v === true || v === 1 || v === "true" || v === "1");
const Stats = z.object({ volume_5m: nullable(Decimal), volume_1h: nullable(Decimal), volume_24h: nullable(Decimal),
  buy_volume_24h: nullable(Decimal), sell_volume_24h: nullable(Decimal), buys_24h: nullable(Count), sells_24h: nullable(Count) });
const Info = z.object({ address: Address, holder_count: nullable(Count), biggest_pool_address: nullable(Address),
  creation_timestamp: nullable(Count), price: Stats.nullish(),
  stat: z.object({ top_10_holder_rate: nullable(Ratio), top_rat_trader_percentage: nullable(Ratio), top_bundler_trader_percentage: nullable(Ratio), fresh_wallet_rate: nullable(Ratio) }).nullish() });
const Security = z.object({ address: nullable(Address), is_wash_trading: nullable(Flag), rug_ratio: nullable(Ratio),
  suspected_insider_hold_rate: nullable(Ratio), rat_trader_amount_rate: nullable(Ratio), bundler_trader_amount_rate: nullable(Ratio),
  renounced_mint: nullable(Flag), renounced_freeze_account: nullable(Flag) });
const Pool = z.object({ address: Address, base_address: Address, quote_address: Address, liquidity: nullable(Decimal) });
const Candle = z.object({ time: Count, open: Decimal, high: Decimal, low: Decimal, close: Decimal, volume: Decimal, amount: Decimal })
  .refine(v => v.low > 0 && v.low <= Math.min(v.open, v.close) && v.high >= Math.max(v.open, v.close) && v.high >= v.low, "invalid_ohlc");

// Only selected scalar measurements leave this normalizer. Names, social links,
// metadata instructions and provider error messages are never returned.
export function normalizeGmgn(rawRequest: unknown, raw: unknown, receivedAt: string, cutoffAt = receivedAt, expectedPool?: string, candleContract: "v1" | "v2" = "v2",activityContract:"v1"|"v2"="v1") {
  const request = GmgnRequestSchema.parse(rawRequest), cutoff = Date.parse(z.string().datetime().parse(cutoffAt));
  const received = Date.parse(z.string().datetime().parse(receivedAt));
  if (received > cutoff || cutoff - received > 300_000) throw new Error("gmgn_receipt_stale_or_future");
  boundedJsonValue(raw, 1_000_000);
  const data = gmgnEnvelope(raw), gaps = ["provider_measurement_time_unknown", "provider_labels_not_independent_proof", "organic_volume_unknown", "meaningful_holder_growth_unknown", "canonical_pool_binding_not_verified"];
  let metrics: object, identity: string;
  if (request.kind === "gmgn_token_info") {
    const row = Info.parse(data);
    if (row.address !== request.address) throw new Error("gmgn_mint_mismatch");
    if (row.creation_timestamp !== null && row.creation_timestamp * 1000 > received) throw new Error("gmgn_future_creation");
    identity = "response_mint_matches_request";
    metrics = { reported_holder_count: row.holder_count, reported_pool: row.biggest_pool_address, reported_creation_seconds: row.creation_timestamp,
      reported_volume_usd: row.price ?? null, reported_wallet_ratios: row.stat ?? null };
    if (expectedPool && row.biggest_pool_address !== expectedPool) gaps.push("provider_main_pool_differs_from_canonical");
    gaps.push("positive_balance_count_not_dust_filtered");
  } else if (request.kind === "gmgn_token_security") {
    const row = Security.parse(data);
    if (row.address !== null && row.address !== request.address) throw new Error("gmgn_mint_mismatch");
    identity = row.address === null ? "request_context_only" : "response_mint_matches_request";
    if (row.address === null) gaps.push("response_mint_not_echoed");
    metrics = { provider_flags: row, clean_evidence: false };
    gaps.push("false_or_zero_label_does_not_establish_coverage");
  } else if (request.kind === "gmgn_token_pool") {
    const row = Pool.parse(data);
    if (row.base_address !== request.address) throw new Error("gmgn_mint_mismatch");
    identity = "response_base_mint_matches_request";
    if (expectedPool && row.address !== expectedPool) gaps.push("provider_main_pool_differs_from_canonical");
    metrics = { reported_pool: row.address, reported_base: row.base_address, reported_quote: row.quote_address, reported_liquidity_usd: row.liquidity,
      independently_expected_pool: expectedPool ?? null, pool_address_matches: expectedPool ? row.address === expectedPool : null };
  } else if(request.kind==="gmgn_wallet_activity"){
    identity="response_event_mints_match_request_wallet_context_only";metrics=(activityContract==="v2"?normalizeGmgnWalletActivityResearch:normalizeGmgnWalletActivity)(data,request,receivedAt);
    gaps.push("single_rank_selected_wallet_only","activity_pagination_not_followed","transaction_signatures_not_independently_verified","same_transaction_or_repeated_sizes_not_wash_proof");
  } else if(request.kind==="gmgn_token_traders"){
    identity="request_context_only";metrics=normalizeGmgnTraders(data,receivedAt);
    gaps.push("trader_aggregate_period_unknown","ranked_trader_sample_not_population","response_mint_and_pool_not_echoed","two_sided_activity_not_wash_proof");
  } else if (request.kind === "gmgn_token_candles" && candleContract === "v2") {
    const result = normalizeGmgnCandles(data, request, cutoff);
    identity = "request_context_only";
    gaps.push("response_mint_and_pool_not_echoed", "candle_volume_not_organic", "candle_volume_units_unverified");
    if (!result.complete_window) gaps.push("candle_window_incomplete");
    if (result.reported_field_amount_total === null) gaps.push("candle_amount_missing_or_no_rows");
    metrics = result;
  } else {
    if (request.kind !== "gmgn_token_candles") throw new Error("gmgn_kind_unsupported");
    const rows = z.union([z.array(Candle).max(360), z.object({ list: z.array(Candle).max(360) }).transform(v => v.list)]).parse(data);
    const start = Date.parse(request.start_at) / 1000, end = Date.parse(request.end_at) / 1000;
    const times = rows.map(v => v.time);
    if (times.some((v, i) => v % 60 !== 0 || v < start || v >= end || (v + 60) * 1000 > cutoff || i > 0 && v <= times[i - 1]!)) throw new Error("gmgn_candle_time_invalid");
    const complete = rows.length === (end - start) / 60 && rows.every((v, i) => v.time === start + i * 60);
    if (!complete) gaps.push("candle_window_incomplete");
    const total = (field: "amount" | "volume") => { const n = rows.reduce((sum, v) => sum + v[field], 0); if (!Number.isFinite(n)) throw new Error("gmgn_volume_overflow"); return n; };
    identity = "request_context_only"; gaps.push("response_mint_and_pool_not_echoed", "candle_volume_not_organic");
    metrics = { window_start: request.start_at, window_end: request.end_at, candle_count: rows.length, expected_count: (end - start) / 60, complete_window: complete,
      reported_volume_usd: total("amount"), reported_volume_tokens: total("volume"),
      zero_usd_volume_moving_candles: rows.filter(v => v.amount === 0 && v.high !== v.low).length,
      adjacent_doubling_or_halving: rows.slice(1).filter((v, i) => v.time === rows[i]!.time + 60 && (v.close / rows[i]!.close >= 2 || v.close / rows[i]!.close <= .5)).length,
      candles: rows };
  }
  return { version: request.kind === "gmgn_wallet_activity" && activityContract === "v2" ? "gmgn-observation-v3" as const : request.kind === "gmgn_token_candles" && candleContract === "v2" ? "gmgn-observation-v2" as const : "gmgn-observation-v1" as const, provider: "gmgn" as const, address: request.address, kind: request.kind,
    received_at: receivedAt, cutoff_at: cutoffAt, provider_observed_at: null, identity, metrics, gaps,
    organic_demand_certified: false, holder_growth_certified: false, scoring_effect: "none", evidence_gates_changed: false };
}
