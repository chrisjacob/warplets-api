import {z} from "zod";
import {Address,PolicySchema} from "./model";
import {ScorePriceSchema} from "./discovery-score-model";

import {AnyScoreRecordSchema,AnyScoreSummarySchema} from "./discovery-score-v2-model";
export const ScoreModelSchema=z.enum(["discovery-score-v1","discovery-score-v2"]);
export type ScoreModel=z.infer<typeof ScoreModelSchema>;

export const SCORE_RESEARCH_LIMITS={captures:3,finalizations:5,daily_records:100,daily_bytes:10_000_000,record_bytes:1_900_000,endpoint_samples:256,summary_records:500,lease_ms:120_000,interval_ms:60_000} as const;
const Hash=z.string().regex(/^[a-f0-9]{64}$/),Time=z.string().datetime(),Count=z.number().int().nonnegative();
export const ScoreEndpointSchema=ScorePriceSchema.extend({liquidity_usd:z.number().finite().nonnegative().nullable()}).strict();
export const ScoreCohortHeaderSchema=z.object({version:z.literal("score-cohort-v1"),address:Address,symbol:z.string().max(40),captured_at:Time,score:AnyScoreSummarySchema,action_status:z.enum(["eligible","provisional","excluded"]),baseline:ScoreEndpointSchema.nullable()}).strict();
export const ScoreCohortSummarySchema=ScoreCohortHeaderSchema.extend({cohort_hash:Hash}).strict();
export const ScoreCohortSchema=z.object({summary:ScoreCohortSummarySchema,scorecard:AnyScoreRecordSchema,action_policy:PolicySchema.optional()}).strict();
export const ScoreOutcomeInputSchema=z.object({version:z.literal("score-outcome-input-v1"),cohort:ScoreCohortSummarySchema,finalized_at:Time,points:z.array(ScoreEndpointSchema).max(256),history_limited:z.boolean()}).strict();
export const ScoreOutcomeResultSchema=z.object({version:z.literal("score-outcome-result-v1"),cohort_hash:Hash,target_at:Time,window_end:Time,finalized_at:Time,status:z.enum(["measured","insufficient_data"]),endpoint:ScoreEndpointSchema.nullable(),price_return_pct:z.number().finite().nullable(),liquidity_change_pct:z.number().finite().nullable(),severe_decline:z.boolean().nullable(),gaps:z.array(z.string().max(100)).max(12)}).strict();
export const ScoreOutcomeSchema=z.object({version:z.literal("score-outcome-v1"),inputs:ScoreOutcomeInputSchema,result:ScoreOutcomeResultSchema,input_hash:Hash,result_hash:Hash,outcome_hash:Hash}).strict();
export const ScoreOutcomeSummarySchema=ScoreOutcomeSchema.omit({inputs:true});
export const ScoreResearchDetailSchema=z.object({cohort:ScoreCohortSchema,outcome:ScoreOutcomeSchema.nullable(),replay:z.literal("verified"),provider_requests:z.literal(0)}).strict();
export const ScoreResearchSchema=z.object({at:Time,model:ScoreModelSchema,scope:z.literal("latest_500_score_cohorts"),capped:z.boolean(),automatic_policy_changes:z.literal(false),provider_requests:z.literal(0),limits:z.object({daily_records:z.literal(100),daily_bytes:z.literal(10000000)}).strict(),today:z.object({day:z.string(),records:Count,bytes:Count}).strict(),automation:z.object({next_at:Time.nullable(),last_success:Time.nullable(),last_error:z.string().nullable()}).strict(),counts:z.object({captured:Count,pending:Count,measured:Count,insufficient:Count}).strict(),bands:z.array(z.object({minimum:Count,maximum:Count,captured:Count,pending:Count,measured:Count,insufficient:Count,severe_declines:Count}).strict()).length(5),recent:z.array(z.object({cohort:ScoreCohortSummarySchema,outcome:ScoreOutcomeResultSchema.nullable()}).strict()).max(20),attempts:z.array(z.object({address:Address,attempted_at:Time,gap:z.string()}).strict()).max(10)}).strict().refine(value=>value.recent.every(row=>row.cohort.score.version===value.model),"score_research_model_mismatch");
export type ScoreCohort=z.infer<typeof ScoreCohortSchema>;
export type ScoreCohortSummary=z.infer<typeof ScoreCohortSummarySchema>;
export type ScoreOutcome=z.infer<typeof ScoreOutcomeSchema>;
export type ScoreEndpoint=z.infer<typeof ScoreEndpointSchema>;
