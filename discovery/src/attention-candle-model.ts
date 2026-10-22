import { z } from "zod";
import { Address } from "./model";
import { GmgnCandleReviewSchema, GmgnUnitsSchema } from "./gmgn-model";

export const AttentionCandleReview = z.object({
  chain:z.literal("solana"), address:Address, request_id:z.string().regex(/^attention-candles-\d{10}$/),
  received_at:z.iso.datetime(), window_start:z.iso.datetime(), window_end:z.iso.datetime(),
  candle_count:z.number().int().min(0).max(60), expected_count:z.literal(60), complete_window:z.boolean(),
  activity:GmgnCandleReviewSchema, units:GmgnUnitsSchema,
  response_identity:z.literal("request_context_only"), organic_volume_verified:z.literal(false),
});
export type AttentionCandleResult = z.infer<typeof AttentionCandleReview>;

// Recency of a receipt cannot freshen an old requested window.
export function attentionCandlesFresh(review:AttentionCandleResult, now:Date) {
  const at=now.getTime(),received=Date.parse(review.received_at),end=Date.parse(review.window_end);
  return received<=at&&end<=received&&at-received<=7200000&&at-end<=7200000;
}
