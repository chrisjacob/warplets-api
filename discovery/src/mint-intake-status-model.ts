import { z } from "zod";
import { Address } from "./model";
export const MintIntakeReview = z.object({
  state: z.enum(["queued", "scanning", "admitted", "unsupported_quote", "not_found", "expired"]),
  queued_at: z.string().datetime(), updated_at: z.string().datetime(),
  pages: z.number().int().min(0).max(3), bodies_checked: z.number().int().min(0).max(90),
  last_error: z.string().regex(/^[a-z0-9_]{1,100}$/).nullable(),
}).strict();
export const MintIntakeStatus = z.object({
  version: z.literal("mint-intake-status-v1"), chain: z.literal("solana"), address: Address, at: z.string().datetime(),
  scope: z.literal("bounded_pump_fun_wsol_migration_review"), review: MintIntakeReview.nullable(),
  candidate_saved: z.boolean(), migration_lead_saved: z.boolean(),
  control: z.object({ paused: z.boolean(), retry_after: z.string().datetime().nullable(), next_refresh_at: z.string().datetime().nullable(),
    reserved_today: z.number().int().min(0).max(20) }).strict(),
  provider_requests: z.literal(0), database_writes: z.literal(0), scoring_effect: z.literal("none"), evidence_gates_changed: z.literal(false),
}).strict().superRefine((value, context) => {
  if (value.review && (Date.parse(value.review.queued_at) > Date.parse(value.review.updated_at) || Date.parse(value.review.updated_at) > Date.parse(value.at))) context.addIssue({ code: "custom", message: "intake_status_time_order" });
});
export type MintIntakeStatus = z.infer<typeof MintIntakeStatus>;
