import { z } from "zod";
import { Signature } from "./model";

export const TRANSACTION_READER_VERSION = "solana-json-legacy-v0-v1-r1";
export const INBOX_RECOVERY_DAILY_LIMIT = 20;
export const INBOX_RECOVERY_PER_TURN = 2;
export const InboxReadSchema = z.object({
  signature: Signature, reader_version: z.string().max(80), expected_slot: z.number().int().safe().nonnegative(),
  prior_processed_at: z.string().datetime().nullable(), started_at: z.string().datetime(), finished_at: z.string().datetime().nullable(),
  state: z.enum(["reading","finished"]), outcome: z.string().max(80).nullable(), payload_hash: z.string().regex(/^[a-f0-9]{64}$/).nullable(),
}).strict();
export const InboxRecoveryResponse = z.object({data:z.object({
  at:z.string().datetime(),reader_version:z.literal(TRANSACTION_READER_VERSION),
  daily_limit:z.literal(INBOX_RECOVERY_DAILY_LIMIT),per_turn_limit:z.literal(INBOX_RECOVERY_PER_TURN),
  used_today:z.number().int().nonnegative(),remaining_today:z.number().int().nonnegative(),
  pending_recent:z.number().int().nonnegative(),older_unsupported:z.number().int().nonnegative(),
  recent:z.array(InboxReadSchema).max(10),provider_requests:z.literal(0),evidence_gates_changed:z.literal(false),
}).strict()});
