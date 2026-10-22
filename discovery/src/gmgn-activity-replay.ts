import {z} from "zod";
import {GmgnRequestSchema} from "./gmgn-request";
import {GMGN_USE_AUTHORITY} from "./gmgn-model";
import {gmgnActivitySelection} from "./gmgn-activity-selection";
import {normalizeGmgn} from "./gmgn-normalize";
import {boundedJsonValue} from "./source-pilot";
import {hashJson} from "./solana";
import {gmgnActivityContract,GMGN_ACTIVITY_RESEARCH_VALIDATION} from "./gmgn-wallet-activity";
const Hash=z.string().regex(/^[a-f0-9]{64}$/);
export const GMGN_ACTIVITY_REPLAY_BYTES=4_000_000;
export async function replayGmgnActivityRecord(raw:unknown){
  boundedJsonValue(raw,GMGN_ACTIVITY_REPLAY_BYTES);
  const record=z.object({version:z.literal("gmgn-wallet-activity-replay-v1"),request:GmgnRequestSchema,receipt:z.unknown(),receipt_hash:Hash,report_hash:Hash,selection_record:z.unknown()}).strict().parse(raw);
  if(record.request.kind!=="gmgn_wallet_activity")throw Error("gmgn_activity_replay_kind");
  const receipt=z.object({version:z.literal("source-fetch-receipt-v1"),request_hash:Hash,response_hash:Hash,reserved_at:z.string().datetime(),received_at:z.string().datetime(),status:z.number().int().min(200).max(299),error:z.null(),response:z.unknown(),access_probe:z.literal(false),access_accepted:z.literal(true),research_permission_reference:z.literal(GMGN_USE_AUTHORITY),semantic_validation:z.enum(["gmgn_selected_fields_v2",GMGN_ACTIVITY_RESEARCH_VALIDATION]),canonical_pool_proof:z.literal("not_checked"),scoring_effect:z.literal("none")}).passthrough().parse(record.receipt);
  if(Date.parse(receipt.reserved_at)>Date.parse(receipt.received_at)||await hashJson(record.request)!==receipt.request_hash||await hashJson(record.receipt)!==record.receipt_hash||await hashJson(receipt.response)!==receipt.response_hash)throw Error("gmgn_activity_replay_hash_mismatch");
  const selected=await gmgnActivitySelection(record.selection_record,new Date(receipt.reserved_at));
  if(selected.address!==record.request.address||selected.wallet!==record.request.wallet||selected.selection_hash!==record.request.selection_hash)throw Error("gmgn_activity_replay_selection_mismatch");
  const observation=normalizeGmgn(record.request,receipt.response,receipt.received_at,undefined,undefined,"v2",gmgnActivityContract(receipt.semantic_validation));
  if(await hashJson(observation)!==record.report_hash)throw Error("gmgn_activity_replay_report_mismatch");
  return{observation,receipt_hash:record.receipt_hash,report_hash:record.report_hash,provider_requests:0,database_writes:0};
}
