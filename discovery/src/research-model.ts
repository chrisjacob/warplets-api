import { z } from "zod";
import { MarketSchema } from "./model";

export const HistorySchema = z.object({ address: z.string(), source: z.literal("geckoterminal"), coverage: z.literal("local_observations_only"), points: z.array(MarketSchema).max(1000) });
export const FeaturesSchema = z.object({
  holders: z.number().nullable(), top1_pct: z.number().nullable(), top10_pct: z.number().nullable(), creator_pct: z.number().nullable(),
  liquidity_usd: z.number().nullable(), volume_24h_usd: z.number().nullable(),
  fees_produced_usd: z.null(), bundle_risk: z.literal("unknown"), buyer_wallet_risk: z.literal("unknown"),
  same_slot_buyers: z.number().nullable().default(null), shared_funder_buyers: z.number().nullable().default(null),
  dev_funded_supply_pct: z.number().nullable().default(null), dev_sold_supply_pct: z.number().nullable().default(null),
  sampled_buyers: z.number().nullable().default(null),
  funding_windows_examined: z.number().nullable().default(null), funding_wallets_tracked: z.number().nullable().default(null),
});
export const OutcomeSchema = z.object({
  address: z.string(), symbol: z.string(), recommended: z.boolean(), selected_at: z.string(), input_hash: z.string(),
  cohort_kind: z.enum(["first_observation", "first_wallet_sample", "first_recommendation"]).default("first_observation"),
  status: z.enum(["pending", "measured", "insufficient_data"]), outcome: z.enum(["severe_loss_signal", "positive", "negative", "flat", "unmeasured"]),
  return_24h_pct: z.number().nullable(), observed_max_drawdown_pct: z.number().nullable(), liquidity_change_pct: z.number().nullable(),
  endpoint_at: z.string().nullable(), gaps: z.array(z.string()), features: FeaturesSchema,
  wallets: z.array(z.object({ wallet: z.string(), role: z.enum(["creation_user", "large_owner", "buyer", "seller"]), evidence_hash: z.string() })).max(61),
});
export type Outcome = z.infer<typeof OutcomeSchema>;
export const ProposalSchema = z.object({
  feature: z.enum(["top1_pct", "top10_pct", "holders", "liquidity_usd", "dev_funded_supply_pct", "dev_sold_supply_pct", "shared_funder_buyers", "same_slot_buyers"]), threshold: z.number(),
  direction: z.enum(["maximum", "minimum"]), train_count: z.number(), validation_count: z.number(),
  validation_flagged: z.number(), validation_loss_precision: z.number(), validation_nonloss_excluded: z.number(),
  validation_baseline_loss_rate: z.number(),
  activated: z.literal(false), status: z.literal("research_proposal"),
});
export const ReviewSchema = z.object({
  day: z.string(), timezone: z.literal("Australia/Sydney"), version: z.literal("outcomes-v1"),
  input_hash: z.string(), created_at: z.string(), policy_activation: z.literal("review_required"),
  counts: z.object({ observed: z.number(), recommended: z.number(), measured: z.number(), pending: z.number(), insufficient_data: z.number(), severe_loss_signals: z.number() }),
  outcomes: z.array(OutcomeSchema).max(100), proposals: z.array(ProposalSchema).max(12),
  wallet_watch: z.array(z.object({ wallet: z.string(), role: z.string(), distinct_tokens: z.number(), severe_loss_associations: z.number(), evidence_hashes: z.array(z.string()), label: z.literal("review_association_not_fraud_finding") })).max(50),
  gaps: z.array(z.string()),
});
export type Review = z.infer<typeof ReviewSchema>;
