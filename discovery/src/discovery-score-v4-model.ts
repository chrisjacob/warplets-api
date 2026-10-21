import { z } from "zod";
import { DISCOVERY_SCORE_POLICY_V3, ScorePolicyV3Schema, ScoreInputV3Schema, ScoreResultV3Schema, ScoreRecordV3Schema, ScoreSummaryV3Schema } from "./discovery-score-v3-model";

export const ScorePolicyV4Schema = ScorePolicyV3Schema.extend({
  version: z.literal("discovery-score-v4"),
  launch_timing: z.object({ same_slot_ceiling: z.literal(50), high_early_cap_ceiling: z.literal(25) }).strict(),
}).strict();
export const DISCOVERY_SCORE_POLICY_V4 = ScorePolicyV4Schema.parse({ ...DISCOVERY_SCORE_POLICY_V3,
  version: "discovery-score-v4", launch_timing: { same_slot_ceiling: 50, high_early_cap_ceiling: 25 } });
export const ScoreInputV4Schema = ScoreInputV3Schema.extend({ version: z.literal("discovery-score-input-v4"), policy: ScorePolicyV4Schema }).strict();
const Time = z.string().datetime().nullable(), Slot = z.number().int().safe().nonnegative().nullable();
export const LaunchTimingReviewSchema = z.object({
  status: z.enum(["unknown", "not_flagged", "review"]), confirmed_same_slot: z.boolean().nullable(),
  creation_slot: Slot, graduation_slot: Slot, creation_at: Time, graduation_at: Time,
  early_reported_cap_usd: z.number().finite().nonnegative().nullable(), first_quote_at: Time,
  high_early_report: z.boolean().nullable(), gaps: z.array(z.string().max(100)).max(8),
}).strict();
export const ScoreResultV4Schema = ScoreResultV3Schema.extend({ version: z.literal("discovery-score-result-v4"),
  concerns: ScoreResultV3Schema.shape.concerns.element.array().max(24), launch_timing: LaunchTimingReviewSchema }).strict();
export const ScoreRecordV4Schema = ScoreRecordV3Schema.extend({ version: z.literal("discovery-scorecard-v4"), inputs: ScoreInputV4Schema, result: ScoreResultV4Schema }).strict();
export const ScoreSummaryV4Schema = ScoreSummaryV3Schema.extend({ version: z.literal("discovery-score-v4"), risk_flags: ScoreResultV4Schema.shape.concerns }).strict();
export type ScoreInputV4 = z.infer<typeof ScoreInputV4Schema>;
export type ScoreRecordV4 = z.infer<typeof ScoreRecordV4Schema>;
