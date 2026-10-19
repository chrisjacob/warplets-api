import { z } from "zod";

export const HolderSchema = z.object({
  version: z.enum(["owners-v1", "owners-v2"]), status: z.enum(["verified", "partial", "unavailable"]),
  layout_certified: z.boolean().default(false),
  observed_at: z.string().datetime(), context_slot: z.number().int().safe().nonnegative().nullable(),
  payload_hash: z.string().regex(/^[a-f0-9]{64}$/).nullable(),
  supply_raw: z.string().regex(/^\d+$/), inventoried_raw: z.string().regex(/^\d+$/),
  account_count: z.number().int().nonnegative(), holder_count: z.number().int().nonnegative(),
  top1_pct: z.number().min(0).max(100).nullable(), top10_pct: z.number().min(0).max(100).nullable(),
  pool_pct: z.number().min(0).max(100).nullable(), creator_pct: z.number().min(0).max(100).nullable(),
  creator: z.string().nullable(),
  owners: z.array(z.object({ owner: z.string(), amount_raw: z.string(), supply_pct: z.number().min(0).max(100), role: z.enum(["holder", "canonical_pool_vault"]) })).max(20),
  gaps: z.array(z.string()).max(20),
}).strict();
export type HolderAnalysis = z.infer<typeof HolderSchema>;
