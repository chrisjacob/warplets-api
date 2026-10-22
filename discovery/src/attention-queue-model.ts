import { z } from "zod";
import { AttentionToken } from "./attention-feed-contract";
import { AttentionCandleReview } from "./attention-candle-model";
import { AttentionTraderReview } from "./attention-trader-model";
import { AttentionActivityReview,AttentionActivityIssue } from "./attention-activity-model";

export const AttentionSource = z.object({ provider: z.enum(["gmgn", "geckoterminal", "dexscreener"]), window: z.enum(["1h", "6h", "24h"]),
  received_at: z.iso.datetime(), rank: z.number().nullable(), previous_rank: z.number().nullable(), search_interest: z.number().nullable(), fresh: z.boolean() });
export const AttentionQueue = z.object({ version: z.literal("attention-queue-v1"), as_of: z.iso.datetime(),
  rows: z.array(AttentionToken.extend({ sources: z.array(AttentionSource).max(6), attention_families: z.number().int(), observed_hours: z.number().int(),
    checks: z.enum(["adverse", "review"]), reasons: z.array(z.string()).max(20), market_crosschecked: z.boolean(),
    market_source: z.enum(["gmgn","geckoterminal","dexscreener"]).nullable().default(null),
    recent_volume_source: z.enum(["gmgn","geckoterminal","dexscreener"]).nullable().default(null) })).max(100),
  candle_reviews:z.array(AttentionCandleReview).max(8).default([]),
  trader_reviews:z.array(AttentionTraderReview).max(6).default([]),
  activity_reviews:z.array(AttentionActivityReview).max(2).default([]),
  activity_issues:z.array(AttentionActivityIssue).max(2).default([]),
  observed_tokens: z.number().int(), returned_tokens: z.number().int(), excluded_launched: z.number().int(), snapshot_count: z.number().int(),
  history_truncated: z.boolean(), gaps: z.array(z.string()).max(60), provider_requests: z.literal(0), database_writes: z.literal(0),
  launch_history_connected: z.literal(false), launch_enabled: z.literal(false), scoring_effect: z.literal("none"), evidence_gates_changed: z.literal(false) });
export type AttentionQueueResult = z.infer<typeof AttentionQueue>;
