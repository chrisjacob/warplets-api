import { afterEach, describe, expect, it, vi } from "vitest";
import { reviewSourceActivity, replaySourceActivity, type SourceActivityInput } from "./source-pilot-activity";
import { syntheticSourceActivityInput } from "./source-pilot-activity-fixtures";
import { SOURCE_PILOT_LIMITS } from "./source-pilot-model";
import { freezeSourcePilot } from "./source-pilot";
import { WSOL } from "./pump";

const sample = () => structuredClone(syntheticSourceActivityInput());
function jupiter(input: SourceActivityInput) { return (input.sources[0]!.response as Record<string, unknown>[])[0]!; }
function bars(input: SourceActivityInput) { return (input.sources[2]!.response as { data: { attributes: { ohlcv_list: number[][] } } }).data.attributes.ohlcv_list; }
function metadata(input: SourceActivityInput) { return input.cohort[0]!.pool_metadata!.response as {
  data: { id: string; type: string; attributes: { address: string }; relationships: { base_token: { data: { id: string; type: string } }; quote_token: { data: { id: string; type: string } } } };
}; }
const row = async (input = sample()) => (await reviewSourceActivity(input)).report.rows[0]!;
afterEach(() => vi.restoreAllMocks());

describe("offline paired source activity", () => {
  it("retains uncovered controls and source disagreement without changing scores, evidence or contacting providers", async () => {
    const network = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("forbidden"));
    const input = sample(), before = JSON.stringify(input), record = await reviewSourceActivity(input);
    expect(JSON.stringify(input)).toBe(before);
    expect(record.report).toMatchObject({ provenance: "synthetic", source_authenticity: "unverified", selection_proof: "unverified_file_assertion",
      provider_requests: 0, database_writes: 0, scoring_effect: "none", evidence_gates_changed: false,
      coverage: { cohort_total: 2, jupiter_fresh_parsed: 1, gecko_info_parsed: 1, metadata_consistent: 1, candle_parsed: 1, descriptive_bundles_available: 1 } });
    const [covered, absent] = record.report.rows;
    expect(covered).toMatchObject({ organic_activity: { organic_score: 23, stats_5m: { buy_organic_volume_pct: 0.25, sell_organic_volume_pct: 0.4, organic_net_buyers: 3 } },
      gt_score: 76, gt_score_observed_at: null, combined_score: null, wash_trading_verdict: "not_established", opening_market_cap_usd: null });
    expect(absent).toMatchObject({ jupiter_state: "not_supplied", gecko_info_state: "not_supplied", candle_state: "not_supplied",
      organic_activity: null, gt_score: null, candle_activity: null, descriptive_bundle_available: false });
    expect(covered!.sources).toHaveLength(3);
    for (const source of input.sources) expect(covered!.sources.map(value => value.record_hash)).toContain((await freezeSourcePilot(source)).record_hash);
    expect(await replaySourceActivity(record)).toMatchObject({ replay: "verified", record_hash: record.record_hash });
    expect(network).not.toHaveBeenCalled();
  });
  it("distinguishes an omitted source from an empty/rejected response without dropping the mint", async () => {
    const input = sample(); input.sources[0]!.response = [];
    expect(await row(input)).toMatchObject({ jupiter_state: "not_reported", organic_activity: null, descriptive_bundle_available: false });
    input.sources[0]!.response = [{ id: input.cohort[0]!.address, organicScore: 101 }];
    expect(await row(input)).toMatchObject({ jupiter_state: "rejected", organic_activity: null });
    input.sources.splice(0, 1);
    expect(await row(input)).toMatchObject({ jupiter_state: "not_supplied", organic_activity: null });
    expect((await reviewSourceActivity(input)).report.coverage.cohort_total).toBe(2);
  });
  it("treats zero, absent and undefined denominator ratios separately and never calls net buyers all buyers", async () => {
    const input = sample(); jupiter(input).stats5m = { buyVolume: 0, buyOrganicVolume: 0, sellVolume: 100, sellOrganicVolume: 0, numOrganicBuyers: 0 };
    expect((await row(input)).organic_activity!.stats_5m).toEqual({ buy_organic_volume_pct: null, sell_organic_volume_pct: 0, reported_traders: null, organic_net_buyers: 0, reported_net_buyers: null });
    jupiter(input).stats5m = { buyVolume: 1e-300, buyOrganicVolume: 1e-10 };
    expect((await row(input)).organic_activity!.stats_5m!.buy_organic_volume_pct).toBeNull();
    delete jupiter(input).stats5m;
    expect((await row(input)).organic_activity!.stats_5m).toBeNull();
  });
  it("holds missing/stale/future provider timestamps, including age measured at the common cutoff", async () => {
    for (const updatedAt of [undefined, "2026-10-21T05:54:59Z", "2026-10-21T06:00:01Z"]) {
      const input = sample(); if (updatedAt) jupiter(input).updatedAt = updatedAt; else delete jupiter(input).updatedAt;
      expect((await row(input)).organic_activity).toBeNull();
    }
    const input = sample(); input.sources[0]!.received_at = "2026-10-21T05:59:00Z"; jupiter(input).updatedAt = "2026-10-21T05:54:30Z";
    expect((await row(input)).jupiter_state).toBe("parsed");
    expect((await row(input)).organic_activity).toBeNull();
  });
});

describe("pool metadata consistency is not chain proof", () => {
  it("checks exact chain, pool and orientation but never authenticates candles or certifies graduation", async () => {
    expect((await row()).pool_binding).toMatchObject({ state: "metadata_consistent", canonical_chain_proof: "not_checked", source_authenticity: "unverified" });
    const input = sample(); input.cohort[0]!.pool_metadata = null;
    expect(await row(input)).toMatchObject({ pool_binding: { state: "not_supplied" }, candle_state: "parsed", candle_activity: null, descriptive_bundle_available: false });
  });
  it.each(["chain", "pool", "attribute", "base", "quote", "reversed", "type", "missing"])("holds %s metadata without rescuing it with a good GT score", async kind => {
    const input = sample(), pool = metadata(input).data;
    if (kind === "chain") pool.id = pool.id.replace("solana_", "base_");
    if (kind === "pool") pool.id = `solana_${input.cohort[1]!.pool}`;
    if (kind === "attribute") pool.attributes.address = input.cohort[1]!.pool;
    if (kind === "base") pool.relationships.base_token.data.id = `solana_${input.cohort[1]!.address}`;
    if (kind === "quote") pool.relationships.quote_token.data.id = `solana_${input.cohort[1]!.address}`;
    if (kind === "reversed") [pool.relationships.base_token, pool.relationships.quote_token] = [pool.relationships.quote_token, pool.relationships.base_token];
    if (kind === "type") pool.relationships.base_token.data.type = "pool";
    if (kind === "missing") input.cohort[0]!.pool_metadata!.response = null;
    expect(await row(input)).toMatchObject({ gt_score: 76, pool_binding: { state: "rejected" }, candle_activity: null, descriptive_bundle_available: false });
  });
});

describe("candle measurements preserve sample limits", () => {
  it("measures adjacent runs, moves, observed drawdown and moving zero-volume bars without a wash verdict", async () => {
    const result = await row();
    expect(result.candle_activity).toMatchObject({ observed_minutes: 3, expected_minutes: 3, missing_minutes: 0, complete_window: true,
      adjacent_pairs: 2, rising_adjacent_pairs: 2, rising_adjacent_pct: 100, longest_rising_run_pairs: 2,
      observed_close_drawdown_pct: 0, zero_reported_volume_moving_bars: 1, reported_volume_usd: 3,
      top_two_share_of_positive_adjacent_log_moves_pct: 100 });
    expect(result.candle_activity!.max_adjacent_close_move_pct).toBeCloseTo(10);
    expect(result.wash_trading_verdict).toBe("not_established");
  });
  it("does not bridge candle holes into jumps or uninterrupted runs", async () => {
    const input = sample(); bars(input).splice(1, 1);
    expect(await row(input)).toMatchObject({ descriptive_bundle_available: false, candle_activity: {
      complete_window: false, missing_minutes: 1, adjacent_pairs: 0, rising_adjacent_pct: null,
      longest_rising_run_pairs: 0, max_adjacent_close_move_pct: null, top_two_share_of_positive_adjacent_log_moves_pct: null } });
  });
  it("counts an adjacent zero-volume close jump even with flat OHLC, but never bridges a missing minute", async () => {
    const input = sample(); bars(input)[1]!.splice(1, 4, 1.1, 1.1, 1.1, 1.1);
    expect((await row(input)).candle_activity!.zero_reported_volume_moving_bars).toBe(1);
    bars(input).splice(2, 1);
    expect((await row(input)).candle_activity!.zero_reported_volume_moving_bars).toBe(0);
  });
  it("preserves missing edge minutes and does not let one observed bar imply a return or drawdown", async () => {
    const input = sample(); bars(input).splice(1);
    expect((await row(input)).candle_activity).toMatchObject({ observed_minutes: 1, missing_minutes: 2, observed_close_return_pct: null, observed_close_drawdown_pct: null, adjacent_pairs: 0 });
  });
  it("keeps an empty or rejected series held and rejects numerical overflow", async () => {
    const input = sample(); bars(input).splice(0);
    expect(await row(input)).toMatchObject({ candle_state: "not_reported", candle_activity: null });
    const bad = sample(); bars(bad)[0]![3] = 2;
    expect(await row(bad)).toMatchObject({ candle_state: "rejected", candle_activity: null });
    const huge = sample();
    bars(huge)[0]!.splice(1, 4, 1, 1, 1, 1);
    bars(huge)[1]!.splice(1, 4, 1e-320, 1e-320, 1e-320, 1e-320);
    bars(huge)[2]!.splice(1, 4, 1e10, 1e10, 1e10, 1e10);
    await expect(reviewSourceActivity(huge)).rejects.toThrow("source_activity_metric_overflow");
  });
  it("measures declines, flat periods and reversals without treating them as safety evidence", async () => {
    const input = sample(); bars(input)[0]!.splice(1, 4, 1, 1, 1, 1);
    expect((await row(input)).candle_activity).toMatchObject({ rising_adjacent_pairs: 1, longest_rising_run_pairs: 1 });
    expect((await row(input)).candle_activity!.observed_close_drawdown_pct).toBeCloseTo(100 / 11);
    for (const bar of bars(input)) bar.splice(1, 4, 1, 1, 1, 1);
    expect(await row(input)).toMatchObject({ candle_activity: { rising_adjacent_pct: 0, max_adjacent_close_move_pct: 0,
      zero_reported_volume_moving_bars: 0, top_two_share_of_positive_adjacent_log_moves_pct: null }, wash_trading_verdict: "not_established" });
  });
});

describe("manifest boundaries and immutable replay", () => {
  it.each(["selection", "future", "stale", "before_selection", "endpoint", "duplicate_mint", "duplicate_pool", "duplicate_source", "foreign_mint", "foreign_pool", "mixed", "url", "chain_proof"])("rejects %s manifest contradictions/injected authority", async kind => {
    const input = sample();
    if (kind === "selection") input.selected_at = "2026-10-21T06:00:01Z";
    if (kind === "future") input.sources[0]!.received_at = "2026-10-21T06:00:01Z";
    if (kind === "stale") { input.selected_at = "2026-10-21T05:00:00Z"; input.cohort[0]!.pool_metadata!.received_at = "2026-10-21T05:54:59Z"; }
    if (kind === "before_selection") input.sources[0]!.received_at = "2026-10-21T05:58:00Z";
    if (kind === "endpoint") { const request = input.sources[2]!.request; if (request.kind === "geckoterminal_pool_candles") request.end_at = "2026-10-21T05:59:00Z"; }
    if (kind === "duplicate_mint") input.cohort[1]!.address = input.cohort[0]!.address;
    if (kind === "duplicate_pool") input.cohort[1]!.pool = input.cohort[0]!.pool;
    if (kind === "duplicate_source") input.sources.push(input.sources[0]!);
    if (kind === "foreign_mint") input.sources[0]!.request = { kind: "jupiter_tokens_v2", addresses: [WSOL] };
    if (kind === "foreign_pool") { const request = input.sources[2]!.request; if (request.kind === "geckoterminal_pool_candles") request.pool = input.cohort[1]!.pool; }
    if (kind === "mixed") input.sources[0]!.provenance = "unverified_file";
    if (kind === "url") Object.assign(input, { url: "https://untrusted.invalid" });
    if (kind === "chain_proof") Object.assign(input.cohort[0]!, { canonical_chain_proof: true });
    await expect(reviewSourceActivity(input)).rejects.toThrow();
  });
  it("accepts a wholly absent source set and preserves the exact cohort order", async () => {
    const input = sample(); input.sources = []; input.cohort.reverse();
    expect((await reviewSourceActivity(input)).report.rows.map(row => row.address)).toEqual(input.cohort.map(row => row.address));
    expect((await reviewSourceActivity(input)).report.coverage).toMatchObject({ cohort_total: 2, descriptive_bundles_available: 0 });
  });
  it("bounds combined bytes/work/counts and rejects fake authentication", async () => {
    await expect(reviewSourceActivity({ ...sample(), provenance: "authenticated" })).rejects.toThrow();
    const huge = sample(); huge.cohort[0]!.pool_metadata!.response = "x".repeat(SOURCE_PILOT_LIMITS.input_bytes);
    await expect(reviewSourceActivity(huge)).rejects.toThrow("source_pilot_size_limit");
    const many = sample(); many.sources = Array(22).fill(many.sources[0]);
    await expect(reviewSourceActivity(many)).rejects.toThrow();
    const deep = sample(); let value: unknown = null; for (let i = 0; i < 26; i++) value = { value };
    deep.cohort[0]!.pool_metadata!.response = value;
    await expect(reviewSourceActivity(deep)).rejects.toThrow("source_pilot_input_complexity_limit");
  });
  it("rejects changed raw evidence, cohort, timestamps, metrics and record identity", async () => {
    const record = await reviewSourceActivity(sample());
    for (const mutate of [
      (value: typeof record) => { value.inputs.sources[0]!.response = []; },
      (value: typeof record) => { value.inputs.cohort.reverse(); },
      (value: typeof record) => { value.inputs.cutoff_at = "2026-10-21T06:00:01Z"; },
      (value: typeof record) => { value.report.rows[0]!.gt_score = 99; },
      (value: typeof record) => { value.report.coverage.cohort_total = 1; },
      (value: typeof record) => { value.record_hash = "0".repeat(64); },
      (value: typeof record) => { value.input_hash = "0".repeat(64); },
    ]) { const changed = structuredClone(record); mutate(changed); await expect(replaySourceActivity(changed)).rejects.toThrow(); }
  });
});
