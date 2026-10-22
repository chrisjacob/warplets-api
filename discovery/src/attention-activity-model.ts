import { z } from "zod";
import { Address } from "./model";
import { GmgnWalletActivityAnySchema,GmgnActivityIssueSchema } from "./gmgn-wallet-activity";

export const AttentionActivityReview=z.object({chain:z.literal("solana"),address:Address,request_id:z.uuid(),
  received_at:z.iso.datetime(),selection_received_at:z.iso.datetime(),activity:GmgnWalletActivityAnySchema,
  response_identity:z.literal("token_echo_wallet_request_context")}).strict().refine(v=>
    v.received_at===v.activity.received_at&&Date.parse(v.selection_received_at)<=Date.parse(v.received_at)&&
    /^attention-traders-\d{10}$/.test(v.activity.source_request_id),"Activity source/time mismatch.");
export type AttentionActivityResult=z.infer<typeof AttentionActivityReview>;
export const AttentionActivityIssue=GmgnActivityIssueSchema.extend({chain:z.literal("solana"),address:Address,request_id:z.uuid()}).strict();
export type AttentionActivityIssueResult=z.infer<typeof AttentionActivityIssue>;
export function attentionActivityFresh(review:AttentionActivityResult,now:Date) {
  const age=now.getTime()-Date.parse(review.received_at);return age>=0&&age<=7200000;
}
