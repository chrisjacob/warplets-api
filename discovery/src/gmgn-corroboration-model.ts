import{z}from"zod";
import{Signature}from"./model";
const Hash=z.string().regex(/^[a-f0-9]{64}$/),Time=z.string().datetime();
export const GMGN_CORROBORATION_BYTES=6_000_000,GMGN_CORROBORATION_CACHE_BYTES=1_800_000;
export const GmgnCorroborationInputSchema=z.object({version:z.literal("gmgn-rpc-input-v1"),activity_id:z.uuid(),cutoff_at:Time,activity_record:z.unknown(),transactions:z.array(z.object({signature:Signature,payload_hash:Hash,raw_hash:Hash,fetched_at:Time,transaction:z.unknown()}).strict()).max(2)}).strict();
export const GmgnCorroborationStatusSchema=z.enum(["exact_instruction_quantities","aggregate_quantity_only","quantity_conflict","time_conflict","wallet_or_side_not_supported","cache_missing","quantity_unknown","parser_held","transaction_failed"]);
export const GmgnCorroborationReportSchema=z.object({version:z.literal("gmgn-rpc-comparison-v1"),activity_id:z.uuid(),address:z.string(),cutoff_at:Time,activity_received_at:Time,activity_report_hash:Hash,
  status:z.enum(["compared_sample","held"]),required_transactions:z.number().int().min(0).max(20),cached_transactions:z.number().int().min(0).max(2),
  reported_trade_events:z.number().int().min(0).max(20),non_trade_events:z.number().int().min(0).max(20),
  exact_quantity_events:z.number().int().min(0).max(20),aggregate_only_events:z.number().int().min(0).max(20),
  groups:z.array(z.object({events:z.number().int().min(1).max(20),parsed_instructions:z.number().int().min(0).max(100),status:GmgnCorroborationStatusSchema}).strict()).max(20),
  gaps:z.array(z.string()).max(20),finality_independently_attested:z.literal(false),usd_volume_verified:z.literal(false),organic_volume_usd:z.null(),scoring_effect:z.literal("none"),evidence_gates_changed:z.literal(false),provider_requests:z.literal(0),database_writes:z.literal(0),input_hash:Hash,report_hash:Hash}).strict();
export type GmgnCorroborationReport=z.infer<typeof GmgnCorroborationReportSchema>;
