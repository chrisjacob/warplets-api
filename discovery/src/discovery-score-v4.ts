import { DISCOVERY_SCORE_POLICY_V3 } from "./discovery-score-v3-model";
import { evaluateDiscoveryScoreV3 } from "./discovery-score-v3";
import { DiscoveryScoreError } from "./discovery-score";
import { DISCOVERY_SCORE_POLICY_V4, ScoreInputV4Schema, ScoreResultV4Schema, ScoreRecordV4Schema, ScoreSummaryV4Schema, LaunchTimingReviewSchema, type ScoreInputV4 } from "./discovery-score-v4-model";
import { PUMP } from "./pump";
import { hashJson } from "./solana";

const round = (n: number) => Math.round(n * 100) / 100;
export function evaluateDiscoveryScoreV4(raw: ScoreInputV4) {
  const input = ScoreInputV4Schema.parse(raw), candidate = input.candidate, now = Date.parse(input.as_of);
  // Frozen v3 remains the support/previous-risk baseline. This adds concerns,
  // never points, a new provenance pass, a wash verdict or an action gate.
  const base = evaluateDiscoveryScoreV3({ ...input, version: "discovery-score-input-v3", policy: DISCOVERY_SCORE_POLICY_V3 });
  const creation = candidate.creation, graduation = candidate.graduation;
  const dated = (proof: typeof creation) => proof !== null && Date.parse(proof.block_time) <= now &&
    Date.parse(proof.fetched_at) >= Date.parse(proof.block_time) && Date.parse(proof.fetched_at) <= now;
  const certified = candidate.verification === "verified" && dated(creation) && dated(graduation) &&
    creation!.kind === "creation" && graduation!.kind === "graduation" &&
    creation!.program === PUMP && graduation!.program === PUMP &&
    ["create", "create_v2"].includes(creation!.instruction) && ["migrate", "migrate_v2"].includes(graduation!.instruction);
  const ordered = certified && graduation!.slot >= creation!.slot && Date.parse(graduation!.block_time) >= Date.parse(creation!.block_time);
  const consistent = ordered && (creation!.slot !== graduation!.slot || Date.parse(creation!.block_time) === Date.parse(graduation!.block_time));
  const sameSlot = consistent ? creation!.slot === graduation!.slot : null;
  const earlyCap = base.launch_review.early_reported_cap_usd;
  const highEarly = earlyCap === null ? null : earlyCap >= input.policy.launch_review.early_cap_usd;
  const gaps = ["same_slot_launch_not_fraud_or_wash_proof", "beneficial_ownership_and_launch_distribution_unverified"];
  if (!certified) gaps.push("creation_graduation_pair_uncertified_or_future");
  else if (!consistent) gaps.push("creation_graduation_slot_time_contradiction");
  if (earlyCap === null) gaps.push("early_reported_cap_unavailable");
  const timing = LaunchTimingReviewSchema.parse({ status: sameSlot === null ? "unknown" : sameSlot ? "review" : "not_flagged",
    confirmed_same_slot: sameSlot, creation_slot: creation?.slot ?? null, graduation_slot: graduation?.slot ?? null,
    creation_at: creation?.block_time ?? null, graduation_at: graduation?.block_time ?? null,
    early_reported_cap_usd: earlyCap, first_quote_at: base.launch_review.first_quote_at, high_early_report: highEarly, gaps });
  const concerns = [...base.concerns];
  if (sameSlot) {
    concerns.push({ code: "same_slot_creation_and_graduation", ceiling: input.policy.launch_timing.same_slot_ceiling, observed_at: graduation!.block_time });
    if (highEarly) concerns.push({ code: "same_slot_high_early_reported_valuation", ceiling: input.policy.launch_timing.high_early_cap_ceiling, observed_at: base.launch_review.first_quote_at });
    const performance = base.criteria.find(criterion => criterion.id === "sampled_performance")!;
    performance.points = 0;
    performance.notes = [...performance.notes, "same_slot_launch_review_withholds_momentum"].slice(0, 8);
  }
  const points = round(base.criteria.reduce((sum, criterion) => sum + criterion.points, 0));
  const ceiling = Math.min(100, ...concerns.map(concern => concern.ceiling));
  return ScoreResultV4Schema.parse({ ...base, version: "discovery-score-result-v4", base_points: points, ceiling,
    value: Math.max(0, Math.floor(Math.min(points, ceiling) + 1e-8)), concerns, launch_timing: timing,
    components: base.components.map(component => ({ ...component, points: round(base.criteria.filter(criterion => criterion.category === component.category).reduce((sum, criterion) => sum + criterion.points, 0)) })) });
}
export const defaultScoreInputV4 = (candidate: ScoreInputV4["candidate"], at: Date, prices: ScoreInputV4["prices"] = [], history_limited = false, first_market: ScoreInputV4["first_market"] = null): ScoreInputV4 =>
  ({ version: "discovery-score-input-v4", as_of: at.toISOString(), candidate, prices, history_limited, first_market, policy: DISCOVERY_SCORE_POLICY_V4 });
export async function freezeDiscoveryScoreV4(raw: ScoreInputV4) {
  const inputs = ScoreInputV4Schema.parse(raw);
  if (new TextEncoder().encode(JSON.stringify(inputs)).length > 1_800_000) throw new DiscoveryScoreError("discovery_score_input_size_limit");
  const result = evaluateDiscoveryScoreV4(inputs);
  const hashes = { input_hash: await hashJson(inputs), policy_hash: await hashJson(inputs.policy), result_hash: await hashJson(result) };
  return ScoreRecordV4Schema.parse({ version: "discovery-scorecard-v4", inputs, result, ...hashes,
    record_hash: await hashJson({ version: "discovery-scorecard-v4", ...hashes }) });
}
export function scoreSummaryV4(record: Awaited<ReturnType<typeof freezeDiscoveryScoreV4>>) {
  return ScoreSummaryV4Schema.parse({ version: "discovery-score-v4", as_of: record.result.as_of, value: record.result.value,
    evidence_coverage: record.result.evidence_coverage, ceiling: record.result.ceiling, risk_flags: record.result.concerns,
    input_hash: record.input_hash, policy_hash: record.policy_hash, result_hash: record.result_hash, record_hash: record.record_hash });
}
