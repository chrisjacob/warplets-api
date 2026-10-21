import { z } from "zod";
import { Address } from "./model";

import { SOURCE_PILOT_LIMITS } from "./source-pilot-limits";
export { SOURCE_PILOT_LIMITS };
export const PilotTime = z.string().datetime();
const Hash = z.string().regex(/^[a-f0-9]{64}$/);
const uniqueAddresses = z.array(Address).min(1).max(SOURCE_PILOT_LIMITS.mints)
  .refine(rows => new Set(rows).size === rows.length, "duplicate_mint");
export const SourcePilotRequestSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("jupiter_tokens_v2"), addresses: uniqueAddresses }).strict(),
  z.object({ kind: z.literal("geckoterminal_token_info"), address: Address }).strict(),
  z.object({ kind: z.literal("geckoterminal_pool_candles"), address: Address, pool: Address, start_at: PilotTime, end_at: PilotTime }).strict(),
]).superRefine((request, context) => {
  if (request.kind !== "geckoterminal_pool_candles") return;
  const start = Date.parse(request.start_at), end = Date.parse(request.end_at);
  if (start % 60_000 || end % 60_000 || end <= start || end - start > SOURCE_PILOT_LIMITS.window_seconds * 1000)
    context.addIssue({ code: "custom", message: "invalid_closed_minute_window" });
});
export type SourcePilotRequest = z.infer<typeof SourcePilotRequestSchema>;
export const SourcePilotInputSchema = z.object({
  version: z.literal("source-pilot-input-v1"),
  provenance: z.enum(["synthetic", "unverified_file"]), received_at: PilotTime,
  request: SourcePilotRequestSchema, response: z.unknown(),
}).strict().superRefine((input, context) => {
  if (!Object.hasOwn(input, "response")) context.addIssue({ code: "custom", message: "response_required" });
  if (input.request.kind === "geckoterminal_pool_candles" && Date.parse(input.request.end_at) > Date.parse(input.received_at))
    context.addIssue({ code: "custom", message: "future_candle_window" });
});
export type SourcePilotInput = z.infer<typeof SourcePilotInputSchema>;
const Count = z.number().int().safe().nonnegative();
const Metric = z.number().finite().nonnegative().nullable();
const Percent = z.number().finite().min(0).max(100).nullable();
const Issues = z.array(z.string().max(80)).max(24);
const State = z.enum(["parsed", "not_reported", "rejected"]);
const Window = z.object({
  buy_volume_usd: Metric, sell_volume_usd: Metric, organic_buy_volume_usd: Metric, organic_sell_volume_usd: Metric,
  traders: Count.nullable(), organic_net_buyers: Count.nullable(), net_buyers: Count.nullable(),
}).strict();
export const JupiterPilotRowSchema = z.object({
  address: Address, state: State, issues: Issues, provider_updated_at: PilotTime.nullable(),
  metrics: z.object({
    organic_score: Percent, organic_score_label: z.enum(["high", "medium", "low"]).nullable(),
    holder_count: Count.nullable(), price_usd: Metric, reported_cap_usd: Metric, fdv_usd: Metric, liquidity_usd: Metric,
    top_holders_pct: Percent, mint_authority_disabled: z.boolean().nullable(), freeze_authority_disabled: z.boolean().nullable(),
    first_pool_created_at: PilotTime.nullable(),
    stats_5m: Window.nullable(), stats_1h: Window.nullable(), stats_6h: Window.nullable(), stats_24h: Window.nullable(),
  }).strict().nullable(),
}).strict();
export const GeckoPilotRowSchema = z.object({
  address: Address, state: State, issues: Issues,
  metrics: z.object({
    gt_score: Percent,
    score_details: z.object({ pool: Percent, transaction: Percent, creation: Percent, info: Percent, holders: Percent }).strict(),
    holder_count: Count.nullable(), top_ten_pct: Percent, holders_updated_at: PilotTime.nullable(),
    // The token-info schema supplies no timestamp for the GT score itself.
    score_observed_at: z.null(),
  }).strict().nullable(),
}).strict();
export const PilotCandleSchema = z.object({
  start_at: PilotTime, open_usd: z.number().finite().positive(), high_usd: z.number().finite().positive(),
  low_usd: z.number().finite().positive(), close_usd: z.number().finite().positive(), volume_usd: z.number().finite().nonnegative(),
}).strict();
export const CandlePilotResultSchema = z.object({
  address: Address, pool: Address, state: State, issues: Issues,
  pool_identity: z.literal("request_context_only"), quote_address: Address,
  expected_minutes: Count.max(SOURCE_PILOT_LIMITS.candles), returned_minutes: Count.max(SOURCE_PILOT_LIMITS.candles),
  missing_minutes: Count.max(SOURCE_PILOT_LIMITS.candles), complete_window: z.boolean(),
  candles: z.array(PilotCandleSchema).max(SOURCE_PILOT_LIMITS.candles),
  close_return_pct: z.number().finite().nullable(), reported_volume_usd: Metric,
  opening_market_cap_usd: z.null(), wash_trading_verdict: z.literal("not_established"),
}).strict();
export const SourcePilotReportSchema = z.object({
  version: z.literal("source-pilot-report-v1"), provenance: z.enum(["synthetic", "unverified_file"]),
  received_at: PilotTime, provider_requests: z.literal(0), database_writes: z.literal(0),
  scoring_effect: z.literal("none"), evidence_gates_changed: z.literal(false), source_authenticity: z.literal("unverified"),
  result: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("jupiter_tokens_v2"), rows: z.array(JupiterPilotRowSchema).min(1).max(SOURCE_PILOT_LIMITS.mints) }).strict(),
    z.object({ kind: z.literal("geckoterminal_token_info"), row: GeckoPilotRowSchema }).strict(),
    z.object({ kind: z.literal("geckoterminal_pool_candles"), series: CandlePilotResultSchema }).strict(),
  ]),
}).strict();
export type SourcePilotReport = z.infer<typeof SourcePilotReportSchema>;
export const SourcePilotRecordSchema = z.object({
  version: z.literal("source-pilot-record-v1"), inputs: SourcePilotInputSchema, report: SourcePilotReportSchema,
  input_hash: Hash, report_hash: Hash, record_hash: Hash,
}).strict();
export type SourcePilotRecord = z.infer<typeof SourcePilotRecordSchema>;
