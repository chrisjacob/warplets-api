import { describe, expect, it } from "vitest";
import { fixtureCandidates } from "./fixtures";
import { assess, DEFAULT_POLICY, shortlist } from "./model";
import { reportedCapReview } from "./market-review";

const at = new Date("2026-10-20T00:00:00Z"), freshness = DEFAULT_POLICY.max_market_age_seconds;
const sample = async () => {
  const c = (await fixtureCandidates(at))[0]!;
  return { ...c, market: { ...c.market!, market_cap_usd: 10_000_001, liquidity_usd: 100_000 } };
};
describe("new token reported-cap review is a diagnostic", () => {
  it("uses a strict $10M threshold and independently saved creation, without FDV fallback", async () => {
    const c = await sample();
    expect(reportedCapReview(c, at, freshness)).toMatchObject({ market_cap_usd: 10_000_001, age_hours: 1, market_stale: false });
    expect(reportedCapReview({ ...c, market: { ...c.market, market_cap_usd: 10_000_000 } }, at, freshness)).toBeNull();
    expect(reportedCapReview({ ...c, market: { ...c.market, market_cap_usd: null, fdv_usd: 500_000_000 } }, at, freshness)).toBeNull();
    expect(reportedCapReview({ ...c, creation: null }, at, freshness)).toBeNull();
    expect(reportedCapReview({ ...c, market: null }, at, freshness)).toBeNull();
  });
  it("includes exactly 24 hours, excludes older and future creation times", async () => {
    const c = await sample(), created = (offset: number) => ({ ...c, creation: { ...c.creation!, block_time: new Date(at.getTime() + offset).toISOString() } });
    expect(reportedCapReview(created(-86_400_000), at, freshness)).not.toBeNull();
    expect(reportedCapReview(created(-86_400_001), at, freshness)).toBeNull();
    expect(reportedCapReview(created(1), at, freshness)).toBeNull();
  });
  it("retains stale reports as labelled observations, and never invents missing liquidity", async () => {
    const c = await sample();
    expect(reportedCapReview(c, new Date(at.getTime() + freshness * 1000), freshness)?.market_stale).toBe(false);
    expect(reportedCapReview(c, new Date(at.getTime() + freshness * 1000 + 1), freshness)?.market_stale).toBe(true);
    expect(reportedCapReview({ ...c, market: { ...c.market, fetched_at: new Date(at.getTime() + 1).toISOString() } }, at, freshness)?.market_stale).toBe(true);
    expect(reportedCapReview({ ...c, market: { ...c.market, liquidity_usd: null } }, at, freshness)?.liquidity_to_cap_pct).toBeNull();
    expect(reportedCapReview(c, at, freshness)?.liquidity_to_cap_pct).toBeCloseTo(1);
  });
  it("does not mutate evidence, eligibility or ordering, including repeated evaluation", async () => {
    const c = await sample(), f = await fixtureCandidates(at), before = JSON.stringify(c);
    const result = assess(c, DEFAULT_POLICY, at), ranked = shortlist([c, ...f], DEFAULT_POLICY, at);
    reportedCapReview(c, at, freshness); reportedCapReview(c, at, freshness);
    expect(JSON.stringify(c)).toBe(before);
    expect(assess(c, DEFAULT_POLICY, at)).toEqual(result);
    expect(shortlist([c, ...f], DEFAULT_POLICY, at)).toEqual(ranked);
  });
});
