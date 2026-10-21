import { z } from "zod";
import { Address } from "./model";
import { HolderHistoryInputSchema, HolderHistoryReportSchema } from "./holder-history-model";

export const HOLDER_ACQUISITION_LIMITS = { wallet_bytes: 1_800_000, input_bytes: 11_000_000 } as const;
const Hash = z.string().regex(/^[a-f0-9]{64}$/), Count = z.number().int().min(0).max(5000);
export const AcquisitionWalletMetaSchema = z.object({ evidence_hash: Hash, address: Address, observed_at: z.string().datetime(), bytes: z.number().int().nonnegative() }).strict();
export const HolderAcquisitionInputSchema = z.object({ version: z.literal("holder-acquisition-input-v1"),
  history: HolderHistoryInputSchema, selection: z.literal("latest_wallet_receipt_before_cutoff"),
  wallet_index: z.array(AcquisitionWalletMetaSchema).max(2),
  wallet: z.object({ evidence_hash: Hash, raw_hash: Hash, evidence: z.unknown() }).strict().nullable() }).strict();
export type HolderAcquisitionInput = z.infer<typeof HolderAcquisitionInputSchema>;
export const AcquisitionIntervalSchema = z.object({ status: z.enum(["measured_sample", "held"]),
  start_hash: Hash, end_hash: Hash, start_at: z.string().datetime(), end_at: z.string().datetime(),
  raw_entrants: Count.nullable(), supported_net_buy_entrants: Count.nullable(), acquisition_unknown_entrants: Count.nullable(),
  interval_sampled_trades: z.number().int().min(0).max(100), finalized_matched_transactions: z.number().int().min(0).max(64),
  exclusions: z.object({ missing_finalized_history: Count, two_sided_or_round_trip: Count, mixed_or_nonpositive_transaction_flow: Count,
    quote_flow_unknown: Count, endpoint_balance_below_sampled_acquisition: Count }).strict(),
  gaps: z.array(z.string()).max(16) }).strict();
export const HolderAcquisitionReportSchema = z.object({ version: z.literal("holder-acquisition-v1"), history: HolderHistoryReportSchema,
  selection: z.literal("latest_wallet_receipt_before_cutoff"), wallet_evidence_hash: Hash.nullable(), wallet_raw_hash: Hash.nullable(),
  wallet_observed_at: z.string().datetime().nullable(), wallet_stale: z.boolean(), wallet_records: z.number().int().min(0).max(64),
  since_first: AcquisitionIntervalSchema.nullable(), recent: AcquisitionIntervalSchema.nullable(), gaps: z.array(z.string()).max(20),
  meaningful_holder_growth: z.null(), organic_demand_certified: z.literal(false), beneficial_independence_verified: z.literal(false),
  population_trade_coverage: z.literal("unknown"), scoring_effect: z.literal("none"), evidence_gates_changed: z.literal(false),
  provider_requests: z.literal(0), database_writes: z.literal(0), input_hash: Hash, report_hash: Hash }).strict();
export type HolderAcquisitionReport = z.infer<typeof HolderAcquisitionReportSchema>;
