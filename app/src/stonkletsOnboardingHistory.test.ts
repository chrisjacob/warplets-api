import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { MARSCOIN_CONTRACT, SPCXB_CONTRACT, MARSCOIN_POOL, MARSCOIN_MILESTONES, historicalReturn, formatHistoricalReturn } from "./stonkletsOnboardingHistory";

const sources = JSON.parse(readFileSync(new URL("../../docs/stonklets-onboarding-history-source.json", import.meta.url), "utf8")) as Array<{
  milestone: string; asset: "mars" | "spcxb"; url: string;
  response: { meta: { base: { address: string } }; data: { attributes: { ohlcv_list: number[][] } } };
}>;
describe("frozen MarsCoin comparison provenance", () => {
  it("uses six matching hourly USD closes from the correct contracts and pool", () => {
    expect(sources).toHaveLength(6);
    for (const milestone of MARSCOIN_MILESTONES) {
      for (const asset of ["mars", "spcxb"] as const) {
        const source = sources.find((row) => row.milestone === milestone.id && row.asset === asset)!;
        const url = new URL(source.url);
        const contract = asset === "mars" ? MARSCOIN_CONTRACT : SPCXB_CONTRACT;
        expect(url.pathname).toContain(`${MARSCOIN_POOL}/ohlcv/hour`);
        expect(url.searchParams.get("currency")).toBe("usd");
        expect(url.searchParams.get("token")).toBe(contract);
        expect(source.response.meta.base.address).toBe(contract);
        const [candle, preceding] = source.response.data.attributes.ohlcv_list;
        expect(candle![0]).toBe(milestone.candleStart);
        expect(candle![4]).toBe(milestone[asset]);
        expect(candle![1]).toBe(preceding![4]);
        expect(Number(url.searchParams.get("before_timestamp"))).toBe(milestone.candleStart + 3599);
      }
    }
    expect(MARSCOIN_MILESTONES[2].candleStart - MARSCOIN_MILESTONES[1].candleStart).toBe(86400);
  });
  it("matches independently calculated decimal returns, rounded only for display", () => {
    const [baseline, listing, endpoint] = MARSCOIN_MILESTONES;
    expect(historicalReturn(listing.mars, baseline.mars)).toBeCloseTo(34552.6501981097, 8);
    expect(historicalReturn(listing.spcxb, baseline.spcxb)).toBeCloseTo(34.3219654568, 8);
    expect(historicalReturn(endpoint.mars, baseline.mars)).toBeCloseTo(48441.3731746196, 8);
    expect(historicalReturn(endpoint.spcxb, baseline.spcxb)).toBeCloseTo(35.7178978122, 8);
    expect(formatHistoricalReturn(historicalReturn(endpoint.mars, baseline.mars))).toBe("+48,441%");
    expect(formatHistoricalReturn(historicalReturn(endpoint.spcxb, baseline.spcxb))).toBe("+36%");
  });
});
