import { describe, expect, it } from "vitest";
import type { Market } from "./model";
import { pricePatternReview, PRICE_PATTERN_RULE } from "./price-pattern";

const at = new Date("2026-10-20T08:00:00Z");
function point(price: number | null, minutesAgo: number, source: Market["source"] = "dexscreener"): Market {
  return { source, fetched_at: new Date(at.getTime() - minutesAgo * 60_000).toISOString(), observed_at: null,
    price_usd: price, market_cap_usd: price === null ? null : price * 1e9, fdv_usd: null, liquidity_usd: 1e6, volume_24h_usd: null, image_url: null };
}
const line = () => Array.from({ length: 21 }, (_, i) => point(1 + i * .01, 60 - i * 3));

describe("sampled smooth-rise review", () => {
  it("flags a linear rise using elapsed timestamps, without making an authenticity decision", () => {
    const p = line(), result = pricePatternReview(p, at);
    expect(result).toMatchObject({ version: "sampled-linear-rise-v1", status: "review", samples: 21, span_minutes: 60, stale: false });
    expect(result.metrics).toMatchObject({ upward_steps: 20, downward_steps: 0, unchanged_steps: 0, upward_step_pct: 100, max_drawdown_pct: 0 });
    expect(result.metrics!.return_pct).toBeCloseTo(20);
    expect(result.metrics!.linear_r_squared).toBeCloseTo(1);
    expect(pricePatternReview([...p].reverse(), at)).toEqual(result);
  });
  it("requires sufficient sample count, duration and return, including threshold boundaries", () => {
    expect(pricePatternReview(line().slice(1), at).status).toBe("insufficient"); // 20 samples, only 57 minutes
    expect(pricePatternReview(Array.from({ length: 19 }, (_, i) => point(1 + i / 100, 72 - i * 4)), at).status).toBe("insufficient");
    expect(pricePatternReview(Array.from({ length: 20 }, (_, i) => point(100 + i, 60 - i * 60 / 19)), at).status).toBe("review");
    expect(pricePatternReview(Array.from({ length: 21 }, (_, i) => point(100 + i / 5, 60 - i * 3)), at).status).toBe("not_flagged");
    expect(pricePatternReview(Array.from({ length: 21 }, (_, i) => point(100 + i, 60 - i * 3)), new Date(at.getTime() + 180_000)).stale).toBe(false);
    expect(pricePatternReview(line(), new Date(at.getTime() + 180_001)).stale).toBe(true);
  });
  it("does not flag flat, falling, violently reversing or curved prices", () => {
    for (const value of [() => 1, (i: number) => 2 - i * .01, (i: number) => 1 + i * .01 + (i % 2 ? .2 : 0), (i: number) => 1 + i ** 3 * .005]) {
      const result = pricePatternReview(Array.from({ length: 21 }, (_, i) => point(value(i), 60 - i * 3)), at);
      expect(result.status).toBe("not_flagged");
    }
    expect(pricePatternReview(line().map(p => ({ ...p, price_usd: 1 })), at).metrics!.linear_r_squared).toBeNull();
  });
  it("does not confuse sample-index linearity with price-versus-time linearity", () => {
    const p = Array.from({ length: 31 }, (_, i) => point(1 + i / 50, 90 - i ** 2 / 10));
    const result = pricePatternReview(p, at);
    expect(result.status).toBe("not_flagged");
    expect(result.metrics!.linear_r_squared).toBeLessThan(PRICE_PATTERN_RULE.min_linear_r_squared);
  });
  it("starts a new run on a source change or a gap over ten minutes", () => {
    const p = line();
    expect(pricePatternReview([...p, point(1.3, -1)], at).gaps).toContain("invalid_or_future_observation_ignored");
    const changed = pricePatternReview([...p.slice(0, -1), point(1.2, 0, "geckoterminal")], at);
    expect(changed).toMatchObject({ status: "insufficient", samples: 1 });
    expect(changed.gaps).toContain("source_change_break");
    const gap = pricePatternReview([...p, point(1.3, -11)], new Date(at.getTime() + 660_000));
    expect(gap).toMatchObject({ status: "insufficient", samples: 1 });
    expect(gap.gaps).toContain("sampling_gap_break");
    expect(pricePatternReview([...p, point(1.3, -10)], new Date(at.getTime() + 600_000)).samples).toBe(22);
  });
  it("does not bridge missing/zero prices or duplicated timestamps, including at the end", () => {
    const p = line();
    for (const value of [null, 0]) {
      const broken = [...p]; broken[10] = { ...broken[10]!, price_usd: value };
      expect(pricePatternReview(broken, at)).toMatchObject({ status: "insufficient", samples: 10 });
    }
    const duplicate = pricePatternReview([...p, { ...p[10]!, price_usd: 5 }], at);
    expect(duplicate).toMatchObject({ status: "insufficient", samples: 10 });
    expect(duplicate.gaps).toContain("duplicate_time_break");
    expect(pricePatternReview([...p, p.at(-1)!], at)).toMatchObject({ status: "insufficient", samples: 0 });
    expect(pricePatternReview([...p, { ...p.at(-1)!, price_usd: null }], at).metrics).toBeNull();
  });
  it("ignores future/old observations and never infers prices from market cap or FDV", () => {
    expect(pricePatternReview([point(1, 1441), point(2, -1)], at)).toMatchObject({ status: "insufficient", samples: 0 });
    expect(pricePatternReview(line().map(p => ({ ...p, price_usd: null, fdv_usd: 1e12 })), at).status).toBe("insufficient");
    expect(pricePatternReview([], at)).toMatchObject({ status: "insufficient", metrics: null, stale: true });
  });
  it("assesses the latest run and does not keep an obsolete earlier flag", () => {
    const volatile = Array.from({ length: 21 }, (_, i) => point(1 + (i % 2) * .2, 60 - i * 3));
    const oldLine = line().map(p => ({ ...p, fetched_at: new Date(Date.parse(p.fetched_at) - 7_200_000).toISOString() }));
    expect(pricePatternReview([...oldLine, ...volatile], at)).toMatchObject({ status: "not_flagged", samples: 21 });
  });
  it("treats market-cap moves as no extra evidence and does not mutate the saved observations", () => {
    const p = line(), saved = JSON.stringify(p), before = pricePatternReview(p, at);
    const changedCaps = p.map((v, i) => ({ ...v, market_cap_usd: i % 2 ? 1e12 : null, fdv_usd: 1 }));
    expect(pricePatternReview(changedCaps, at)).toEqual(before);
    expect(JSON.stringify(p)).toBe(saved);
  });
});
