import { z } from "zod";
import { validAddress } from "./solana";

const Key = z.string().max(44).refine(validAddress);
const Sig = z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{64,88}$/);
const Hash = z.string().regex(/^[a-f0-9]{64}$/);
const Raw = z.string().regex(/^\d+$/).max(30);
const Slot = z.number().int().safe().nonnegative();
export const TradeSchema = z.object({
  signature: Sig, slot: Slot, block_time: z.string().datetime(), instruction_index: z.string(),
  program: Key, instruction: z.string(), side: z.enum(["buy", "sell"]), wallet: Key,
  fee_payer: Key, base_amount_raw: Raw, quote_amount_raw: Raw.nullable(),
  quote_kind: z.enum(["native_lamports", "wsol_raw"]), net_wallet_base_raw: z.string().regex(/^-?\d+$/).max(31),
  transaction_hash: Hash,
  quote_account_proof: z.literal("temporary_wsol_lifecycle").optional(),
}).strict();
export type VerifiedTrade = z.infer<typeof TradeSchema>;
export const FundingSchema = z.object({
  from: Key, to: Key, lamports_raw: Raw, signature: Sig, slot: Slot,
  block_time: z.string().datetime(), transaction_hash: Hash,
  before_sampled_buy: z.boolean(),
  before_signed_creation: z.boolean().optional(),
}).strict();
export type Funding = z.infer<typeof FundingSchema>;
export const FundingCoverageSchema = z.object({ wallet: Key, anchor_signature: Sig, anchor_kind: z.enum(["sampled_buy", "signed_creation", "funding_transfer"]), anchor_at: z.string().datetime(), window_start: z.string().datetime(), pages: z.number().int(), signatures: z.number().int(), transactions_in_window: z.number().int(), transactions_examined: z.number().int(), status: z.enum(["partial", "window_examined"]), boundary_reached: z.boolean(), gaps: z.array(z.string()) }).strict();
export const WalletProfileSchema = z.object({
  wallet: Key, roles: z.array(z.enum(["creation_user", "declared_creator", "buyer", "seller"])).max(4),
  signed_creation: z.boolean(), buys: z.number().int().nonnegative(), sells: z.number().int().nonnegative(),
  bought_raw: Raw, sold_raw: Raw, net_bought_raw: z.string().regex(/^-?\d+$/),
  current_supply_pct: z.number().min(0).max(100).nullable(),
  oldest_observed_reference_at: z.string().datetime().nullable(),
  history_signatures: z.number().int().nonnegative(), history_complete: z.literal(false),
  prior_loss_associations: z.number().int().nonnegative(), gaps: z.array(z.string()).max(20),
}).strict();
export const FundingEdgeSchema = z.object({ from: Key, to: Key, lamports_raw: Raw, signature: Sig, slot: Slot, block_time: z.string().datetime(), instruction_index: z.number().int().nonnegative(), transaction_hash: Hash }).strict();
export type FundingEdge = z.infer<typeof FundingEdgeSchema>;
export const SecondHopSchema = z.object({ depth: z.literal(2), eligible_funders: z.number().int().nonnegative(), coverage: z.array(FundingCoverageSchema).max(4),
  paths: z.array(z.object({ source: Key, intermediary: Key, target: Key, target_role: z.enum(["signed_creation", "early_buyer"]), upstream: FundingEdgeSchema, downstream: FundingEdgeSchema }).strict()).max(50), gaps: z.array(z.string()).max(30),
}).strict();
export type SecondHop = z.infer<typeof SecondHopSchema>;
const LegacyWalletAnalysisSchema = z.object({
  version: z.enum(["wallet-signals-v1", "wallet-signals-v2", "wallet-signals-v3", "wallet-signals-v4"]), observed_at: z.string().datetime(), evidence_hash: Hash,
  funding_coverage: z.array(FundingCoverageSchema).max(8).optional(),
  second_hop: SecondHopSchema.optional(),
  status: z.enum(["signals_detected", "no_signal_in_sample", "unavailable"]),
  source: z.literal("solana-finalized-rpc"), coverage: z.literal("bounded_sample"),
  actual_bundle_membership: z.literal("unknown"), exhaustive: z.literal(false),
  creation_slot: Slot.nullable(), holder_snapshot_at: z.string().datetime().nullable(),
  scope: z.object({ curve_pages: z.number().int(), early_window_reached: z.boolean(), signatures_considered: z.number().int(), transactions_examined: z.number().int(), unsupported_or_missing_transactions: z.number().int(), wallet_histories_examined: z.number().int() }).strict(),
  metrics: z.object({
    verified_buys: z.number().int(), verified_sells: z.number().int(), distinct_buyers: z.number().int(),
    max_same_slot_buyers: z.number().int(), max_same_transaction_buyers: z.number().int(),
    shared_funder_buyers: z.number().int(), dev_funded_buyers: z.number().int(),
    dev_funded_supply_pct: z.number().min(0).max(100).nullable(), dev_sold_supply_pct: z.number().nonnegative().nullable(),
    round_trip_wallets: z.number().int(),
  }).strict(),
  signals: z.array(z.object({ code: z.string(), strength: z.enum(["observed", "heuristic"]), wallets: z.array(Key).max(20), signatures: z.array(Sig).max(20) }).strict()).max(20),
  trades: z.array(TradeSchema).max(100), funding: z.array(FundingSchema).max(100), wallets: z.array(WalletProfileSchema).max(20),
  gaps: z.array(z.string()).max(50),
}).strict();
export const WalletAnalysisSchema=z.discriminatedUnion("version",[
  LegacyWalletAnalysisSchema,
  LegacyWalletAnalysisSchema.extend({version:z.literal("wallet-signals-v5"),funding_coverage:z.array(FundingCoverageSchema).max(20).optional()}),
]);
export type WalletAnalysis = z.infer<typeof WalletAnalysisSchema>;
