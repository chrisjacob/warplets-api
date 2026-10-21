import{z}from"zod";
import{GmgnCorroborationStatusSchema}from"./gmgn-corroboration-model";
const Raw=z.string().regex(/^\d+$/).max(40).nullable(),Amount=z.number().finite().nonnegative().nullable(),Hash=z.string().regex(/^[a-f0-9]{64}$/),Count=z.number().int().min(0).max(100);
export const GmgnQuoteGroupSchema=z.object({side:z.enum(["buy","sell"]),events:Count,token_match:GmgnCorroborationStatusSchema,quote_kinds:z.array(z.enum(["native_lamports","wsol_raw"])).max(2),
  pool_quote_transfer_raw:Raw,reported_usd:Amount,implied_usd_per_sol:Amount,fee_rows:Count,fee_status:z.enum(["known_layout_complete","partial","unavailable"]),event_quote_raw:Raw,known_fee_raw:Raw,wallet_swap_cashflow_raw:Raw,gaps:z.array(z.string()).max(20)}).strict();
export const GmgnQuoteReportSchema=z.object({version:z.literal("gmgn-quote-review-v1"),activity_id:z.uuid(),address:z.string(),cutoff_at:z.string().datetime(),comparison_hash:Hash,
  status:z.enum(["reviewed_sample","held"]),reported_trade_events:Count,supported_events:Count,quote_decimals:z.literal(9),buy_pool_quote_transfer_raw:Raw,sell_pool_quote_transfer_raw:Raw,
  groups:z.array(GmgnQuoteGroupSchema).max(20),gaps:z.array(z.string()).max(20),historical_usd_verified:z.literal(false),organic_volume_usd:z.null(),scoring_effect:z.literal("none"),evidence_gates_changed:z.literal(false),provider_requests:z.literal(0),database_writes:z.literal(0),report_hash:Hash}).strict();
export type GmgnQuoteReport=z.infer<typeof GmgnQuoteReportSchema>;
