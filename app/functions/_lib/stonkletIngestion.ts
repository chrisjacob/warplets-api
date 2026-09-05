import {
  STONKLETS_CATALOG,
  emptyMarketMetrics,
  type FlapDemoLifecycle,
  type FlapDemoToken,
  type MarketDataStatus,
  type MarketMetrics,
  type StonkletDemoMarketState,
} from "../../shared/stonkletsCatalog.js";
import {
  normalizePriceSeries,
  periodChangeFromChart,
  type ChartPoint,
  type StonkletChartResult,
} from "./stonkletMarket.js";
import {
  DEFAULT_STONKLET_CHANGE_RANGE,
  stonkletRangeCacheSeconds,
  type StonkletChangeRange,
} from "../../shared/stonkletsTime.js";
import { ingestCmcMarketIfDue, type CmcIngestResult, type StonkletCmcEnv } from "./stonkletCmc.js";
import { loadLocalStonkletHistory, mergeStonkletHistoryPoints, persistStonkletHistory } from "./stonkletHistory.js";

const FLAP_PORTAL = "0xe2cE6ab80874Fa9Fa2aAE65D277Dd6B8e65C9De0";
const GET_TOKEN_V8_SAFE_SELECTOR = "0x62fafcca";
const WBNB = "0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c";
const DEFAULT_BNB_RPC_URLS = [
  "https://bsc-dataseed.bnbchain.org",
  "https://bsc-dataseed1.bnbchain.org",
] as const;
const DEXPAPRIKA_BASE = "https://api.dexpaprika.com/networks/bsc";
const GECKOTERMINAL_BASE = "https://api.geckoterminal.com/api/v2/networks/bsc";
const FRESH_MS = 5 * 60_000;
const STALE_MS = 60 * 60_000;
const KV_KEY = "stonklets:demo-market:v1";
const PROVIDER_HEADERS = { accept: "application/json", "user-agent": "10X-Stonklets/1.0 (+https://stonklet.10x.meme)" };

export interface StonkletMarketIngestEnv extends StonkletCmcEnv {
  WARPLETS: D1Database;
  WARPLETS_KV?: KVNamespace;
  BNB_RPC_URL?: string;
  STONKLETS_MARKET_INGEST_ENABLED?: string;
  STONKLETS_MARKET_INGEST_INTERVAL_MINUTES?: string;
}

export interface FlapTokenState {
  status: number;
  reserve: bigint;
  circulatingSupply: bigint;
  price: bigint;
  quoteTokenAddress: string;
  poolAddress: string;
  progress: number;
}

export interface StonkletDemoSnapshot {
  pairId: string;
  contractAddress: string;
  metrics: MarketMetrics;
  state: StonkletDemoMarketState;
  chart: ChartPoint[];
}

interface SnapshotRow {
  pair_id: string;
  contract_address: string;
  metrics_json: string;
  state_json: string;
  chart_json: string;
  updated_at: string;
}

interface CachedSnapshots {
  storedAt: number;
  snapshots: StonkletDemoSnapshot[];
}

interface CachedRangeChart {
  storedAt: number;
  value: StonkletChartResult;
}

function finiteNumber(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(parsed) ? parsed : null;
}

function safeJson<T>(value: string): T | null {
  try { return JSON.parse(value) as T; } catch { return null; }
}

function addressWord(word: string): string {
  return `0x${word.slice(-40)}`.toLowerCase();
}

function uintWord(word: string): bigint {
  return BigInt(`0x${word}`);
}

export function decodeFlapTokenState(data: string): FlapTokenState | null {
  const hex = data.startsWith("0x") ? data.slice(2) : data;
  if (!/^[0-9a-f]+$/i.test(hex) || hex.length < 18 * 64) return null;
  const words = Array.from({ length: 18 }, (_, index) => hex.slice(index * 64, (index + 1) * 64));
  try {
    return {
      status: Number(uintWord(words[0]!)),
      reserve: uintWord(words[1]!),
      circulatingSupply: uintWord(words[2]!),
      price: uintWord(words[3]!),
      quoteTokenAddress: addressWord(words[9]!),
      poolAddress: addressWord(words[14]!),
      progress: Math.max(0, Math.min(100, Number(uintWord(words[15]!)) / 1e16)),
    };
  } catch {
    return null;
  }
}

function encodeGetTokenCall(address: string): string {
  const normalized = address.toLowerCase().replace(/^0x/, "");
  if (!/^[0-9a-f]{40}$/.test(normalized)) throw new Error("Invalid demo token address");
  return `${GET_TOKEN_V8_SAFE_SELECTOR}${normalized.padStart(64, "0")}`;
}

function lifecycleForStatus(status: number): FlapDemoLifecycle | null {
  if (status === 4) return "migrated";
  if (status === 1) return "bonding";
  return null;
}

async function fetchJson(url: string, init?: RequestInit, cacheTtl = 300): Promise<unknown> {
  const response = await fetch(url, {
    ...init,
    headers: { ...PROVIDER_HEADERS, ...(init?.headers ?? {}) },
    signal: AbortSignal.timeout(8_000),
    cf: { cacheEverything: true, cacheTtl },
  } as RequestInit);
  if (!response.ok) throw new Error(`Upstream returned ${response.status}`);
  return response.json();
}

export async function fetchFlapStates(tokens: readonly FlapDemoToken[], env: StonkletMarketIngestEnv): Promise<Map<string, FlapTokenState>> {
  tokens = [...new Map(tokens.map((token) => [token.contractAddress.toLowerCase(), token])).values()];
  const configured = env.BNB_RPC_URL?.trim();
  const rpcUrls = [configured, ...DEFAULT_BNB_RPC_URLS].filter((value): value is string => Boolean(value && /^https:\/\//i.test(value)));
  const body = tokens.map((token, index) => ({
    jsonrpc: "2.0",
    id: index + 1,
    method: "eth_call",
    params: [{ to: FLAP_PORTAL, data: encodeGetTokenCall(token.contractAddress) }, "latest"],
  }));
  let lastError = "unreachable";
  for (const url of rpcUrls) {
    try {
      const payload = await fetchJson(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      if (!Array.isArray(payload)) throw new Error("Malformed BNB RPC batch response");
      const byId = new Map(payload.flatMap((item) => item && typeof item === "object"
        ? [[Number((item as { id?: unknown }).id), item as { result?: unknown; error?: { message?: unknown } }] as const]
        : []));
      const states = new Map<string, FlapTokenState>();
      tokens.forEach((token, index) => {
        const result = byId.get(index + 1)?.result;
        const decoded = typeof result === "string" ? decodeFlapTokenState(result) : null;
        if (decoded) states.set(token.contractAddress.toLowerCase(), decoded);
      });
      if (states.size !== tokens.length) throw new Error("Incomplete BNB RPC batch response");
      return states;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
  }
  throw new Error(`Flap state RPC ${lastError}`);
}

export function normalizeDexPaprikaToken(payload: unknown, updatedAt: string, status: "live" | "stale" = "live"): MarketMetrics {
  const root = payload && typeof payload === "object" ? payload as Record<string, unknown> : {};
  const summary = root.summary && typeof root.summary === "object" ? root.summary as Record<string, unknown> : {};
  const period = (key: string) => summary[key] && typeof summary[key] === "object" ? summary[key] as Record<string, unknown> : {};
  return {
    ...emptyMarketMetrics(),
    price: finiteNumber(summary.price_usd),
    marketCap: finiteNumber(summary.fdv),
    volume24h: finiteNumber(period("24h").volume_usd),
    liquidity: finiteNumber(summary.liquidity_usd),
    change5m: finiteNumber(period("5m").last_price_usd_change),
    change1h: finiteNumber(period("1h").last_price_usd_change),
    change24h: finiteNumber(period("24h").last_price_usd_change),
    updatedAt: typeof root.last_updated === "string" ? root.last_updated : updatedAt,
    status,
  };
}

export function normalizeGeckoTerminalChart(payload: unknown): ChartPoint[] {
  const list = payload && typeof payload === "object"
    ? (((payload as { data?: { attributes?: { ohlcv_list?: unknown } } }).data?.attributes?.ohlcv_list) ?? null)
    : null;
  if (!Array.isArray(list)) return [];
  const prices = list.flatMap((row) => {
    if (!Array.isArray(row)) return [];
    const time = finiteNumber(row[0]);
    const price = finiteNumber(row[4]);
    return time != null && price != null && price > 0 ? [{ time: Math.floor(time), price }] : [];
  }).sort((a, b) => a.time - b.time);
  const baseline = prices[0]?.price;
  if (!baseline || prices.length < 2) return [];
  return prices.map((point) => ({ ...point, value: ((point.price / baseline) - 1) * 100 }));
}

function changeFromChart(points: ChartPoint[], hours: number): number | null {
  if (points.length < 2) return null;
  const current = points.at(-1)!;
  const cutoff = current.time - hours * 3600;
  const baseline = points.find((point) => point.time >= cutoff) ?? points[0];
  return baseline?.price ? ((current.price / baseline.price) - 1) * 100 : null;
}

async function dexPaprikaToken(address: string): Promise<unknown> {
  return fetchJson(`${DEXPAPRIKA_BASE}/tokens/${encodeURIComponent(address.toLowerCase())}`);
}

export function geckoRangeConfig(range: StonkletChangeRange): { timeframe: "minute" | "hour" | "day"; aggregate: number; limit: number } {
  if (range === "1h") return { timeframe: "minute", aggregate: 1, limit: 61 };
  if (range === "24h") return { timeframe: "minute", aggregate: 5, limit: 289 };
  if (range === "7d") return { timeframe: "hour", aggregate: 1, limit: 169 };
  if (range === "30d") return { timeframe: "hour", aggregate: 4, limit: 181 };
  if (range === "60d") return { timeframe: "hour", aggregate: 4, limit: 361 };
  if (range === "90d") return { timeframe: "hour", aggregate: 12, limit: 181 };
  return { timeframe: "day", aggregate: 1, limit: 1000 };
}

async function geckoChart(token: FlapDemoToken, range: StonkletChangeRange = DEFAULT_STONKLET_CHANGE_RANGE): Promise<ChartPoint[]> {
  if (!token.poolAddress || !token.chartTokenSide) return [];
  const config = geckoRangeConfig(range);
  const payload = await fetchJson(
    `${GECKOTERMINAL_BASE}/pools/${encodeURIComponent(token.poolAddress.toLowerCase())}/ohlcv/${config.timeframe}?aggregate=${config.aggregate}&limit=${config.limit}&currency=usd&token=${token.chartTokenSide}`,
    { headers: { accept: "application/json;version=20230203" } },
    stonkletRangeCacheSeconds(range),
  );
  return normalizeGeckoTerminalChart(payload);
}

function staleSnapshots(snapshots: readonly StonkletDemoSnapshot[]): StonkletDemoSnapshot[] {
  return snapshots.map((snapshot) => ({
    ...snapshot,
    metrics: snapshot.metrics.status === "unavailable" ? snapshot.metrics : { ...snapshot.metrics, status: "stale" },
    state: snapshot.state.status === "unavailable" ? snapshot.state : { ...snapshot.state, status: "stale" },
  }));
}

function snapshotAge(snapshot: StonkletDemoSnapshot, now = Date.now()): number {
  const timestamp = Date.parse(snapshot.state.updatedAt ?? snapshot.metrics.updatedAt ?? "");
  return Number.isFinite(timestamp) ? now - timestamp : Number.POSITIVE_INFINITY;
}

function allFresh(snapshots: readonly StonkletDemoSnapshot[], now = Date.now()): boolean {
  const expected = STONKLETS_CATALOG.filter((entry) => entry.demoToken);
  return snapshots.length === expected.length
    && expected.every((entry) => snapshots.some((snapshot) => snapshot.pairId === entry.id && snapshot.contractAddress.toLowerCase() === entry.demoToken!.contractAddress.toLowerCase()))
    && snapshots.every((snapshot) => snapshotAge(snapshot, now) < FRESH_MS);
}

async function persistSnapshots(env: StonkletMarketIngestEnv, snapshots: readonly StonkletDemoSnapshot[]): Promise<void> {
  const storedAt = Date.now();
  await env.WARPLETS_KV?.put(KV_KEY, JSON.stringify({ storedAt, snapshots: [...snapshots] } satisfies CachedSnapshots), { expirationTtl: Math.ceil(STALE_MS / 1000) }).catch(() => undefined);
  await Promise.all(snapshots.map((snapshot) => env.WARPLETS.prepare(
    `INSERT INTO stonklet_market_snapshots
      (pair_id, contract_address, metrics_json, state_json, chart_json, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(pair_id) DO UPDATE SET
       contract_address = excluded.contract_address,
       metrics_json = excluded.metrics_json,
       state_json = excluded.state_json,
       chart_json = excluded.chart_json,
       updated_at = excluded.updated_at`,
  ).bind(
    snapshot.pairId,
    snapshot.contractAddress,
    JSON.stringify(snapshot.metrics),
    JSON.stringify(snapshot.state),
    JSON.stringify(snapshot.chart),
    snapshot.state.updatedAt ?? new Date(storedAt).toISOString(),
  ).run())).catch((error) => {
    console.warn("stonklets_snapshot_d1_write_error", { message: error instanceof Error ? error.message : String(error) });
  });
  await persistStonkletHistory(env.WARPLETS, snapshots.map((snapshot) => ({
    pairId: snapshot.pairId,
    price: snapshot.metrics.price,
    marketCap: snapshot.metrics.marketCap,
    updatedAt: snapshot.metrics.updatedAt ?? snapshot.state.updatedAt,
  }))).catch((error) => {
    console.warn(JSON.stringify({ message: "stonklets_history_d1_write_error", error: error instanceof Error ? error.message : String(error) }));
  });
}

export async function readStonkletDemoSnapshots(db: D1Database): Promise<StonkletDemoSnapshot[]> {
  const result = await db.prepare(
    "SELECT pair_id, contract_address, metrics_json, state_json, chart_json, updated_at FROM stonklet_market_snapshots ORDER BY pair_id",
  ).all<SnapshotRow>().catch(() => ({ results: [] }));
  return (result.results ?? []).flatMap((row) => {
    const metrics = safeJson<MarketMetrics>(row.metrics_json);
    const state = safeJson<StonkletDemoMarketState>(row.state_json);
    const chart = safeJson<ChartPoint[]>(row.chart_json);
    return metrics && state && Array.isArray(chart) ? [{
      pairId: row.pair_id,
      contractAddress: row.contract_address,
      metrics,
      state: { ...state, updatedAt: state.updatedAt ?? row.updated_at },
      chart,
    }] : [];
  });
}

async function readCachedSnapshots(env: StonkletMarketIngestEnv): Promise<StonkletDemoSnapshot[]> {
  const cached = await env.WARPLETS_KV?.get<CachedSnapshots>(KV_KEY, "json").catch(() => null) ?? null;
  if (cached && Array.isArray(cached.snapshots)) return cached.snapshots;
  return readStonkletDemoSnapshots(env.WARPLETS);
}

export async function refreshStonkletDemoMarket(env: StonkletMarketIngestEnv): Promise<StonkletDemoSnapshot[]> {
  const mapped = STONKLETS_CATALOG.flatMap((entry) => entry.demoToken ? [{ pairId: entry.id, token: entry.demoToken }] : []);
  const states = await fetchFlapStates(mapped.map(({ token }) => token), env);
  const now = new Date().toISOString();
  const migrated = mapped.filter(({ token }) => lifecycleForStatus(states.get(token.contractAddress.toLowerCase())!.status) === "migrated");
  const quoteAddresses = new Set(mapped.flatMap(({ token }) => {
    const state = states.get(token.contractAddress.toLowerCase())!;
    if (lifecycleForStatus(state.status) !== "bonding") return [];
    return [state.quoteTokenAddress === "0x0000000000000000000000000000000000000000" ? WBNB.toLowerCase() : state.quoteTokenAddress];
  }));
  const [tokenPayloads, quotePayloads, chartPayloads] = await Promise.all([
    Promise.all(migrated.map(async ({ token }) => [token.contractAddress.toLowerCase(), await dexPaprikaToken(token.contractAddress)] as const)),
    Promise.all([...quoteAddresses].map(async (address) => [address, await dexPaprikaToken(address)] as const)),
    Promise.all(migrated.map(async ({ token }) => [token.contractAddress.toLowerCase(), await geckoChart(token).catch(() => [])] as const)),
  ]);
  const tokenData = new Map(tokenPayloads);
  const quoteData = new Map(quotePayloads);
  const charts = new Map(chartPayloads);

  const snapshots = mapped.map(({ pairId, token }): StonkletDemoSnapshot => {
    const flap = states.get(token.contractAddress.toLowerCase())!;
    const lifecycle = lifecycleForStatus(flap.status) ?? token.expectedLifecycle;
    const chart = charts.get(token.contractAddress.toLowerCase()) ?? [];
    let metrics: MarketMetrics;
    let provider: StonkletDemoMarketState["provider"];
    if (lifecycle === "migrated" && tokenData.has(token.contractAddress.toLowerCase())) {
      metrics = normalizeDexPaprikaToken(tokenData.get(token.contractAddress.toLowerCase()), now);
      metrics.change4h = changeFromChart(chart, 4);
      provider = "flap+dexpaprika";
    } else {
      const quoteAddress = flap.quoteTokenAddress === "0x0000000000000000000000000000000000000000" ? WBNB.toLowerCase() : flap.quoteTokenAddress;
      const quoteMetrics = normalizeDexPaprikaToken(quoteData.get(quoteAddress), now);
      const quoteUsd = quoteMetrics.price;
      const priceInQuote = Number(flap.price) / 1e18;
      const reserveInQuote = Number(flap.reserve) / 1e18;
      const priceUsd = quoteUsd != null ? priceInQuote * quoteUsd : null;
      metrics = {
        ...emptyMarketMetrics(),
        price: priceUsd,
        marketCap: priceUsd == null ? null : priceUsd * 1_000_000_000,
        liquidity: quoteUsd == null ? null : reserveInQuote * quoteUsd,
        updatedAt: now,
        status: priceUsd == null ? "unavailable" : "live",
      };
      provider = "flap-onchain";
    }
    return {
      pairId,
      contractAddress: token.contractAddress.toLowerCase(),
      metrics,
      chart,
      state: {
        lifecycle,
        progress: flap.progress,
        poolAddress: flap.poolAddress === "0x0000000000000000000000000000000000000000" ? null : flap.poolAddress,
        quoteTokenAddress: flap.quoteTokenAddress,
        provider,
        updatedAt: now,
        status: metrics.status,
      },
    };
  });
  await persistSnapshots(env, snapshots);
  return snapshots;
}

export async function loadStonkletDemoMarket(env: StonkletMarketIngestEnv): Promise<StonkletDemoSnapshot[]> {
  const prior = await readCachedSnapshots(env);
  if (allFresh(prior)) return prior;
  try {
    return await refreshStonkletDemoMarket(env);
  } catch (error) {
    console.warn("stonklets_demo_market_upstream_error", { message: error instanceof Error ? error.message : String(error) });
    return prior.length && prior.every((snapshot) => snapshotAge(snapshot) <= STALE_MS) ? staleSnapshots(prior) : prior;
  }
}

function unavailableRangeChart(range: StonkletChangeRange): StonkletChartResult {
  return { range, basis: "price", provider: null, points: [], periodChange: null, coverageStart: null, coverageEnd: null, status: "unavailable", updatedAt: null };
}

export async function loadStonkletRangeChart(
  env: StonkletMarketIngestEnv,
  pairId: string,
  range: StonkletChangeRange = DEFAULT_STONKLET_CHANGE_RANGE,
  suppliedSnapshots?: readonly StonkletDemoSnapshot[],
): Promise<StonkletChartResult> {
  const entry = STONKLETS_CATALOG.find((candidate) => candidate.id === pairId);
  if (!entry?.demoToken) return unavailableRangeChart(range);
  const cacheSeconds = stonkletRangeCacheSeconds(range);
  const staleSeconds = Math.max(60 * 60, cacheSeconds * 4);
  const cacheKey = `stonklets:range-chart:v1:${pairId}:${range}`;
  const prior = await env.WARPLETS_KV?.get<CachedRangeChart>(cacheKey, "json").catch(() => null) ?? null;
  if (prior && Date.now() - prior.storedAt < cacheSeconds * 1000) return prior.value;
  try {
    const snapshots = marketSnapshotsByPair(suppliedSnapshots ?? await loadStonkletDemoMarket(env));
    const snapshot = snapshots.get(pairId);
    const local = await loadLocalStonkletHistory(env.WARPLETS, pairId, range);
    let provider: ChartPoint[] = [];
    let providerFailed = false;
    if (snapshot?.state.lifecycle === "migrated") {
      try {
        provider = await geckoChart(entry.demoToken, range);
        if (provider.length < 2) providerFailed = true;
      } catch (error) {
        providerFailed = true;
        console.warn(JSON.stringify({ message: "stonklets_gecko_chart_error", pair: pairId, range, error: error instanceof Error ? error.message : String(error) }));
      }
    }
    const current = snapshot?.metrics.price && snapshot.metrics.updatedAt ? [{ time: Math.floor(Date.parse(snapshot.metrics.updatedAt) / 1000), price: snapshot.metrics.price }] : [];
    const merged = mergeStonkletHistoryPoints(provider.map((point) => ({ time: point.time, price: point.price })), local, current);
    const points = normalizePriceSeries(merged);
    if (points.length < 2 && providerFailed && prior && Date.now() - prior.storedAt <= staleSeconds * 1000) {
      return { ...prior.value, status: prior.value.status === "unavailable" ? "unavailable" : "stale" };
    }
    const value: StonkletChartResult = points.length < 2 ? unavailableRangeChart(range) : {
      range,
      basis: "price",
      provider: snapshot?.state.lifecycle === "migrated" ? "geckoterminal+local" : "flap-local",
      points,
      periodChange: periodChangeFromChart(points),
      coverageStart: new Date(points[0]!.time * 1000).toISOString(),
      coverageEnd: new Date(points.at(-1)!.time * 1000).toISOString(),
      status: providerFailed || snapshot?.metrics.status === "stale" ? "stale" : "live",
      updatedAt: snapshot?.metrics.updatedAt ?? new Date().toISOString(),
    };
    await env.WARPLETS_KV?.put(cacheKey, JSON.stringify({ storedAt: Date.now(), value } satisfies CachedRangeChart), { expirationTtl: staleSeconds }).catch(() => undefined);
    return value;
  } catch (error) {
    console.warn(JSON.stringify({ message: "stonklets_range_chart_error", pair: pairId, range, error: error instanceof Error ? error.message : String(error) }));
    if (prior && Date.now() - prior.storedAt <= staleSeconds * 1000) return { ...prior.value, status: prior.value.status === "unavailable" ? "unavailable" : "stale" };
    return unavailableRangeChart(range);
  }
}

export async function loadStonkletPeriodChanges(
  env: StonkletMarketIngestEnv,
  range: StonkletChangeRange,
  suppliedSnapshots?: readonly StonkletDemoSnapshot[],
  pairIds?: readonly string[],
): Promise<Map<string, number | null>> {
  const snapshots = suppliedSnapshots ?? await loadStonkletDemoMarket(env);
  const rows = await Promise.all(STONKLETS_CATALOG.filter((entry) => !pairIds || pairIds.includes(entry.id)).map(async (entry) => [entry.id, entry.demoToken ? (await loadStonkletRangeChart(env, entry.id, range, snapshots)).periodChange : null] as const));
  return new Map(rows);
}

export async function ingestStonkletMarketIfDue(env: StonkletMarketIngestEnv): Promise<{ status: "disabled" | "fresh" | "ingested"; snapshots?: number; cmc: CmcIngestResult }> {
  const cmc = await ingestCmcMarketIfDue(env);
  if (!/^(1|true|yes)$/i.test(env.STONKLETS_MARKET_INGEST_ENABLED?.trim() ?? "")) return { status: "disabled", cmc };
  const interval = Math.max(1, Math.min(60, Number(env.STONKLETS_MARKET_INGEST_INTERVAL_MINUTES) || 5));
  const prior = await readCachedSnapshots(env);
  if (prior.length === 4 && prior.every((snapshot) => snapshotAge(snapshot) < interval * 60_000)) return { status: "fresh", cmc };
  const snapshots = await refreshStonkletDemoMarket(env);
  return { status: "ingested", snapshots: snapshots.length, cmc };
}

export function marketSnapshotsByPair(snapshots: readonly StonkletDemoSnapshot[]): Map<string, StonkletDemoSnapshot> {
  return new Map(snapshots.map((snapshot) => [snapshot.pairId, snapshot]));
}

export function marketStatusForSnapshots(snapshots: readonly StonkletDemoSnapshot[]): MarketDataStatus {
  if (snapshots.some((snapshot) => snapshot.state.status === "stale")) return "stale";
  if (snapshots.some((snapshot) => snapshot.state.status === "live")) return "live";
  return "unavailable";
}
