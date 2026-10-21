import {z} from "zod";
import {DISCOVERY_SCORE_POLICY,ScorePolicySchema,ScoreInputSchema,ScoreResultSchema,ScoreRecordSchema,ScoreSummarySchema} from "./discovery-score-model";

// V1 schemas/evaluator stay frozen for exported scorecards and prospective cohorts.
export const ScorePolicyV2Schema=ScorePolicySchema.extend({version:z.literal("discovery-score-v2"),integrity:z.object({
  history_seconds:z.literal(86400),max_samples:z.literal(256),jump_gap_seconds:z.literal(600),jump_up_ratio:z.literal(2),jump_down_ratio:z.literal(.5),jump_ceiling:z.literal(40),
  depth_reference_ratio:z.literal(.05),depth_curve:z.literal("square_root"),
  dust_quote_lamports:z.literal("1000000"),participation_quote_lamports:z.literal("10000000"),dust_min_trades:z.literal(5),dust_min_wallets:z.literal(3),dust_fraction:z.literal(.8),dust_ceiling:z.literal(40),
}).strict()}).strict();
export const DISCOVERY_SCORE_POLICY_V2=ScorePolicyV2Schema.parse({...DISCOVERY_SCORE_POLICY,version:"discovery-score-v2",integrity:{history_seconds:86400,max_samples:256,jump_gap_seconds:600,jump_up_ratio:2,jump_down_ratio:.5,jump_ceiling:40,depth_reference_ratio:.05,depth_curve:"square_root",dust_quote_lamports:"1000000",participation_quote_lamports:"10000000",dust_min_trades:5,dust_min_wallets:3,dust_fraction:.8,dust_ceiling:40}});
export const ScoreInputV2Schema=ScoreInputSchema.extend({version:z.literal("discovery-score-input-v2"),policy:ScorePolicyV2Schema,prices:ScoreInputSchema.shape.prices.element.array().max(256)}).strict();
const NullableNumber=z.number().finite().nullable();
export const ScoreIntegritySchema=z.object({
  scope:z.literal("cached_observations_not_fraud_verdict"),history_limited:z.boolean(),price_pairs:z.number().int().nonnegative(),largest_jump_pct:NullableNumber,jump_at:z.string().datetime().nullable(),
  liquidity_cap_ratio:NullableNumber,sampled_trades:z.number().int().nonnegative(),dust_trades:z.number().int().nonnegative(),sampled_wallets:z.number().int().nonnegative(),qualifying_buyers:z.number().int().nonnegative(),wallet_observed_at:z.string().datetime().nullable(),
  gaps:z.array(z.string().max(100)).max(12),
}).strict();
export const ScoreResultV2Schema=ScoreResultSchema.extend({version:z.literal("discovery-score-result-v2"),concerns:ScoreResultSchema.shape.concerns.element.array().max(16),integrity:ScoreIntegritySchema}).strict();
export const ScoreRecordV2Schema=ScoreRecordSchema.extend({version:z.literal("discovery-scorecard-v2"),inputs:ScoreInputV2Schema,result:ScoreResultV2Schema}).strict();
export const ScoreSummaryV2Schema=ScoreSummarySchema.extend({version:z.literal("discovery-score-v2"),risk_flags:ScoreResultV2Schema.shape.concerns}).strict();
export const AnyScoreRecordSchema=z.union([ScoreRecordSchema,ScoreRecordV2Schema]);
export const AnyScoreSummarySchema=z.union([ScoreSummarySchema,ScoreSummaryV2Schema]);
export const AnyScorePolicySchema=z.union([ScorePolicySchema,ScorePolicyV2Schema]);
export const AnyScoreResponseSchema=z.object({record:AnyScoreRecordSchema,replay:z.literal("verified"),provider_requests:z.literal(0)}).strict();
export type ScoreInputV2=z.infer<typeof ScoreInputV2Schema>;
export type ScoreRecordV2=z.infer<typeof ScoreRecordV2Schema>;
export type AnyScoreRecord=z.infer<typeof AnyScoreRecordSchema>;
export type AnyScoreSummary=z.infer<typeof AnyScoreSummarySchema>;
