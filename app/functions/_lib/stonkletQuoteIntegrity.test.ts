import { describe, expect, it } from "vitest";
import { emptyMarketMetrics } from "../../shared/stonkletsCatalog";
import { freshQuote, notificationStockChange, quotedChange, stockChartAgreesWithQuote } from "./stonkletQuoteIntegrity";
import { loadStockPeriodChanges, type StonkletChartResult } from "./stonkletMarket";
import { STONKLETS_BY_ID } from "../../shared/stonkletsCatalog";

const quote = (price = 52.73, change24h = -0.86) => ({ ...emptyMarketMetrics(), price, change24h, status: "live" as const, updatedAt: new Date().toISOString() });
function chart(first = 53.1874, last = 52.73): StonkletChartResult {
  const now = Math.floor(Date.now() / 1000);
  return { range: "24h", provider: "geckoterminal+local", basis: "price", status: "live", updatedAt: new Date().toISOString(), coverageStart: null, coverageEnd: null,
    periodChange: (last / first - 1) * 100, points: [{ time: now - 86400, price: first, value: 0 }, { time: now, price: last, value: (last / first - 1) * 100 }] };
}
describe("stock quote integrity", () => {
  it("rejects the observed PYPLB $49.49 to $201.32 spike", () => {
    expect(stockChartAgreesWithQuote(chart(49.4936, 201.3208), quote())).toBe(false);
    expect(stockChartAgreesWithQuote(chart(), quote())).toBe(true);
  });
  it("rejects bad baselines even when the last price agrees", () => {
    expect(stockChartAgreesWithQuote(chart(13, 52.73), quote())).toBe(false);
  });
  it("rejects old, future and incomplete chart windows", () => {
    for (const offset of [-25200, 600]) {
      const data = chart(); data.points.forEach(p => p.time += offset);
      expect(stockChartAgreesWithQuote(data, quote())).toBe(false);
    }
    const data = chart(); data.points[0]!.time += 80000;
    expect(stockChartAgreesWithQuote(data, quote())).toBe(false);
  });
  it("accepts a quiet pool's historical trades only while corroborated by a fresh quote", () => {
    const data = chart(); data.points.forEach(p => p.time -= 7200);
    expect(stockChartAgreesWithQuote(data, quote())).toBe(true);
    expect(stockChartAgreesWithQuote(data, quote(201, 306))).toBe(false);
  });
  it("does not trust a live label on an old quote", () => {
    const old = { ...quote(), updatedAt: new Date(Date.now() - 86400000).toISOString() };
    expect(freshQuote(old)).toBe(false);
    expect(quotedChange(old, "24h")).toBeNull();
    expect(notificationStockChange(old, quote())).toBeNull();
  });
  it("requires corroboration for large moves and rejects disagreements", () => {
    expect(notificationStockChange(quote(), undefined)).toBe(-0.86);
    expect(notificationStockChange(quote(201, 306), quote())).toBeNull();
    expect(notificationStockChange(quote(201, 306), undefined)).toBeNull();
    expect(notificationStockChange(quote(201, 306), quote(202, 305))).toBe(306);
    expect(notificationStockChange(quote(), quote(100, -0.86))).toBeNull();
  });
  it("uses the rolling quote for board returns without fetching pool candles", async () => {
    const entry = STONKLETS_BY_ID.get("paypal")!;
    expect((await loadStockPeriodChanges([entry], "24h", undefined, new Map([[entry.id, quote()]]))).get(entry.id)).toBe(-0.86);
    expect((await loadStockPeriodChanges([entry], "24h")).get(entry.id)).toBeNull();
  });
});
