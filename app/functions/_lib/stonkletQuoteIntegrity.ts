import type { MarketMetrics } from "../../shared/stonkletsCatalog.js";
import type { StonkletChangeRange } from "../../shared/stonkletsTime.js";
import type { StonkletChartResult } from "./stonkletMarket.js";

// A refreshed cache is not evidence that the underlying quote is current.
export function freshQuote(metrics: MarketMetrics | undefined, now = Date.now()): metrics is MarketMetrics {
  const age = now - Date.parse(metrics?.updatedAt ?? "");
  return !!metrics && metrics.status === "live" && Number.isFinite(metrics.price) && metrics.price! > 0
    && Number.isFinite(age) && age >= -60_000 && age <= 30 * 60_000;
}

export function quotedChange(metrics: MarketMetrics | undefined, range: StonkletChangeRange): number | null {
  if (!freshQuote(metrics)) return null;
  const change = range === "24h" ? metrics.change24h : range === "1h" ? metrics.change1h : null;
  return change != null && Number.isFinite(change) && change >= -100 ? change : null;
}

export function stockChartAgreesWithQuote(chart: StonkletChartResult, quote: MarketMetrics | undefined): boolean {
  if (!freshQuote(quote) || chart.status !== "live" || chart.points.length < 2) return false;
  const last = chart.points.at(-1)!;
  const age = Date.now() - last.time * 1000;
  // Quiet pools can have no recent trades. Allow bounded historical coverage,
  // still corroborated by a fresh quote, and expose the actual ending time.
  const maxAge = chart.range === "24h" ? 6 * 3600_000 : 30 * 60_000;
  if (age < -60_000 || age > maxAge || Math.abs(last.price / quote.price! - 1) > 0.1) return false;
  const expected = quotedChange(quote, chart.range);
  if (chart.range === "24h" || chart.range === "1h") {
    const duration = chart.range === "24h" ? 86400 : 3600;
    if (last.time - chart.points[0]!.time < duration * 0.9) return false;
    if (expected == null || chart.periodChange == null || Math.abs(chart.periodChange - expected) > 5) return false;
  }
  return chart.points.every(point => Number.isFinite(point.price) && point.price > 0 && Number.isFinite(point.value));
}

export function notificationStockChange(primary: MarketMetrics | undefined, independent: MarketMetrics | undefined): number | null {
  const change = quotedChange(primary, "24h");
  if (change == null) return null;
  const corroboration = quotedChange(independent, "24h");
  // Large moves require another current source. Conflicting current sources fail closed.
  if (Math.abs(change) > 25 && corroboration == null) return null;
  if (corroboration != null && (Math.abs(change - corroboration) > 5 || Math.abs(primary!.price! / independent!.price! - 1) > 0.1)) return null;
  return change;
}
