import { z } from "zod";
import { AttentionQueue } from "./attention-queue-model";
import { attentionAddress } from "./attention-feed-contract";
import { LIGHTWEIGHT_ATTENTION_POLICY, lightweightAttention, providerAttentionOrder } from "./attention-lightweight";
import { hashJson } from "./solana";
import { ScoreRecordV4Schema } from "./discovery-score-v4-model";
import { freezeDiscoveryScoreV4 } from "./discovery-score-v4";

export const ATTENTION_TRIAL_POLICY = {
  version: "attention-selection-trial-v1", scope: "returned_solana_attention_not_market_population",
  arms: ["provider", "lightweight", "frozen_v4"], top_k: 5, controls: 5, enrollment_days: 14,
  capture_window_seconds: 7200, baseline_review_seconds: 7200, followup_start_seconds: 86400, followup_end_seconds: 172800,
  run_in_days: 3, minimum_holdout_identities: 30, required_worthwhile_lift_per_five: 1,
  maximum_additional_adverse_picks: 0, minimum_coverage_difference: -0.1,
  missing_slots: "unfilled_unknown_never_replaced", repeated_identities: "first_enrollment_only_for_holdout",
  primary: "blind_worth_reviewing_at_baseline_and_still_worth_reviewing_at_24h",
  controls_scope: "reviewed_lower_provider_positions_only_not_population_recall",
  acquisition_cost: "unknown_existing_cache_cost_must_be_measured_before_promotion",
  source_bytes_max: 1000000, deep_bytes_max: 2000000, labels_max: 20,
  provider_requests: 0, automatic_promotion: false, score_changes: false, launch_gates_changed: false,
} as const;
export async function trialStudy(start: string) {
  z.iso.datetime().parse(start);
  const body = { version: "attention-study-v1", start, policy: ATTENTION_TRIAL_POLICY, lightweight_policy: LIGHTWEIGHT_ATTENTION_POLICY } as const;
  return { ...body, study_hash: await hashJson(body) };
}
export type TrialStudy = Awaited<ReturnType<typeof trialStudy>>;
export async function verifyTrialStudy(study: TrialStudy) {
  if (JSON.stringify(await trialStudy(study.start)) !== JSON.stringify(study)) throw Error("trial_study_mismatch");
}
export function trialSlot(study: TrialStudy, now: Date) {
  const elapsed = now.getTime() - Date.parse(study.start), slot = Math.floor(elapsed / 86400000);
  if (!Number.isFinite(elapsed) || elapsed < 0 || slot >= ATTENTION_TRIAL_POLICY.enrollment_days || elapsed % 86400000 > 7200000) throw Error("trial_capture_outside_declared_slot");
  return slot;
}
export async function planAttentionTrial(study: TrialStudy, raw: unknown, previous: string[], slot: number) {
  await verifyTrialStudy(study);
  if (new TextEncoder().encode(JSON.stringify(raw)).length > ATTENTION_TRIAL_POLICY.source_bytes_max) throw Error("trial_source_bytes");
  const queue = AttentionQueue.parse(raw);
  if (trialSlot(study, new Date(queue.as_of)) !== slot) throw Error("trial_slot_mismatch");
  const seen = new Set<string>();
  for (const row of queue.rows) {
    const id = `${row.chain}:${row.address}`;
    if (seen.has(id) || attentionAddress(row.chain, row.address) !== row.address) throw Error("trial_source_identity"); seen.add(id);
    const keys = new Set<string>(); let families = new Set<string>();
    for (const s of row.sources) {
      const key = `${s.provider}:${s.window}`, age = Date.parse(queue.as_of) - Date.parse(s.received_at);
      if (keys.has(key) || age < 0 || s.fresh !== (age <= 7200000)) throw Error("trial_source_time_or_duplicate"); keys.add(key);
      if (s.fresh && s.provider !== "dexscreener") families.add(s.provider);
    }
    if (row.attention_families !== families.size || row.market_crosschecked !== row.sources.some(s => s.provider === "dexscreener" && s.fresh)) throw Error("trial_source_checks_mismatch");
  }
  const ordered = providerAttentionOrder(queue).filter(r => r.chain === "solana"), prior = new Set(z.array(z.string()).max(1400).parse(previous));
  const eligible = ordered.filter(r => slot < 3 || !prior.has(r.address));
  const body = { version: "attention-trial-plan-v1", study_hash: study.study_hash, slot, cutoff: queue.as_of, source_hash: await hashJson(queue),
    source_returned: queue.rows.length, outside_solana: queue.rows.filter(r => r.chain !== "solana").length,
    history_truncated: queue.history_truncated, source_gaps: queue.gaps,
    population: ordered.map((row, index) => ({ address: row.address, provider_position: index + 1, first_enrollment: !prior.has(row.address), lightweight: lightweightAttention(row) })),
    provider: eligible.slice(0, 5).map(r => r.address), lightweight: eligible.filter(r => lightweightAttention(r).reviewable).slice(0, 5).map(r => r.address),
    provider_requests: 0, launch_gates_changed: false } as const;
  return { queue, plan: { ...body, plan_hash: await hashJson(body) } };
}
export type TrialPlan = Awaited<ReturnType<typeof planAttentionTrial>>;
export type TrialDeepRow = { address: string; scorecard: z.infer<typeof ScoreRecordV4Schema> | null; gap: string | null };
export async function freezeAttentionTrial(source: TrialPlan, deep: TrialDeepRow[]) {
  if (deep.length !== source.plan.population.length || new Set(deep.map(r => r.address)).size !== deep.length || deep.some(r => !source.plan.population.some(p => p.address === r.address))) throw Error("trial_deep_population_mismatch");
  if (new TextEncoder().encode(JSON.stringify(deep)).length > ATTENTION_TRIAL_POLICY.deep_bytes_max) throw Error("trial_deep_bytes");
  for (const row of deep) {
    if (!row.scorecard) { if (!row.gap) throw Error("trial_missing_deep_reason"); continue; }
    const score = ScoreRecordV4Schema.parse(row.scorecard);
    if (row.gap || score.inputs.candidate.address !== row.address || score.inputs.candidate.mode !== "live" || score.inputs.as_of !== source.plan.cutoff
      || score.inputs.candidate.checked_at > source.plan.cutoff || score.inputs.candidate.first_seen_at > source.plan.cutoff
      || JSON.stringify(await freezeDiscoveryScoreV4(score.inputs)) !== JSON.stringify(score)) throw Error("trial_deep_cutoff_or_replay");
  }
  const eligible = (address: string) => source.plan.slot < 3 || source.plan.population.some(p => p.address === address && p.first_enrollment);
  const v4 = deep.filter(r => r.scorecard && eligible(r.address)).sort((a, b) => b.scorecard!.result.value - a.scorecard!.result.value
    || source.plan.population.findIndex(p => p.address === a.address) - source.plan.population.findIndex(p => p.address === b.address)).slice(0, 5).map(r => r.address);
  const union = new Set([...source.plan.provider, ...source.plan.lightweight, ...v4]);
  const controls = await Promise.all(source.plan.population.filter(p => eligible(p.address) && p.provider_position >= 11 && !union.has(p.address)).map(async p => ({ address: p.address, hash: await hashJson([source.plan.study_hash, source.plan.slot, p.address]) })));
  controls.sort((a, b) => a.hash.localeCompare(b.hash)); controls.slice(0, 5).forEach(c => union.add(c.address));
  const blind = await Promise.all([...union].map(async address => ({ address, id: await hashJson([source.plan.plan_hash, address]) })));
  blind.sort((a, b) => a.id.localeCompare(b.id));
  const body = { version: "attention-trial-cohort-v1", plan_hash: source.plan.plan_hash, study_hash: source.plan.study_hash, slot: source.plan.slot, cutoff: source.plan.cutoff,
    arms: { provider: [...source.plan.provider], lightweight: [...source.plan.lightweight], frozen_v4: v4 }, deep_hash: await hashJson(deep),
    controls: controls.slice(0, 5).map(c => c.address), blind, first_enrollments: source.plan.population.filter(p => p.first_enrollment).map(p => p.address),
    cost: { marginal_provider_requests: 0, existing_deep_acquisition_rpc: null, existing_deep_acquisition_bytes: null },
    scoring_effect: "none", launch_gates_changed: false, automatic_promotion: false } as const;
  return { ...body, cohort_hash: await hashJson(body) };
}
export type TrialCohort = Awaited<ReturnType<typeof freezeAttentionTrial>>;
export const TrialLabels = z.object({ cohort_hash: z.string().regex(/^[a-f0-9]{64}$/), phase: z.enum(["baseline", "followup"]),
  rows: z.array(z.object({ id: z.string().regex(/^[a-f0-9]{64}$/), worthwhile: z.enum(["yes", "no", "unknown"]),
    adverse: z.enum(["yes", "no", "unknown"]), minutes: z.number().finite().min(0).max(120), note: z.string().max(500) }).strict()).max(20) }).strict();
export async function freezeTrialLabels(cohort: TrialCohort, raw: unknown, at: string) {
  const labels = TrialLabels.parse(raw); z.iso.datetime().parse(at);
  const age = Date.parse(at) - Date.parse(cohort.cutoff), baseline = labels.phase === "baseline";
  if (age < (baseline ? 0 : 86400000) || age > (baseline ? 7200000 : 172800000) || labels.cohort_hash !== cohort.cohort_hash
    || labels.rows.length !== cohort.blind.length || new Set(labels.rows.map(r => r.id)).size !== labels.rows.length || labels.rows.some(r => !cohort.blind.some(b => b.id === r.id))) throw Error("trial_labels_binding_or_window");
  const body = { labels, recorded_at: at };
  return { ...body, label_hash: await hashJson(body) };
}
export type TrialLabelsRecord = Awaited<ReturnType<typeof freezeTrialLabels>>;
export function trialCohortResults(cohort: TrialCohort, baseline: TrialLabelsRecord | null, followup: TrialLabelsRecord | null) {
  return Object.fromEntries(Object.entries(cohort.arms).map(([arm, addresses]) => {
    let retained = 0, unknown = 5 - addresses.length, adverse = 0, minutes = 0;
    for (const address of addresses) {
      const id = cohort.blind.find(b => b.address === address)!.id, a = baseline?.labels.rows.find(r => r.id === id), b = followup?.labels.rows.find(r => r.id === id);
      if (!a || !b || a.worthwhile === "unknown" || b.worthwhile === "unknown") unknown++;
      else if (a.worthwhile === "yes" && b.worthwhile === "yes") retained++;
      if (a?.adverse === "yes" || b?.adverse === "yes") adverse++; minutes += (a?.minutes ?? 0) + (b?.minutes ?? 0);
    }
    return [arm, { slots: 5, filled: addresses.length, retained_worthwhile: retained, unknown, adverse, reviewed_minutes: minutes }];
  }));
}
