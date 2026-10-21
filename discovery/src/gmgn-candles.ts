import { z } from "zod";
import type { GmgnRequest } from "./gmgn-request";

const Decimal = z.union([z.number().finite(), z.string().max(100).regex(/^\d+(?:\.\d+)?$/).transform(Number)])
  .pipe(z.number().finite().nonnegative());
const Bar = z.object({ time: Decimal.pipe(z.number().int().safe()), open: Decimal, high: Decimal, low: Decimal, close: Decimal,
  volume: Decimal, amount: Decimal.nullish().transform(v => v ?? null) })
  .refine(v => v.low > 0 && v.low <= Math.min(v.open, v.close) && v.high >= Math.max(v.open, v.close), "invalid_ohlc");
const Rows = z.union([z.array(Bar).max(360), z.object({ list: z.array(Bar).max(360) }).transform(v => v.list)]);
export class GmgnCandleError extends Error {
  constructor(readonly reason: "shape_or_ohlc" | "time_unit_or_window" | "mixed_time_units" | "duplicate_or_order" | "metric_overflow") {
    super(`gmgn_candle_${reason}`);
  }
}

// The vendor's market table says seconds, while its measured contract-DD example
// uses milliseconds. Match one whole-series unit to the explicit request window;
// do not guess by digit count, round a timestamp, fill holes or discard bad rows.
export function normalizeGmgnCandles(data: unknown, request: Extract<GmgnRequest, { kind: "gmgn_token_candles" }>, cutoff: number) {
  const parsed = Rows.safeParse(data);
  if (!parsed.success) throw new GmgnCandleError("shape_or_ohlc");
  const start = Date.parse(request.start_at) / 1000, end = Date.parse(request.end_at) / 1000;
  if (end * 1000 > Math.floor(cutoff / 60_000) * 60_000) throw new GmgnCandleError("time_unit_or_window");
  let unit: "seconds" | "milliseconds" | null = null;
  const bars = parsed.data.map(bar => {
    const valid = (t: number) => Number.isSafeInteger(t) && t % 60 === 0 && t >= start && t < end && (t + 60) * 1000 <= cutoff;
    const seconds = valid(bar.time), milliseconds = valid(bar.time / 1000);
    if (seconds === milliseconds) throw new GmgnCandleError("time_unit_or_window");
    const current = seconds ? "seconds" : "milliseconds";
    if (unit !== null && unit !== current) throw new GmgnCandleError("mixed_time_units");
    unit = current;
    return { ...bar, time: seconds ? bar.time : bar.time / 1000 };
  });
  const differences = bars.slice(1).map((bar, i) => bar.time - bars[i]!.time);
  if (differences.some(d => d === 0) || differences.some(d => d > 0) && differences.some(d => d < 0)) throw new GmgnCandleError("duplicate_or_order");
  const reversed = differences.length > 0 && differences[0]! < 0;
  if (reversed) bars.reverse();
  const complete = bars.length === (end - start) / 60 && bars.every((bar, i) => bar.time === start + i * 60);
  const total = (field: "volume" | "amount") => {
    if (bars.length === 0 || bars.some(bar => bar[field] === null)) return null;
    const result = bars.reduce((sum, bar) => sum + bar[field]!, 0);
    if (!Number.isFinite(result)) throw new GmgnCandleError("metric_overflow");
    return result;
  };
  let adjacent = 0, rising = 0, run = 0, longestRise = 0, jumps = 0, zeroFlowMoving = 0, alternating = 0, maxMove: number | null = null;
  for (let i = 0; i < bars.length; i++) {
    const bar = bars[i]!, previous = bars[i - 1], isAdjacent = previous !== undefined && bar.time === previous.time + 60;
    let moving = bar.high !== bar.low;
    if (isAdjacent) {
      adjacent++;
      const ratio = bar.close / previous.close, move = Math.abs(ratio - 1) * 100;
      if (!Number.isFinite(move)) throw new GmgnCandleError("metric_overflow");
      maxMove = Math.max(maxMove ?? 0, move);
      if (ratio >= 2 || ratio <= .5) jumps++;
      moving ||= bar.close !== previous.close;
      if (bar.close > previous.close) { rising++; run++; longestRise = Math.max(longestRise, run); } else run = 0;
      if (Math.sign(bar.close - bar.open) * Math.sign(previous.close - previous.open) === -1) alternating++;
    } else run = 0;
    // Unit-independent: both reported fields must explicitly be zero. Missing
    // turnover is never zero, and a gap is never an adjacent movement.
    if (bar.volume === 0 && bar.amount === 0 && moving) zeroFlowMoving++;
  }
  const activity = { adjacent_pairs: adjacent, rising_adjacent_pairs: rising, longest_rising_run_pairs: longestRise,
    alternating_body_pairs: alternating, adjacent_doubling_or_halving: jumps, zero_reported_flow_moving_candles: zeroFlowMoving,
    max_adjacent_close_move_pct: maxMove,
    review_reasons: [zeroFlowMoving > 0 ? "price_moves_with_both_flow_fields_zero" : null,
      jumps > 0 ? "adjacent_close_doubles_or_halves" : null, longestRise >= 12 ? "twelve_or_more_consecutive_rising_closes" : null].filter((v): v is string => v !== null),
    wash_trading_verdict: "not_established" as const, thresholds: "descriptive_review_v1_uncalibrated" as const };
  return { contract: "gmgn-candles-v2" as const, timestamp_unit: unit, input_order_reversed: reversed,
    window_start: request.start_at, window_end: request.end_at, candle_count: bars.length, expected_count: (end - start) / 60, complete_window: complete,
    // Official market guidance contradicts its own response-field table. Retain
    // field-labelled sums; do not silently choose a USD/token unit or use either
    // as verified organic volume until this endpoint's units are corroborated.
    volume_units: "unverified_conflicting_vendor_documentation" as const,
    reported_field_volume_total: total("volume"), reported_field_amount_total: total("amount"),
    reported_volume_usd: null, reported_volume_tokens: null, activity, candles: bars };
}
