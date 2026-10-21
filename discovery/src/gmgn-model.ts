import { z } from "zod";
import { Address } from "./model";
import { GmgnTraderSampleSchema } from "./gmgn-traders";
import { GmgnWalletActivitySchema,GmgnActivityIssueSchema } from "./gmgn-wallet-activity";
// Founder explicitly authorized storage/display on 21 October after the earlier
// rights question. This records that authority, not a provider licence grant.
export const GMGN_USE_AUTHORITY = "founder-direction-2026-10-21";
const Pairs = z.number().int().min(0).max(359);
export const GmgnCandleReviewSchema = z.object({
  received_at: z.string().datetime(), window_start: z.string().datetime(), window_end: z.string().datetime(),
  adjacent_pairs: Pairs, rising_adjacent_pairs: Pairs, longest_rising_run_pairs: Pairs, alternating_body_pairs: Pairs,
  adjacent_doubling_or_halving: Pairs, zero_reported_flow_moving_candles: z.number().int().min(0).max(360),
  max_adjacent_close_move_pct: z.number().finite().nonnegative().nullable(),
  review_reasons: z.array(z.enum(["price_moves_with_both_flow_fields_zero", "adjacent_close_doubles_or_halves", "twelve_or_more_consecutive_rising_closes"])).max(3),
  wash_trading_verdict: z.literal("not_established"), thresholds: z.literal("descriptive_review_v1_uncalibrated"),
}).strict();
const BarCount = z.number().int().min(0).max(360);
export const GmgnUnitsSchema = z.object({ version: z.literal("gmgn-unit-corroboration-v1"), state: z.enum(["price_consistent", "unknown"]),
  usd_field: z.enum(["volume", "amount"]).nullable(), token_field: z.enum(["volume", "amount"]).nullable(),
  informative_candles: BarCount, volume_usd_consistent: BarCount, amount_usd_consistent: BarCount, contradictory_flow_pairs: BarCount,
  price_tolerance_pct: z.literal(1), minimum_informative_candles: z.literal(12), independent_trade_verification: z.literal(false) }).strict();
export const GmgnCoverageSchema = z.object({ window_id: z.uuid(), expected_parts: z.literal(4), attempted_parts: z.number().int().min(1).max(4),
  succeeded_parts: z.number().int().min(0).max(4), failed_parts: z.number().int().min(0).max(4), missing_minutes: BarCount,
  overlap_conflicts: z.number().int().min(0).max(40),
  receipt_span_ms: z.number().finite().nonnegative().nullable(), units: GmgnUnitsSchema, report_hash: z.string().regex(/^[a-f0-9]{64}$/) }).strict();
export const GmgnPublicSummarySchema = z.object({
  version: z.literal("gmgn-summary-v1"), address: Address,
  use_authority: z.literal(GMGN_USE_AUTHORITY), provider_rights_independently_confirmed: z.literal(false),
  observations: z.number().int().min(0).max(6), received_at: z.string().datetime().nullable(),
  provider_observed_at: z.null(), stale: z.boolean(),
  reported_volume_24h_usd: z.number().finite().nonnegative().nullable(), reported_volume_1h_usd: z.number().finite().nonnegative().nullable(),
  reported_holder_count: z.number().int().safe().nonnegative().nullable(),
  provider_wash_flag: z.boolean().nullable(), provider_rug_ratio: z.number().min(0).max(1).nullable(),
  provider_insider_hold_ratio: z.number().min(0).max(1).nullable(), provider_bundler_volume_ratio: z.number().min(0).max(1).nullable(),
  candle_count: z.number().int().min(0).max(360).nullable(), candle_window_complete: z.boolean().nullable(),
  candle_window_volume_usd: z.number().finite().nonnegative().nullable(),
  candle_review: GmgnCandleReviewSchema.nullable().default(null),
  candle_coverage: GmgnCoverageSchema.nullable().default(null),
  trader_sample: GmgnTraderSampleSchema.nullable().default(null),
  wallet_activity: GmgnWalletActivitySchema.nullable().default(null),
  wallet_activity_issue:GmgnActivityIssueSchema.nullable().default(null),
  gaps: z.array(z.string().max(100)).max(30),
  organic_volume_usd: z.null(), meaningful_holder_growth: z.null(), scoring_effect: z.literal("none"),
});
export type GmgnPublicSummary = z.infer<typeof GmgnPublicSummarySchema>;
