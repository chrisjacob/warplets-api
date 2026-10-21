import { z } from "zod";
import { Address } from "./model";
import { WSOL } from "./pump";
import { SourceError } from "./rpc";
import { hashJson } from "./solana";
import { boundedJsonValue, freezeSourcePilot } from "./source-pilot";
import { PilotTime, SourcePilotInputSchema, SOURCE_PILOT_LIMITS, type SourcePilotReport } from "./source-pilot-model";

const Provenance = z.enum(["synthetic", "unverified_file"]);
const Metadata = z.object({ received_at: PilotTime, response: z.unknown() }).strict()
  .refine(value => Object.hasOwn(value, "response"), "response_required");
export const SourceActivityInputSchema = z.object({
  version: z.literal("source-activity-input-v1"), provenance: Provenance,
  selected_at: PilotTime, cutoff_at: PilotTime,
  cohort: z.array(z.object({ address: Address, pool: Address, pool_metadata: Metadata.nullable() }).strict()).min(1).max(10),
  sources: z.array(SourcePilotInputSchema).max(21),
}).strict().superRefine((input, context) => {
  const issue = (message: string) => context.addIssue({ code: "custom", message });
  const cutoff = Date.parse(input.cutoff_at), selected = Date.parse(input.selected_at);
  if (selected > cutoff) issue("selection_after_cutoff");
  if (new Set(input.cohort.map(row => row.address)).size !== input.cohort.length) issue("duplicate_cohort_mint");
  if (new Set(input.cohort.map(row => row.pool)).size !== input.cohort.length) issue("duplicate_cohort_pool");
  const slots = new Set<string>();
  const checkTime = (received: string) => {
    const time = Date.parse(received);
    if (time < selected || time > cutoff || cutoff - time > SOURCE_PILOT_LIMITS.provider_age_seconds * 1000) issue("source_outside_capture_window");
  };
  for (const row of input.cohort) if (row.pool_metadata) checkTime(row.pool_metadata.received_at);
  for (const source of input.sources) {
    checkTime(source.received_at);
    if (source.provenance !== input.provenance) issue("mixed_provenance");
    const request = source.request;
    const addresses = request.kind === "jupiter_tokens_v2" ? request.addresses : [request.address];
    for (const address of addresses) {
      const row = input.cohort.find(row => row.address === address);
      if (!row || request.kind === "geckoterminal_pool_candles" && request.pool !== row.pool) issue("source_outside_cohort");
      const slot = `${request.kind}:${address}`;
      if (slots.has(slot)) issue("duplicate_source_slot");
      slots.add(slot);
    }
    // Compare the same closed minute endpoint, not arbitrary historical windows.
    if (request.kind === "geckoterminal_pool_candles" && Date.parse(request.end_at) !== Math.floor(cutoff / 60_000) * 60_000)
      issue("candle_endpoint_not_cutoff");
  }
});
export type SourceActivityInput = z.infer<typeof SourceActivityInputSchema>;

const Relation = z.object({ data: z.object({ id: z.string().max(100), type: z.literal("token") }) });
const PoolMetadata = z.object({ data: z.object({
  id: z.string().max(100), type: z.literal("pool"), attributes: z.object({ address: Address }),
  relationships: z.object({ base_token: Relation, quote_token: Relation }),
}) });
type CohortRow = SourceActivityInput["cohort"][number];
export function poolBinding(row: CohortRow) {
  const common = { received_at: row.pool_metadata?.received_at ?? null,
    canonical_chain_proof: "not_checked" as const, source_authenticity: "unverified" as const };
  if (!row.pool_metadata) return { ...common, state: "not_supplied" as const, issue: "pool_metadata_missing" };
  const parsed = PoolMetadata.safeParse(row.pool_metadata.response);
  if (!parsed.success) return { ...common, state: "rejected" as const, issue: "pool_metadata_schema_invalid" };
  const pool = parsed.data.data;
  if (pool.id !== `solana_${row.pool}` || pool.attributes.address !== row.pool)
    return { ...common, state: "rejected" as const, issue: "pool_metadata_identity_mismatch" };
  if (pool.relationships.base_token.data.id !== `solana_${row.address}` || pool.relationships.quote_token.data.id !== `solana_${WSOL}`)
    return { ...common, state: "rejected" as const, issue: "pool_metadata_orientation_mismatch" };
  // File consistency is not authenticated transport or independently verified graduation.
  return { ...common, state: "metadata_consistent" as const, issue: "canonical_pool_proof_not_checked" };
}
type JupiterRow = Extract<SourcePilotReport["result"], { kind: "jupiter_tokens_v2" }>["rows"][number];
type GeckoRow = Extract<SourcePilotReport["result"], { kind: "geckoterminal_token_info" }>["row"];
type Series = Extract<SourcePilotReport["result"], { kind: "geckoterminal_pool_candles" }>["series"];
const ratio = (part: number | null, total: number | null) => part === null || total === null || total === 0 || part > total ? null : part / total * 100;
function organicActivity(row: JupiterRow | null, cutoff: string) {
  if (!row || row.state !== "parsed" || row.issues.some(issue => issue.startsWith("provider_time_")) ||
    row.provider_updated_at === null || Date.parse(cutoff) - Date.parse(row.provider_updated_at) > SOURCE_PILOT_LIMITS.provider_age_seconds * 1000) return null;
  const window = (value: NonNullable<JupiterRow["metrics"]>["stats_5m"]) => value === null ? null : {
    buy_organic_volume_pct: ratio(value.organic_buy_volume_usd, value.buy_volume_usd),
    sell_organic_volume_pct: ratio(value.organic_sell_volume_usd, value.sell_volume_usd),
    reported_traders: value.traders, organic_net_buyers: value.organic_net_buyers, reported_net_buyers: value.net_buyers,
  };
  return { organic_score: row.metrics!.organic_score,
    stats_5m: window(row.metrics!.stats_5m), stats_1h: window(row.metrics!.stats_1h),
    stats_6h: window(row.metrics!.stats_6h), stats_24h: window(row.metrics!.stats_24h) };
}

// Measurements only: no fraud thresholds, vendor-score blending or score-v4.
function candleActivity(series: Series | null, binding: ReturnType<typeof poolBinding>) {
  if (!series || series.state !== "parsed" || binding.state !== "metadata_consistent") return null;
  const bars = series.candles;
  let adjacent = 0, rising = 0, zeroVolumeMoving = 0, longestRise = 0, run = 0, maxMove: number | null = null;
  let peak = bars[0]!.close_usd, drawdown = 0, previous = bars[0]!;
  const upLogs: number[] = [];
  for (let i = 0; i < bars.length; i++) {
    const bar = bars[i]!;
    let moved = bar.high_usd !== bar.low_usd || bar.open_usd !== bar.close_usd;
    peak = Math.max(peak, bar.close_usd);
    drawdown = Math.max(drawdown, (1 - bar.close_usd / peak) * 100);
    if (i) {
      if (Date.parse(bar.start_at) - Date.parse(previous.start_at) === 60_000) {
        adjacent++;
        moved ||= bar.close_usd !== previous.close_usd;
        const move = Math.abs(bar.close_usd / previous.close_usd - 1) * 100;
        if (!Number.isFinite(move)) throw new SourceError("source_activity_metric_overflow");
        maxMove = Math.max(maxMove ?? 0, move);
        if (bar.close_usd > previous.close_usd) {
          rising++; run++; longestRise = Math.max(longestRise, run);
          upLogs.push(Math.log(bar.close_usd) - Math.log(previous.close_usd));
        } else run = 0;
      } else run = 0; // A hole cannot become a one-minute jump or a continuous rise.
    }
    if (bar.volume_usd === 0 && moved) zeroVolumeMoving++;
    previous = bar;
  }
  const logs = upLogs.reduce((sum, value) => sum + value, 0);
  const biggestTwo = upLogs.slice().sort((a, b) => b - a).slice(0, 2).reduce((sum, value) => sum + value, 0);
  return { observed_minutes: bars.length, expected_minutes: series.expected_minutes,
    missing_minutes: series.missing_minutes, complete_window: series.complete_window,
    adjacent_pairs: adjacent, rising_adjacent_pairs: rising, rising_adjacent_pct: adjacent ? rising / adjacent * 100 : null,
    longest_rising_run_pairs: longestRise, max_adjacent_close_move_pct: maxMove,
    observed_close_drawdown_pct: bars.length >= 2 ? drawdown : null,
    zero_reported_volume_moving_bars: zeroVolumeMoving,
    top_two_share_of_positive_adjacent_log_moves_pct: logs > 0 ? biggestTwo / logs * 100 : null,
    reported_volume_usd: series.reported_volume_usd, observed_close_return_pct: series.close_return_pct };
}
export async function reviewSourceActivity(raw: unknown) {
  boundedJsonValue(raw, SOURCE_PILOT_LIMITS.input_bytes);
  const inputs = SourceActivityInputSchema.parse(raw);
  const sources: Awaited<ReturnType<typeof freezeSourcePilot>>[] = [];
  for (const source of inputs.sources) sources.push(await freezeSourcePilot(source));
  const rows = inputs.cohort.map(cohort => {
    let jupiter: JupiterRow | null = null, gecko: GeckoRow | null = null, candles: Series | null = null;
    const refs: { kind: string; record_hash: string; received_at: string; provider_updated_at: string | null; state: string; issues: string[] }[] = [];
    for (const source of sources) {
      const result = source.report.result;
      if (result.kind === "jupiter_tokens_v2") {
        const row = result.rows.find(row => row.address === cohort.address);
        if (row) { jupiter = row; refs.push({ kind: result.kind, record_hash: source.record_hash, received_at: source.report.received_at, provider_updated_at: row.provider_updated_at, state: row.state, issues: row.issues }); }
      } else if (result.kind === "geckoterminal_token_info" && result.row.address === cohort.address) {
        gecko = result.row; refs.push({ kind: result.kind, record_hash: source.record_hash, received_at: source.report.received_at, provider_updated_at: null, state: gecko.state, issues: gecko.issues });
      } else if (result.kind === "geckoterminal_pool_candles" && result.series.address === cohort.address) {
        candles = result.series; refs.push({ kind: result.kind, record_hash: source.record_hash, received_at: source.report.received_at, provider_updated_at: null, state: candles.state, issues: candles.issues });
      }
    }
    const binding = poolBinding(cohort), organic = organicActivity(jupiter, inputs.cutoff_at), activity = candleActivity(candles, binding);
    return { address: cohort.address, pool: cohort.pool, sources: refs, pool_binding: binding,
      jupiter_state: jupiter?.state ?? "not_supplied", gecko_info_state: gecko?.state ?? "not_supplied", candle_state: candles?.state ?? "not_supplied",
      organic_activity: organic, gt_score: gecko?.metrics?.gt_score ?? null, gt_score_observed_at: null,
      candle_activity: activity, descriptive_bundle_available: organic !== null && organic.organic_score !== null && gecko?.metrics?.gt_score != null && activity?.complete_window === true,
      combined_score: null, wash_trading_verdict: "not_established", opening_market_cap_usd: null };
  });
  const report = { version: "source-activity-report-v1" as const, provenance: inputs.provenance,
    selected_at: inputs.selected_at, cutoff_at: inputs.cutoff_at, selection_proof: "unverified_file_assertion" as const,
    source_authenticity: "unverified" as const, provider_requests: 0, database_writes: 0,
    scoring_effect: "none" as const, evidence_gates_changed: false,
    comparison_scope: "descriptive_only_not_custom_score_validation" as const,
    timing_alignment: "capture_window_only_provider_score_time_unknown" as const,
    volume_comparison: "not_comparable_token_activity_vs_single_pool_candles" as const,
    coverage: { cohort_total: rows.length, jupiter_fresh_parsed: rows.filter(row => row.organic_activity !== null).length,
      gecko_info_parsed: rows.filter(row => row.gecko_info_state === "parsed").length,
      metadata_consistent: rows.filter(row => row.pool_binding.state === "metadata_consistent").length,
      candle_parsed: rows.filter(row => row.candle_state === "parsed").length,
      descriptive_bundles_available: rows.filter(row => row.descriptive_bundle_available).length }, rows };
  const input_hash = await hashJson(inputs), report_hash = await hashJson(report);
  const record_hash = await hashJson({ version: "source-activity-record-v1", input_hash, report_hash });
  const record = { version: "source-activity-record-v1" as const, inputs, report, input_hash, report_hash, record_hash };
  boundedJsonValue(record, SOURCE_PILOT_LIMITS.record_bytes);
  return record;
}
const Hash = z.string().regex(/^[a-f0-9]{64}$/);
const ActivityRecord = z.object({ version: z.literal("source-activity-record-v1"), inputs: SourceActivityInputSchema,
  report: z.unknown(), input_hash: Hash, report_hash: Hash, record_hash: Hash }).strict();
export async function replaySourceActivity(raw: unknown) {
  boundedJsonValue(raw, SOURCE_PILOT_LIMITS.record_bytes);
  const supplied = ActivityRecord.parse(raw), regenerated = await reviewSourceActivity(supplied.inputs);
  if (await hashJson(supplied) !== await hashJson(regenerated)) throw new SourceError("source_activity_replay_mismatch");
  return { replay: "verified", record_hash: regenerated.record_hash, report: regenerated.report };
}
