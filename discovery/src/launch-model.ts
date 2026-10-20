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
export const FEE_MATH_REVISION="meteora-onlyb-static-79ebbfe-v2";
export const LaunchFeeConfig=z.object({
  collect_fee_mode:z.literal("only_quote"),fee_version:z.literal(1),base_fee_schedule:z.literal("static"),dynamic_fee_enabled:z.literal(false),
  fee_numerator:LaunchRaw.refine(v=>/^(0|[1-9]\d*)$/.test(v)&&v.length<=20&&BigInt(v)>=100000n&&BigInt(v)<=990000000n,"Fee version 1 requires 1–9900 bps"),
  protocol_fee_percent:z.number().int().min(0).max(100),referral_fee_percent:z.number().int().min(0).max(100),compounding_fee_bps:z.literal(0),
}).strict();
export const FeeLaunchScenario=LaunchScenario.omit({version:true,pools:true,trades:true}).extend({
  version:z.literal("launch-fee-lab-v2"),
  pools:z.object({native:LaunchPoolInput.extend({fees:LaunchFeeConfig}),og:LaunchPoolInput.extend({fees:LaunchFeeConfig}),tenx:LaunchPoolInput.extend({fees:LaunchFeeConfig})}).strict(),
  trades:z.array(z.object({pool:z.enum(["native","og","tenx"]),direction:z.enum(["quote_to_attn","attn_to_quote"]),gross_input_raw:PositiveRaw,minimum_output_raw:LaunchRaw,has_referral:z.boolean()}).strict()).max(24),
}).strict();
export type FeeLaunchInput=z.infer<typeof FeeLaunchScenario>;
export const LaunchFeeTotals=z.object({total_fee_raw:Amount,lp_claiming_fee_raw:Amount,protocol_fee_raw:Amount,referral_fee_raw:Amount}).strict();
export const FeeLaunchStep=LaunchStep.omit({status:true}).extend({
  status:z.enum(["simulated","range_exhausted","zero_output","inventory_or_u64_bound","fee_consumes_input","minimum_output_not_met"]),
  gross_input_raw:LaunchRaw,trader_debit_raw:LaunchRaw,trader_output_raw:LaunchRaw,minimum_output_raw:LaunchRaw,fees_on_input:z.boolean(),
  total_fee_raw:LaunchRaw,lp_claiming_fee_raw:LaunchRaw,protocol_fee_raw:LaunchRaw,referral_fee_raw:LaunchRaw,
}).strict();
export const FeeLaunchResult=LaunchResult.omit({version:true,math_revision:true,scope:true,pools:true,steps:true,fees_modeled:true}).extend({
  version:z.literal("launch-fee-lab-v2"),math_revision:z.literal(FEE_MATH_REVISION),scope:z.literal("concentrated_liquidity_static_only_quote_exact_input"),fees_modeled:z.literal(true),program_execution_verified:z.literal(false),
  pools:z.array(LaunchPoolResult.extend({fees:LaunchFeeConfig,fee_totals:LaunchFeeTotals})).length(3),steps:z.array(FeeLaunchStep).max(24),
}).strict();
export const AnyLaunchScenario=z.discriminatedUnion("version",[LaunchScenario,FeeLaunchScenario]);
export const AnyLaunchResult=z.discriminatedUnion("version",[LaunchResult,FeeLaunchResult]);
export const LaunchRequest = z.object({ request_id: z.uuid(), reason: z.string().trim().min(3).max(300), scenario: AnyLaunchScenario }).strict();
export const LaunchRecord = z.object({ id: z.uuid(), created_at: z.iso.datetime(), reason: z.string(), request_hash: Hash, input_hash: Hash, result_hash: Hash, record_hash: Hash, inputs: AnyLaunchScenario, result: AnyLaunchResult }).strict();
export const LaunchSummary = LaunchRecord.omit({ reason: true, request_hash: true, input_hash: true, inputs: true });
export const LaunchList = z.object({ scope: z.literal("local_hypothetical_launch_curve_lab"), runs: z.array(LaunchSummary).max(5) }).strict();
