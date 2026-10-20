import { z } from "zod";
export const LAUNCH_MATH_REVISION = "meteora-cl-79ebbfe-v1";
export const METEORA_REVISION = "79ebbfe59a225e641a2f37cd03404f26de1b0c8e";
const integer = (digits: number) => z.string().regex(/^(0|[1-9]\d*)$/).max(digits);
export const LaunchRaw = integer(20).refine(v => /^(0|[1-9]\d*)$/.test(v)&&v.length<=20&&BigInt(v) <= 18446744073709551615n, "Requires u64 raw units");
const PositiveRaw = LaunchRaw.refine(v => /^(0|[1-9]\d*)$/.test(v)&&v.length<=20&&BigInt(v) > 0n, "Must be positive");
const Ratio = z.object({ numerator: PositiveRaw, denominator: PositiveRaw }).strict();
export const LaunchPoolInput = z.object({
  quote_decimals: z.number().int().min(0).max(9), quote_native: Ratio,
  sqrt_min: integer(29), sqrt_initial: integer(29), sqrt_max: integer(29),
}).strict();
export const LaunchScenario = z.object({
  version: z.literal("launch-curve-lab-v1"), as_of: z.iso.datetime(),
  chain: z.literal("solana"), attn_asset: z.literal("SIM-ATTN"), attn_decimals: z.number().int().min(0).max(9),
  supply_raw: PositiveRaw, native_quote_budget_raw: LaunchRaw,
  reference_attn_native: Ratio, max_opening_divergence_bps: z.number().int().min(0).max(10000),
  pools: z.object({ native: LaunchPoolInput, og: LaunchPoolInput, tenx: LaunchPoolInput }).strict(),
  trades: z.array(z.object({ pool: z.enum(["native", "og", "tenx"]), direction: z.enum(["quote_to_attn", "attn_to_quote"]), net_input_raw: PositiveRaw }).strict()).max(24),
}).strict();
export type LaunchInput = z.infer<typeof LaunchScenario>;
export const LaunchRequest = z.object({ request_id: z.uuid(), reason: z.string().trim().min(3).max(300), scenario: LaunchScenario }).strict();
const Amount = integer(130), SignedDecimal = z.string().regex(/^-?\d+\.\d{8}$/).max(150);
const Price = z.object({ numerator: Amount, denominator: Amount }).strict();
export const LaunchCurveState = z.object({ sqrt_price: Amount, attn_raw: LaunchRaw, quote_raw: LaunchRaw, marginal_native_per_attn: Price }).strict();
export const LaunchPoolResult = z.object({
  pool: z.enum(["native", "og", "tenx"]), quote_asset: z.enum(["SIM-SOL", "SIM-OG", "SIM-10X"]), quote_decimals: z.number().int(),
  allocation_bps: z.number().int(), allocated_attn_raw: LaunchRaw, unseeded_attn_raw: LaunchRaw, liquidity_q64: Amount,
  sqrt_min: Amount, sqrt_max: Amount, initial: LaunchCurveState, final: LaunchCurveState,
  opening_deviation_bps: SignedDecimal, opening_divergence_exceeded: z.boolean(),
  remaining_net_quote_to_upper_raw: LaunchRaw, remaining_net_attn_to_lower_raw: LaunchRaw,
}).strict();
export const LaunchStep = z.object({
  index: z.number().int(), pool: z.enum(["native", "og", "tenx"]), direction: z.enum(["quote_to_attn", "attn_to_quote"]),
  net_input_raw: LaunchRaw, curve_output_raw: LaunchRaw,
  status: z.enum(["simulated", "range_exhausted", "zero_output", "inventory_or_u64_bound"]),
  before: LaunchCurveState, after: LaunchCurveState,
}).strict();
export const LaunchResult = z.object({
  version: z.literal("launch-curve-lab-v1"), math_revision: z.literal(LAUNCH_MATH_REVISION), sdk_version: z.literal("1.5.1"), source_commit: z.literal(METEORA_REVISION),
  as_of: z.iso.datetime(), source: z.literal("hypothetical_operator_inputs"), scope: z.literal("concentrated_liquidity_net_curve_only"),
  supply_raw: LaunchRaw, attn_decimals: z.number().int(), campaign_reserve_raw: LaunchRaw,
  native_quote_required_raw: LaunchRaw, native_quote_budget_raw: LaunchRaw,
  pools: z.array(LaunchPoolResult).length(3), steps: z.array(LaunchStep).max(24),
  launch_enabled: z.literal(false), transfers_enabled: z.literal(false), policy_approved: z.literal(false),
  fees_modeled: z.literal(false), locks_verified: z.literal(false), external_prices_verified: z.literal(false), provider_requests: z.literal(0),
  gaps: z.array(z.string()).max(16),
}).strict();
const Hash = z.string().regex(/^[a-f0-9]{64}$/);
export const LaunchRecord = z.object({ id: z.uuid(), created_at: z.iso.datetime(), reason: z.string(), request_hash: Hash, input_hash: Hash, result_hash: Hash, record_hash: Hash, inputs: LaunchScenario, result: LaunchResult }).strict();
export const LaunchSummary = LaunchRecord.omit({ reason: true, request_hash: true, input_hash: true, inputs: true });
export const LaunchList = z.object({ scope: z.literal("local_hypothetical_launch_curve_lab"), runs: z.array(LaunchSummary).max(5) }).strict();
