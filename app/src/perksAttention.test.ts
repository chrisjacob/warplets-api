import { describe, expect, it } from "vitest";
import { ATTENTION_CHART_PERIODS, PERKS_DEFINITIONS } from "./perksMockData";

describe("Attention perk", () => {
  it("provides chart and stats data for every requested period", () => {
    const explorer = PERKS_DEFINITIONS.attention.explorer;

    expect(ATTENTION_CHART_PERIODS).toEqual(["All", "7D", "30D", "90D", "1Y"]);
    expect(explorer.filters).toEqual([...ATTENTION_CHART_PERIODS]);
    expect(explorer.rows.map((row) => row.filter)).toEqual([...ATTENTION_CHART_PERIODS]);
    expect(explorer.rows).toHaveLength(5);
    expect(explorer.rows.every((row) => row.cells.length === explorer.columns.length)).toBe(true);
    const impressionsIndex = explorer.columns.indexOf("Impressions");
    expect(Object.fromEntries(explorer.rows.map((row) => [row.filter, row.cells[impressionsIndex]]))).toEqual({
      All: "94.2M",
      "7D": "2.8M",
      "30D": "14.6M",
      "90D": "35.8M",
      "1Y": "76.4M",
    });
  });

  it("keeps the all-time explorer stats aligned with the headline totals", () => {
    const definition = PERKS_DEFINITIONS.attention;
    const allTime = definition.explorer.rows.find((row) => row.filter === "All");
    const metric = (label: string) => allTime?.cells[definition.explorer.columns.indexOf(label)];

    expect(metric("Impressions")).toBe("94.2M");
    expect(metric("Engagements")).toBe("6.8M");
    expect(metric("Posts")).toBe("24,800");
    expect(metric("Actions")).toBe("3.1M");
    expect(metric("Unlock")).toBe("78%");
  });
});
