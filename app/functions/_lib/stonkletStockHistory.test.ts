import { expect, it } from "vitest";
import { emptyMarketMetrics } from "../../shared/stonkletsCatalog";
import { loadStockQuoteHistory, stockHistoryKey } from "./stonkletStockHistory";

const now = new Date().toISOString();
const quote = {...emptyMarketMetrics(), price: 53, updatedAt: now, status: "live" as const};
const db = (rows: unknown[]) => ({prepare: () => ({bind: () => ({all: async () => ({results: rows})})})}) as unknown as D1Database;
it("renders only observed quotes and marks incomplete history without inventing a 24h return", async () => {
  const start = new Date(Math.floor((Date.now() - 600000) / 1000) * 1000).toISOString();
  const result = await loadStockQuoteHistory(db([{source_updated_at:start,price:52}]), "paypal", "24h", quote);
  expect(result).toMatchObject({provider:"cmc-local", partial:true, periodChange:null, coverageStart:start, coverageEnd:now});
  expect(result!.points.map(p=>p.price)).toEqual([52,53]);
});
it("does not turn a single observation into a fabricated line", async () => {
  expect(await loadStockQuoteHistory(db([{source_updated_at:now,price:53}]), "paypal", "24h", quote)).toBeNull();
});
it("does not render with stale quotes and separates token contract histories", async () => {
  expect(await loadStockQuoteHistory(db([]),"paypal","24h",{...quote,status:"stale"})).toBeNull();
  expect(stockHistoryKey("paypal","0xABC")).toBe("stock:paypal:0xabc");
});
