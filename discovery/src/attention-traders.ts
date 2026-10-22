import { GmgnRequestSchema, gmgnEnvelope } from "./gmgn-request";
import { normalizeGmgnTraders } from "./gmgn-traders";
import { AttentionTraderReview } from "./attention-trader-model";

// Replay request/receipt/body hashes before calling. This ranked sample has no
// documented period or population coverage, and cannot certify organic flow.
export function normalizeAttentionTraders(id:string,rawRequest:unknown,body:unknown,receivedAt:string) {
  const request=GmgnRequestSchema.parse(rawRequest);
  if(request.kind!=="gmgn_token_traders")throw Error("attention_trader_scope_mismatch");
  return AttentionTraderReview.parse({chain:"solana",address:request.address,request_id:id,received_at:receivedAt,
    sample:normalizeGmgnTraders(gmgnEnvelope(body),receivedAt),response_identity:"request_context_only"});
}
