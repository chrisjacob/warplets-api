import {z} from "zod";
import {ScoreRecordSchema,ScoreSummarySchema,ScorePolicySchema} from "./discovery-score-model";
import {ScoreRecordV2Schema,ScoreSummaryV2Schema,ScorePolicyV2Schema} from "./discovery-score-v2-model";
import {ScoreRecordV3Schema,ScoreSummaryV3Schema,ScorePolicyV3Schema} from "./discovery-score-v3-model";
import {ScoreRecordV4Schema,ScoreSummaryV4Schema,ScorePolicyV4Schema} from "./discovery-score-v4-model";

export const AnyScoreRecordSchema=z.union([ScoreRecordSchema,ScoreRecordV2Schema,ScoreRecordV3Schema,ScoreRecordV4Schema]);
export const AnyScoreSummarySchema=z.union([ScoreSummarySchema,ScoreSummaryV2Schema,ScoreSummaryV3Schema,ScoreSummaryV4Schema]);
export const AnyScorePolicySchema=z.union([ScorePolicySchema,ScorePolicyV2Schema,ScorePolicyV3Schema,ScorePolicyV4Schema]);
export const AnyScoreResponseSchema=z.object({record:AnyScoreRecordSchema,replay:z.literal("verified"),provider_requests:z.literal(0)}).strict();
export const ScoreModelSchema=z.enum(["discovery-score-v1","discovery-score-v2","discovery-score-v3","discovery-score-v4"]);
export type AnyScoreRecord=z.infer<typeof AnyScoreRecordSchema>;
export type AnyScoreSummary=z.infer<typeof AnyScoreSummarySchema>;
export type ScoreModel=z.infer<typeof ScoreModelSchema>;
