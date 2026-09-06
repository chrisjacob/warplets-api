import {
  STONKLETS_CATALOG,
  emptyMarketMetrics,
  type MarketMetrics,
  type StonkletCatalogEntry,
} from "../../shared/stonkletsCatalog.js";

const CMC_BASE = "https://pro-api.coinmarketcap.com";
const KV_KEY = "stonklets:cmc-market:v1";
const DEFAULT_QUOTE_INTERVAL_MS = 5 * 60_000;
const DEFAULT_MAPPING_INTERVAL_MS = 24 * 60 * 60_000;
const DEFAULT_MONTHLY_BUDGET = 14_000;
const MAX_QUOTE_IDS = 250;
const PROVIDER_HEADERS = { accept: "application/json", "user-agent": "10X-Stonklets/1.0 (+https://stonklet.10x.meme)" };

export type CmcAssetSide = "stock" | "stonklet";

export interface StonkletCmcEnv {
  WARPLETS: D1Database;
  WARPLETS_KV?: KVNamespace;
  COINMARKETCAP_API_KEY?: string;
  STONKLETS_CMC_ENABLED?: string;
  STONKLETS_CMC_QUOTES_INTERVAL_MINUTES?: string;
  STONKLETS_CMC_HOLDER_TARGET_HOURS?: string;
  STONKLETS_CMC_MONTHLY_CREDIT_BUDGET?: string;
}

export interface CmcAssetSnapshot {
  assetKey: string;
  pairId: string;
  asset: CmcAssetSide;
  symbol: string;
  cmcId: number | null;
  contractAddress: string | null;
  metrics: MarketMetrics;
  quoteUpdatedAt: string | null;
  holdersUpdatedAt: string | null;
  mappingUpdatedAt: string | null;
}

export interface CmcIngestResult {
  status: "disabled" | "missing-key" | "budget-exhausted" | "fresh" | "ingested" | "error";
  mapped?: number;
  quoted?: number;
  holderAsset?: string;
  creditsThisMonth?: number;
}

interface CmcAssetRow {
  asset_key: string;
  pair_id: string;
  asset: CmcAssetSide;
  symbol: string;
  cmc_id: number | null;
  contract_address: string | null;
  quote_json: string | null;
  quote_updated_at: string | null;
  holders: number | null;
  holders_updated_at: string | null;
  mapping_updated_at: string | null;
}

interface CmcMapItem {
  id: number;
  symbol: string;
  platform: { slug?: string; token_address?: string } | null;
}

interface CmcQuoteItem {
  id: number;
  symbol: string;
  last_updated?: string;
  platform?: { slug?: string; token_address?: string } | null;
  quote?: Array<{
    symbol?: string;
    price?: unknown;
    volume_24h?: unknown;
    percent_change_1h?: unknown;
    percent_change_24h?: unknown;
    market_cap?: unknown;
    last_updated?: string;
  }>;
}

interface CmcResponse<T> {
  data?: T;
  status?: { error_code?: number | string; error_message?: string | null; credit_count?: number };
}

interface StoredCmcAssets {
  storedAt: number;
  assets: CmcAssetSnapshot[];
}

class CmcBudgetError extends Error {}

function enabled(value: string | undefined): boolean {
  return /^(1|true|yes)$/i.test(value?.trim() ?? "");
}

function finiteNumber(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(parsed) ? parsed : null;
}

function positiveInteger(value: unknown): number | null {
  const parsed = finiteNumber(value);
  return parsed != null && parsed >= 0 ? Math.floor(parsed) : null;
}

function safeJson<T>(value: string | null): T | null {
  if (!value) return null;
  try { return JSON.parse(value) as T; } catch { return null; }
}

function timestampAge(value: string | null, now = Date.now()): number {
  const parsed = Date.parse(value ?? "");
  return Number.isFinite(parsed) ? now - parsed : Number.POSITIVE_INFINITY;
}

function assetKey(pairId: string, asset: CmcAssetSide): string {
  return `${pairId}:${asset}`;
}

function monthKey(date = new Date()): string {
  return date.toISOString().slice(0, 7);
}

function budgetFor(env: StonkletCmcEnv): number {
  return Math.max(1_000, Math.min(15_000, Number(env.STONKLETS_CMC_MONTHLY_CREDIT_BUDGET) || DEFAULT_MONTHLY_BUDGET));
}

function quoteIntervalFor(env: StonkletCmcEnv): number {
  return Math.max(1, Math.min(60, Number(env.STONKLETS_CMC_QUOTES_INTERVAL_MINUTES) || 5)) * 60_000;
}

function candidateRows(entries: readonly StonkletCatalogEntry[]): Array<Pick<CmcAssetSnapshot, "assetKey" | "pairId" | "asset" | "symbol" | "contractAddress">> {
  return entries.flatMap((entry) => {
    const stock = {
      assetKey: assetKey(entry.id, "stock"), pairId: entry.id, asset: "stock" as const,
      symbol: entry.stock.symbol, contractAddress: entry.stock.contractAddress,
    };
    const stonkletAddress = entry.stonklet.contractAddress ?? entry.demoToken?.contractAddress ?? null;
    const stonklet = stonkletAddress ? [{
      assetKey: assetKey(entry.id, "stonklet"), pairId: entry.id, asset: "stonklet" as const,
      symbol: entry.stonklet.symbol, contractAddress: stonkletAddress,
    }] : [];
    return [stock, ...stonklet];
  });
}

export function normalizeCmcMap(payload: unknown): CmcMapItem[] {
  const data = payload && typeof payload === "object" ? (payload as CmcResponse<unknown>).data : null;
  if (!Array.isArray(data)) return [];
  return data.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const row = item as Record<string, unknown>;
    const platform = row.platform && typeof row.platform === "object" ? row.platform as Record<string, unknown> : null;
    const id = positiveInteger(row.id);
    const symbol = typeof row.symbol === "string" ? row.symbol.toUpperCase() : "";
    if (id == null || !symbol) return [];
    return [{
      id,
      symbol,
      platform: platform ? {
        slug: typeof platform.slug === "string" ? platform.slug : undefined,
        token_address: typeof platform.token_address === "string" ? platform.token_address.toLowerCase() : undefined,
      } : null,
    }];
  });
}

export function normalizeCmcQuotes(payload: unknown, fallbackUpdatedAt: string): Map<number, MarketMetrics> {
  const data = payload && typeof payload === "object" ? (payload as CmcResponse<unknown>).data : null;
  if (!Array.isArray(data)) return new Map();
  const result = new Map<number, MarketMetrics>();
  for (const value of data) {
    if (!value || typeof value !== "object") continue;
    const row = value as CmcQuoteItem;
    const id = positiveInteger(row.id);
    const usd = Array.isArray(row.quote) ? row.quote.find((quote) => quote?.symbol === "USD") ?? row.quote[0] : null;
    if (id == null || !usd) continue;
    const price = finiteNumber(usd.price);
    const marketCap = finiteNumber(usd.market_cap);
    const volume24h = finiteNumber(usd.volume_24h);
    const change1h = finiteNumber(usd.percent_change_1h);
    const change24h = finiteNumber(usd.percent_change_24h);
    const hasMetric = [price, marketCap, volume24h, change1h, change24h].some((metric) => metric != null);
    result.set(id, {
      ...emptyMarketMetrics(),
      price,
      marketCap,
      volume24h,
      change1h,
      change24h,
      updatedAt: usd.last_updated ?? row.last_updated ?? fallbackUpdatedAt,
      status: hasMetric ? "live" : "unavailable",
    });
  }
  return result;
}

export function normalizeCmcHolderCount(payload: unknown): number | null {
  if (!payload || typeof payload !== "object") return null;
  const wrapped = payload as { data?: unknown; count?: unknown };
  const value = wrapped.data && typeof wrapped.data === "object" ? wrapped.data as { count?: unknown } : wrapped;
  return positiveInteger(value.count);
}

function readCreditCount(payload: unknown): number {
  if (!payload || typeof payload !== "object") return 1;
  return Math.max(1, positiveInteger((payload as CmcResponse<unknown>).status?.credit_count) ?? 1);
}

async function reserveCredits(env: StonkletCmcEnv, credits: number): Promise<number> {
  const now = new Date().toISOString();
  const row = await env.WARPLETS.prepare(
    `INSERT INTO stonklet_cmc_credit_usage (month_key, credits, requests, updated_at)
     VALUES (?, ?, 1, ?)
     ON CONFLICT(month_key) DO UPDATE SET
       credits = stonklet_cmc_credit_usage.credits + excluded.credits,
       requests = stonklet_cmc_credit_usage.requests + 1,
       updated_at = excluded.updated_at
     WHERE stonklet_cmc_credit_usage.credits + excluded.credits <= ?
     RETURNING credits`,
  ).bind(monthKey(), credits, now, budgetFor(env)).first<{ credits: number }>();
  if (!row) throw new CmcBudgetError("CMC monthly safety budget reached");
  return Number(row.credits) || credits;
}

async function accountExtraCredits(env: StonkletCmcEnv, reserved: number, actual: number): Promise<void> {
  const extra = Math.max(0, actual - reserved);
  if (!extra) return;
  await env.WARPLETS.prepare(
    "UPDATE stonklet_cmc_credit_usage SET credits = credits + ?, updated_at = ? WHERE month_key = ?",
  ).bind(extra, new Date().toISOString(), monthKey()).run();
}

async function acquireLease(env: StonkletCmcEnv, lockKey: string, leaseMs = 2 * 60_000): Promise<string | null> {
  const now = new Date();
  const leaseUntil = new Date(now.getTime() + leaseMs).toISOString();
  const row = await env.WARPLETS.prepare(
    `INSERT INTO stonklet_cmc_ingest_locks (lock_key, lease_until, updated_at)
     VALUES (?, ?, ?)
     ON CONFLICT(lock_key) DO UPDATE SET lease_until = excluded.lease_until, updated_at = excluded.updated_at
     WHERE stonklet_cmc_ingest_locks.lease_until <= excluded.updated_at
     RETURNING lease_until`,
  ).bind(lockKey, leaseUntil, now.toISOString()).first<{ lease_until: string }>();
  return row?.lease_until === leaseUntil ? leaseUntil : null;
}

async function releaseLease(env: StonkletCmcEnv, lockKey: string, leaseUntil: string): Promise<void> {
  const now = new Date().toISOString();
  await env.WARPLETS.prepare(
    "UPDATE stonklet_cmc_ingest_locks SET lease_until = ?, updated_at = ? WHERE lock_key = ? AND lease_until = ?",
  ).bind(now, now, lockKey, leaseUntil).run().catch(() => undefined);
}

async function fetchCmcJson(env: StonkletCmcEnv, path: string): Promise<{ payload: unknown; creditsThisMonth: number }> {
  const key = env.COINMARKETCAP_API_KEY?.trim();
  if (!key) throw new Error("Missing CoinMarketCap API key");
  const reserved = 1;
  const creditsThisMonth = await reserveCredits(env, reserved);
  const response = await fetch(`${CMC_BASE}${path}`, {
    headers: { ...PROVIDER_HEADERS, "X-CMC_PRO_API_KEY": key },
    signal: AbortSignal.timeout(8_000),
  });
  const payload = await response.json().catch(() => null);
  const status = payload && typeof payload === "object" ? (payload as CmcResponse<unknown>).status : null;
  if (!response.ok || (status?.error_code != null && Number(status.error_code) !== 0)) {
    throw new Error(`CMC returned ${response.status}: ${status?.error_message || "upstream error"}`);
  }
  await accountExtraCredits(env, reserved, readCreditCount(payload));
  return { payload, creditsThisMonth };
}

function rowToSnapshot(row: CmcAssetRow): CmcAssetSnapshot {
  const quote = safeJson<MarketMetrics>(row.quote_json) ?? emptyMarketMetrics();
  return {
    assetKey: row.asset_key,
    pairId: row.pair_id,
    asset: row.asset,
    symbol: row.symbol,
    cmcId: positiveInteger(row.cmc_id),
    contractAddress: row.contract_address?.toLowerCase() ?? null,
    metrics: { ...quote, holders: positiveInteger(row.holders) },
    quoteUpdatedAt: row.quote_updated_at,
    holdersUpdatedAt: row.holders_updated_at,
    mappingUpdatedAt: row.mapping_updated_at,
  };
}

async function readRows(env: StonkletCmcEnv): Promise<CmcAssetRow[]> {
  const result = await env.WARPLETS.prepare(
    `SELECT asset_key, pair_id, asset, symbol, cmc_id, contract_address, quote_json,
            quote_updated_at, holders, holders_updated_at, mapping_updated_at
     FROM stonklet_cmc_assets ORDER BY asset_key`,
  ).all<CmcAssetRow>().catch((error) => {
    console.warn("stonklets_cmc_d1_read_error", { message: error instanceof Error ? error.message : String(error) });
    return { results: [] as CmcAssetRow[] };
  });
  return result.results ?? [];
}

async function writeCache(env: StonkletCmcEnv, rows?: CmcAssetRow[]): Promise<CmcAssetSnapshot[]> {
  const snapshots = (rows ?? await readRows(env)).map(rowToSnapshot);
  await env.WARPLETS_KV?.put(KV_KEY, JSON.stringify({ storedAt: Date.now(), assets: snapshots } satisfies StoredCmcAssets), {
    expirationTtl: 7 * 24 * 60 * 60,
  }).catch(() => undefined);
  return snapshots;
}

export async function loadCmcMarket(env: StonkletCmcEnv): Promise<Map<string, CmcAssetSnapshot>> {
  const cached = await env.WARPLETS_KV?.get<StoredCmcAssets>(KV_KEY, "json").catch(() => null) ?? null;
  const staleAfter = Math.max(15 * 60_000, quoteIntervalFor(env) * 3);
  const raw = cached && Array.isArray(cached.assets) ? cached.assets : (await readRows(env)).map(rowToSnapshot);
  const expected = new Map(candidateRows(STONKLETS_CATALOG).map(row => [row.assetKey, row.contractAddress?.toLowerCase()]));
  const snapshots = raw.filter(snapshot => expected.get(snapshot.assetKey) === snapshot.contractAddress?.toLowerCase()).map((snapshot) => ({
    ...snapshot,
    metrics: snapshot.metrics.status === "live" && timestampAge(snapshot.quoteUpdatedAt) > staleAfter
      ? { ...snapshot.metrics, status: "stale" as const }
      : snapshot.metrics,
  }));
  return new Map(snapshots.map((snapshot) => [snapshot.assetKey, snapshot]));
}

async function refreshMappings(env: StonkletCmcEnv, candidates: ReturnType<typeof candidateRows>): Promise<number> {
  const symbols = [...new Set(candidates.map((candidate) => candidate.symbol.toUpperCase()))];
  const params = new URLSearchParams({ symbol: symbols.join(","), aux: "platform" });
  const { payload } = await fetchCmcJson(env, `/v1/cryptocurrency/map?${params}`);
  const mappedBySymbol = new Map<string, CmcMapItem[]>();
  for (const item of normalizeCmcMap(payload)) {
    if (item.platform?.slug !== "bnb" || !item.platform.token_address) continue;
    mappedBySymbol.set(item.symbol, [...(mappedBySymbol.get(item.symbol) ?? []), item]);
  }
  const now = new Date().toISOString();
  const statements = candidates.map((candidate) => {
    const possible = mappedBySymbol.get(candidate.symbol.toUpperCase()) ?? [];
    const expectedAddress = candidate.contractAddress?.toLowerCase() ?? null;
    const mapped = expectedAddress
      ? possible.find((item) => item.platform?.token_address === expectedAddress)
      : possible[0];
    const address = candidate.contractAddress?.toLowerCase() ?? mapped?.platform?.token_address ?? null;
    return env.WARPLETS.prepare(
      `INSERT INTO stonklet_cmc_assets
        (asset_key, pair_id, asset, symbol, cmc_id, contract_address, mapping_updated_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(asset_key) DO UPDATE SET
         symbol = excluded.symbol,
         cmc_id = CASE WHEN stonklet_cmc_assets.contract_address IS NOT excluded.contract_address THEN excluded.cmc_id ELSE COALESCE(excluded.cmc_id, stonklet_cmc_assets.cmc_id) END,
         quote_json = CASE WHEN stonklet_cmc_assets.contract_address IS NOT excluded.contract_address THEN NULL ELSE stonklet_cmc_assets.quote_json END,
         quote_updated_at = CASE WHEN stonklet_cmc_assets.contract_address IS NOT excluded.contract_address THEN NULL ELSE stonklet_cmc_assets.quote_updated_at END,
         holders = CASE WHEN stonklet_cmc_assets.contract_address IS NOT excluded.contract_address THEN NULL ELSE stonklet_cmc_assets.holders END,
         holders_updated_at = CASE WHEN stonklet_cmc_assets.contract_address IS NOT excluded.contract_address THEN NULL ELSE stonklet_cmc_assets.holders_updated_at END,
         contract_address = COALESCE(excluded.contract_address, stonklet_cmc_assets.contract_address),
         mapping_updated_at = excluded.mapping_updated_at,
         updated_at = excluded.updated_at`,
    ).bind(candidate.assetKey, candidate.pairId, candidate.asset, candidate.symbol, mapped?.id ?? null, address, now, now);
  });
  if (statements.length) await env.WARPLETS.batch(statements);
  return candidates.filter((candidate) => {
    const possible = mappedBySymbol.get(candidate.symbol.toUpperCase()) ?? [];
    const expectedAddress = candidate.contractAddress?.toLowerCase() ?? null;
    return expectedAddress ? possible.some((item) => item.platform?.token_address === expectedAddress) : possible.length > 0;
  }).length;
}

async function refreshQuotes(env: StonkletCmcEnv, rows: CmcAssetRow[]): Promise<number> {
  const ids = [...new Set(rows.flatMap((row) => row.cmc_id == null ? [] : [Number(row.cmc_id)]))].slice(0, MAX_QUOTE_IDS);
  if (!ids.length) return 0;
  const params = new URLSearchParams({ id: ids.join(","), convert: "USD", skip_invalid: "true" });
  const now = new Date().toISOString();
  const { payload } = await fetchCmcJson(env, `/v3/cryptocurrency/quotes/latest?${params}`);
  const quotes = normalizeCmcQuotes(payload, now);
  const statements = rows.flatMap((row) => {
    const metrics = row.cmc_id == null ? null : quotes.get(Number(row.cmc_id));
    if (!metrics) return [];
    return [env.WARPLETS.prepare(
      `UPDATE stonklet_cmc_assets SET quote_json = ?, quote_updated_at = ?, last_error = NULL, updated_at = ?
       WHERE asset_key = ?`,
    ).bind(JSON.stringify(metrics), now, now, row.asset_key)];
  });
  if (statements.length) await env.WARPLETS.batch(statements);
  return statements.length;
}

function holderIntervalMs(env: StonkletCmcEnv, eligibleAssets: number): number {
  const configured = Number(env.STONKLETS_CMC_HOLDER_TARGET_HOURS);
  const hours = Number.isFinite(configured) && configured > 0 ? configured : Math.max(6, (eligibleAssets / 40) * 6);
  return Math.max(1, hours) * 60 * 60_000;
}

export function estimateCmcMonthlyCredits(assetCount: number, days = 31, quoteIntervalMinutes = 5): {
  quotes: number; holders: number; mappings: number; total: number;
} {
  const boundedAssets = Math.max(0, Math.min(MAX_QUOTE_IDS, Math.floor(assetCount)));
  const minutes = Math.max(1, quoteIntervalMinutes);
  const quoteBatches = boundedAssets === 0 ? 0 : Math.ceil(boundedAssets / MAX_QUOTE_IDS);
  const quotes = Math.ceil((days * 24 * 60) / minutes) * quoteBatches;
  const holderHours = Math.max(6, (boundedAssets / 40) * 6);
  const holders = boundedAssets === 0 ? 0 : Math.ceil((days * 24 * boundedAssets) / holderHours);
  const mappings = boundedAssets === 0 ? 0 : Math.ceil(days);
  return { quotes, holders, mappings, total: quotes + holders + mappings };
}

async function refreshOneHolder(env: StonkletCmcEnv, rows: CmcAssetRow[]): Promise<string | null> {
  const eligible = rows.filter((row) => /^0x[0-9a-f]{40}$/i.test(row.contract_address ?? ""));
  const interval = holderIntervalMs(env, eligible.length);
  const due = eligible
    .filter((row) => timestampAge(row.holders_updated_at) >= interval)
    .sort((a, b) => (Date.parse(a.holders_updated_at ?? "") || 0) - (Date.parse(b.holders_updated_at ?? "") || 0))[0];
  if (!due?.contract_address) return null;
  const params = new URLSearchParams({ platform: "bsc", tokenAddress: due.contract_address });
  const { payload } = await fetchCmcJson(env, `/v1/dex/holders/count?${params}`);
  const holders = normalizeCmcHolderCount(payload);
  if (holders == null) throw new Error("CMC returned a malformed holder count");
  const now = new Date().toISOString();
  await env.WARPLETS.prepare(
    `UPDATE stonklet_cmc_assets SET holders = ?, holders_updated_at = ?, last_error = NULL, updated_at = ?
     WHERE asset_key = ?`,
  ).bind(holders, now, now, due.asset_key).run();
  return due.asset_key;
}

export async function ingestCmcMarketIfDue(env: StonkletCmcEnv): Promise<CmcIngestResult> {
  if (!enabled(env.STONKLETS_CMC_ENABLED)) return { status: "disabled" };
  if (!env.COINMARKETCAP_API_KEY?.trim()) return { status: "missing-key" };
  try {
    const candidates = candidateRows(STONKLETS_CATALOG);
    let rows = await readRows(env);
    let mapped = 0;
    const needsMapping = candidates.some(candidate => !rows.some(row => row.asset_key === candidate.assetKey && row.contract_address?.toLowerCase() === candidate.contractAddress?.toLowerCase())) || rows.length < candidates.length || rows.some((row) => timestampAge(row.mapping_updated_at) >= DEFAULT_MAPPING_INTERVAL_MS);
    if (needsMapping) {
      const lease = await acquireLease(env, "mapping");
      if (lease) {
        try { mapped = await refreshMappings(env, candidates); }
        finally { await releaseLease(env, "mapping", lease); }
        rows = await readRows(env);
      }
    }
    let quoted = 0;
    if (rows.some((row) => row.cmc_id != null && timestampAge(row.quote_updated_at) >= quoteIntervalFor(env))) {
      const lease = await acquireLease(env, "quotes");
      if (lease) {
        try { quoted = await refreshQuotes(env, rows); }
        finally { await releaseLease(env, "quotes", lease); }
        rows = await readRows(env);
      }
    }
    let holderAsset: string | null = null;
    const holderLease = await acquireLease(env, "holders");
    if (holderLease) {
      try { holderAsset = await refreshOneHolder(env, rows); }
      finally { await releaseLease(env, "holders", holderLease); }
    }
    await writeCache(env);
    const changed = mapped > 0 || quoted > 0 || holderAsset != null;
    return { status: changed ? "ingested" : "fresh", mapped, quoted, holderAsset: holderAsset ?? undefined };
  } catch (error) {
    if (error instanceof CmcBudgetError) {
      console.warn("stonklets_cmc_budget_exhausted", { month: monthKey(), budget: budgetFor(env) });
      return { status: "budget-exhausted" };
    }
    console.warn("stonklets_cmc_ingest_error", { message: error instanceof Error ? error.message : String(error) });
    return { status: "error" };
  }
}

export function mergeCmcMetrics(primary: MarketMetrics, supplemental: CmcAssetSnapshot | undefined): MarketMetrics {
  if (!supplemental) return primary;
  const cmc = supplemental.metrics;
  const updatedAt = [primary.updatedAt, cmc.updatedAt].filter((value): value is string => Boolean(value)).sort().at(-1) ?? null;
  const hasMetric = [primary, cmc].some((metrics) => metrics.status !== "unavailable");
  return {
    price: primary.price ?? cmc.price,
    marketCap: cmc.marketCap ?? primary.marketCap,
    volume24h: primary.volume24h ?? cmc.volume24h,
    holders: cmc.holders ?? primary.holders,
    liquidity: primary.liquidity ?? cmc.liquidity,
    change5m: primary.change5m ?? cmc.change5m,
    change1h: primary.change1h ?? cmc.change1h,
    change4h: primary.change4h ?? cmc.change4h,
    change24h: primary.change24h ?? cmc.change24h,
    updatedAt,
    status: primary.status === "live" || cmc.status === "live" ? "live" : hasMetric ? "stale" : "unavailable",
  };
}
