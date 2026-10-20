import type { Market } from "./model";

// Unvalidated review heuristic only. No eligibility, ranking or organic-trading claim.
export const PRICE_PATTERN_RULE_V1 = Object.freeze({
  version: "sampled-linear-rise-v1", window_ms: 86_400_000,
  min_samples: 20, min_span_ms: 3_600_000, max_gap_ms: 600_000,
  min_return_pct: 5, min_upward_step_pct: 90, max_drawdown_pct: 1, min_linear_r_squared: 0.98,
});

export const PRICE_PATTERN_RULE = PRICE_PATTERN_RULE_V1;
export function pricePatternReviewV1(points: readonly Market[], now: Date) {
  const rule = PRICE_PATTERN_RULE_V1, gaps = new Set<string>();
  // Only the latest continuous run is assessed. Never join different sources,
  // duplicate timestamps, missing prices or long gaps to manufacture a trend.
  const ordered = points.filter(p => {
    const at = Date.parse(p.fetched_at);
    if (!Number.isFinite(at) || at > now.getTime()) { gaps.add("invalid_or_future_observation_ignored"); return false; }
    return at >= now.getTime() - rule.window_ms;
  }).slice().sort((a, b) => Date.parse(a.fetched_at) - Date.parse(b.fetched_at));
  let run: Market[] = [];
  for (let i = 0; i < ordered.length; i++) {
    const p = ordered[i]!, at = Date.parse(p.fetched_at);
    if ((i > 0 && at === Date.parse(ordered[i - 1]!.fetched_at)) || (i + 1 < ordered.length && at === Date.parse(ordered[i + 1]!.fetched_at))) {
      gaps.add("duplicate_time_break"); run = []; continue;
    }
    if (p.price_usd === null || !Number.isFinite(p.price_usd) || p.price_usd <= 0) { gaps.add("missing_price_break"); run = []; continue; }
    const previous = run.at(-1);
    if (previous && (previous.source !== p.source || at - Date.parse(previous.fetched_at) > rule.max_gap_ms)) {
      gaps.add(previous.source !== p.source ? "source_change_break" : "sampling_gap_break"); run = [];
    }
    run.push(p);
  }
  const first = run[0], last = run.at(-1), span = first && last ? Date.parse(last.fetched_at) - Date.parse(first.fetched_at) : 0;
  const base = {
    version: rule.version, samples: run.length, input_samples: points.length,
    first_at: first?.fetched_at ?? null, last_at: last?.fetched_at ?? null, source: last?.source ?? null,
    span_minutes: span / 60_000, stale: !last || now.getTime() - Date.parse(last.fetched_at) > 180_000,
    gaps: [...gaps],
  };
  if (run.length < rule.min_samples || span < rule.min_span_ms) return {
    ...base, status: "insufficient" as const, metrics: null,
  };
  // Normalize both axes; regress against elapsed time, not sample index, so
  // uneven polling cannot turn a nonlinear time series into a linear one.
  const values = run.map(p => p.price_usd! / first!.price_usd!), xs = run.map(p => (Date.parse(p.fetched_at) - Date.parse(first!.fetched_at)) / span);
  let up = 0, down = 0, unchanged = 0, peak = values[0]!, drawdown = 0;
  for (let i = 1; i < values.length; i++) {
    const v = values[i]!;
    if (v > values[i - 1]!) up++; else if (v < values[i - 1]!) down++; else unchanged++;
    peak = Math.max(peak, v); drawdown = Math.max(drawdown, (1 - v / peak) * 100);
  }
  const meanX = xs.reduce((a, b) => a + b, 0) / xs.length, meanY = values.reduce((a, b) => a + b, 0) / values.length;
  let xx = 0, yy = 0, xy = 0;
  for (let i = 0; i < values.length; i++) {
    const x = xs[i]! - meanX, y = values[i]! - meanY;
    xx += x * x; yy += y * y; xy += x * y;
  }
  const rSquared = xx > 0 && yy > 0 ? Math.min(1, Math.max(0, xy * xy / xx / yy)) : null;
  const metrics = {
    return_pct: (values.at(-1)! - 1) * 100, upward_steps: up, downward_steps: down, unchanged_steps: unchanged,
    upward_step_pct: up / (values.length - 1) * 100, max_drawdown_pct: drawdown, linear_r_squared: rSquared,
  };
  if (Object.values(metrics).some(v => v !== null && !Number.isFinite(v))) return { ...base, gaps: [...gaps, "numeric_range_unusable"], status: "insufficient" as const, metrics: null };
  const flagged = xy > 0 && metrics.return_pct >= rule.min_return_pct && metrics.upward_step_pct >= rule.min_upward_step_pct && drawdown <= rule.max_drawdown_pct && rSquared !== null && rSquared >= rule.min_linear_r_squared;
  return { ...base, status: flagged ? "review" as const : "not_flagged" as const, metrics };
}
// The display may move to another version; retained research keeps the v1 decoder.
export const pricePatternReview = pricePatternReviewV1;
