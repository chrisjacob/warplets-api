import { describe, expect, it } from "vitest";
import { dailyTopBody, dailyTopDate, selectDailyTopTokens, type DailyTopToken } from "./stonkletsDailyTop";
const token = (symbol: string, change: number | null, asset: "stock" | "stonklet" = "stock", marketCap: number | null = 100): DailyTopToken => ({ id: symbol, symbol, change, asset, marketCap });
describe("daily Top 3", () => {
  it("mixes both markets and fills gains with the smallest losses", () => {
    const top = selectDailyTopTokens([token("A", -10), token("B", 5), token("C", -1, "stonklet"), token("D", -2)]);
    expect(top.map(t => t.symbol)).toEqual(["B", "C", "D"]);
    expect(dailyTopBody(top)).toBe("Daily Top 3: +5% $B. -1% $C. -2% $D.");
  });
  it("prefers Stonklets over stocks and lower known Stonklet market caps on ties", () => {
    const top = selectDailyTopTokens([token("STOCK", 4), token("BIG", 4, "stonklet", 1000), token("UNKNOWN", 4, "stonklet", null), token("SMALL", 4, "stonklet", 10)]);
    expect(top.map(t => t.symbol)).toEqual(["SMALL", "BIG", "UNKNOWN"]);
  });
  it("orders all losses correctly and omits unavailable data", () => {
    expect(selectDailyTopTokens([token("A", null), token("B", NaN), token("C", Infinity), token("D", -2), token("E", -1)]).map(t => t.symbol)).toEqual(["E", "D"]);
  });
  it("ranks unrounded gains and keeps small signed changes readable", () => {
    const top = selectDailyTopTokens([token("A", 0.001), token("B", -0.001), token("C", 0.002)]);
    expect(top.map(t => t.symbol)).toEqual(["C", "A", "B"]);
    expect(dailyTopBody(top)).toBe("Daily Top 3: +<0.01% $C. +<0.01% $A. -<0.01% $B.");
  });
  it.each([
    ["2026-09-08T19:59:00Z", null], ["2026-09-08T20:00:00Z", "2026-09-08"],
    ["2026-11-02T20:59:00Z", null], ["2026-11-02T21:00:00Z", "2026-11-02"],
    ["2026-09-07T22:00:00Z", null], ["2026-09-06T22:00:00Z", null],
    ["2026-11-27T17:59:00Z", null], ["2026-11-27T18:00:00Z", "2026-11-27"],
    ["2026-12-24T18:00:00Z", "2026-12-24"], ["2026-12-25T22:00:00Z", null],
    ["2026-07-02T17:00:00Z", null], ["2028-07-03T17:00:00Z", "2028-07-03"],
  ])("uses the NYSE close including DST and holidays at %s", (date, expected) => {
    expect(dailyTopDate(new Date(date))).toBe(expected);
  });
});
