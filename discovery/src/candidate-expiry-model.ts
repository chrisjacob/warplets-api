import { z } from "zod";
import { Address, ProofSchema } from "./model";

export const CandidateExpirySchema = z.object({
  version: z.literal("verified-creation-expiry-v1"), address: Address,
  creation: ProofSchema.extend({kind:z.literal("creation")}), expired_at: z.string().datetime(),
}).strict();
export const CandidateExpiryReceiptSchema = CandidateExpirySchema.extend({receipt_hash:z.string().regex(/^[a-f0-9]{64}$/)});
export const InventoryStatusSchema = z.object({
  policy: z.literal("verified-creation-expiry-v1"), retained: z.number().int().nonnegative(),
  active: z.number().int().nonnegative(), expired: z.number().int().nonnegative(),
  active_limit: z.literal(500), active_over_limit: z.boolean(),
  last_expired_at: z.string().datetime().nullable(),
});
