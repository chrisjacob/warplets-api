import { describe, expect, it } from "vitest";
import { ARROW_SCENARIO, HOOD_SCENARIO, STONKLETS_ONBOARDING_KEY, completeOnboarding, firstStonkletsDialog, onboardingComplete, scenarioValue, marketAgeDays } from "./stonkletsOnboardingState";

describe("Stonklets onboarding lifecycle", () => {
  it("remembers only Stonklets completion and tolerates unavailable storage", () => {
    const values = new Map([["warplets-search-onboarding-v1-complete", "1"]]);
    const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } };
    expect(onboardingComplete(storage)).toBe(false);
    completeOnboarding(storage);
    expect(onboardingComplete(storage)).toBe(true);
    expect(values.get(STONKLETS_ONBOARDING_KEY)).toBe("1");
    expect(onboardingComplete({ getItem: () => { throw new Error("blocked"); } })).toBe(false);
    expect(() => completeOnboarding({ setItem: () => { throw new Error("blocked"); } })).not.toThrow();
    expect(onboardingComplete(null)).toBe(false);
    expect(() => completeOnboarding(null)).not.toThrow();
  });
  it("queues notifications after onboarding and notice, then exposes the destination", () => {
    expect(firstStonkletsDialog(true, true, false)).toBe("onboarding");
    expect(firstStonkletsDialog(true, true, true)).toBe("onboarding");
    expect(firstStonkletsDialog(false, true, true)).toBe("notice");
    expect(firstStonkletsDialog(false, false, true)).toBe("notifications");
    expect(firstStonkletsDialog(false, false, false)).toBeNull();
    expect(firstStonkletsDialog(true, false, true)).toBe("onboarding");
  });
});
describe("illustrative return animation", () => {
  it("starts together and ends at 100% and 1,000%, clamping animation time", () => {
    for (const series of [HOOD_SCENARIO, ARROW_SCENARIO]) {
      expect(scenarioValue(series, 0)).toBe(0);
      expect(scenarioValue(series, -1)).toBe(0);
      expect(scenarioValue(series, 2)).toBe(series.at(-1));
    }
    expect(scenarioValue(HOOD_SCENARIO, 1)).toBe(100);
    expect(scenarioValue(ARROW_SCENARIO, 1)).toBe(1000);
    expect(scenarioValue([0, 100], .5)).toBe(50);
  });
  it("includes negative Arrow returns and much larger reversals", () => {
    const largestDrop = (series: number[]) => Math.max(...series.slice(1).map((value, index) => series[index]! - value));
    expect(Math.min(...ARROW_SCENARIO)).toBeLessThan(0);
    expect(largestDrop(ARROW_SCENARIO)).toBeGreaterThan(300);
    expect(largestDrop(HOOD_SCENARIO)).toBeLessThan(10);
  });
});

describe("market calendar ages", () => {
  it("calculates both launch ages without counting a partial day", () => {
    const today = new Date(2026, 8, 23, 23, 59);
    expect(marketAgeDays("1792-05-17", today)).toBe(85595);
    expect(marketAgeDays("2026-09-06", today)).toBe(17);
    expect(marketAgeDays("2026-09-06", new Date(2026, 8, 6))).toBe(0);
    expect(marketAgeDays("2026-09-06", new Date(2026, 8, 5))).toBe(0);
  });
});
