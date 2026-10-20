import { z } from "zod";
import { Address, CandidateSchema, PolicySchema } from "./model";
import { TradeSchema } from "./wallet-model";
import { WalletTransactionSchema } from "./wallet-rpc";

const Hash = z.string().regex(/^[a-f0-9]{64}$/), Raw = z.string().regex(/^-?\d+$/).max(80);
export const BackingAssumptions = z.object({
  assumed_sol_usd: z.number().int().min(1).max(10000),
  minimum_trade_usd: z.number().int().min(1).max(1000),
  per_identity_cap_usd: z.number().int().min(1).max(1000000),
}).strict().refine(a => a.per_identity_cap_usd >= a.minimum_trade_usd, "Cap must be at least the minimum trade");
export const OpenBackingRequest = z.object({ request_id: z.uuid(), reason: z.string().min(3).max(300), duration_minutes: z.number().int().min(1).max(1440), assumptions: BackingAssumptions }).strict();
export const BackingOpening = z.object({
  version: z.literal("backing-opening-v1"), id: z.uuid(), starts_at: z.iso.datetime(), ends_at: z.iso.datetime(), deadline: z.iso.datetime(),
  assumptions: BackingAssumptions, policy: PolicySchema,
  candidates: z.array(CandidateSchema).max(20),
  members: z.array(z.object({ address: Address, identity_id: z.uuid(), linked_at: z.iso.datetime() }).strict()).max(1000),
  candidate_scope: z.literal("up_to_20_observed_contenders"),
}).strict();
export const CachedBackingTransaction = z.object({ signature: z.string(), payload_hash: Hash, fetched_at: z.iso.datetime(), transaction: WalletTransactionSchema }).strict();
export const BackingEvidence = z.object({
  version: z.literal("backing-evidence-v1"), frozen_at: z.iso.datetime(),
  closing_candidates: z.array(CandidateSchema).max(20),
  revoked_wallets: z.array(Address).max(1000), transactions: z.array(CachedBackingTransaction).max(100),
  scan_limited: z.boolean(), source: z.literal("cached_finalized_mainnet_rpc"),
}).strict();
export const BackingEntry = TradeSchema.extend({ mint: Address, identity_id: z.uuid().nullable(), reasons: z.array(z.string()).max(20) }).strict();
export const BackingGroup = z.object({
  mint: Address, identity_id: z.uuid(), buys: z.number().int(), sells: z.number().int(),
  net_base_raw: Raw, net_quote_lamports_raw: Raw, hypothetical_net_usd_micros: Raw,
  linear_projection_micros: Raw, sqrt_projection_micros: Raw, reasons: z.array(z.string()).max(30),
}).strict();
export const BackingResult = z.object({
  version: z.literal("backing-result-v1"), algorithm: z.literal("backing-experiment-v1"),
  outcome: z.literal("withheld"), winner_address: z.null(), voting_enabled: z.literal(false), rewards_enabled: z.literal(false),
  pricing: z.literal("hypothetical_fixed_SOL_USD_not_verified_valuation"), coverage: z.literal("bounded_cache_not_exhaustive"),
  entries: z.array(BackingEntry).max(1000), groups: z.array(BackingGroup).max(1000),
  projections: z.array(z.object({ mint: Address, symbol: z.string(), eligible_at_open: z.boolean(), eligible_at_close: z.boolean(), linear_micros: Raw, sqrt_micros: Raw, identities_projected: z.number().int(), identities_held: z.number().int() }).strict()).max(20),
  ignored_transactions: z.number().int().nonnegative(), max_examined_slot: z.number().int().safe().nullable(), gaps: z.array(z.string()).max(30),
}).strict();
export const BackingRecord = z.object({ opening: BackingOpening, opening_hash: Hash, evidence: BackingEvidence, evidence_hash: Hash, result: BackingResult, result_hash: Hash, record_hash: Hash }).strict();
export const BackingSummary = z.object({
  id: z.uuid(), starts_at: z.iso.datetime(), ends_at: z.iso.datetime(), deadline: z.iso.datetime(), state: z.enum(["open", "frozen"]),
  assumptions: BackingAssumptions, candidate_count: z.number().int(), eligible_at_open: z.number().int(), frozen_wallet_count: z.number().int(),
  entries: z.number().int(), groups: z.number().int(), projections: BackingResult.shape.projections,
  entry_reasons: z.record(z.string(),z.number().int().nonnegative()),
  opening_hash: Hash, record_hash: Hash.nullable(), replay: z.enum(["pending", "hash_checked"]), last_error: z.string().nullable(),
  outcome: z.literal("withheld"), voting_enabled: z.literal(false), gaps: z.array(z.string()),
}).strict();
export const BackingListResponse = z.object({ scope: z.literal("local_backing_rehearsals"), runs: z.array(BackingSummary).max(10), provider_requests: z.literal(0), voting_enabled: z.literal(false) }).strict();
export type Opening = z.infer<typeof BackingOpening>;
export type Evidence = z.infer<typeof BackingEvidence>;
export type Result = z.infer<typeof BackingResult>;
export type Record = z.infer<typeof BackingRecord>;
