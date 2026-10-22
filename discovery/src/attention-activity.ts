import { z } from "zod";
import { GmgnRequestSchema } from "./gmgn-request";
import { normalizeGmgn } from "./gmgn-normalize";
import { replayGmgnActivityRecord } from "./gmgn-activity-replay";
import { hashJson } from "./solana";
import { AttentionActivityReview,AttentionActivityIssue } from "./attention-activity-model";
import { GmgnActivityShape } from "./gmgn-activity-shape";

type Saved={request:unknown;receipt:unknown};
export function attentionActivityIssue(id:string,saved:Saved) {
  const request=GmgnRequestSchema.parse(saved.request);
  if(request.kind!=="gmgn_wallet_activity"||!/^attention-traders-\d{10}$/.test(request.selection_id))throw Error("attention_activity_scope_mismatch");
  const receipt=z.object({received_at:z.iso.datetime(),status:z.number().nullable(),error:z.string(),activity_validation_fields:z.array(z.string()).optional(),activity_validation_shape:GmgnActivityShape.optional()}).parse(saved.receipt);
  return AttentionActivityIssue.parse({chain:"solana",address:request.address,request_id:id,received_at:receipt.received_at,
    http_status:receipt.status,error:receipt.error,fields:receipt.activity_validation_fields??[],...(receipt.activity_validation_shape?{shape:receipt.activity_validation_shape}:{})});
}
// Both receipts are hash-checked by the store before entry. Replay the complete
// original selection too: wallet/mint/source tampering must never become data.
export async function normalizeAttentionActivity(id:string,saved:Saved,source:Saved) {
  const request=GmgnRequestSchema.parse(saved.request),sourceRequest=GmgnRequestSchema.parse(source.request);
  if(request.kind!=="gmgn_wallet_activity"||!/^attention-traders-\d{10}$/.test(request.selection_id)||sourceRequest.kind!=="gmgn_token_traders")throw Error("attention_activity_scope_mismatch");
  const time=z.object({received_at:z.iso.datetime()}),receipt=time.parse(saved.receipt),selection=time.parse(source.receipt);
  const sourceRecord={version:"gmgn-trader-replay-v1",request:sourceRequest,receipt:source.receipt,receipt_hash:await hashJson(source.receipt),
    report_hash:await hashJson(normalizeGmgn(sourceRequest,z.object({response:z.unknown()}).parse(source.receipt).response,selection.received_at))};
  const response=z.object({response:z.unknown()}).parse(saved.receipt).response,observation=normalizeGmgn(request,response,receipt.received_at);
  await replayGmgnActivityRecord({version:"gmgn-wallet-activity-replay-v1",request,receipt:saved.receipt,receipt_hash:await hashJson(saved.receipt),
    report_hash:await hashJson(observation),selection_record:sourceRecord});
  return AttentionActivityReview.parse({chain:"solana",address:request.address,request_id:id,received_at:receipt.received_at,
    selection_received_at:selection.received_at,activity:observation.metrics,response_identity:"token_echo_wallet_request_context"});
}
