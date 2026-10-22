import{z}from"zod";
import{Address,Signature}from"./model";
import{GmgnCorroborationInputSchema,GmgnCorroborationReportSchema}from"./gmgn-corroboration-model";

const Hash=z.string().regex(/^[a-f0-9]{64}$/),Time=z.string().datetime(),Count=z.number().int().min(0).max(50);
export const GmgnEventSamplePlanSchema=z.object({version:z.literal("gmgn-event-sample-plan-v1"),activity_id:z.uuid(),cutoff_at:Time,
  activity_received_at:Time,source_receipt_hash:Hash,source_report_hash:Hash,
  selection:z.literal("two_sided_then_repeated_same_side_size_then_signature"),
  selected:z.array(z.object({signature:Signature,event_indices:z.array(z.number().int().min(0).max(49)).min(1).max(50),reason:z.enum(["two_sided","repeated_same_side_size","signature_order"])}).strict()).max(2),
  page_events:Count,page_transactions:Count,page_trade_events:Count,selected_events:Count,selected_trade_events:Count,unselected_events:Count,unselected_trade_events:Count,
  state:z.enum(["ready","held"]),hold_reason:z.enum(["selected_event_bound_exceeded","no_trade_transactions"]).nullable(),
  representative_sample:z.literal(false),live_collection_enabled:z.literal(false),provider_requests:z.literal(0),database_writes:z.literal(0),scoring_effect:z.literal("none"),plan_hash:Hash}).strict();
export const GmgnEventSampleInputSchema=GmgnCorroborationInputSchema.extend({version:z.literal("gmgn-event-sample-input-v1"),plan:GmgnEventSamplePlanSchema});
export const GmgnEventSampleReportSchema=z.object({version:z.literal("gmgn-event-sample-comparison-v1"),activity_id:z.uuid(),address:Address,cutoff_at:Time,
  source_report_hash:Hash,plan_hash:Hash,state:z.enum(["held","cache_missing","compared_sample"]),page_events:Count,selected_events:Count,selected_trade_events:Count,unselected_events:Count,unselected_trade_events:Count,
  required_transactions:z.number().int().min(0).max(2),cached_transactions:z.number().int().min(0).max(2),
  exact_quantity_events:z.number().int().min(0).max(20),aggregate_only_events:z.number().int().min(0).max(20),groups:GmgnCorroborationReportSchema.shape.groups,
  gaps:z.array(z.string()).max(12),representative_sample:z.literal(false),finality_independently_attested:z.literal(false),usd_volume_verified:z.literal(false),organic_volume_usd:z.null(),
  live_collection_enabled:z.literal(false),provider_requests:z.literal(0),database_writes:z.literal(0),scoring_effect:z.literal("none"),evidence_gates_changed:z.literal(false),input_hash:Hash,report_hash:Hash}).strict();

export type GmgnEventSampleReport=z.infer<typeof GmgnEventSampleReportSchema>;
// Archived v1 remains replayable with its original disconnected-collector claim.
export const GmgnEventSampleCurrentReportSchema=GmgnEventSampleReportSchema.omit({live_collection_enabled:true}).extend({
  version:z.literal("gmgn-event-sample-comparison-v2"),collection_mode:z.literal("explicit_operator_only")
});
export const GmgnEventSampleAnyReportSchema=z.union([GmgnEventSampleReportSchema,GmgnEventSampleCurrentReportSchema]);
export type GmgnEventSampleAnyReport=z.infer<typeof GmgnEventSampleAnyReportSchema>;
