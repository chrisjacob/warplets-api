import { z } from "zod";
export const CoverageSchema = z.object({
  target: z.literal(10), observed: z.number(), created_24h: z.number(), creation_unknown: z.number(),
  eligible: z.number(), market_floor_met: z.number(), holder_checks_met: z.number(), remaining: z.number(),
  blockers: z.array(z.object({ code: z.string(), count: z.number() })).max(12),
  at: z.string().datetime(), scope: z.literal("stored_candidates_not_exhaustive"),
});
