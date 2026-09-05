import { STONKLETS_CATALOG, emptyMarketMetrics, type FlapDemoToken, type MarketMetrics } from "../../shared/stonkletsCatalog.js";
import { STONKLET_TRADE_DESTINATIONS } from "../../shared/stonkletsTrading.js";
import { type StonkletChangeRange, stonkletRangeCacheSeconds } from "../../shared/stonkletsTime.js";
import { geckoRangeConfig, normalizeGeckoTerminalChart } from "./stonkletIngestion.js";
import { periodChangeFromChart, type StonkletChartResult } from "./stonkletMarket.js";

const FLAP = "https://bnb.taxed.fun"; // Public board endpoint used by flap.sh.
const GECKO = "https://api.geckoterminal.com/api/v2/networks/bsc";
const PREFIX = "stonklets:flap-preview:v2:";
const ADDRESS = /^0x[0-9a-f]{40}$/i;
export class FlapPreviewRateLimitError extends Error {}
interface BoardItem {
  coin: { address: string; name: string; symbol: string };
  listed: boolean;
  price: unknown; marketCap: unknown; volume24h: unknown; holders: unknown; liquidity: unknown;
  change5m: unknown; change1h: unknown; change4h: unknown; change24h: unknown;
}
interface Cached<T> { at: number; value: T }
function number(value: unknown): number | null {
  const parsed = typeof value === "number" || typeof value === "string" && value.trim() !== "" ? Number(value) : NaN;
  return Number.isFinite(parsed) ? parsed : null;
}
async function read<T>(kv: KVNamespace | undefined, key: string) {
  return await kv?.get<Cached<T>>(PREFIX + key, "json").catch(() => null) ?? null;
}
async function write<T>(kv: KVNamespace | undefined, key: string, value: T) {
  await kv?.put(PREFIX + key, JSON.stringify({ at: Date.now(), value }), { expirationTtl: 86400 }).catch(() => undefined);
}
async function fetchJson(url: string): Promise<any> {
  const response = await fetch(url, { signal: AbortSignal.timeout(12000), headers: url.startsWith(FLAP) ? {
    accept: "application/json", "user-agent": "Mozilla/5.0", origin: "https://flap.sh", referer: "https://flap.sh/",
  } : { accept: "application/json" } });
  if (response.status === 429) throw new FlapPreviewRateLimitError("Preview chart provider rate limited");
  if (!response.ok) throw new Error(`Preview source returned ${response.status}`);
  return response.json();
}

export async function loadFlapPreviewBoard(kv?: KVNamespace) {
  const prior = await read<BoardItem[]>(kv, "board");
  if (prior && Date.now() - prior.at < 60000) return { ...prior, stale: false };
  try {
    const items = new Map<string, BoardItem>();
    let cursor: string | undefined;
    for (let page = 0; page < 8 && items.size < STONKLETS_CATALOG.length; page++) {
      const params = new URLSearchParams(cursor ? { cursor } : { limit: "100" });
      const payload = await fetchJson(`${FLAP}/v3/board?${params}`);
      for (const item of Array.isArray(payload.items) ? payload.items : []) {
        if (ADDRESS.test(item?.coin?.address) && item.listed === true && (number(item.volume24h) ?? 0) > 0 && (number(item.price) ?? 0) > 0) {
          items.set(item.coin.address.toLowerCase(), item);
        }
      }
      if (!payload.nextCursor || payload.nextCursor === cursor) break;
      cursor = payload.nextCursor;
    }
    if (items.size < STONKLETS_CATALOG.length) throw new Error("Not enough distinct traded Flap launches available");
    // Retain assignments across refreshes when their sources are still trading.
    const retained = (prior?.value ?? []).map(item => items.get(item.coin.address.toLowerCase())).filter((item): item is BoardItem => Boolean(item));
    const assigned = new Set(retained.map(item => item.coin.address.toLowerCase()));
    const value = [...retained, ...[...items.values()].filter(item => !assigned.has(item.coin.address.toLowerCase()))].slice(0, STONKLETS_CATALOG.length);
    await write(kv, "board", value);
    return { at: Date.now(), value, stale: false };
  } catch (error) {
    if (prior && Date.now() - prior.at < 86400000) return { ...prior, stale: true };
    throw error;
  }
}

export function applyFlapPreview<T extends { id: string; demoToken?: FlapDemoToken | null; stonkletMetrics?: MarketMetrics; stonkletPeriodChange?: number | null }>(entries: readonly T[], board: Awaited<ReturnType<typeof loadFlapPreviewBoard>>, range: StonkletChangeRange) {
  if (new Set(board.value.map(item => item.coin.address.toLowerCase())).size < entries.length) throw new Error("Each Stonklet requires a unique preview source");
  const reserved = new Set(Object.values(STONKLET_TRADE_DESTINATIONS));
  const candidates = board.value.filter(item => !reserved.has(item.coin.address.toLowerCase()));
  let next = 0;
  return entries.map((entry) => {
    if (STONKLET_TRADE_DESTINATIONS[entry.id] && entry.demoToken) return {
      ...entry, launchStatus: "launched" as const, pairingStatus: "available" as const, demoToken: entry.demoToken,
      flapPreview: false, flapUrl: entry.demoToken.flapUrl,
      stonkletMetrics: entry.stonkletMetrics ?? emptyMarketMetrics(), stonkletPeriodChange: entry.stonkletPeriodChange ?? null,
    };
    const item = candidates[next++]!;
    const address = item.coin.address.toLowerCase() as `0x${string}`;
    const demoToken: FlapDemoToken = {
      name: item.coin.name, symbol: item.coin.symbol, contractAddress: address, expectedLifecycle: "migrated",
      poolAddress: null, chartTokenSide: null, quoteSymbol: "", flapUrl: `https://flap.sh/bnb/${address}`,
    };
    return { ...entry, launchStatus: "launched" as const, pairingStatus: "available" as const, demoToken,
      flapPreview: true, flapUrl: demoToken.flapUrl,
      stonkletMetrics: { ...emptyMarketMetrics(), price: number(item.price), marketCap: number(item.marketCap),
        volume24h: number(item.volume24h), holders: number(item.holders), liquidity: number(item.liquidity),
        change5m: number(item.change5m), change1h: number(item.change1h), change4h: number(item.change4h), change24h: number(item.change24h),
        updatedAt: new Date(board.at).toISOString(), status: board.stale ? "stale" as const : "live" as const },
      stonkletPeriodChange: range === "1h" ? number(item.change1h) : range === "24h" ? number(item.change24h) : null,
    };
  });
}

// Preview data is keyed by source contract, never by the official Stonklet ID.
// No preview prices are written into the normal ingestion/history tables.
export async function cachedFlapPreviewChange(kv: KVNamespace | undefined, source: string, range: StonkletChangeRange): Promise<number | null> {
  const cached = await read<StonkletChartResult>(kv, `chart:${source.toLowerCase()}:${range}`);
  return cached && Date.now() - cached.at < stonkletRangeCacheSeconds(range) * 1000 ? cached.value.periodChange : null;
}

async function loadPaprikaPreviewChart(kv: KVNamespace | undefined, source: string, range: StonkletChangeRange): Promise<StonkletChartResult> {
  const base = "https://api.dexpaprika.com";
  let pool = (await read<{ address: string; inverted: boolean }>(kv, `paprika-pool:${source}`))?.value;
  if (!pool) {
    const data = await fetchJson(`${base}/search?query=${source}`) as { pools?: { id: string; chain: string; volume_usd: number; tokens: { id: string }[] }[] };
    const candidates = (data.pools ?? []).filter(row => row.chain === "bsc" && row.tokens?.some(token => token.id.toLowerCase() === source));
    const match = candidates.sort((a, b) => b.volume_usd - a.volume_usd)[0];
    if (!match) throw new Error("No alternate preview pool available");
    pool = { address: match.id, inverted: match.tokens[0]?.id.toLowerCase() !== source };
    await write(kv, `paprika-pool:${source}`, pool);
  }
  const configs: Record<StonkletChangeRange, { interval: string; seconds: number; days: number }> = {
    "1h": { interval: "1m", seconds: 60, days: 1 / 24 }, "24h": { interval: "5m", seconds: 300, days: 1 },
    "7d": { interval: "1h", seconds: 3600, days: 7 }, "30d": { interval: "6h", seconds: 21600, days: 30 },
    "60d": { interval: "6h", seconds: 21600, days: 60 }, "90d": { interval: "12h", seconds: 43200, days: 90 },
    all: { interval: "24h", seconds: 86400, days: 365 },
  };
  const config = configs[range];
  const end = Math.floor(Date.now() / 1000 / config.seconds) * config.seconds;
  const params = new URLSearchParams({ start: String(end - config.days * 86400), end: String(end), interval: config.interval, limit: "366", inversed: String(pool.inverted) });
  const data = await fetchJson(`${base}/networks/bsc/pools/${encodeURIComponent(pool.address)}/ohlcv?${params}`) as { time_open: string; close: number }[];
  const prices = (Array.isArray(data) ? data : []).map(row => ({ time: Date.parse(row.time_open) / 1000, price: Number(row.close) })).filter(point => Number.isFinite(point.time) && Number.isFinite(point.price) && point.price > 0).sort((a, b) => a.time - b.time);
  if (prices.length < 2) throw new Error("Alternate preview chart has insufficient history");
  const points = prices.map(point => ({ ...point, value: (point.price / prices[0]!.price - 1) * 100 }));
  return { sourceToken: source, range, basis: "price", provider: "dexpaprika+local", points, periodChange: periodChangeFromChart(points), coverageStart: new Date(points[0]!.time * 1000).toISOString(), coverageEnd: new Date(points.at(-1)!.time * 1000).toISOString(), status: "live", updatedAt: new Date().toISOString() };
}

export async function loadFlapPreviewChart(kv: KVNamespace | undefined, source: string, range: StonkletChangeRange): Promise<StonkletChartResult> {
  const empty: StonkletChartResult = { range, basis: "price", provider: null, points: [], periodChange: null, coverageStart: null, coverageEnd: null, status: "unavailable", updatedAt: null };
  if (!ADDRESS.test(source)) return empty;
  source = source.toLowerCase();
  const key = `chart:${source}:${range}`;
  const cachedPrior = await read<StonkletChartResult>(kv, key);
  const prior = cachedPrior?.value.provider === "dexpaprika+local" && cachedPrior.value.sourceToken !== source ? null : cachedPrior;
  if (prior && Date.now() - prior.at < stonkletRangeCacheSeconds(range) * 1000) return prior.value;
  try {
    let pool = (await read<{ address: string; side: string }>(kv, `pool:${source}`))?.value;
    if (!pool) {
      const payload = await fetchJson(`${GECKO}/tokens/${source}/pools?page=1`);
      const match = payload.data?.find((row: any) => ADDRESS.test(row.attributes?.address) &&
        [row.relationships?.base_token?.data?.id, row.relationships?.quote_token?.data?.id].includes(`bsc_${source}`));
      if (!match) throw new Error("No GeckoTerminal pool available");
      pool = { address: match.attributes.address, side: match.relationships.base_token.data.id === `bsc_${source}` ? "base" : "quote" };
      await write(kv, `pool:${source}`, pool);
    }
    const config = geckoRangeConfig(range);
    const payload = await fetchJson(`${GECKO}/pools/${pool.address}/ohlcv/${config.timeframe}?aggregate=${config.aggregate}&limit=${config.limit}&currency=usd&token=${pool.side}`);
    const points = normalizeGeckoTerminalChart(payload);
    if (points.length < 2) throw new Error("Preview chart has insufficient history");
    const value: StonkletChartResult = { range, basis: "price", provider: "geckoterminal+local", points,
      periodChange: periodChangeFromChart(points), coverageStart: new Date(points[0]!.time * 1000).toISOString(),
      coverageEnd: new Date(points.at(-1)!.time * 1000).toISOString(), status: "live", updatedAt: new Date().toISOString() };
    await write(kv, key, value);
    return value;
  } catch (error) {
    if (prior && Date.now() - prior.at < 86400000) return { ...prior.value, status: "stale" };
    try {
      const value = await loadPaprikaPreviewChart(kv, source, range);
      await write(kv, key, value);
      return value;
    } catch (fallbackError) {
      if (error instanceof FlapPreviewRateLimitError || fallbackError instanceof FlapPreviewRateLimitError) throw new FlapPreviewRateLimitError("Preview chart providers are busy");
      console.warn("Flap preview chart unavailable", source, range, fallbackError instanceof Error ? fallbackError.message : String(fallbackError));
      return empty;
    }
  }
}
