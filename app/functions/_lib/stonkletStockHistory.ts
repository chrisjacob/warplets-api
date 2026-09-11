import { STONKLETS_BY_ID, type MarketMetrics } from "../../shared/stonkletsCatalog.js";
import { stonkletChangeRangeSeconds, type StonkletChangeRange } from "../../shared/stonkletsTime.js";
import { historyGranularity, mergeStonkletHistoryPoints } from "./stonkletHistory.js";
import { freshQuote } from "./stonkletQuoteIntegrity.js";
import { normalizePriceSeries, periodChangeFromChart, type StonkletChartResult } from "./stonkletMarket.js";

export const stockHistoryKey = (id: string, contract: string) => `stock:${id}:${contract.toLowerCase()}`;

export async function loadStockQuoteHistory(db: D1Database, id: string, range: StonkletChangeRange, quote: MarketMetrics | undefined): Promise<StonkletChartResult | null> {
  const contract = STONKLETS_BY_ID.get(id)?.stock.contractAddress;
  if (!contract || !freshQuote(quote)) return null;
  const duration = stonkletChangeRangeSeconds(range);
  const cutoff = new Date(duration == null ? 0 : Date.now() - duration * 1000).toISOString();
  const rows = await db.prepare("SELECT source_updated_at, price FROM stonklet_market_history WHERE pair_id = ? AND granularity = ? AND source_updated_at >= ? ORDER BY source_updated_at")
    .bind(stockHistoryKey(id, contract), historyGranularity(range), cutoff).all<{source_updated_at: string; price: number}>();
  const history = (rows.results ?? []).map(row => ({time: Date.parse(row.source_updated_at) / 1000, price: row.price}));
  const points = normalizePriceSeries(mergeStonkletHistoryPoints(history, [{time: Math.floor(Date.parse(quote.updatedAt!) / 1000), price: quote.price!}]));
  if (points.length < 2) return null;
  const partial = duration != null && points.at(-1)!.time - points[0]!.time < duration * 0.9;
  return {range, basis: "price", provider: "cmc-local", points,
    periodChange: partial ? null : periodChangeFromChart(points),
    coverageStart: new Date(points[0]!.time * 1000).toISOString(), coverageEnd: quote.updatedAt,
    partial, status: "live", updatedAt: quote.updatedAt};
}
