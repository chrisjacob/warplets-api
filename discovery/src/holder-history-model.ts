import { z } from "zod";
import { Address } from "./model";

export const HOLDER_HISTORY_LIMITS = { records: 96, selected: 3, snapshot_bytes: 3_000_000, input_bytes: 9_100_000 } as const;
const Hash = z.string().regex(/^[a-f0-9]{64}$/);
const Count = z.number().int().min(0).max(5000);
export const HolderArchiveMetaSchema = z.object({ payload_hash: Hash, address: Address, slot: z.number().int().safe().nonnegative(),
  observed_at: z.string().datetime(), bytes: z.number().int().nonnegative() }).strict();
export const HolderHistoryInputSchema = z.object({ version: z.literal("holder-history-input-v1"), address: Address,
  cutoff_at: z.string().datetime(), selection: z.literal("first_and_latest_two_within_24h"),
  index: z.array(HolderArchiveMetaSchema).max(HOLDER_HISTORY_LIMITS.records + 1),
  samples: z.array(z.object({ payload_hash: Hash, evidence: z.unknown() }).strict()).max(HOLDER_HISTORY_LIMITS.selected),
}).strict();
export type HolderHistoryInput = z.infer<typeof HolderHistoryInputSchema>;
export const HolderHistorySnapshotSchema = z.object({ payload_hash: Hash, observed_at: z.string().datetime(),
  context_slot: z.number().int().safe().nonnegative(), mint_slot: z.number().int().safe().nonnegative(),
  pool: Address, program: Address, supply_raw: z.string().regex(/^\d+$/), account_count: Count, raw_owner_count: Count,
  complete: z.boolean(), layout_certified: z.boolean(), acquisition_provenance: z.literal("unknown"), gaps: z.array(z.string()).max(20) }).strict();
export const HolderHistoryDeltaSchema = z.object({ status: z.enum(["measured", "held"]),
  start_at: z.string().datetime(), end_at: z.string().datetime(), duration_seconds: z.number().finite().nonnegative(),
  start_hash: Hash, end_hash: Hash, starting_owners: Count.nullable(), ending_owners: Count.nullable(),
  entrants: Count.nullable(), exits: Count.nullable(), retained: Count.nullable(), net_change: z.number().int().min(-5000).max(5000).nullable(),
  raw_growth_pct: z.number().finite().nullable(), positive_balance_retention_pct: z.number().min(0).max(100).nullable(),
  gaps: z.array(z.string()).max(12) }).strict();
export const HolderHistoryReportSchema = z.object({ version: z.literal("holder-history-v1"), address: Address,
  cutoff_at: z.string().datetime(), requested_start: z.string().datetime(), status: z.enum(["no_history", "limited", "available"]),
  archive_records: z.number().int().min(0).max(97), archive_limit: z.literal(96), selection: z.literal("first_and_latest_two_within_24h"),
  snapshots: z.array(HolderHistorySnapshotSchema).max(3), since_first: HolderHistoryDeltaSchema.nullable(), recent: HolderHistoryDeltaSchema.nullable(),
  stale: z.boolean(), gaps: z.array(z.string()).max(20), input_hash: Hash, report_hash: Hash,
  meaningful_holder_growth: z.null(), trailing_24h_holder_growth: z.null(), since_creation_holder_growth: z.null(),
  organic_demand_certified: z.literal(false), acquisition_provenance: z.literal("unknown"), continuous_coverage: z.literal(false),
  scoring_effect: z.literal("none"), evidence_gates_changed: z.literal(false), provider_requests: z.literal(0), database_writes: z.literal(0),
}).strict();
export type HolderHistoryReport = z.infer<typeof HolderHistoryReportSchema>;
