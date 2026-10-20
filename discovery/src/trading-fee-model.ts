import { z } from "zod";
import { validAddress } from "./solana";
const Key=z.string().refine(validAddress), Raw=z.string().regex(/^\d+$/).max(30), Hash=z.string().regex(/^[a-f0-9]{64}$/);
export const TradingFeeRowSchema=z.object({
  signature:z.string(),instruction_index:z.string(),event_instruction_index:z.string(),program:z.enum(["pump","pumpswap"]),side:z.enum(["buy","sell"]),slot:z.number().int(),block_time:z.string().datetime(),wallet:Key,
  quote_amount_raw:Raw,protocol_gross_raw:Raw,protocol_net_raw:Raw,buyback_raw:Raw,creator_raw:Raw,lp_raw:Raw,total_fee_raw:Raw,
  verification:z.literal("event_and_execution_reconciled"),transaction_hash:Hash,event_hash:Hash,
  transfers:z.array(z.object({component:z.enum(["quote","protocol","creator","buyback"]),instruction_index:z.string(),from:Key,to:Key,amount_raw:Raw})).max(4),
  gaps:z.array(z.string()).max(10),
}).strict();
export type TradingFeeRow=z.infer<typeof TradingFeeRowSchema>;
export const TradingFeesSchema=z.object({
  version:z.literal("pump-fees-v1"),descriptor_revision:z.string(),status:z.enum(["verified_sample","partial","unavailable"]),scope:z.literal("verified_swap_sample_not_24h_totals"),
  quote_mint:Key,quote_decimals:z.literal(9),sampled_trades:z.number().int().nonnegative(),verified_trades:z.number().int().nonnegative(),unverified_trades:z.number().int().nonnegative(),
  protocol_gross_raw:Raw.nullable(),protocol_net_raw:Raw.nullable(),buyback_raw:Raw.nullable(),creator_raw:Raw.nullable(),lp_raw:Raw.nullable(),total_fee_raw:Raw.nullable(),quote_volume_raw:Raw.nullable(),
  rows:z.array(TradingFeeRowSchema).max(100),unverified:z.array(z.object({signature:z.string(),instruction_index:z.string(),reason:z.string()})).max(100),gaps:z.array(z.string()).max(20),
}).strict();
export type TradingFees=z.infer<typeof TradingFeesSchema>;
