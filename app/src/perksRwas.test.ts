import { describe, expect, it } from "vitest";
import {
  aggregateRwaExplorerRows,
  getIllustrativeStonkletMarketCap,
  getIllustrativeStonkletPerformance,
  getRwaMarketCapMovement,
  getStonkletMarketCapMovement,
  PERKS_DEFINITIONS,
  RWA_CHART_PERIODS,
  RWA_MARKET_CHARTS,
  RWA_YOU_REWARDS_DISPLAY,
} from "./perksMockData";
import {
  PERKS_SHARE_CONTENT,
  getPerksShareContentFromPath,
  getPerksShareImageUrl,
} from "./perksShareContent";

function parseIllustrativeNumber(value: string): number {
  const normalized = value.replace(/[$,]/g, "").trim();
  const multiplier = normalized.endsWith("M") ? 1_000_000 : normalized.endsWith("K") ? 1_000 : 1;
  return Number(normalized.replace(/[MK]$/, "")) * multiplier;
}

describe("RWAs perk", () => {
  it("uses the exact personalized rewards presentation", () => {
    expect(RWA_YOU_REWARDS_DISPLAY).toBe("$337");
  });

  it("defines the exact page and share identity", () => {
    const content = PERKS_SHARE_CONTENT.rwas;
    expect(content.eyebrow).toBe("Gen Z's Stonk Market");
    expect(content.summary).toBe("Major real-world assets, relaunched as meme stonks. Paper hands feed diamond hands... Compounding memetic aura!");
    expect(content.callout).toBe("Reset the market. Be early. Win.");
    expect(content.cta).toBe("Share 10X RWAs");
    expect(getPerksShareImageUrl(content)).toBe("https://warplets.10x.meme/9736.gif");
    expect(PERKS_DEFINITIONS.rwas.futureTokenId).toBe(9736);
    expect(getPerksShareContentFromPath("/perks/rwas")).toBe(content);
    expect(getPerksShareContentFromPath("/warplets/perks/rwas/")).toBe(content);
  });

  it("models five Stonklets across seven BSC and Robinhood markets", () => {
    const definition = PERKS_DEFINITIONS.rwas;
    const rows = definition.explorer.rows;
    expect(definition.explorer.description).toBe("Stonklets compete across multiple chains. Every market has its own volume, liquidity, rewards, and burns. Chain ↔ RWA ↔ Stonklet ↔ 10X reflexive market dynamics.");
    expect(definition.explorer.filters).toEqual(["All", "BSC", "Robinhood"]);
    expect(rows).toHaveLength(7);
    expect(rows.filter((row) => row.filter === "BSC")).toHaveLength(5);
    expect(rows.filter((row) => row.filter === "Robinhood")).toHaveLength(2);
    expect(new Set(rows.map((row) => row.stonklet?.id)).size).toBe(5);
    expect(rows.find((row) => row.stonklet?.id === "teslalet")?.stonklet?.rwaToken).toBe("$TSLAB");
    expect(rows.filter((row) => row.filter === "BSC").every((row) => row.stonklet?.rwaToken.endsWith("B"))).toBe(true);
    expect(rows.filter((row) => row.filter === "Robinhood").every((row) => row.stonklet?.rwaToken.endsWith("X"))).toBe(true);
    expect(Object.fromEntries(rows.map((row) => [row.stonklet!.id, row.stonklet!.tokenId]))).toEqual({
      teslalet: 3389,
      spacexlet: 5326,
      nvidialet: 5599,
      googlelet: 8687,
      hoodlet: 5547,
    });

    for (const id of ["spacexlet", "hoodlet"]) {
      const markets = rows.filter((row) => row.stonklet?.id === id);
      expect(markets).toHaveLength(2);
      expect(new Set(markets.map((row) => row.filter))).toEqual(new Set(["BSC", "Robinhood"]));
      expect(new Set(markets.map((row) => row.stonklet?.ticker)).size).toBe(1);
      expect(new Set(markets.map((row) => row.stonklet?.tokenId)).size).toBe(1);
    }
  });

  it("combines multi-chain Stonklets for each card's All view", () => {
    const definition = PERKS_DEFINITIONS.rwas;
    const groupedRows = Array.from(new Set(definition.explorer.rows.map((row) => row.stonklet?.id))).map((id) =>
      definition.explorer.rows.filter((row) => row.stonklet?.id === id),
    );
    expect(groupedRows).toHaveLength(5);

    const spacex = aggregateRwaExplorerRows(
      definition.explorer.rows.filter((row) => row.stonklet?.id === "spacexlet"),
      definition.explorer.columns,
    );
    expect(Object.fromEntries(definition.explorer.columns.map((column, index) => [column, spacex.cells[index]]))).toEqual({
      Chain: "2 chains",
      "Lifetime Volume": "$43.6M",
      "RWA Rewards": "$1.12M",
      "RWA LP": "$448K",
      "10X LP": "$448K",
      Burned: "$13.4K",
    });
    expect(spacex.progress).toBeUndefined();
    expect(definition.explorer.columns).not.toContain("Age");
    expect(definition.explorer.columns).not.toContain("Fitness");
    expect(definition.explorer.rows.every((row) => row.progress == null)).toBe(true);
  });

  it("compares approximate RWA performance with varied Stonklet outcomes", () => {
    const definition = PERKS_DEFINITIONS.rwas;
    expect(RWA_CHART_PERIODS).toEqual(["All", "7D", "30D", "90D", "1Y"]);
    expect(Object.keys(RWA_MARKET_CHARTS).sort()).toEqual(["googlelet", "hoodlet", "nvidialet", "spacexlet", "teslalet"]);

    const outcomes: number[] = [];
    for (const row of definition.explorer.rows) {
      const chart = RWA_MARKET_CHARTS[row.stonklet!.id];
      expect(chart).toBeDefined();
      for (const period of RWA_CHART_PERIODS) {
        const stonkletSeries = getIllustrativeStonkletPerformance(row, period);
        expect(stonkletSeries).toHaveLength(chart.performance[period].length);
        expect(stonkletSeries[0]).toBe(0);
        expect(stonkletSeries.every(Number.isFinite)).toBe(true);
        outcomes.push(stonkletSeries.at(-1)!);
      }
    }
    expect(outcomes.filter((outcome) => outcome > 0).length).toBeGreaterThan(25);
    expect(outcomes.filter((outcome) => outcome < 0).length).toBeGreaterThanOrEqual(6);

    const hoodletBsc = definition.explorer.rows.find((row) => row.stonklet?.id === "hoodlet" && row.filter === "BSC")!;
    for (const period of RWA_CHART_PERIODS) {
      const failedLaunch = getIllustrativeStonkletPerformance(hoodletBsc, period);
      expect(Math.max(...failedLaunch)).toBeGreaterThan(0);
      expect(failedLaunch.at(-1)).toBeLessThan(0);
      expect(failedLaunch.at(-1)).toBeLessThan(Math.max(...failedLaunch) * 0.1);
    }

    const tesla = definition.explorer.rows.find((row) => row.stonklet?.id === "teslalet")!;
    expect(getIllustrativeStonkletMarketCap(tesla)).toBe("$8.42M");
    const spacexMarkets = definition.explorer.rows.filter((row) => row.stonklet?.id === "spacexlet");
    expect(spacexMarkets.map((row) => row.filter)).toEqual(["BSC", "Robinhood"]);
    expect(spacexMarkets.map((row) => getIllustrativeStonkletPerformance(row, "All"))).toHaveLength(2);
  });

  it("keeps every displayed market cap movement consistent with its selected-period return", () => {
    const definition = PERKS_DEFINITIONS.rwas;
    for (const [stonkletId, chart] of Object.entries(RWA_MARKET_CHARTS)) {
      const markets = definition.explorer.rows.filter((row) => row.stonklet?.id === stonkletId);
      const rwaLabels = new Set<string>();
      const stonkletLabels = new Set<string>();

      for (const period of RWA_CHART_PERIODS) {
        const rwa = getRwaMarketCapMovement(chart, period);
        const stonklet = getStonkletMarketCapMovement(markets, period);
        expect(((rwa.current / rwa.opening) - 1) * 100).toBeCloseTo(rwa.change, 8);
        expect(((stonklet.current / stonklet.opening) - 1) * 100).toBeCloseTo(stonklet.change, 8);
        rwaLabels.add(rwa.label);
        stonkletLabels.add(stonklet.label);
      }
      expect(rwaLabels.size).toBe(RWA_CHART_PERIODS.length);
      expect(stonkletLabels.size).toBe(RWA_CHART_PERIODS.length);
    }

    const spacexMarkets = definition.explorer.rows.filter((row) => row.stonklet?.id === "spacexlet");
    const combined = getStonkletMarketCapMovement(spacexMarkets, "90D");
    expect(combined.current).toBe(4_360_000);
    expect(((combined.current / combined.opening) - 1) * 100).toBeCloseTo(combined.change, 8);
    expect(combined.change).not.toBe(Math.max(...spacexMarkets.map((row) => getIllustrativeStonkletPerformance(row, "90D").at(-1)!)));
  });

  it("keeps the market rows consistent with the global illustrative totals", () => {
    const definition = PERKS_DEFINITIONS.rwas;
    const rows = definition.explorer.rows;
    expect(definition.statsTitle).toBe("Stonk Stats");
    const columnTotal = (label: string) => {
      const index = definition.explorer.columns.indexOf(label);
      return rows.reduce((total, row) => total + parseIllustrativeNumber(row.cells[index]), 0);
    };
    expect(columnTotal("Lifetime Volume")).toBe(184_200_000);
    expect(columnTotal("RWA Rewards")).toBe(4_860_000);
    expect(columnTotal("RWA LP")).toBe(1_944_000);
    expect(columnTotal("10X LP")).toBe(1_944_000);
    expect(columnTotal("Burned")).toBe(58_320);
    expect(columnTotal("Burned")).toBe(columnTotal("10X LP") * 0.03);
    expect(columnTotal("Burned")).toBeLessThan(columnTotal("10X LP"));
    expect(definition.globalMetrics.map(({ label, value }) => [label, value])).toEqual([
      ["Stonklets", "5"],
      ["Stonk Markets", "7"],
      ["Lifetime Volume", "$184.2M"],
      ["RWA Rewards", "$4.86M"],
      ["Permanent Liquidity", "$3.88M"],
      ["Burned", "$58,320"],
    ]);
  });

  it("attributes rewards correctly and presents the consolidated future RWA explanation", () => {
    const definition = PERKS_DEFINITIONS.rwas;
    expect(definition.leaderboardMetric).toBe("RWA Rewards");
    expect(definition.explanation.map((item) => item.title)).toEqual([
      "Built for Risk. Grounded in Reality.",
      "Meme Stonks, not Stocks",
      "Tax: 3% in, 3% out",
      "1% Holders. 1% Liquidity. 1% Growth",
      "Your Turn to Be Early",
    ]);
    expect(definition.explanation[0]).toEqual({
      title: "Built for Risk. Grounded in Reality.",
      body: "Gen Z are entering markets after decades of compounding has already created enormous wealth for earlier generations. Stonklets are built for a new generation willing to take more risk in search of asymmetric upside ...while staying grounded in longer-term exposure to real-world value.",
    });
    expect(definition.explanation.find((item) => item.title === "Meme Stonks, not Stocks")?.body).toContain("It does not represent, track or redeem for the stock.");
    expect(definition.explanation.find((item) => item.title === "1% Holders. 1% Liquidity. 1% Growth")?.body).toContain("34% of tax revenue funds tokenized-asset RWA rewards for qualifying holders.");
    expect(definition.averageMetrics.map(({ label, value }) => [label, value])).toEqual([
      ["Early Entry", "4"],
      ["Holdings", "$1,000"],
      ["Rewards", "$200"],
      ["Yield", "20%"],
      ["Airdrop Boost", "6.4X"],
      ["Airdrop Value At ATH", "$584"],
    ]);
    expect(definition.averageMetrics.find((metric) => metric.label === "Rewards")?.detail).toContain("Warplet ownership alone does not earn RWA rewards");

    expect(definition.explanation.at(-1)?.callout).toBe("Reset the market. Be early. Win.");
  });
});
