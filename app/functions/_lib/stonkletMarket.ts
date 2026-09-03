import { STONKLETS_BY_ID, emptyMarketMetrics, type MarketMetrics, type StonkletCatalogEntry } from "../../shared/stonkletsCatalog.js";
import {
  DEFAULT_STONKLET_CHANGE_RANGE,
  stonkletChangeRangeSeconds,
  stonkletRangeCacheSeconds,
  type StonkletChangeRange,
} from "../../shared/stonkletsTime.js";

// Binance documents data-api.binance.vision as its public, market-data-only
// base URL. It avoids account endpoints and is reachable from Pages regions
// where the main exchange hostname is geo-restricted.
const BINANCE_BASES = [
  "https://data-api.binance.vision/api/v3",
  "https://api1.binance.com/api/v3",
  "https://api4.binance.com/api/v3",
  "https://www.binance.com/api/v3",
] as const;
const FRESH_MS = 60_000;
const STALE_MS = 15 * 60_000;

export interface ChartPoint { time: number; value: number; price: number }
export interface StonkletChartResult {
  range: StonkletChangeRange;
  basis: "price";
  provider: "binance" | "geckoterminal+local" | "flap-local" | null;
  points: ChartPoint[];
  periodChange: number | null;
  coverageStart: string | null;
  coverageEnd: string | null;
  status: "live" | "stale" | "unavailable";
  updatedAt: string | null;
}

interface PricePoint { time: number; price: number }

export interface BinanceRangeConfig { interval: string; limit: number }

export function binanceRangeConfig(range: StonkletChangeRange): BinanceRangeConfig {
  if (range === "1h") return { interval: "1m", limit: 61 };
  if (range === "24h") return { interval: "5m", limit: 289 };
  if (range === "7d") return { interval: "30m", limit: 337 };
  if (range === "30d") return { interval: "2h", limit: 361 };
  if (range === "60d") return { interval: "4h", limit: 361 };
  if (range === "90d") return { interval: "4h", limit: 541 };
  return { interval: "1d", limit: 1000 };
}

interface CachedValue<T> { storedAt: number; value: T }
const MARKET_HEADERS = { accept: "application/json", "user-agent": "10X-Stonklets/1.0 (+https://stonklet.10x.meme)" };

async function fetchBinanceJson(path: string): Promise<unknown> {
  let lastStatus = 0;
  for (const base of BINANCE_BASES) {
    const response = await fetch(`${base}${path}`, { headers: MARKET_HEADERS, cf: { cacheTtl: 30, cacheEverything: true } } as RequestInit).catch(() => null);
    if (!response) continue;
    lastStatus = response.status;
    const payload = await response.json().catch(() => null);
    if (response.ok) return payload;
  }
  throw new Error(`Binance market data ${lastStatus || "unreachable"}`);
}

function finiteNumber(value: unknown): number | null {
  const number = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(number) ? number : null;
}

function percentageChange(rows: unknown[][], periods: number): number | null {
  const current = finiteNumber(rows.at(-1)?.[4]);
  const baseline = finiteNumber(rows.at(-(periods + 1))?.[4] ?? rows[0]?.[1]);
  return current != null && baseline != null && baseline > 0 ? ((current / baseline) - 1) * 100 : null;
}

export function normalizeBinanceTicker(payload: unknown, updatedAt: string, status: "live" | "stale"): MarketMetrics {
  if (!payload || typeof payload !== "object") return emptyMarketMetrics();
  const wrapper = payload as { ticker?: Record<string, unknown>; shortKlines?: unknown[][] };
  const ticker = wrapper.ticker ?? payload as Record<string, unknown>;
  const rows = Array.isArray(wrapper.shortKlines) ? wrapper.shortKlines : [];
  return {
    ...emptyMarketMetrics(),
    price: finiteNumber(ticker.lastPrice),
    volume24h: finiteNumber(ticker.quoteVolume),
    change5m: percentageChange(rows, 1),
    change1h: percentageChange(rows, 12),
    change4h: percentageChange(rows, 48),
    change24h: finiteNumber(ticker.priceChangePercent),
    updatedAt,
    status,
  };
}

async function cached<T>(kv: KVNamespace | undefined, key: string): Promise<CachedValue<T> | null> {
  return kv?.get<CachedValue<T>>(key, "json").catch(() => null) ?? null;
}

async function store<T>(kv: KVNamespace | undefined, key: string, value: T, expirationTtl = Math.ceil(STALE_MS / 1000)): Promise<void> {
  await kv?.put(key, JSON.stringify({ storedAt: Date.now(), value }), { expirationTtl }).catch(() => undefined);
}

export function normalizePriceSeries(points: readonly PricePoint[], maxPoints = 500): ChartPoint[] {
  const sorted = [...points]
    .filter((point) => Number.isFinite(point.time) && Number.isFinite(point.price) && point.price > 0)
    .sort((a, b) => a.time - b.time)
    .filter((point, index, rows) => index === rows.length - 1 || point.time !== rows[index + 1]?.time);
  if (sorted.length < 2) return [];
  const sampled = sorted.length <= maxPoints ? sorted : Array.from({ length: maxPoints }, (_, index) => sorted[Math.round(index * (sorted.length - 1) / (maxPoints - 1))]!).filter((point, index, rows) => index === 0 || point.time !== rows[index - 1]?.time);
  const baseline = sampled[0]?.price;
  if (!baseline) return [];
  return sampled.map((point) => ({ ...point, value: ((point.price / baseline) - 1) * 100 }));
}

export function periodChangeFromChart(points: readonly ChartPoint[]): number | null {
  const first = points[0]?.price;
  const last = points.at(-1)?.price;
  return first && last ? ((last / first) - 1) * 100 : null;
}

function chartUnavailable(range: StonkletChangeRange): StonkletChartResult {
  return { range, basis: "price", provider: null, points: [], periodChange: null, coverageStart: null, coverageEnd: null, status: "unavailable", updatedAt: null };
}

function parseBinanceRows(rows: readonly unknown[][]): PricePoint[] {
  return rows.flatMap((row) => {
    const time = finiteNumber(row[0]);
    const price = finiteNumber(row[4]);
    return time != null && price != null && price > 0 ? [{ time: Math.floor(time / 1000), price }] : [];
  });
}

async function fetchBinanceChartRows(symbol: string, range: StonkletChangeRange): Promise<unknown[][]> {
  const config = binanceRangeConfig(range);
  const encodedSymbol = encodeURIComponent(`${symbol}USDT`);
  if (range !== "all") {
    const payload = await fetchBinanceJson(`/klines?symbol=${encodedSymbol}&interval=${config.interval}&limit=${config.limit}`);
    if (!Array.isArray(payload)) throw new Error("Malformed Binance candles");
    return payload as unknown[][];
  }
  const batches: unknown[][][] = [];
  let endTime: number | null = null;
  for (let page = 0; page < 10; page += 1) {
    const suffix = endTime == null ? "" : `&endTime=${endTime}`;
    const payload = await fetchBinanceJson(`/klines?symbol=${encodedSymbol}&interval=1d&limit=1000${suffix}`);
    if (!Array.isArray(payload)) throw new Error("Malformed Binance candles");
    const batch = payload as unknown[][];
    batches.unshift(batch);
    const firstTime = finiteNumber(batch[0]?.[0]);
    if (batch.length < 1000 || firstTime == null) break;
    endTime = firstTime - 1;
  }
  return batches.flat();
}

function responseBySymbol(payload: unknown): Map<string, Record<string, unknown>> {
  if (!Array.isArray(payload)) throw new Error("Malformed Binance batch response");
  return new Map(payload.flatMap((row) => row && typeof row === "object" && typeof (row as Record<string, unknown>).symbol === "string"
    ? [[(row as Record<string, unknown>).symbol as string, row as Record<string, unknown>] as const]
    : []));
}

export async function loadStockMetricsBatch(entries: readonly StonkletCatalogEntry[], kv?: KVNamespace): Promise<Map<string, MarketMetrics>> {
  const available = entries.filter((entry) => entry.pairingStatus === "available");
  const cacheKey = "stonklets:market-batch:v2";
  const prior = await cached<Record<string, MarketMetrics>>(kv, cacheKey);
  if (prior && Date.now() - prior.storedAt < FRESH_MS) return new Map(Object.entries(prior.value));
  const query = encodeURIComponent(JSON.stringify(available.map((entry) => `${entry.stock.symbol}USDT`)));
  try {
    const bodies = await Promise.all([
      fetchBinanceJson(`/ticker/24hr?symbols=${query}`),
      ...(["5m", "1h", "4h"] as const).map((windowSize) => fetchBinanceJson(`/ticker?symbols=${query}&windowSize=${windowSize}&type=FULL`)),
    ]);
    const day = responseBySymbol(bodies[0]);
    const five = responseBySymbol(bodies[1]);
    const hour = responseBySymbol(bodies[2]);
    const four = responseBySymbol(bodies[3]);
    const updatedAt = new Date().toISOString();
    const value: Record<string, MarketMetrics> = {};
    for (const entry of entries) {
      if (entry.pairingStatus !== "available") { value[entry.id] = emptyMarketMetrics(); continue; }
      const symbol = `${entry.stock.symbol}USDT`;
      const ticker = day.get(symbol);
      value[entry.id] = ticker ? {
        ...emptyMarketMetrics(),
        price: finiteNumber(ticker.lastPrice),
        volume24h: finiteNumber(ticker.quoteVolume),
        change5m: finiteNumber(five.get(symbol)?.priceChangePercent),
        change1h: finiteNumber(hour.get(symbol)?.priceChangePercent),
        change4h: finiteNumber(four.get(symbol)?.priceChangePercent),
        change24h: finiteNumber(ticker.priceChangePercent),
        updatedAt,
        status: "live",
      } : emptyMarketMetrics();
    }
    await store(kv, cacheKey, value);
    return new Map(Object.entries(value));
  } catch (error) {
    console.warn("stonklets_market_batch_upstream_error", { message: error instanceof Error ? error.message : String(error) });
    if (prior && Date.now() - prior.storedAt <= STALE_MS) return new Map(Object.entries(prior.value).map(([id, metric]) => [id, metric.status === "unavailable" ? metric : { ...metric, status: "stale" as const }]));
    return new Map(entries.map((entry) => [entry.id, emptyMarketMetrics()]));
  }
}

export async function loadStockMetrics(entry: StonkletCatalogEntry, kv?: KVNamespace): Promise<MarketMetrics> {
  if (entry.pairingStatus !== "available") return emptyMarketMetrics();
  const key = `stonklets:market:v1:${entry.stock.symbol}`;
  const prior = await cached<Record<string, unknown>>(kv, key);
  if (prior && Date.now() - prior.storedAt < FRESH_MS) {
    return normalizeBinanceTicker(prior.value, new Date(prior.storedAt).toISOString(), "live");
  }
  try {
    const symbol = encodeURIComponent(`${entry.stock.symbol}USDT`);
    const [tickerPayload, klinesPayload] = await Promise.all([
      fetchBinanceJson(`/ticker/24hr?symbol=${symbol}`),
      fetchBinanceJson(`/klines?symbol=${symbol}&interval=5m&limit=49`).catch(() => []),
    ]);
    const ticker = tickerPayload as Record<string, unknown>;
    if (finiteNumber(ticker.lastPrice) == null) throw new Error("Malformed Binance ticker");
    const payload = { ticker, shortKlines: Array.isArray(klinesPayload) ? klinesPayload as unknown[][] : [] };
    await store(kv, key, payload);
    return normalizeBinanceTicker(payload, new Date().toISOString(), "live");
  } catch (error) {
    console.warn("stonklets_market_upstream_error", { pair: entry.id, message: error instanceof Error ? error.message : String(error) });
    return prior && Date.now() - prior.storedAt <= STALE_MS
      ? normalizeBinanceTicker(prior.value, new Date(prior.storedAt).toISOString(), "stale")
      : emptyMarketMetrics();
  }
}

export async function loadChart(pairId: string, asset: "stock" | "stonklet", kv?: KVNamespace, range: StonkletChangeRange = DEFAULT_STONKLET_CHANGE_RANGE): Promise<StonkletChartResult> {
  const entry = STONKLETS_BY_ID.get(pairId);
  if (!entry || asset === "stonklet" || entry.pairingStatus !== "available") return chartUnavailable(range);
  const cacheSeconds = stonkletRangeCacheSeconds(range);
  const staleSeconds = Math.max(15 * 60, cacheSeconds * 4);
  const key = `stonklets:chart:v2:${entry.stock.symbol}:${range}`;
  const prior = await cached<unknown[][]>(kv, key);
  let rows = prior?.value ?? null;
  let status: "live" | "stale" = "live";
  let storedAt = prior?.storedAt ?? Date.now();
  if (!prior || Date.now() - prior.storedAt >= cacheSeconds * 1000) {
    try {
      const nextRows = await fetchBinanceChartRows(entry.stock.symbol, range);
      if (parseBinanceRows(nextRows).length < 2) throw new Error("Binance returned insufficient candles");
      rows = nextRows;
      storedAt = Date.now();
      await store(kv, key, rows, staleSeconds);
    } catch (error) {
      console.warn(JSON.stringify({ message: "stonklets_chart_upstream_error", pair: entry.id, range, error: error instanceof Error ? error.message : String(error) }));
      if (!prior || Date.now() - prior.storedAt > staleSeconds * 1000) return chartUnavailable(range);
      rows = prior.value;
      status = "stale";
    }
  }
  const cutoffSeconds = stonkletChangeRangeSeconds(range);
  const parsed = parseBinanceRows(rows ?? []);
  const latestTime = parsed.at(-1)?.time ?? null;
  const ranged = cutoffSeconds != null && latestTime != null ? parsed.filter((point) => point.time >= latestTime - cutoffSeconds) : parsed;
  const points = normalizePriceSeries(ranged);
  if (points.length < 2) return chartUnavailable(range);
  return {
    range,
    basis: "price",
    provider: "binance",
    points,
    periodChange: periodChangeFromChart(points),
    coverageStart: new Date(points[0]!.time * 1000).toISOString(),
    coverageEnd: new Date(points.at(-1)!.time * 1000).toISOString(),
    status,
    updatedAt: new Date(storedAt).toISOString(),
  };
}

export async function loadStockPeriodChanges(entries: readonly StonkletCatalogEntry[], range: StonkletChangeRange, kv?: KVNamespace): Promise<Map<string, number | null>> {
  const rows = await Promise.all(entries.map(async (entry) => [entry.id, entry.pairingStatus === "available" ? (await loadChart(entry.id, "stock", kv, range)).periodChange : null] as const));
  return new Map(rows);
}
