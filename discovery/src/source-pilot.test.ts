import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { syntheticSourcePilotInputs } from "./source-pilot-fixtures";
import { freezeSourcePilot, replaySourcePilot, sourcePilotPlan } from "./source-pilot";
import { SOURCE_PILOT_LIMITS, type SourcePilotInput } from "./source-pilot-model";
import { toBase58 } from "./solana";

const other = toBase58(new Uint8Array(32).fill(4));
function sample(index = 0) { return structuredClone(syntheticSourcePilotInputs()[index]!); }
function token(input: SourcePilotInput) { return z.array(z.record(z.string(), z.unknown())).parse(input.response)[0]!; }
function candleRows(input: SourcePilotInput) { return (input.response as { data: { attributes: { ohlcv_list: number[][] } } }).data.attributes.ohlcv_list; }
async function jupiter(input: SourcePilotInput) {
  const result = (await freezeSourcePilot(input)).report.result;
  if (result.kind !== "jupiter_tokens_v2") throw new Error("unexpected_kind");
  return result.rows;
}
async function gecko(input: SourcePilotInput) {
  const result = (await freezeSourcePilot(input)).report.result;
  if (result.kind !== "geckoterminal_token_info") throw new Error("unexpected_kind");
  return result.row;
}
async function candles(input: SourcePilotInput) {
  const result = (await freezeSourcePilot(input)).report.result;
  if (result.kind !== "geckoterminal_pool_candles") throw new Error("unexpected_kind");
  return result.series;
}
afterEach(() => vi.restoreAllMocks());
describe("offline source pilot boundaries and request plans", () => {
  it("has no live activation, source calls, storage writes or score effects", async () => {
    const network = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("outside_call_forbidden"));
    const plan = sourcePilotPlan();
    expect(plan).toMatchObject({ mode: "offline_only", live_collection_enabled: false, provider_requests: 0, database_writes: 0, proposed_http_requests: 0, scoring_effect: "none", evidence_gates_changed: false });
    expect(plan.future_admission).toMatchObject({ market_daily_subset: 20, shared_market_daily_default: 600, subset_is_additional: false, shared_research_records: 120, shared_research_bytes: 10000000, reservations_made: false, remaining_capacity: null });
    for (const input of syntheticSourcePilotInputs()) {
      const before = JSON.stringify(input), record = await freezeSourcePilot(input), replay = await replaySourcePilot(record);
      expect(JSON.stringify(input)).toBe(before);
      expect(replay).toMatchObject({ replay: "verified", provider_requests: 0, database_writes: 0, source_authenticity: "unverified" });
      expect(record.report).toMatchObject({ provenance: "synthetic", scoring_effect: "none", evidence_gates_changed: false });
    }
    expect(network).not.toHaveBeenCalled();
  });
  it("plans only fixed-host read routes and flags candle pool-binding work", () => {
    const inputs = syntheticSourcePilotInputs();
    const jup = sourcePilotPlan(inputs[0]!.request);
    expect(jup.proposed_http_requests).toBe(1);
    expect(new URL(jup.proposed_requests[0]!.url).pathname).toBe("/tokens/v2/search");
    const gt = sourcePilotPlan(inputs[1]!.request);
    expect(gt.proposed_requests[0]!.url).toContain("api.geckoterminal.com/api/v2/networks/solana/tokens/");
    const series = sourcePilotPlan(inputs[2]!.request);
    expect(series.proposed_http_requests).toBe(2);
    const url = new URL(series.proposed_requests[1]!.url);
    expect(Object.fromEntries(url.searchParams)).toMatchObject({ aggregate: "1", currency: "usd", include_empty_intervals: "false", limit: "3" });
    for (const plan of [jup, gt, series]) for (const descriptor of plan.proposed_requests) {
      expect(descriptor.method).toBe("GET"); expect(new URL(descriptor.url).protocol).toBe("https:");
      expect(new URL(descriptor.url).searchParams.has("api_key")).toBe(false);
    }
  });
  it("rejects duplicate, oversized, malformed mints and injected live/URL parameters", () => {
    const address = token(sample()).id as string;
    for (const addresses of [[address, address], Array.from({ length: 11 }, (_, i) => toBase58(new Uint8Array(32).fill(i + 1))), ["https://untrusted.invalid"]])
      expect(() => sourcePilotPlan({ kind: "jupiter_tokens_v2", addresses })).toThrow();
    expect(() => sourcePilotPlan({ ...sample().request, url: "https://untrusted.invalid" } as never)).toThrow();
    expect(() => sourcePilotPlan({ ...sample().request, live: true } as never)).toThrow();
  });
  it.each([
    ["2026-10-21T05:57:01Z", "2026-10-21T06:00:00Z"],
    ["2026-10-21T06:00:00Z", "2026-10-21T06:00:00Z"],
    ["2026-10-20T23:59:00Z", "2026-10-21T06:00:00Z"],
  ])("rejects an unaligned, empty or oversized candle window", (start_at, end_at) => {
    expect(() => sourcePilotPlan({ ...sample(2).request, start_at, end_at } as never)).toThrow();
  });
  it("bounds bytes, nesting and work and rejects non-JSON numerical laundering", async () => {
    const huge = sample(); huge.response = "x".repeat(SOURCE_PILOT_LIMITS.input_bytes);
    await expect(freezeSourcePilot(huge)).rejects.toThrow("source_pilot_size_limit");
    const deep = sample(); let nested: unknown = null; for (let i = 0; i < 26; i++) nested = { nested }; deep.response = nested;
    await expect(freezeSourcePilot(deep)).rejects.toThrow("source_pilot_input_complexity_limit");
    const many = sample(); many.response = Array(30001).fill(null);
    await expect(freezeSourcePilot(many)).rejects.toThrow("source_pilot_input_complexity_limit");
    for (const value of [NaN, Infinity, undefined, () => 1, new Date()]) {
      const input = sample(); input.response = value;
      await expect(freezeSourcePilot(input)).rejects.toThrow("source_pilot_non_json_input");
    }
    const cyclic: Record<string, unknown> = {}; cyclic.self = cyclic;
    await expect(freezeSourcePilot({ ...sample(), response: cyclic })).rejects.toThrow("source_pilot_non_json_input");
  });
  it("rejects false authenticated/live provenance and future collection cutoffs", async () => {
    await expect(freezeSourcePilot({ ...sample(), provenance: "authenticated" })).rejects.toThrow();
    await expect(freezeSourcePilot({ ...sample(2), received_at: "2026-10-21T05:59:00Z" })).rejects.toThrow();
    const input = sample(); input.provenance = "unverified_file";
    expect((await freezeSourcePilot(input)).report.source_authenticity).toBe("unverified");
  });
  it("rejects changed inputs, reports, metadata and fabricated hashes on replay", async () => {
    const record = await freezeSourcePilot(sample());
    for (const mutate of [
      (value: typeof record) => { value.inputs.response = []; },
      (value: typeof record) => { value.report.received_at = "2026-10-21T06:01:00Z"; },
      (value: typeof record) => { value.report.provenance = "unverified_file"; },
      (value: typeof record) => { value.input_hash = "0".repeat(64); },
      (value: typeof record) => { value.record_hash = "0".repeat(64); },
    ]) {
      const changed = structuredClone(record); mutate(changed);
      await expect(replaySourcePilot(changed)).rejects.toThrow("source_pilot_replay_mismatch");
    }
  });
});
describe("Jupiter preserves independent metrics and absent evidence", () => {
  it("does not turn FDV into cap, first-pool time into creation, or provider controls into proof", async () => {
    const input = sample(), row = token(input);
    row.firstPool = { id: other, createdAt: "2026-10-21T05:00:00Z" }; input.response = [row];
    const result = (await jupiter(input))[0]!;
    expect(result.state).toBe("parsed");
    expect(result.metrics).toMatchObject({ organic_score: 23, reported_cap_usd: null, fdv_usd: 5000000, top_holders_pct: 41.5, freeze_authority_disabled: false, first_pool_created_at: "2026-10-21T05:00:00Z", stats_1h: null });
    expect(result.metrics).not.toHaveProperty("created_at");
    expect(result.metrics!.stats_5m).toMatchObject({ organic_buy_volume_usd: 25, organic_net_buyers: 3, traders: 100 });
  });
  it("keeps zero values, false values and missing fields distinct", async () => {
    const input = sample(), row = token(input);
    row.organicScore = 0; row.holderCount = 0; row.audit = { mintAuthorityDisabled: false }; delete row.updatedAt; delete row.stats5m; input.response = [row];
    const result = (await jupiter(input))[0]!;
    expect(result.metrics).toMatchObject({ organic_score: 0, holder_count: 0, mint_authority_disabled: false, freeze_authority_disabled: null, top_holders_pct: null, stats_5m: null });
    expect(result.provider_updated_at).toBeNull(); expect(result.issues).toContain("provider_time_missing");
    delete row.organicScore; input.response = [row];
    expect((await jupiter(input))[0]!.metrics!.organic_score).toBeNull();
  });
  it.each(["23", "", true, -1, 101])("holds invalid organic score %s instead of coercing it", async value => {
    const input = sample(), row = token(input); row.organicScore = value; input.response = [row];
    expect((await jupiter(input))[0]).toMatchObject({ state: "rejected", metrics: null });
  });
  it("keeps a valid neighbour when one identified token has bad metrics", async () => {
    const input = sample(); input.request = { kind: "jupiter_tokens_v2", addresses: [token(input).id as string, other] };
    input.response = [token(input), { id: other, organicScore: 101 }];
    expect((await jupiter(input)).map(row => row.state)).toEqual(["parsed", "rejected"]);
  });
  it("retains missing and duplicate responses and holds unassignable/foreign identities", async () => {
    const input = sample(), row = token(input);
    input.response = []; expect((await jupiter(input))[0]!.state).toBe("not_reported");
    input.response = [row, row]; expect((await jupiter(input))[0]!.issues).toContain("duplicate_token_identity");
    for (const extra of [{ id: other }, { organicScore: 99 }]) {
      input.response = [row, extra]; expect((await jupiter(input))[0]!.state).toBe("rejected");
    }
    const address = row.id as string, index = address.slice(4).search(/[a-zA-Z]/) + 4;
    const character = address[index]!, changed = address.slice(0, index) + (character === character.toUpperCase() ? character.toLowerCase() : character.toUpperCase()) + address.slice(index + 1);
    input.response = [{ ...row, id: changed }]; expect((await jupiter(input))[0]!.state).toBe("rejected");
  });
  it("rejects conflicting activity denominators and future times, and marks stale times", async () => {
    const input = sample(), row = token(input);
    row.stats5m = { buyVolume: 10, buyOrganicVolume: 11 }; input.response = [row];
    expect((await jupiter(input))[0]!.state).toBe("rejected");
    delete row.stats5m; row.updatedAt = "2026-10-21T06:00:01Z";
    expect((await jupiter(input))[0]!.issues).toContain("provider_time_future");
    row.updatedAt = "2026-10-21T05:00:00Z";
    expect((await jupiter(input))[0]!.issues).toContain("provider_time_stale");
  });
});
describe("GeckoTerminal fields and minute candles", () => {
  it("reads decimal percentages without converting 41.5 into 0.415 and keeps score time unknown", async () => {
    const row = await gecko(sample(1));
    expect(row.metrics).toMatchObject({ gt_score: 76, top_ten_pct: 41.5, holder_count: 100, score_observed_at: null });
    expect(row.issues).toContain("score_time_not_reported");
  });
  it.each(["", " ", "0x20", "1e2", true, -1, "101"])("rejects invalid Gecko score %s", async value => {
    const input = sample(1), response = input.response as { data: { attributes: { gt_score: unknown } } };
    response.data.attributes.gt_score = value;
    expect((await gecko(input)).state).toBe("rejected");
  });
  it("requires both returned chain-qualified id and exact address to match", async () => {
    const input = sample(1), response = input.response as { data: { id: string; attributes: { address: string } } };
    response.data.id = `base_${response.data.attributes.address}`;
    expect((await gecko(input)).state).toBe("rejected");
    response.data.id = `solana_${response.data.attributes.address}`; response.data.attributes.address = other;
    expect((await gecko(input)).state).toBe("rejected");
  });
  it("keeps a candle hole visible and never infers opening cap, pool identity or wash trading", async () => {
    const series = await candles(sample(2));
    expect(series).toMatchObject({ state: "parsed", expected_minutes: 3, returned_minutes: 2, missing_minutes: 1, complete_window: false, pool_identity: "request_context_only", opening_market_cap_usd: null, wash_trading_verdict: "not_established", reported_volume_usd: 3 });
    expect(series.close_return_pct).toBeCloseTo(20);
    expect(series.candles[0]!.start_at).toBe("2026-10-21T05:57:00.000Z");
    expect(series.issues).toContain("candle_minutes_missing");
  });
  it("accepts a complete closed window without gap filling", async () => {
    const input = sample(2); candleRows(input).splice(1, 0, [Date.parse("2026-10-21T05:58:00Z") / 1000, 1, 1.2, 1, 1.1, 0]);
    expect(await candles(input)).toMatchObject({ complete_window: true, missing_minutes: 0, returned_minutes: 3, reported_volume_usd: 3 });
  });
  it.each(["milliseconds", "duplicate", "out_of_order", "current_minute", "outside_start", "bad_range", "negative_volume"])("holds a %s candle series in full", async kind => {
    const input = sample(2), rows = candleRows(input);
    if (kind === "milliseconds") rows[0]![0] *= 1000;
    if (kind === "duplicate") rows.push([...rows[0]!]);
    if (kind === "out_of_order") rows.reverse();
    if (kind === "current_minute") rows[0]![0] = Date.parse(input.received_at) / 1000;
    if (kind === "outside_start") rows[1]![0] -= 60;
    if (kind === "bad_range") rows[0]![2] = 0.5;
    if (kind === "negative_volume") rows[0]![5] = -1;
    expect(await candles(input)).toMatchObject({ state: "rejected", candles: [], reported_volume_usd: null, complete_window: false });
  });
  it("requires correct base/quote identity and refuses ambiguous orientation", async () => {
    const input = sample(2), response = input.response as { meta: { base: { address: string }; quote: { address: string } } };
    [response.meta.base, response.meta.quote] = [response.meta.quote, response.meta.base];
    expect((await candles(input)).issues).toContain("candle_token_orientation_mismatch");
  });
  it("does not interpret absent trades as zero volume or a good score", async () => {
    const input = sample(2); candleRows(input).splice(0);
    expect(await candles(input)).toMatchObject({ state: "not_reported", returned_minutes: 0, reported_volume_usd: null, close_return_pct: null, complete_window: false });
  });
});
