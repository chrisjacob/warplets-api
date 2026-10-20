import { z } from "zod";
import { assess, type Market } from "./model";
import { pricePatternReviewV1 } from "./price-pattern";
import { hashJson } from "./solana";
import { SignalCohortSchema, SignalFeatureSchema, SignalInputSchema, SignalOutcomeSchema, SignalSummarySchema, SignalValidationSchema, type Signal } from "./signal-model";

export class SignalResearchError extends Error {}
export type SignalCohort = z.infer<typeof SignalCohortSchema>;
export type SignalOutcome = z.infer<typeof SignalOutcomeSchema>;
export type SignalSummary = z.infer<typeof SignalSummarySchema>;
export const OUTCOME_DELAY_MS = 26 * 3_600_000;
const day = (at: string) => new Intl.DateTimeFormat("en-CA", { timeZone: "Australia/Sydney", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(at));
const metadata = (r: SignalCohort | Omit<SignalCohort, "inputs">) => ({ version: r.version, address: r.address, symbol: r.symbol, signal: r.signal, captured_at: r.captured_at, day: r.day, input_hash: r.input_hash, feature_hash: r.feature_hash });

// Preserve these v1 definitions when introducing another diagnostic version.
// The $10M threshold is a research hypothesis, never an eligibility change.
export function deriveSignal(raw: z.infer<typeof SignalInputSchema>) {
  const input = SignalInputSchema.parse(raw), c = input.candidate, at = new Date(input.at), now = at.getTime();
  if (c.mode !== "live" || c.verification !== "verified" || !c.creation || !c.graduation) throw new SignalResearchError("verified_origin_and_graduation_required");
  const times = [c.first_seen_at, c.checked_at, c.creation.block_time, c.creation.fetched_at, c.graduation.block_time, c.graduation.fetched_at, c.risk.observed_at, c.holders?.observed_at, c.wallet_analysis?.observed_at, c.market?.fetched_at, c.market?.observed_at];
  if (times.some(t => t && Date.parse(t) > now)) throw new SignalResearchError("future_snapshot_not_captured");
  const age = (now - Date.parse(c.creation.block_time)) / 3_600_000;
  if (age < 0 || age > 24) throw new SignalResearchError("creation_outside_24h");
  if (Date.parse(c.graduation.block_time)<Date.parse(c.creation.block_time)) throw new SignalResearchError("origin_timing_invalid");
  const market = c.market;
  if (!market || market.price_usd === null || market.price_usd <= 0 || now - Date.parse(market.fetched_at) > input.policy.max_market_age_seconds * 1000) throw new SignalResearchError("fresh_positive_price_required");
  const feature = { signal: input.signal, flagged: false, reported_cap_usd: market.market_cap_usd, creation_age_hours: age, eligibility: assess(c, input.policy, at).eligibility };
  if (input.signal === "new_token_high_cap") {
    if (input.history.length) throw new SignalResearchError("cap_history_must_be_empty");
    if (market.market_cap_usd === null) throw new SignalResearchError("reported_market_cap_unavailable");
    return SignalFeatureSchema.parse({ ...feature, rule_version: "new-token-cap-v1", flagged: market.market_cap_usd > 10_000_000, pattern: null });
  }
  if (input.history.some(p => Date.parse(p.fetched_at) > Date.parse(market.fetched_at) || Date.parse(p.fetched_at) > now || Date.parse(p.fetched_at)<Date.parse(c.graduation!.block_time) || p.observed_at && Date.parse(p.observed_at)>now)) throw new SignalResearchError("post_baseline_or_pre_graduation_history_rejected");
  const last = [...input.history].sort((a,b) => Date.parse(a.fetched_at) - Date.parse(b.fetched_at)).at(-1);
  if (!last || last.fetched_at !== market.fetched_at || last.source !== market.source || last.price_usd !== market.price_usd) throw new SignalResearchError("history_baseline_mismatch");
  const pattern = pricePatternReviewV1(input.history, at);
  if (pattern.status === "insufficient" || pattern.stale || !pattern.metrics || !pattern.first_at || !pattern.last_at) throw new SignalResearchError("comparable_price_history_not_ready");
  return SignalFeatureSchema.parse({ ...feature, rule_version: "sampled-linear-rise-v1", flagged: pattern.status === "review", pattern: { samples: pattern.samples, span_minutes: pattern.span_minutes, upward_step_pct: pattern.metrics.upward_step_pct, max_drawdown_pct: pattern.metrics.max_drawdown_pct, linear_r_squared: pattern.metrics.linear_r_squared, return_pct: pattern.metrics.return_pct, first_at: pattern.first_at, last_at: pattern.last_at, gaps: pattern.gaps } });
}
export async function freezeSignal(raw: z.infer<typeof SignalInputSchema>): Promise<SignalCohort> {
  const inputs = SignalInputSchema.parse(raw), feature = deriveSignal(inputs);
  const meta = { version: "signal-cohort-v1" as const, address: inputs.candidate.address, symbol: inputs.candidate.symbol, signal: inputs.signal, captured_at: inputs.at, day: day(inputs.at), input_hash: await hashJson(inputs), feature_hash: await hashJson(feature) };
  return SignalCohortSchema.parse({ ...meta, inputs, feature, record_hash: await hashJson(meta) });
}
export async function verifySignalSummary(r: Omit<SignalCohort, "inputs">) {
  if (r.day !== day(r.captured_at) || r.feature.signal !== r.signal || await hashJson(r.feature) !== r.feature_hash || await hashJson(metadata(r)) !== r.record_hash) throw new SignalResearchError("signal_summary_hash_mismatch");
}
export async function replaySignal(raw: SignalCohort) {
  const r = SignalCohortSchema.parse(raw); await verifySignalSummary(r);
  if (r.address !== r.inputs.candidate.address || r.signal !== r.inputs.signal || r.captured_at !== r.inputs.at || await hashJson(r.inputs) !== r.input_hash || await hashJson(deriveSignal(r.inputs)) !== r.feature_hash) throw new SignalResearchError("signal_replay_mismatch");
  return r;
}

export async function measureSignalOutcome(raw: SignalCohort, points: readonly Market[], now: Date): Promise<SignalOutcome | null> {
  const r = await replaySignal(raw), captured = Date.parse(r.captured_at), target = captured + 86_400_000, end = captured + OUTCOME_DELAY_MS;
  if (now.getTime() < end) return null; // Wait for the complete endpoint grace window.
  const baseline = r.inputs.candidate.market!;
  const bounded = points.filter(p => Date.parse(p.fetched_at) >= target - 1_800_000 && Date.parse(p.fetched_at) <= end && Date.parse(p.fetched_at) <= now.getTime());
  const times = new Map<number, number>(); for (const p of bounded) times.set(Date.parse(p.fetched_at), (times.get(Date.parse(p.fetched_at)) ?? 0) + 1);
  const endpoint = bounded.length > 1000 ? null : bounded.filter(p => p.source === baseline.source && (!p.observed_at || Date.parse(p.observed_at)<=Date.parse(p.fetched_at)) && times.get(Date.parse(p.fetched_at)) === 1 && p.price_usd !== null && p.price_usd > 0 && p.liquidity_usd !== null && p.liquidity_usd >= 0).sort((a,b) => Math.abs(Date.parse(a.fetched_at)-target)-Math.abs(Date.parse(b.fetched_at)-target) || a.fetched_at.localeCompare(b.fetched_at))[0] ?? null;
  const change = (a: number | null, b: number | null | undefined) => { const n = a !== null && a > 0 && b != null ? (b/a-1)*100 : null; return n !== null && Number.isFinite(n) ? n : null; };
  const price = change(baseline.price_usd, endpoint?.price_usd), liquidity = change(baseline.liquidity_usd, endpoint?.liquidity_usd), measured = price !== null && liquidity !== null;
  const body = { version: "signal-outcome-v1" as const, cohort_hash: r.record_hash, address: r.address, signal: r.signal, captured_at: r.captured_at, finalized_at: now.toISOString(), target_at: new Date(target).toISOString(), window_end: new Date(end).toISOString(), status: measured ? "measured" as const : "insufficient_data" as const, endpoint, price_return_pct: price, liquidity_change_pct: liquidity, severe_loss_signal: measured ? price <= -80 || liquidity <= -80 : null,
    gaps: ["provider_snapshots_not_continuous", "observational_cohort_not_a_recommendation", "loss_not_proof_of_fraud", ...(!endpoint ? [bounded.length > 1000 ? "endpoint_sample_limit" : "comparable_24h_endpoint_missing"] : []), ...(liquidity === null ? ["liquidity_comparison_unavailable"] : [])] };
  return SignalOutcomeSchema.parse({ ...body, outcome_hash: await hashJson(body) });
}
export async function verifySignalOutcome(raw: SignalOutcome, cohortHash: string, cohort?: SignalCohort) {
  const r = SignalOutcomeSchema.parse(raw), { outcome_hash, ...body } = r;
  if (r.cohort_hash !== cohortHash || Date.parse(r.target_at) !== Date.parse(r.captured_at)+86_400_000 || Date.parse(r.window_end) !== Date.parse(r.captured_at)+OUTCOME_DELAY_MS || Date.parse(r.finalized_at) < Date.parse(r.window_end) || await hashJson(body) !== outcome_hash) throw new SignalResearchError("signal_outcome_hash_mismatch");
  if (cohort) {
    const baseline = cohort.inputs.candidate.market!, p = r.endpoint;
    if (r.address !== cohort.address || r.signal !== cohort.signal || r.captured_at !== cohort.captured_at || p && (p.source !== baseline.source || Date.parse(p.fetched_at)<Date.parse(r.target_at)-1_800_000 || Date.parse(p.fetched_at)>Date.parse(r.window_end) || p.price_usd === null || p.price_usd<=0 || p.liquidity_usd === null)) throw new SignalResearchError("signal_outcome_identity_mismatch");
    const change = (a: number|null,b: number|null|undefined) => { const n = a !== null && a>0 && b != null ? (b/a-1)*100 : null; return n !== null && Number.isFinite(n) ? n : null; };
    const price = change(baseline.price_usd,p?.price_usd), liquidity = change(baseline.liquidity_usd,p?.liquidity_usd), complete = price !== null && liquidity !== null;
    if (r.price_return_pct !== price || r.liquidity_change_pct !== liquidity || r.status !== (complete ? "measured" : "insufficient_data") || r.severe_loss_signal !== (complete ? price<=-80 || liquidity<=-80 : null)) throw new SignalResearchError("signal_outcome_calculation_mismatch");
  }
  return r;
}

export function validateSignal(rows: readonly SignalSummary[], signal: Signal) {
  const seen = new Set<string>();
  const measured = rows.filter(r => r.signal === signal && r.outcome?.status === "measured").slice().sort((a,b) => a.captured_at.localeCompare(b.captured_at) || a.address.localeCompare(b.address)).filter(r => { if (seen.has(r.address)) return false; seen.add(r.address); return true; });
  const boundary = Math.floor(measured.length * .7), holdout = measured.slice(boundary), cutoff = holdout[0] ? Date.parse(holdout[0].captured_at) : 0;
  // Purge training outcomes not yet observable when holdout collection began.
  const train = measured.slice(0,boundary).filter(r => Date.parse(r.outcome!.finalized_at) < cutoff && Date.parse(r.captured_at)+OUTCOME_DELAY_MS < cutoff);
  const flagged = holdout.filter(r => r.feature.flagged), controls = holdout.filter(r => !r.feature.flagged), trainFlags = train.filter(r => r.feature.flagged);
  const rate = (xs: SignalSummary[]) => xs.length ? xs.filter(r => r.outcome!.severe_loss_signal === true).length/xs.length : null;
  const gaps: string[] = [];
  if (measured.length < 40 || train.length < 25 || holdout.length < 12) gaps.push("too_few_time_separated_outcomes");
  if (trainFlags.length < 5 || flagged.length < 4 || controls.length < 4) gaps.push("insufficient_flagged_or_control_coverage");
  if (measured.slice(0,boundary).length !== train.length) gaps.push("overlapping_or_unavailable_training_outcomes_purged");
  const supported = !gaps.some(g => g !== "overlapping_or_unavailable_training_outcomes_purged") && (rate(trainFlags) ?? 0) >= .6 && (rate(flagged) ?? 0) >= .6 && (rate(flagged) ?? 0)-(rate(holdout) ?? 0) >= .1;
  return SignalValidationSchema.parse({ signal, protocol: "signal-holdout-v1", status: supported ? "review_proposal" : gaps.some(g => g !== "overlapping_or_unavailable_training_outcomes_purged") ? "collecting" : "not_supported", measured: measured.length, train_count: train.length, validation_count: holdout.length, purged_count: boundary-train.length, validation_flagged: flagged.length, validation_controls: controls.length, flagged_loss_rate: rate(flagged), control_loss_rate: rate(controls), baseline_loss_rate: rate(holdout), nonloss_flagged: flagged.filter(r => r.outcome!.severe_loss_signal === false).length, gaps, activated: false });
}
