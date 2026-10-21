import {z} from "zod";
import {ScoreModelSchema} from "./score-research-model";
import {Address} from "./model";

export const SCORE_FOLLOWUP_LIMITS={slots:5,cohorts:500,cooldown_ms:900000,before_ms:1800000,after_ms:7200000} as const;
const Time=z.string().datetime(),Count=z.number().int().nonnegative();
export const ScoreFollowupRowSchema=z.object({address:Address,model:ScoreModelSchema,pool:Address,cohort_hash:z.string().regex(/^[a-f0-9]{64}$/),captured_at:Time,target_at:Time,window_end:Time,phase:z.enum(["pre_target","post_target"]),last_attempt:Time.nullable()}).strict();
export const ScoreFollowupSchema=z.object({policy:z.literal("score-endpoint-followup-v1"),at:Time,provider:z.enum(["geckoterminal","dexscreener"]),state:z.enum(["disabled","paused","waiting","ready","no_work"]),scope:z.literal("latest_500_pending_score_cohorts"),capped:z.boolean(),max_batch_slots:z.literal(5),cooldown_seconds:z.literal(900),next_window_at:Time.nullable(),market_next_at:Time.nullable(),market_error:z.string().nullable(),counts:z.object({pending:Count,baseline_unavailable:Count,provider_mismatch:Count,identity_unavailable:Count,awaiting_window:Count,awaiting_target:Count,window_closed:Count,endpoint_saved:Count,cooling_down:Count,ready:Count}).strict(),ready:z.array(ScoreFollowupRowSchema).max(5),provider_requests:z.literal(0)}).strict();
