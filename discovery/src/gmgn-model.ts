import { z } from "zod";
import { Address } from "./model";
// Founder explicitly authorized storage/display on 21 October after the earlier
// rights question. This records that authority, not a provider licence grant.
export const GMGN_USE_AUTHORITY = "founder-direction-2026-10-21";
export const GmgnPublicSummarySchema = z.object({
  version: z.literal("gmgn-summary-v1"), address: Address,
  use_authority: z.literal(GMGN_USE_AUTHORITY), provider_rights_independently_confirmed: z.literal(false),
  observations: z.number().int().min(0).max(4), received_at: z.string().datetime().nullable(),
  provider_observed_at: z.null(), stale: z.boolean(),
  reported_volume_24h_usd: z.number().finite().nonnegative().nullable(), reported_volume_1h_usd: z.number().finite().nonnegative().nullable(),
  reported_holder_count: z.number().int().safe().nonnegative().nullable(),
  provider_wash_flag: z.boolean().nullable(), provider_rug_ratio: z.number().min(0).max(1).nullable(),
  provider_insider_hold_ratio: z.number().min(0).max(1).nullable(), provider_bundler_volume_ratio: z.number().min(0).max(1).nullable(),
  candle_count: z.number().int().min(0).max(360).nullable(), candle_window_complete: z.boolean().nullable(),
  candle_window_volume_usd: z.number().finite().nonnegative().nullable(),
  gaps: z.array(z.string().max(100)).max(30),
  organic_volume_usd: z.null(), meaningful_holder_growth: z.null(), scoring_effect: z.literal("none"),
});
export type GmgnPublicSummary = z.infer<typeof GmgnPublicSummarySchema>;
