import { expect, it } from "vitest";
import { normalizeAttention } from "./attention-feed-contract";
import { buildAttentionQueue } from "./attention-queue";
import { key } from "./wallet-fixtures.test-helper";
import { fixtureCandidates } from "./fixtures";
import { defaultScoreInputV4, freezeDiscoveryScoreV4 } from "./discovery-score-v4";
import { providerAttentionOrder, lightweightAttention } from "./attention-lightweight";
import { trialStudy, trialSlot, planAttentionTrial, freezeAttentionTrial, freezeTrialLabels, trialCohortResults, type TrialDeepRow } from "./attention-selection-trial";
const at = new Date("2026-10-23T09:30:00.000Z"), time = (n: number) => new Date(at.getTime() + n).toISOString();
async function setup(slot = 0, previous: string[] = []) {
  const candidate = (await fixtureCandidates(at))[0]!; candidate.mode = "live";
  const now = new Date(at.getTime() + slot * 86400000), addresses = [candidate.address, ...Array.from({ length: 19 }, (_, i) => key(100 + i))];
  const attention = normalizeAttention({ kind: "gmgn_hot_searches", chains: ["solana"], intervals: ["24h"] }, { code: 0, data: [{ chain: "sol", interval: "24h", tokens: addresses.map((address, i) => ({ address, rank: i + 1, visiting_count: 1000 - i, open_timestamp: at.getTime() / 1000 - 100 * 86400, liquidity: 40000, buys: 10, sells: 10, is_wash_trading: i === 0, renounced_mint: 1, renounced_freeze_account: 1 })) }] }, now.toISOString());
  const dex = normalizeAttention({ kind: "attention_dex_crosscheck", chain: "solana", addresses }, addresses.map(address => ({ chainId: "solana", baseToken: { address }, liquidity: { usd: 40000 }, txns: { h24: { buys: 10, sells: 10 } } })), now.toISOString());
  const queue = buildAttentionQueue([attention, dex], now), study = await trialStudy(at.toISOString()), source = await planAttentionTrial(study, queue, previous, slot);
  const scorecard = await freezeDiscoveryScoreV4(defaultScoreInputV4(candidate, now)), deep: TrialDeepRow[] = source.plan.population.map(p => ({ address: p.address, scorecard: p.address === candidate.address ? scorecard : null, gap: p.address === candidate.address ? null : "outside_saved_inventory" }));
  return { candidate, queue, source, study, deep, addresses, now };
}
it("preserves provider order and older runners while lightweight filtering applies no scoring or launch credit", async () => {
  const { queue, source, candidate } = await setup();
  expect(providerAttentionOrder(queue)[0]!.address).toBe(candidate.address); // adverse lead still belongs in baseline A
  expect(source.plan.provider[0]).toBe(candidate.address); expect(source.plan.lightweight).not.toContain(candidate.address);
  expect(source.plan.population).toHaveLength(20); expect(source.plan.lightweight).toHaveLength(5);
  expect(lightweightAttention(queue.rows.find(r => r.address === candidate.address)!)).toMatchObject({ reviewable: false, security_verified: false, launch_eligible: false });
  const row = structuredClone(queue.rows.find(r => r.checks !== "adverse")!); row.market_crosschecked = false;
  expect(lightweightAttention(row).gaps).toContain("fresh_dex_crosscheck_needed");
});
it("freezes unchanged v4 at the same cutoff and retains unavailable slots rather than substituting provider picks", async () => {
  const { source, deep, candidate } = await setup(), cohort = await freezeAttentionTrial(source, deep);
  expect(cohort.arms.frozen_v4).toEqual([candidate.address]); expect(cohort.cost.existing_deep_acquisition_rpc).toBeNull();
  const report = trialCohortResults(cohort, null, null); expect(report.frozen_v4).toMatchObject({ slots: 5, filled: 1, unknown: 5, retained_worthwhile: 0 });
  expect(cohort.automatic_promotion).toBe(false); expect(cohort.launch_gates_changed).toBe(false);
  deep[0]!.scorecard!.result.value++;
  await expect(freezeAttentionTrial(source, deep)).rejects.toThrow("trial_deep_cutoff_or_replay");
});
it("selects blinded union reviews and lower-position controls without arm order or backfilled replacements", async () => {
  const { source, deep } = await setup(), before = JSON.stringify(source), cohort = await freezeAttentionTrial(source, deep);
  expect(cohort.blind.length).toBeLessThanOrEqual(20); expect(cohort.controls).toHaveLength(5);
  expect(cohort.controls.every(a => source.plan.population.find(p => p.address === a)!.provider_position >= 11)).toBe(true);
  expect(cohort.controls.every(a => !Object.values(cohort.arms).flat().includes(a))).toBe(true);
  expect(cohort.blind.map(b => b.id)).toEqual(cohort.blind.map(b => b.id).sort()); expect(JSON.stringify(source)).toBe(before);
});
it("holds out later days and excludes every previously enrolled identity before ranking any arm", async () => {
  const original = await setup(), previous = original.source.plan.population.slice(0, 16).map(p => p.address), { source, deep } = await setup(3, previous);
  const cohort = await freezeAttentionTrial(source, deep);
  expect(source.plan.population.filter(p => !p.first_enrollment)).toHaveLength(16);
  for (const members of Object.values(cohort.arms)) expect(members.every(a => !previous.includes(a))).toBe(true);
  expect(cohort.arms.provider).toHaveLength(4); expect(cohort.arms.frozen_v4).toHaveLength(0);
});
it.each(["family", "crosscheck", "future", "duplicate", "identity"])("rejects inconsistent frozen source %s context", async change => {
  const { queue, study } = await setup();
  if (change === "family") queue.rows[0]!.attention_families++;
  if (change === "crosscheck") queue.rows[0]!.market_crosschecked = false;
  if (change === "future") queue.rows[0]!.sources[0]!.received_at = time(1);
  if (change === "duplicate") queue.rows.push(queue.rows[0]!);
  if (change === "identity") queue.rows[0]!.address = "invalid";
  await expect(planAttentionTrial(study, queue, [], 0)).rejects.toThrow();
});
it("enforces original daily windows without backfills, late substitutions or out-of-study captures", async () => {
  const study = await trialStudy(at.toISOString());
  expect(trialSlot(study, at)).toBe(0); expect(trialSlot(study, new Date(at.getTime() + 86400000))).toBe(1);
  for (const delta of [-1, 7200001, 14 * 86400000]) expect(() => trialSlot(study, new Date(at.getTime() + delta))).toThrow();
});
it("requires exact blind labels, separates early/late follow-ups and keeps unknown outcomes in all five slots", async () => {
  const { source, deep } = await setup(), cohort = await freezeAttentionTrial(source, deep);
  const labels = { cohort_hash: cohort.cohort_hash, phase: "baseline" as const, rows: cohort.blind.map(b => ({ id: b.id, worthwhile: "yes" as const, adverse: "unknown" as const, minutes: 1, note: "Founder review" })) };
  const baseline = await freezeTrialLabels(cohort, labels, time(1000)), follow = { ...labels, phase: "followup" as const };
  await expect(freezeTrialLabels(cohort, follow, time(86399999))).rejects.toThrow();
  await expect(freezeTrialLabels(cohort, follow, time(172800001))).rejects.toThrow();
  await expect(freezeTrialLabels(cohort, { ...labels, rows: labels.rows.slice(1) }, time(1000))).rejects.toThrow();
  const followup = await freezeTrialLabels(cohort, follow, time(86400000)), result = trialCohortResults(cohort, baseline, followup);
  expect(result.provider).toMatchObject({ retained_worthwhile: 5, unknown: 0 }); expect(result.frozen_v4).toMatchObject({ retained_worthwhile: 1, unknown: 4 });
  const unknown = await freezeTrialLabels(cohort, { ...follow, rows: follow.rows.map(r => ({ ...r, worthwhile: "unknown" })) }, time(86400000));
  expect(trialCohortResults(cohort, baseline, unknown).provider.unknown).toBe(5);
});
