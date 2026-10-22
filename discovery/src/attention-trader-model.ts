import { z } from "zod";
import { Address } from "./model";
import { GmgnTraderSampleSchema } from "./gmgn-traders";

export const AttentionTraderReview=z.object({chain:z.literal("solana"),address:Address,
  request_id:z.string().regex(/^attention-traders-\d{10}$/),received_at:z.iso.datetime(),sample:GmgnTraderSampleSchema,
  response_identity:z.literal("request_context_only")}).strict()
  .refine(v=>v.received_at===v.sample.received_at,"Trader sample time mismatch.");
export type AttentionTraderResult=z.infer<typeof AttentionTraderReview>;
export function attentionTradersFresh(review:AttentionTraderResult,now:Date) {
  const age=now.getTime()-Date.parse(review.received_at);return age>=0&&age<=7200000;
}
