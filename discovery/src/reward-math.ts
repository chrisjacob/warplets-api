import { RewardResult, RewardScenario, type Scenario } from "./reward-model";

export class RewardError extends Error {}
export const REWARD_DAY = 86400000;
const fail = (message: string): never => { throw new RewardError(message); };
const min = (a: bigint, b: bigint) => a < b ? a : b;
const sum = (values: bigint[]) => values.reduce((a, b) => a + b, 0n);
const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;

/** Offline arithmetic only. Every economic parameter is an unapproved scenario assumption. */
export function evaluateRewards(raw: Scenario) {
  const input = RewardScenario.parse(raw), asOf = Date.parse(input.as_of);
  const campaigns = [...input.campaigns].sort((a, b) => compare(a.id, b.id));
  if (new Set(campaigns.map(c => c.id)).size !== campaigns.length || new Set(campaigns.map(c => c.asset)).size !== campaigns.length) fail("reward_duplicate_campaign_or_asset");
  const seen = new Set<string>();
  for (const s of input.scores) {
    const c = campaigns.find(c => c.id === s.campaign_id);
    if (!c) fail("reward_unknown_campaign");
    const key = `${s.campaign_id}:${s.day}:${s.participant}`;
    if (seen.has(key)) fail("reward_duplicate_participant_period");
    seen.add(key);
    if (Date.parse(c!.starts_at) + (s.day + 1) * REWARD_DAY > asOf) fail("reward_unfinished_period_scores");
  }
  const spotlight = campaigns.find(c => c.id === input.spotlight_id);
  if (input.spotlight_id && (!spotlight || Date.parse(spotlight.starts_at) > asOf || Date.parse(spotlight.starts_at) + 10 * REWARD_DAY <= asOf)) fail("reward_spotlight_not_active");
  // End-exclusive windows: finish events precede start events at the same instant.
  const events = campaigns.flatMap(c => [[Date.parse(c.starts_at), 1], [Date.parse(c.starts_at) + 10 * REWARD_DAY, -1]]).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  let overlap = 0, maxOverlap = 0;
  for (const [, delta] of events) { overlap += delta; maxOverlap = Math.max(maxOverlap, overlap); }
  return RewardResult.parse({ version: "attention-lab-v1", as_of: input.as_of, source: "hypothetical_operator_inputs", max_overlap: maxOverlap, spotlight_id: input.spotlight_id, active_campaigns: campaigns.filter(c => Date.parse(c.starts_at) <= asOf && Date.parse(c.starts_at) + 10 * REWARD_DAY > asOf).length, combined_cap_bps: input.combined_cap_bps, bonus_pool_bps: input.bonus_pool_bps, policy_approved: false, claims_enabled: false, transfers_enabled: false, provider_requests: 0,
    campaigns: campaigns.map(c => {
      const supply = BigInt(c.supply_raw), start = Date.parse(c.starts_at), end = start + 10 * REWARD_DAY;
      if (supply === 0n || supply % 10n !== 0n) fail("reward_supply_requires_exact_ten_percent");
      if (c.daily_weights_bps.reduce((a, b) => a + b, 0) !== 10000) fail("reward_daily_weights_must_sum_10000");
      const reserve = supply / 10n;
      const periods = c.daily_weights_bps.map((weight, day) => {
        const cutoff = start + (day + 1) * REWARD_DAY, periodStart = start + day * REWARD_DAY;
        const rows = input.scores.filter(s => s.campaign_id === c.id && s.day === day).sort((a, b) => compare(a.participant, b.participant));
        const included = rows.filter(s => s.disposition === "included"), tranche = reserve * BigInt(weight) / 10000n;
        const validTime = (t: string | null) => t !== null && Date.parse(t) >= periodStart && Date.parse(t) < cutoff && Date.parse(t) <= asOf;
        const rawGap = included.some(s => s.raw_points === null || !validTime(s.raw_observed_at));
        const boostGap = included.some(s => s.boost_bps === null || !validTime(s.boost_observed_at));
        const rawTotal = sum(included.map(s => BigInt(s.raw_points ?? "0")));
        const status = cutoff > asOf ? "scheduled" : rawGap ? "raw_evidence_gap" : !rawTotal ? "no_eligible_points" : boostGap ? "boost_evidence_gap" : "projected";
        const effective = (s: typeof rows[number]) => BigInt(Math.min(s.boost_bps ?? 10000, input.combined_cap_bps));
        const weightedTotal = sum(included.map(s => BigInt(s.raw_points ?? "0") * effective(s)));
        const bonusTotal = sum(included.map(s => BigInt(s.raw_points ?? "0") * (effective(s) - 10000n)));
        const basePool = tranche * BigInt(10000 - input.bonus_pool_bps) / 10000n, bonusPool = tranche * BigInt(input.bonus_pool_bps) / 10000n;
        const participants = rows.map(s => {
          const reasons = s.disposition !== "included" ? [s.disposition] : rawGap ? ["period_raw_evidence_incomplete"] : boostGap ? ["period_boost_evidence_incomplete"] : !rawTotal ? ["no_eligible_points"] : [];
          const points = BigInt(s.raw_points ?? "0"), rank = s.disposition === "included" && !rawGap && cutoff <= asOf ? 1 + included.filter(other => BigInt(other.raw_points!) > points).length : null;
          let a = 0n, b = 0n, base = 0n;
          if (s.disposition === "included" && status === "projected") {
            const fullRawBaseline = tranche * points / rawTotal;
            // Lab assumption: combined cap is relative to the full raw-merit tranche baseline.
            const cap = fullRawBaseline * BigInt(input.combined_cap_bps) / 10000n;
            a = min(tranche * points * effective(s) / weightedTotal, cap);
            base = basePool * points / rawTotal;
            const bonus = bonusTotal ? bonusPool * points * (effective(s) - 10000n) / bonusTotal : 0n;
            b = base + min(bonus, cap > base ? cap - base : 0n);
          }
          return { participant: s.participant, rank, raw_points: s.raw_points, effective_boost_bps: status === "projected" && s.disposition === "included" ? Number(effective(s)) : null, base_b_raw: String(base), option_a_raw: String(a), option_b_raw: String(b), reasons };
        });
        const a = sum(participants.map(p => BigInt(p.option_a_raw))), b = sum(participants.map(p => BigInt(p.option_b_raw)));
        if (a > tranche || b > tranche) fail("reward_budget_invariant");
        return { day, starts_at: new Date(periodStart).toISOString(), ends_at: new Date(cutoff).toISOString(), tranche_raw: String(tranche), status, included: included.length, excluded: rows.length - included.length, option_a_raw: String(a), option_b_raw: String(b), unallocated_a_raw: String(tranche - a), unallocated_b_raw: String(tranche - b), participants };
      });
      return { id: c.id, asset: c.asset, decimals: c.decimals, starts_at: c.starts_at, ends_at: new Date(end).toISOString(), state: start > asOf ? "future" : end <= asOf ? "past" : "active", supply_raw: c.supply_raw, reserve_raw: String(reserve), schedule_dust_raw: String(reserve - sum(periods.map(p => BigInt(p.tranche_raw)))), option_a_raw: String(sum(periods.map(p => BigInt(p.option_a_raw)))), option_b_raw: String(sum(periods.map(p => BigInt(p.option_b_raw)))), periods };
    }) });
}

export function exampleRewards(now = new Date()): Scenario {
  const starts = new Date(now.getTime() - 2 * REWARD_DAY);
  const campaigns = Array.from({ length: 10 }, (_, i) => ({ id: `00000000-0000-4000-8000-${String(i + 1).padStart(12, "0")}`, asset: `SIM-EDITION-${i + 1}`, starts_at: new Date(starts.getTime() - i * REWARD_DAY).toISOString(), supply_raw: "1000000000", decimals: 6, daily_weights_bps: Array(10).fill(1000) as number[] }));
  return RewardScenario.parse({ version: "attention-lab-v1", as_of: now.toISOString(), combined_cap_bps: 15000, bonus_pool_bps: 2000, spotlight_id: campaigns[0].id, campaigns, scores: campaigns.flatMap(c => ["alice", "bob", "carol"].map((participant, i) => ({ campaign_id: c.id, day: 0, participant, raw_points: ["100", "80", "50"][i], raw_observed_at: new Date(Date.parse(c.starts_at) + 3600000).toISOString(), boost_bps: [10000, 15000, 12000][i], boost_observed_at: new Date(Date.parse(c.starts_at) + 3600000).toISOString(), disposition: "included" }))) });
}
