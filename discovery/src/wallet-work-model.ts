import { z } from "zod";
export const WalletWorkSchema = z.object({
  address: z.string(), symbol: z.string(), source_evidence_hash: z.string(),
  snapshot_at: z.string().datetime(), attempted_at: z.string().datetime(),
  stage: z.enum(["direct_funding", "refresh_required", "source_limited"]),
  windows: z.number().int().nonnegative(), examined_windows: z.number().int().nonnegative(),
  pending_transactions: z.number().int().nonnegative(), decoded_transactions: z.number().int().nonnegative(),
  rpc_calls: z.number().int().nonnegative(), gaps: z.array(z.string()),
});
export type WalletWork = z.infer<typeof WalletWorkSchema>;
export const WalletWorkResponseSchema = z.object({ data: z.object({ work: z.array(WalletWorkSchema).max(20), catchup_reserved: z.number(), catchup_limit: z.number(), snapshot_refresh_required: z.literal(true) }) });
