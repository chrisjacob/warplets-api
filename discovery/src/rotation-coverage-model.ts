import { z } from "zod";
import { Address } from "./model";

export const RotationKind = z.enum(["gmgn_token_info", "gmgn_token_security", "gmgn_token_pool", "gmgn_token_candles"]);
const Count = z.number().int().min(0).max(16800);
const Counts = z.object({ attempted: Count, recorded_succeeded: Count, failed: Count, pending: Count, configured_weight: Count }).strict()
  .refine(v => v.attempted === v.recorded_succeeded + v.failed + v.pending, "rotation_attempt_partition");
const Target = z.object({ address: Address, first_selection: z.boolean(), prior_gmgn_attempts: z.number().int().safe().nonnegative(),
  newly_investigated: z.boolean(), kinds: z.array(z.object({ kind: RotationKind, counts: Counts }).strict()).length(4) }).strict();
const Day = z.object({ day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), manifest_cutoff: z.string().datetime().nullable(), manifest_hash: z.string().regex(/^[a-f0-9]{64}$/).nullable(),
  all_core_attempts: Count, scheduled_baseline_remaining: z.number().int().min(0).max(21),
  inventory: z.number().int().min(0).max(500), regression_fixtures: z.number().int().min(0).max(500), targets: z.array(Target).max(3), counts: Counts }).strict();
export const RotationCoverage = z.object({ version: z.literal("gmgn-rotation-coverage-v1"), cutoff: z.string().datetime(), window_days: z.literal(14),
  scope: z.literal("retained_selection_and_attempt_metadata"), days: z.array(Day).length(14), counts: Counts,
  distinct_selected: z.number().int().min(0).max(42), distinct_attempted: z.number().int().min(0).max(42), newly_investigated: z.number().int().min(0).max(42),
  new_investigation_days: z.number().int().min(0).max(14), target: z.object({ mints: z.literal(30), utc_days: z.literal(3), data_quality_pass: z.null() }).strict(),
  receipt_payloads_replayed: z.literal(false), provider_requests: z.literal(0), database_writes: z.literal(0), scoring_effect: z.literal("none"), evidence_gates_changed: z.literal(false) }).strict();
export type RotationCoverageReport = z.infer<typeof RotationCoverage>;
