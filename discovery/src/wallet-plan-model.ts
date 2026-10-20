import { z } from "zod";
import { Address } from "./model";
import { FundingRecoveryStatusSchema } from "./funding-recovery-model";
export const WalletPlanSchema = z.object({
  address: Address, symbol: z.string(), source_evidence_hash: z.string().nullable(), snapshot_at: z.string().datetime().nullable(),
  stage: z.enum(["new_snapshot", "direct_funding", "reader_recovery", "refresh_required", "source_limited", "cache_invalid"]),
  windows: z.number().int().nonnegative(), examined_windows: z.number().int().nonnegative(), blocked_windows: z.number().int().nonnegative(),
  pending_bodies: z.number().int().nonnegative(), cached_pending_bodies: z.number().int().nonnegative().nullable(),
  cached_recoverable_markers:z.number().int().nonnegative().max(96).optional(),
  source_recoverable_markers:z.number().int().nonnegative().max(2).optional(),
  direct_wallet_limit:z.union([z.literal(8),z.literal(20)]).optional(),additional_windows:z.number().int().min(0).max(20).optional(),
  minimum_rpc_calls: z.number().int().positive().nullable(), gaps: z.array(z.string()),
}).strict();
export type WalletPlan = z.infer<typeof WalletPlanSchema>;
export const WalletYieldSchema = z.object({
  since: z.string().datetime(), turns: z.number(), rpc_calls: z.number(), completed_windows: z.number(),
  new_buyer_observations: z.number(), snapshots: z.number(), failed_turns: z.number(),
  rpc_per_completed_window: z.number().nullable(),
}).strict();
export const WalletPlansResponseSchema = z.object({ data: z.object({
  at: z.string().datetime(), scope: z.literal("up_to_20_current_contenders"), capped: z.boolean(),
  plans: z.array(WalletPlanSchema).max(20), yield: WalletYieldSchema,
  reader_recovery: FundingRecoveryStatusSchema.optional(),
  provider_requests: z.literal(0), evidence_gates_changed: z.literal(false),
}) });
