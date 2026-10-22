import { z } from "zod";
import { GmgnRequestSchema, gmgnEnvelope } from "./gmgn-request";
import { corroborateGmgnUnits } from "./gmgn-candle-units";
import { normalizeGmgnCandles } from "./gmgn-candles";
import { AttentionCandleReview, type AttentionCandleResult } from "./attention-candle-model";

// Call only after the stored request/receipt/body hashes have been replayed.
// Reuse the exact v2 validator: no filled holes, guessed units or mint proof.
export function normalizeAttentionCandles(id:string, rawRequest:unknown, body:unknown, receivedAt:string):AttentionCandleResult {
  const request=GmgnRequestSchema.parse(rawRequest);
  if(request.kind!=="gmgn_token_candles"||request.series||Date.parse(request.end_at)-Date.parse(request.start_at)!==3600000)throw Error("attention_candle_scope_mismatch");
  const metrics=normalizeGmgnCandles(gmgnEnvelope(body),request,Date.parse(z.iso.datetime().parse(receivedAt)));
  return AttentionCandleReview.parse({chain:"solana",address:request.address,request_id:id,received_at:receivedAt,
    window_start:request.start_at,window_end:request.end_at,candle_count:metrics.candle_count,expected_count:60,complete_window:metrics.complete_window,
    activity:{received_at:receivedAt,window_start:request.start_at,window_end:request.end_at,...metrics.activity},units:corroborateGmgnUnits(metrics.candles),
    response_identity:"request_context_only",organic_volume_verified:false});
}
