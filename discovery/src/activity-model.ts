import { z } from "zod";
export const ActivitySchema = z.object({
  address: z.string(), observed_at: z.string().datetime(), scope: z.literal("cached_bounded_observations"),
  organic_trading: z.literal("unverified"), volume_authenticity: z.literal("unverified"),
  wallet_evidence_hash: z.string().nullable(), wallet_observed_at: z.string().datetime().nullable(),
  fees: z.object({ network_fee_lamports_raw: z.string().regex(/^\d+$/).nullable(), transactions: z.number().int().nonnegative(), trades: z.number().int().nonnegative(), distinct_payers: z.number().int().nonnegative(), largest_payer_transaction_pct: z.number().min(0).max(100).nullable(), protocol_trading_fees: z.null(), lp_fees: z.null() }),
  wallets: z.object({ buyers: z.number().int().nonnegative(), sellers: z.number().int().nonnegative(), round_trips: z.number().int().nonnegative(), shared_funder_buyers: z.number().int().nonnegative() }).nullable(),
  prices: z.object({ samples: z.number().int().nonnegative(), upward_steps: z.number().int().nonnegative(), downward_steps: z.number().int().nonnegative(), unchanged_steps: z.number().int().nonnegative(), gaps: z.number().int().nonnegative(), largest_step_pct: z.number().nonnegative().nullable(), continuous_return_pct: z.number().nullable(), first_at: z.string().datetime().nullable(), last_at: z.string().datetime().nullable() }),
  gaps: z.array(z.string()),
}).strict();
