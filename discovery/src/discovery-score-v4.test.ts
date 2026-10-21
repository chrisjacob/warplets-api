import { describe, expect, it, vi } from "vitest";
import ponyx from "../fixtures/score-ponyx-review.json";
import usdf from "../fixtures/score-usdf-review.json";
import xto from "../fixtures/score-xto-review.json";
import { ScoreRecordV3Schema } from "./discovery-score-v3-model";
import { defaultScoreInputV4, evaluateDiscoveryScoreV4, freezeDiscoveryScoreV4 } from "./discovery-score-v4";
import { evaluateDiscoveryScoreV3 } from "./discovery-score-v3";
import { DISCOVERY_SCORE_POLICY_V3 } from "./discovery-score-v3-model";
import { replayAnyDiscoveryScore } from "./discovery-score-replay";
import { AnyScoreRecordSchema } from "./discovery-score-models";
import { assess, DEFAULT_POLICY } from "./model";

const original = ScoreRecordV3Schema.parse(ponyx.original), at = new Date(original.inputs.as_of);
const input = () => defaultScoreInputV4(structuredClone(original.inputs.candidate), at, structuredClone(original.inputs.prices), original.inputs.history_limited, structuredClone(original.inputs.first_market));
const codes = (result: ReturnType<typeof evaluateDiscoveryScoreV4>) => result.concerns.map(concern => concern.code);
const v3 = (value = input()) => evaluateDiscoveryScoreV3({ ...value, version: "discovery-score-input-v3", policy: DISCOVERY_SCORE_POLICY_V3 });

describe("v4 same-slot launch review", () => {
  it("replays the actual PONYX v3 grade unchanged and limits the identical v4 inputs to 25 without provider calls", async () => {
    const network = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("forbidden"));
    try {
      expect(original.result.value).toBe(60);
      expect(await replayAnyDiscoveryScore(original)).toMatchObject({ status: "verified", provider_requests: 0 });
      const value = input(), before = structuredClone(value), record = await freezeDiscoveryScoreV4(value);
      expect(value).toEqual(before);
      expect(record.result).toMatchObject({ value: 25, ceiling: 25, evidence_coverage: 75,
        launch_timing: { status: "review", confirmed_same_slot: true, creation_slot: 459466560, graduation_slot: 459466560, high_early_report: true, early_reported_cap_usd: 7195545 },
        launch_review: { creation_purchase_raw: null, creation_purchase_observed_supply_pct: null }, staircase: { status: "insufficient" } });
      expect(codes(record.result)).toContain("same_slot_creation_and_graduation");
      expect(codes(record.result)).toContain("same_slot_high_early_reported_valuation");
      expect(record.result.criteria.find(criterion => criterion.id === "sampled_performance")!.points).toBe(0);
      expect(record.result.base_points).toBe(v3(value).base_points);
      expect(await replayAnyDiscoveryScore(record)).toMatchObject({ status: "verified" });
      expect(assess(value.candidate, DEFAULT_POLICY, at)).toEqual(assess(before.candidate, DEFAULT_POLICY, at));
      value.candidate.address = value.candidate.pool;
      expect(evaluateDiscoveryScoreV4(value).value).toBe(25); // No mint blacklist.
      for (const old of [usdf.original, xto.original]) expect(await replayAnyDiscoveryScore(AnyScoreRecordSchema.parse(old))).toMatchObject({ status: "verified" });
      expect(network).not.toHaveBeenCalled();
    } finally { network.mockRestore(); }
  });
  it("limits same-slot launches to 50 without an early cap, and never treats a late cap or FDV as opening evidence", () => {
    for (const kind of ["absent", "null", "late", "fdv", "future_observation", "pre_creation_observation"]) {
      const value = input();
      if (kind === "absent") value.first_market = null;
      if (kind === "null" || kind === "fdv") value.first_market!.market_cap_usd = null;
      if (kind === "late") value.first_market!.fetched_at = new Date(Date.parse(value.candidate.creation!.block_time) + 600001).toISOString();
      if (kind === "fdv") value.candidate.market!.fdv_usd = 1e12;
      if (kind === "future_observation") value.first_market!.observed_at = value.as_of;
      if (kind === "pre_creation_observation") value.first_market!.observed_at = new Date(Date.parse(value.candidate.creation!.block_time) - 1).toISOString();
      const result = evaluateDiscoveryScoreV4(value);
      expect(result.launch_timing).toMatchObject({ confirmed_same_slot: true, high_early_report: null });
      expect(codes(result), kind).not.toContain("same_slot_high_early_reported_valuation");
      expect(result.ceiling, kind).toBe(50);
    }
  });
  it.each([4999999, 5000000, 5000001])("uses the inherited early-cap boundary exactly (%s)", cap => {
    const value = input(); value.first_market!.market_cap_usd = cap;
    expect(evaluateDiscoveryScoreV4(value).ceiling).toBe(cap >= 5000000 ? 25 : 50);
  });
  it.each([0, 600, 600.001])("uses the inherited ten-minute window exactly (%s seconds)", delay => {
    const value = input(); value.first_market!.fetched_at = new Date(Date.parse(value.candidate.creation!.block_time) + delay * 1000).toISOString();
    expect(evaluateDiscoveryScoreV4(value).ceiling).toBe(delay <= 600 ? 25 : 50);
  });
  it("does not classify a different-slot launch as same-slot even within the same rounded second", () => {
    const value = input(); value.candidate.graduation!.slot++;
    const result = evaluateDiscoveryScoreV4(value);
    expect(result.launch_timing).toMatchObject({ status: "not_flagged", confirmed_same_slot: false });
    expect(result.value).toBe(v3(value).value);
    expect(codes(result).some(code => code.startsWith("same_slot"))).toBe(false);
  });
  it.each(["creation_missing", "graduation_missing", "provisional", "future_creation", "future_graduation", "future_fetch", "fetch_before_chain", "slot_order", "time_order", "same_slot_time_conflict", "program", "kind", "instruction"])("holds uncertified or inconsistent %s timing", kind => {
    const value = input(), candidate = value.candidate;
    if (kind === "creation_missing") candidate.creation = null;
    if (kind === "graduation_missing") candidate.graduation = null;
    if (kind === "provisional") candidate.verification = "provisional";
    if (kind === "future_creation") candidate.creation!.block_time = new Date(at.getTime() + 1).toISOString();
    if (kind === "future_graduation") candidate.graduation!.block_time = new Date(at.getTime() + 1).toISOString();
    if (kind === "future_fetch") candidate.graduation!.fetched_at = new Date(at.getTime() + 1).toISOString();
    if (kind === "fetch_before_chain") candidate.graduation!.fetched_at = new Date(Date.parse(candidate.graduation!.block_time) - 1).toISOString();
    if (kind === "slot_order") candidate.graduation!.slot--;
    if (kind === "time_order") candidate.graduation!.block_time = new Date(Date.parse(candidate.creation!.block_time) - 1000).toISOString();
    if (kind === "same_slot_time_conflict") candidate.graduation!.block_time = new Date(Date.parse(candidate.creation!.block_time) + 1000).toISOString();
    if (kind === "program") candidate.graduation!.program = candidate.address;
    if (kind === "kind") candidate.graduation!.kind = "creation";
    if (kind === "instruction") candidate.graduation!.instruction = "unrecognized";
    const result = evaluateDiscoveryScoreV4(value);
    expect(result.launch_timing).toMatchObject({ status: "unknown", confirmed_same_slot: null });
    expect(codes(result).some(code => code.startsWith("same_slot"))).toBe(false);
  });
  it("does not cancel the dated launch concern with later dispersion, price history limits, staleness or absent wallets", () => {
    const value = input(); value.history_limited = true; value.prices = []; value.candidate.wallet_analysis = null;
    expect(evaluateDiscoveryScoreV4(value).value).toBe(25);
    value.as_of = new Date(at.getTime() + 6 * 3600000).toISOString();
    expect(evaluateDiscoveryScoreV4(value).ceiling).toBe(25);
    value.candidate.risk.mint_authority = "active";
    expect(evaluateDiscoveryScoreV4(value).ceiling).toBe(25);
    value.candidate.verification = "rejected";
    expect(evaluateDiscoveryScoreV4(value).value).toBe(0);
  });
  it("preserves a stronger existing concern and point accounting", () => {
    const value = input(); value.candidate.market!.liquidity_usd = 0;
    const result = evaluateDiscoveryScoreV4(value);
    expect(result.ceiling).toBe(0); expect(result.value).toBe(0);
    expect(result.base_points).toBeCloseTo(result.components.reduce((sum, component) => sum + component.points, 0));
    expect(result.value).toBeLessThanOrEqual(v3(value).value);
  });
  it("rejects changed inputs, outputs, policy and record hashes on replay", async () => {
    const original = await freezeDiscoveryScoreV4(input());
    for (const mutate of [
      (record: typeof original) => { record.inputs.candidate.graduation!.slot++; },
      (record: typeof original) => { record.inputs.first_market!.market_cap_usd = 0; },
      (record: typeof original) => { record.result.launch_timing.confirmed_same_slot = false; },
      (record: typeof original) => { record.result.value = 60; },
      (record: typeof original) => { record.record_hash = "0".repeat(64); },
      (record: typeof original) => { Object.assign(record.inputs.policy.launch_timing, { same_slot_ceiling: 99 }); },
    ]) { const changed = structuredClone(original); mutate(changed); await expect(replayAnyDiscoveryScore(changed)).rejects.toThrow(); }
  });
});
