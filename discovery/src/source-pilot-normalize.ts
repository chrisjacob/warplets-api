import { z } from "zod";
import { Address } from "./model";
import { WSOL } from "./pump";
import {
  CandlePilotResultSchema, GeckoPilotRowSchema, JupiterPilotRowSchema, PilotTime, SOURCE_PILOT_LIMITS,
  SourcePilotInputSchema, SourcePilotReportSchema, type SourcePilotInput,
} from "./source-pilot-model";

const NumberMetric = z.number().finite().nonnegative();
const Count = NumberMetric.int().safe();
const optional = <T extends z.ZodType>(schema: T) => schema.nullish().transform(value => value ?? null);
const Percent = NumberMetric.max(100);
// Jupiter documents numbers; Gecko explicitly returns decimal strings for some fields.
// Never coerce booleans, blanks, whitespace, hex, Infinity or exponent strings into a passing metric.
const GeckoNumber = z.union([NumberMetric, z.string().regex(/^(?:0|[1-9]\d*)(?:\.\d+)?$/).transform(Number)]).pipe(NumberMetric);
const GeckoPercent = GeckoNumber.pipe(Percent);
const Stats = z.object({
  buyVolume: optional(NumberMetric), sellVolume: optional(NumberMetric), buyOrganicVolume: optional(NumberMetric), sellOrganicVolume: optional(NumberMetric),
  numTraders: optional(Count), numOrganicBuyers: optional(Count), numNetBuyers: optional(Count),
}).superRefine((stats, context) => {
  for (const [part, total] of [[stats.buyOrganicVolume, stats.buyVolume], [stats.sellOrganicVolume, stats.sellVolume], [stats.numOrganicBuyers, stats.numTraders], [stats.numNetBuyers, stats.numTraders]])
    if (part !== null && total !== null && part > total + Math.max(1e-9, total * 1e-9)) context.addIssue({ code: "custom", message: "organic_or_net_exceeds_total" });
});
const JupiterToken = z.object({
  id: Address, updatedAt: optional(PilotTime), organicScore: optional(Percent), organicScoreLabel: optional(z.enum(["high", "medium", "low"])),
  holderCount: optional(Count), usdPrice: optional(NumberMetric), mcap: optional(NumberMetric), fdv: optional(NumberMetric), liquidity: optional(NumberMetric),
  audit: z.object({ topHoldersPercentage: optional(Percent), mintAuthorityDisabled: optional(z.boolean()), freezeAuthorityDisabled: optional(z.boolean()) }).nullish(),
  firstPool: z.object({ id: Address, createdAt: PilotTime }).nullish(),
  stats5m: Stats.nullish(), stats1h: Stats.nullish(), stats6h: Stats.nullish(), stats24h: Stats.nullish(),
});
const GeckoToken = z.object({ data: z.object({
  id: z.string().max(100), type: z.literal("token"), attributes: z.object({
    address: Address, gt_score: optional(GeckoPercent),
    gt_score_details: z.object({ pool: optional(GeckoPercent), transaction: optional(GeckoPercent), creation: optional(GeckoPercent), info: optional(GeckoPercent), holders: optional(GeckoPercent) }).nullish(),
    holders: z.object({ count: optional(GeckoNumber.pipe(Count)), distribution_percentage: z.object({ top_10: optional(GeckoPercent) }).nullish(), last_updated: optional(PilotTime) }).nullish(),
  }),
}) });
const CandleBody = z.object({
  data: z.object({ type: z.literal("ohlcv_request_response"), attributes: z.object({ ohlcv_list: z.array(z.tuple([Count, NumberMetric.positive(), NumberMetric.positive(), NumberMetric.positive(), NumberMetric.positive(), NumberMetric])).max(SOURCE_PILOT_LIMITS.candles) }) }),
  meta: z.object({ base: z.object({ address: Address }), quote: z.object({ address: Address }) }),
});
function timeIssues(value: string | null, receivedAt: string, prefix: string): string[] {
  if (value === null) return [`${prefix}_missing`];
  if (Date.parse(value) > Date.parse(receivedAt)) return [`${prefix}_future`];
  return Date.parse(receivedAt) - Date.parse(value) > SOURCE_PILOT_LIMITS.provider_age_seconds * 1000 ? [`${prefix}_stale`] : [];
}
function normalizeJupiter(input: SourcePilotInput & { request: { kind: "jupiter_tokens_v2"; addresses: string[] } }) {
  const response = z.array(z.unknown()).max(SOURCE_PILOT_LIMITS.response_rows).safeParse(input.response);
  const groups = new Map<string, unknown[]>();
  let identityIssue: string | null = response.success ? null : "response_schema_invalid";
  for (const raw of response.success ? response.data : []) {
    const id = z.object({ id: Address }).safeParse(raw);
    if (!id.success) { identityIssue = "unscoped_token_identity"; continue; }
    if (!input.request.addresses.includes(id.data.id)) { identityIssue = "unexpected_token_identity"; continue; }
    groups.set(id.data.id, [...groups.get(id.data.id) ?? [], raw]);
  }
  return input.request.addresses.map(address => {
    const rejected = (issue: string) => JupiterPilotRowSchema.parse({ address, state: "rejected", issues: [issue], provider_updated_at: null, metrics: null });
    if (identityIssue) return rejected(identityIssue);
    const found = groups.get(address) ?? [];
    if (!found.length) return JupiterPilotRowSchema.parse({ address, state: "not_reported", issues: ["token_not_reported"], provider_updated_at: null, metrics: null });
    if (found.length !== 1) return rejected("duplicate_token_identity");
    const parsed = JupiterToken.safeParse(found[0]);
    if (!parsed.success) return rejected("token_schema_invalid");
    const token = parsed.data;
    const issues = timeIssues(token.updatedAt, input.received_at, "provider_time");
    if (issues.includes("provider_time_future") || token.firstPool && Date.parse(token.firstPool.createdAt) > Date.parse(input.received_at)) return rejected("provider_time_future");
    if (token.organicScore === null) issues.push("organic_score_missing");
    if (!token.audit) issues.push("audit_missing");
    const stats = (window: z.infer<typeof Stats> | null | undefined, name: string) => {
      if (!window) { issues.push(`${name}_missing`); return null; }
      if (Object.values(window).some(value => value === null)) issues.push(`${name}_partial`);
      return { buy_volume_usd: window.buyVolume, sell_volume_usd: window.sellVolume, organic_buy_volume_usd: window.buyOrganicVolume, organic_sell_volume_usd: window.sellOrganicVolume, traders: window.numTraders, organic_net_buyers: window.numOrganicBuyers, net_buyers: window.numNetBuyers };
    };
    const metrics = {
      organic_score: token.organicScore, organic_score_label: token.organicScoreLabel, holder_count: token.holderCount,
      price_usd: token.usdPrice, reported_cap_usd: token.mcap, fdv_usd: token.fdv, liquidity_usd: token.liquidity,
      top_holders_pct: token.audit?.topHoldersPercentage ?? null, mint_authority_disabled: token.audit?.mintAuthorityDisabled ?? null, freeze_authority_disabled: token.audit?.freezeAuthorityDisabled ?? null,
      first_pool_created_at: token.firstPool?.createdAt ?? null,
      stats_5m: stats(token.stats5m, "stats_5m"), stats_1h: stats(token.stats1h, "stats_1h"), stats_6h: stats(token.stats6h, "stats_6h"), stats_24h: stats(token.stats24h, "stats_24h"),
    };
    return JupiterPilotRowSchema.parse({ address, state: "parsed", issues, provider_updated_at: token.updatedAt, metrics });
  });
}
function normalizeGecko(input: SourcePilotInput & { request: { kind: "geckoterminal_token_info"; address: string } }) {
  const address = input.request.address, parsed = GeckoToken.safeParse(input.response);
  const rejected = (issue: string) => GeckoPilotRowSchema.parse({ address, state: "rejected", issues: [issue], metrics: null });
  if (!parsed.success) return rejected("token_schema_invalid");
  if (parsed.data.data.id !== `solana_${address}` || parsed.data.data.attributes.address !== address) return rejected("token_identity_mismatch");
  const token = parsed.data.data.attributes, details = token.gt_score_details;
  const holdersTime = token.holders?.last_updated ?? null;
  if (timeIssues(holdersTime, input.received_at, "holders_time").includes("holders_time_future")) return rejected("holders_time_future");
  const issues = ["score_time_not_reported", ...timeIssues(holdersTime, input.received_at, "holders_time")];
  if (token.gt_score === null) issues.push("gt_score_missing");
  return GeckoPilotRowSchema.parse({ address, state: "parsed", issues, metrics: {
    gt_score: token.gt_score, score_details: { pool: details?.pool ?? null, transaction: details?.transaction ?? null, creation: details?.creation ?? null, info: details?.info ?? null, holders: details?.holders ?? null },
    holder_count: token.holders?.count ?? null, top_ten_pct: token.holders?.distribution_percentage?.top_10 ?? null, holders_updated_at: holdersTime, score_observed_at: null,
  } });
}
function normalizeCandles(input: SourcePilotInput & { request: { kind: "geckoterminal_pool_candles"; address: string; pool: string; start_at: string; end_at: string } }) {
  const request = input.request, start = Date.parse(request.start_at) / 1000, end = Date.parse(request.end_at) / 1000, expected = (end - start) / 60;
  const empty = { address: request.address, pool: request.pool, quote_address: WSOL, pool_identity: "request_context_only" as const, expected_minutes: expected, returned_minutes: 0, missing_minutes: expected, complete_window: false, candles: [], close_return_pct: null, reported_volume_usd: null, opening_market_cap_usd: null, wash_trading_verdict: "not_established" as const };
  const rejected = (issue: string) => CandlePilotResultSchema.parse({ ...empty, state: "rejected", issues: [issue] });
  const parsed = CandleBody.safeParse(input.response);
  if (!parsed.success) return rejected("candle_schema_invalid");
  const body = parsed.data;
  if (body.meta.base.address !== request.address || body.meta.quote.address !== WSOL) return rejected("candle_token_orientation_mismatch");
  const raw = body.data.attributes.ohlcv_list;
  let previous = Infinity;
  for (const [time, open, high, low, close] of raw) {
    // Seconds only, closed minutes only, strict reverse chronology. Never sort
    // away duplicates/out-of-order rows or silently fill no-trade intervals.
    if (time % 60 || time < start || time + 60 > end) return rejected("candle_time_outside_closed_window");
    if (time >= previous) return rejected("candle_duplicate_or_order_invalid");
    if (low > Math.min(open, close) || high < Math.max(open, close) || high < low) return rejected("candle_ohlc_invalid");
    previous = time;
  }
  const candles = raw.slice().reverse().map(([time, open, high, low, close, volume]) => ({ start_at: new Date(time * 1000).toISOString(), open_usd: open, high_usd: high, low_usd: low, close_usd: close, volume_usd: volume }));
  const missing = expected - candles.length, first = candles[0], last = candles.at(-1), total = candles.reduce((sum, candle) => sum + candle.volume_usd, 0);
  const change = first && last ? (last.close_usd / first.close_usd - 1) * 100 : null;
  if (!Number.isFinite(total) || change !== null && !Number.isFinite(change)) return rejected("candle_metric_overflow");
  return CandlePilotResultSchema.parse({ ...empty, state: candles.length ? "parsed" : "not_reported", issues: ["pool_identity_not_echoed", ...(missing ? ["candle_minutes_missing"] : []), ...(!candles.length ? ["candles_not_reported"] : [])],
    returned_minutes: candles.length, missing_minutes: missing, complete_window: missing === 0, candles,
    close_return_pct: candles.length >= 2 ? change : null, reported_volume_usd: candles.length ? total : null,
  });
}
export function normalizeSourcePilot(raw: SourcePilotInput) {
  const input = SourcePilotInputSchema.parse(raw), request = input.request;
  const result = request.kind === "jupiter_tokens_v2" ? { kind: request.kind, rows: normalizeJupiter({ ...input, request }) }
    : request.kind === "geckoterminal_token_info" ? { kind: request.kind, row: normalizeGecko({ ...input, request }) }
    : { kind: request.kind, series: normalizeCandles({ ...input, request }) };
  return SourcePilotReportSchema.parse({ version: "source-pilot-report-v1", provenance: input.provenance, received_at: input.received_at,
    provider_requests: 0, database_writes: 0, scoring_effect: "none", evidence_gates_changed: false, source_authenticity: "unverified", result });
}
