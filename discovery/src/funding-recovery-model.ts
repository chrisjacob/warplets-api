import { z } from "zod";
import { Address, Signature } from "./model";
import { TRANSACTION_READER_VERSION } from "./inbox-recovery-model";
export const FUNDING_RECOVERY_DAILY_LIMIT = 20;
export const FUNDING_RECOVERY_PER_TURN = 2;
export const FundingReadSchema = z.object({
  signature: Signature, address: Address.nullable(), hop: z.enum(["direct", "second"]).nullable(),
  reader_version: z.string().max(80), expected_slot: z.number().int().safe().nonnegative(),
  started_at: z.string().datetime(), finished_at: z.string().datetime().nullable(),
  state: z.enum(["reading", "finished"]), outcome: z.string().max(80).nullable(),
  payload_hash: z.string().regex(/^[a-f0-9]{64}$/).nullable(),
}).strict();
export const FundingRecoveryStatusSchema = z.object({
  reader_version: z.literal(TRANSACTION_READER_VERSION), daily_limit: z.literal(FUNDING_RECOVERY_DAILY_LIMIT),
  per_turn_limit: z.literal(FUNDING_RECOVERY_PER_TURN), used_today: z.number().int().nonnegative(),
  remaining_today: z.number().int().nonnegative(), recent: z.array(FundingReadSchema).max(10),
  provider_requests: z.literal(0), evidence_gates_changed: z.literal(false),
}).strict();
