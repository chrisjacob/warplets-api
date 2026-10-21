import { z } from "zod";
import { Address } from "./model";
import { hashJson } from "./solana";

// Fixed before outcome inspection. Descriptive sample measurements, never score credit.
export const TRADE_SAMPLE_POLICY = { version: "trade-sample-policy-v1", windows_minutes: [5, 60, 360],
  anchor: "latest_replayed_wallet_observation", young_launch: "clip_to_verified_creation",
  minimum_single_buy_quote_raw: "10000000", quote_unit: "SOL_or_WSOL_1e9", freshness_seconds: 3600,
  interval: "start_inclusive_end_inclusive", missing_finality: "withhold_affected_interval",
  unknown_quote: "withhold_direction_total_and_sized_buyers", equal_quote: "same_side_known_raw_amount",
  population_coverage: "unknown", scoring_effect: "none" } as const;
const Time = z.string().datetime(), Hash = z.string().regex(/^[a-f0-9]{64}$/), Count = z.number().int().min(0).max(100);
const Raw = z.string().regex(/^\d+$/).max(33);
const Metrics = z.object({ buys: Count, sells: Count, buyers: Count, sellers: Count, buy_sell_wallets: Count,
  sized_buyers: Count.nullable(), buy_quote_raw: Raw.nullable(), sell_quote_raw: Raw.nullable(),
  unknown_buy_quote_trades: Count, unknown_sell_quote_trades: Count,
  largest_known_equal_quote_trades: Count, largest_known_equal_quote_wallets: Count }).strict();
export const TradeSamplePeriod = z.object({ minutes: z.union([z.literal(5), z.literal(60), z.literal(360)]), start_at: Time, end_at: Time,
  clipped_to_creation: z.boolean(), status: z.enum(["measured_sample", "held"]), candidate_trades: Count, finalized_trades: Count,
  metrics: Metrics.nullable(), gaps: z.array(z.string().max(100)).max(14) }).strict().refine(p => {
  if (Date.parse(p.end_at) < Date.parse(p.start_at) || Date.parse(p.end_at) - Date.parse(p.start_at) > p.minutes * 60000 || p.finalized_trades > p.candidate_trades) return false;
  if (p.status === "held") return p.metrics === null;
  const m = p.metrics;
  return m !== null && p.finalized_trades === p.candidate_trades && m.buys + m.sells === p.candidate_trades
    && m.buyers <= m.buys && m.sellers <= m.sells && m.buy_sell_wallets <= Math.min(m.buyers, m.sellers)
    && m.unknown_buy_quote_trades <= m.buys && m.unknown_sell_quote_trades <= m.sells
    && (m.unknown_buy_quote_trades > 0 ? m.buy_quote_raw === null && m.sized_buyers === null : m.buy_quote_raw !== null && m.sized_buyers !== null && m.sized_buyers <= m.buyers)
    && (m.unknown_sell_quote_trades > 0 ? m.sell_quote_raw === null : m.sell_quote_raw !== null)
    && m.largest_known_equal_quote_trades <= Math.max(m.buys - m.unknown_buy_quote_trades, m.sells - m.unknown_sell_quote_trades)
    && m.largest_known_equal_quote_wallets <= Math.max(m.buyers, m.sellers)
    && m.largest_known_equal_quote_wallets <= m.largest_known_equal_quote_trades
    && (m.largest_known_equal_quote_trades === 0 ? m.largest_known_equal_quote_wallets === 0 : m.largest_known_equal_quote_wallets > 0)
    && (m.buys > 0 || m.buy_quote_raw === "0") && (m.sells > 0 || m.sell_quote_raw === "0");
}, "trade_sample_period_inconsistent");
export const TradeSample = z.object({ version: z.literal("trade-sample-v1"), address: Address, cutoff_at: Time,
  state: z.enum(["available", "missing", "rejected", "simulation"]), anchor_at: Time.nullable(), freshness: z.enum(["fresh", "stale", "unknown"]),
  policy: z.literal(TRADE_SAMPLE_POLICY.version), policy_hash: Hash, input_hash: Hash.nullable(), wallet_hash: Hash.nullable(),
  source_records: z.number().int().min(0).max(64), source_trades: Count, periods: z.array(TradeSamplePeriod).max(3), gaps: z.array(z.string().max(100)).max(20),
  population_trade_coverage: z.literal("unknown"), organic_volume_usd: z.null(), independent_participants: z.null(),
  wash_trading_verdict: z.literal("not_established"), total_wallet_cost_verified: z.literal(false),
  source_finality_independently_attested: z.literal(false), scoring_effect: z.literal("none"), evidence_gates_changed: z.literal(false),
  provider_requests: z.literal(0), database_writes: z.literal(0), report_hash: Hash }).strict().refine(r => {
  if (r.state !== "available") return r.periods.length === 0 && r.anchor_at === null && r.input_hash === null && r.wallet_hash === null && r.freshness === "unknown";
  return r.anchor_at !== null && r.input_hash !== null && r.wallet_hash !== null && Date.parse(r.anchor_at) <= Date.parse(r.cutoff_at)
    && r.periods.map(p => p.minutes).join(",") === "5,60,360" && r.periods.every(p => p.end_at === r.anchor_at)
    && (r.freshness !== "fresh" || Date.parse(r.cutoff_at) - Date.parse(r.anchor_at) <= TRADE_SAMPLE_POLICY.freshness_seconds * 1000);
}, "trade_sample_inconsistent");
export type TradeSample = z.infer<typeof TradeSample>;
export type TradeSamplePeriod = z.infer<typeof TradeSamplePeriod>;
export async function freezeTradeSample(body: Omit<TradeSample, "report_hash">) {
  const { report_hash: _, ...parsed } = TradeSample.parse({ ...body, report_hash: "0".repeat(64) });
  return TradeSample.parse({ ...parsed, report_hash: await hashJson(parsed) });
}
export async function verifyTradeSample(raw: unknown) {
  const report = TradeSample.parse(raw), { report_hash, ...body } = report;
  if (await hashJson(body) !== report_hash || report.policy_hash !== await hashJson(TRADE_SAMPLE_POLICY)) throw Error("trade_sample_hash_or_policy_mismatch");
  return report;
}
