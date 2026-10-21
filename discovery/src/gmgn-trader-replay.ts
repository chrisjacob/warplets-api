import {z} from "zod";
import {GmgnRequestSchema} from "./gmgn-request";
import {GMGN_USE_AUTHORITY} from "./gmgn-model";
import {normalizeGmgn} from "./gmgn-normalize";
import {boundedJsonValue} from "./source-pilot";
import {hashJson} from "./solana";
const Hash=z.string().regex(/^[a-f0-9]{64}$/);
export const GMGN_TRADER_REPLAY_BYTES=2_000_000;
const RecordSchema=z.object({version:z.literal("gmgn-trader-replay-v1"),request:GmgnRequestSchema,receipt:z.unknown(),receipt_hash:Hash,report_hash:Hash}).strict();
export async function replayGmgnTraderRecord(raw:unknown){
  boundedJsonValue(raw,GMGN_TRADER_REPLAY_BYTES);const record=RecordSchema.parse(raw);
  if(record.request.kind!=="gmgn_token_traders")throw Error("gmgn_trader_replay_kind");
  const receipt=z.object({version:z.literal("source-fetch-receipt-v1"),request_hash:Hash,response_hash:Hash,reserved_at:z.string().datetime(),received_at:z.string().datetime(),
    status:z.number().int().min(200).max(299),error:z.null(),response:z.unknown(),access_probe:z.literal(false),access_accepted:z.literal(true),
    research_permission_reference:z.literal(GMGN_USE_AUTHORITY),semantic_validation:z.literal("gmgn_selected_fields_v2"),canonical_pool_proof:z.literal("not_checked"),scoring_effect:z.literal("none")}).passthrough().parse(record.receipt);
  if(Date.parse(receipt.reserved_at)>Date.parse(receipt.received_at)||await hashJson(record.request)!==receipt.request_hash||await hashJson(record.receipt)!==record.receipt_hash||await hashJson(receipt.response)!==receipt.response_hash)throw Error("gmgn_trader_replay_hash_mismatch");
  const observation=normalizeGmgn(record.request,receipt.response,receipt.received_at);
  if(await hashJson(observation)!==record.report_hash)throw Error("gmgn_trader_replay_report_mismatch");
  return{observation,report_hash:record.report_hash,receipt_hash:record.receipt_hash,provider_requests:0 as const,database_writes:0 as const};
}
