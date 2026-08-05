import { jsonSecure, verifyActionSessionToken } from "./security.js";

export const ANALYTICS_EPOCH = "2026-07-02T00:00:00.000Z";
export const STATS_COLLECTION_SLUG = "10xwarplets";
export const WARPLETS_TOTAL_SUPPLY = 10_000;

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const WALLET_PATTERN = /^0x[a-f0-9]{40}$/;
const PUBLIC_CACHE = "public, max-age=60, s-maxage=300, stale-while-revalidate=300";
const PRIVATE_CACHE = "private, no-store";
const SALES_LIMIT = 10_000;

export interface StatsEnv {
  WARPLETS: D1Database;
  WARPLETS_KV?: KVNamespace;
  ACTION_SESSION_SECRET?: string;
  DUNE_API_KEY?: string;
  DUNE_ENABLED?: string;
  DUNE_EXECUTE_ENABLED?: string;
  DUNE_TRADES_QUERY_ID?: string;
  DUNE_TRANSFERS_QUERY_ID?: string;
  DUNE_EXECUTION_INTERVAL_HOURS?: string;
  DUNE_MONTHLY_CREDIT_BUDGET?: string;
  DUNE_MAX_CREDITS_PER_EXECUTION?: string;
}

export type StatsRange = "7d" | "30d" | "90d" | "1y" | "all";

type StatsSource = {
  id: string;
  label: string;
  complete: boolean;
  asOf: string | null;
  note?: string;
};

type StatsMeta = {
  analyticsEpoch: string;
  asOf: string;
  generatedAt: string;
  range: StatsRange;
  coverageStart: string;
  baselineAsOf: string | null;
  complete: boolean;
  stale: boolean;
  sources: StatsSource[];
};

type DuneIntegration = {
  status: "live" | "stale" | "pending" | "disabled" | "unavailable" | "budget_paused";
  configured: boolean;
  asOf: string | null;
  coverageStart: string | null;
  coverageEnd: string | null;
  lastError: string | null;
  creditsThisMonth: number | null;
};

type Metric<T> = {
  value: T;
  unit: string | null;
  source: string;
  complete: boolean;
  asOf: string | null;
  label?: string;
};

type MarketCurrent = {
  itemCount: number;
  floorEth: number | null;
  floorAt: string | null;
  topOfferEth: number | null;
  topOfferSymbol: string | null;
  topOfferAt: string | null;
  listedCount: number;
  ownerCount: number;
  marketUpdatedAt: string | null;
  ownershipUpdatedAt: string | null;
};

type BaselineRow = {
  analytics_epoch: string;
  opensea_total_sales: number | null;
  opensea_total_volume_text: string | null;
  verified_at: string | null;
};

type StatsSnapshotRow = {
  captured_at: string;
  updated_at: string;
  ingest_stale?: number | null;
  total_sales: number | null;
  total_volume_text: string | null;
  one_day_sales: number | null;
  one_day_volume_text: string | null;
  seven_day_sales: number | null;
  seven_day_volume_text: string | null;
  thirty_day_sales: number | null;
  thirty_day_volume_text: string | null;
  floor_eth: number | null;
  owners_count: number | null;
  listed_count: number | null;
};

type SaleRow = {
  key: string;
  tokenId: number;
  transactionHash: string | null;
  orderHash: string | null;
  buyerWallet: string | null;
  sellerWallet: string | null;
  buyerFid: number | null;
  sellerFid: number | null;
  marketplace: string | null;
  priceEth: number | null;
  priceUsd: number | null;
  paymentSymbol: string | null;
  soldAt: string;
  source: string;
};

type Profile = {
  wallet: string;
  fid: number | null;
  username: string | null;
  displayName: string | null;
  pfpUrl: string | null;
  xUsername: string | null;
  score: number | null;
};

type HolderBaseRow = {
  rank: number;
  wallet: string;
  ownedCount: number;
  bestRarityRank: number;
  bestTokenId: number;
  previewTokenIds: number[];
  updatedAt: string | null;
};

type HolderApiRow = HolderBaseRow & {
  ownedPct: number;
  supplyPercentage: number;
  remainingCount: number;
  remainingPreviewCount: number;
  floorValueEth: number | null;
  fid: number | null;
  username: string | null;
  displayName: string | null;
  pfpUrl: string | null;
  xUsername: string | null;
  isViewer: boolean;
  isTopFriend: boolean;
  originalFidTokenId?: number | null;
  averageHoldingDays?: number | null;
  oldestCurrentHoldingAt?: string | null;
  acquiredSinceEpoch?: number | null;
  disposedSinceEpoch?: number | null;
};

type HolderCursor = {
  rank: number;
  ownedCount: number;
  bestRarityRank: number;
  wallet: string;
};

export type PersistOpenSeaStatsResult = {
  persisted: boolean;
  capturedAt: string;
  reason?: string;
};

export type NormalizedSaleInput = {
  canonicalKey?: string;
  chainId?: number;
  collectionSlug?: string;
  tokenId: number;
  transactionHash?: string | null;
  orderHash?: string | null;
  eventId?: string | null;
  buyerWallet?: string | null;
  sellerWallet?: string | null;
  buyerFid?: number | null;
  sellerFid?: number | null;
  marketplace?: string | null;
  priceRaw?: string | null;
  paymentDecimals?: number | null;
  paymentSymbol?: string | null;
  paymentAddress?: string | null;
  priceEth?: number | null;
  priceUsd?: number | null;
  soldAt: string;
  source: string;
  rawPayload?: unknown;
};

export type CollectionMarketSnapshotInput = {
  collectionSlug?: string;
  capturedAt?: string;
  floorEth?: number | null;
  topOfferEth?: number | null;
  listedCount?: number | null;
  ownersCount?: number | null;
  source?: string;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function asFiniteNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function asInteger(value: unknown): number | null {
  const numeric = asFiniteNumber(value);
  return numeric !== null && Number.isSafeInteger(numeric) ? numeric : null;
}

function asDecimalText(value: unknown): string | null {
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
    return String(value);
  }
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return /^\d+(?:\.\d+)?$/.test(trimmed) ? trimmed : null;
}

function asIsoDate(value: unknown, fallback?: string): string | null {
  if (typeof value !== "string" || !value.trim()) return fallback ?? null;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : fallback ?? null;
}

function normalizeWallet(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const wallet = value.trim().toLowerCase();
  return WALLET_PATTERN.test(wallet) && wallet !== ZERO_ADDRESS ? wallet : null;
}

function nullableText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function serializeRaw(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  try {
    return JSON.stringify(value);
  } catch {
    return null;
  }
}

function metric<T>(
  value: T,
  unit: string | null,
  source: string,
  complete: boolean,
  asOf: string | null,
  label?: string,
): Metric<T> {
  return { value, unit, source, complete, asOf, ...(label ? { label } : {}) };
}

function jsonStats(
  data: unknown,
  options?: { private?: boolean; noStore?: boolean; status?: number },
): Response {
  return jsonSecure(data, {
    status: options?.status ?? 200,
    headers: {
      "cache-control": options?.noStore
        ? "no-store"
        : options?.private
          ? PRIVATE_CACHE
          : PUBLIC_CACHE,
    },
  });
}

function jsonError(code: string, message: string, status = 500): Response {
  return jsonStats({ error: code, message }, { private: true, status });
}

const tableExistsCache = new Map<string, Promise<boolean>>();

async function tableExists(db: D1Database, table: string): Promise<boolean> {
  const cached = tableExistsCache.get(table);
  if (cached) return cached;
  const lookup = db
    .prepare("SELECT 1 AS found FROM sqlite_master WHERE type = 'table' AND name = ? LIMIT 1")
    .bind(table)
    .first<{ found: number }>()
    .then((row) => row?.found === 1)
    .catch(() => false);
  tableExistsCache.set(table, lookup);
  return lookup;
}

function envEnabled(value: string | undefined): boolean {
  return /^(?:1|true|yes|on)$/i.test(value?.trim() ?? "");
}

function configuredDuneQueryCount(env: StatsEnv): number {
  return [env.DUNE_TRADES_QUERY_ID, env.DUNE_TRANSFERS_QUERY_ID]
    .map((value) => asInteger(value))
    .filter((value): value is number => value !== null && value > 0)
    .length;
}

async function loadDuneIntegration(env: StatsEnv): Promise<DuneIntegration> {
  const duneEnabled = envEnabled(env.DUNE_ENABLED);
  const queryCount = configuredDuneQueryCount(env);
  const configured = duneEnabled && queryCount > 0;
  const disabled: DuneIntegration = {
    status: duneEnabled ? "unavailable" : "disabled",
    configured,
    asOf: null,
    coverageStart: null,
    coverageEnd: null,
    lastError: duneEnabled && !configured ? "Dune setup is incomplete." : null,
    creditsThisMonth: null,
  };
  if (!(await tableExists(env.WARPLETS, "analytics_ingest_state"))) return disabled;

  try {
    const [state, execution] = await Promise.all([
      env.WARPLETS.prepare(
        `SELECT
           MAX(coverage_start) AS coverage_start,
           MIN(coverage_end) AS coverage_end,
           MIN(last_success_at) AS last_success_at,
           MAX(updated_at) AS updated_at,
           MAX(stale) AS stale,
           MAX(CASE WHEN last_error IS NOT NULL THEN last_error END) AS last_error,
           COUNT(DISTINCT CASE
             WHEN source_key IN ('dune:trades', 'dune:transfers')
               AND last_success_at IS NOT NULL
             THEN source_key
           END) AS successful_sources
         FROM analytics_ingest_state
         WHERE source_key IN ('dune:trades', 'dune:transfers')`
      ).first<{
        coverage_start: string | null;
        coverage_end: string | null;
        last_success_at: string | null;
        updated_at: string | null;
        stale: number | null;
        last_error: string | null;
        successful_sources: number;
      }>(),
      tableExists(env.WARPLETS, "analytics_dune_executions").then(async (exists) => {
        if (!exists) return null;
        return env.WARPLETS.prepare(
          `WITH latest_usage AS (
             SELECT
               billing_period_start,
               billing_period_end,
               credits_used
             FROM analytics_dune_usage_snapshots
             ORDER BY fetched_at DESC
             LIMIT 1
           )
           SELECT
             COALESCE((SELECT credits_used FROM latest_usage), 0) AS credits_this_month,
             MAX(CASE
               WHEN status IN (
                 'QUERY_STATE_PENDING',
                 'QUERY_STATE_EXECUTING',
                 'QUERY_STATE_COMPLETED',
                 'INGESTING'
               ) THEN 1 ELSE 0
             END) AS has_pending,
             MAX(CASE
               WHEN submitted_at >= COALESCE(
                 (SELECT billing_period_start FROM latest_usage),
                 '9999-12-31T00:00:00.000Z'
               )
               THEN execution_cost_credits
             END) AS maximum_execution_credits
           FROM analytics_dune_executions`
        ).first<{
          credits_this_month: number;
          has_pending: number;
          maximum_execution_credits: number | null;
        }>();
      }),
    ]);

    const successCount = state?.successful_sources ?? 0;
    const expectedSources = Math.max(1, queryCount);
    const asOf = state?.last_success_at ?? null;
    const staleByAge = asOf ? isStale(asOf, 36 * 3_600_000) : true;
    const monthlyBudget = asFiniteNumber(env.DUNE_MONTHLY_CREDIT_BUDGET) ?? 1_500;
    const maxExecutionCredits =
      asFiniteNumber(env.DUNE_MAX_CREDITS_PER_EXECUTION) ?? 20;
    const budgetPaused =
      (execution?.credits_this_month ?? 0) >= monthlyBudget ||
      (execution?.maximum_execution_credits ?? 0) > maxExecutionCredits;
    const pending = execution?.has_pending === 1;
    const hasData = successCount > 0;
    const stale = state?.stale === 1 || staleByAge || successCount < expectedSources;
    const status: DuneIntegration["status"] = budgetPaused
      ? "budget_paused"
      : !duneEnabled
        ? "disabled"
        : pending && !hasData
          ? "pending"
          : hasData && stale
            ? "stale"
            : hasData
              ? "live"
              : configured
                ? "pending"
                : "unavailable";
    return {
      status,
      configured,
      asOf,
      coverageStart: state?.coverage_start ?? null,
      coverageEnd: state?.coverage_end ?? null,
      lastError: state?.last_error?.replace(/\s+/g, " ").slice(0, 500) ?? null,
      creditsThisMonth: execution?.credits_this_month ?? 0,
    };
  } catch {
    return disabled;
  }
}

function getRange(url: URL): StatsRange {
  const raw = url.searchParams.get("range")?.trim().toLowerCase();
  return raw === "7d" || raw === "30d" || raw === "90d" || raw === "1y" || raw === "all" ? raw : "30d";
}

function getRangeStart(range: StatsRange, now = new Date()): string {
  if (range === "all") return ANALYTICS_EPOCH;
  const days = range === "7d" ? 7 : range === "90d" ? 90 : range === "1y" ? 365 : 30;
  const startMs = Math.max(Date.parse(ANALYTICS_EPOCH), now.getTime() - days * 86_400_000);
  return new Date(startMs).toISOString();
}

function isStale(asOf: string | null, maxAgeMs = 30 * 60_000): boolean {
  if (!asOf) return true;
  const timestamp = sortableTimestamp(asOf);
  return !Number.isFinite(timestamp) || Date.now() - timestamp > maxAgeMs;
}

function sortableTimestamp(value: string | null): number {
  if (!value) return Number.NaN;
  const normalized = value.includes("T") ? value : `${value.replace(" ", "T")}Z`;
  return Date.parse(normalized);
}

function safePercentage(numerator: number, denominator: number): number {
  return denominator > 0 ? (numerator / denominator) * 100 : 0;
}

function getIntervalRecord(raw: Record<string, unknown>, interval: string): Record<string, unknown> | null {
  const intervals = raw.intervals;
  if (!Array.isArray(intervals)) return null;
  for (const item of intervals) {
    const row = asRecord(item);
    if (row?.interval === interval) return row;
  }
  return null;
}

function readStatsSnapshot(
  rawStats: unknown,
): Omit<StatsSnapshotRow, "captured_at" | "updated_at"> {
  const raw = asRecord(rawStats) ?? {};
  const total = asRecord(raw.total) ?? asRecord(raw.total_stats) ?? raw;
  const oneDay = getIntervalRecord(raw, "one_day") ?? asRecord(raw.one_day) ?? {};
  const sevenDay = getIntervalRecord(raw, "seven_day") ?? asRecord(raw.seven_day) ?? {};
  const thirtyDay = getIntervalRecord(raw, "thirty_day") ?? asRecord(raw.thirty_day) ?? {};

  return {
    total_sales: asInteger(total.sales ?? total.total_sales),
    total_volume_text: asDecimalText(total.volume ?? total.total_volume),
    one_day_sales: asInteger(oneDay.sales ?? oneDay.total_sales),
    one_day_volume_text: asDecimalText(oneDay.volume ?? oneDay.total_volume),
    seven_day_sales: asInteger(sevenDay.sales ?? sevenDay.total_sales),
    seven_day_volume_text: asDecimalText(sevenDay.volume ?? sevenDay.total_volume),
    thirty_day_sales: asInteger(thirtyDay.sales ?? thirtyDay.total_sales),
    thirty_day_volume_text: asDecimalText(thirtyDay.volume ?? thirtyDay.total_volume),
    floor_eth: asFiniteNumber(total.floor_price ?? raw.floor_price),
    owners_count: asInteger(total.num_owners ?? total.owners ?? raw.num_owners ?? raw.owners),
    listed_count: asInteger(total.num_listings ?? total.listed ?? raw.num_listings ?? raw.listed),
  };
}

function decimalTextIsLessThan(
  candidateValue: string | null,
  previousValue: string | null,
): boolean {
  const candidate = parseDecimal(candidateValue);
  const previous = parseDecimal(previousValue);
  if (!candidate || !previous) return false;
  const scale = Math.max(candidate.scale, previous.scale);
  const candidateInteger = candidate.integer * 10n ** BigInt(scale - candidate.scale);
  const previousInteger = previous.integer * 10n ** BigInt(scale - previous.scale);
  return candidateInteger < previousInteger;
}

async function recordOpenSeaStatsIngestHealth(
  db: D1Database,
  coverageEnd: string,
  error: string | null,
): Promise<void> {
  const updatedAt = new Date().toISOString();
  try {
    if (error) {
      await db.prepare(
        `INSERT INTO analytics_ingest_state (
           source_key, coverage_start, coverage_end, complete, stale,
           last_error, last_success_at, updated_at
         ) VALUES (?, ?, ?, 0, 1, ?, NULL, ?)
         ON CONFLICT(source_key) DO UPDATE SET
           coverage_start = COALESCE(analytics_ingest_state.coverage_start, excluded.coverage_start),
           coverage_end = excluded.coverage_end,
           stale = 1,
           last_error = excluded.last_error,
           updated_at = excluded.updated_at`
      ).bind(
        "opensea:collection_stats",
        ANALYTICS_EPOCH,
        coverageEnd,
        error,
        updatedAt,
      ).run();
      return;
    }

    await db.prepare(
      `INSERT INTO analytics_ingest_state (
         source_key, coverage_start, coverage_end, complete, stale,
         last_error, last_success_at, updated_at
       ) VALUES (?, ?, ?, 1, 0, NULL, ?, ?)
       ON CONFLICT(source_key) DO UPDATE SET
         coverage_start = COALESCE(analytics_ingest_state.coverage_start, excluded.coverage_start),
         coverage_end = excluded.coverage_end,
         complete = 1,
         stale = 0,
         last_error = NULL,
         last_success_at = excluded.last_success_at,
         updated_at = excluded.updated_at`
    ).bind(
      "opensea:collection_stats",
      ANALYTICS_EPOCH,
      coverageEnd,
      updatedAt,
      updatedAt,
    ).run();
  } catch {
    // Analytics health tracking is migration-aware and never blocks ingestion.
  }
}

export async function persistOpenSeaStatsSnapshot(
  db: D1Database,
  rawStats: unknown,
  fetchedAt = new Date().toISOString(),
): Promise<PersistOpenSeaStatsResult> {
  const capturedAt = asIsoDate(fetchedAt, new Date().toISOString()) as string;
  try {
    const row = readStatsSnapshot(rawStats);
    const previous = await db.prepare(
      `SELECT total_sales, total_volume_text
       FROM opensea_stats_snapshots
       WHERE collection_slug = ?
       ORDER BY captured_at DESC
       LIMIT 1`
    ).bind(STATS_COLLECTION_SLUG).first<{
      total_sales: number | null;
      total_volume_text: string | null;
    }>();
    let invalidReason: string | null = null;
    if (
      previous?.total_sales !== null &&
      previous?.total_sales !== undefined &&
      row.total_sales === null
    ) {
      invalidReason = "OpenSea collection stats omitted the lifetime sales total.";
    } else if (
      previous?.total_sales !== null &&
      previous?.total_sales !== undefined &&
      row.total_sales !== null &&
      row.total_sales < previous.total_sales
    ) {
      invalidReason =
        `OpenSea lifetime sales moved backwards from ${previous.total_sales} to ${row.total_sales}.`;
    } else if (
      previous?.total_volume_text &&
      !row.total_volume_text
    ) {
      invalidReason = "OpenSea collection stats omitted the lifetime volume total.";
    } else if (
      decimalTextIsLessThan(row.total_volume_text, previous?.total_volume_text ?? null)
    ) {
      invalidReason =
        `OpenSea lifetime volume moved backwards from ${previous?.total_volume_text} to ${row.total_volume_text}.`;
    }
    if (invalidReason) {
      await recordOpenSeaStatsIngestHealth(db, capturedAt, invalidReason);
      return { persisted: false, capturedAt, reason: `opensea_stats_drift: ${invalidReason}` };
    }

    await db.prepare(
      `INSERT INTO opensea_stats_snapshots (
         collection_slug, captured_at,
         total_sales, total_volume_text,
         one_day_sales, one_day_volume_text,
         seven_day_sales, seven_day_volume_text,
         thirty_day_sales, thirty_day_volume_text,
         floor_eth, owners_count, listed_count, raw_payload
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(collection_slug, captured_at) DO UPDATE SET
         total_sales = excluded.total_sales,
         total_volume_text = excluded.total_volume_text,
         one_day_sales = excluded.one_day_sales,
         one_day_volume_text = excluded.one_day_volume_text,
         seven_day_sales = excluded.seven_day_sales,
         seven_day_volume_text = excluded.seven_day_volume_text,
         thirty_day_sales = excluded.thirty_day_sales,
         thirty_day_volume_text = excluded.thirty_day_volume_text,
         floor_eth = excluded.floor_eth,
         owners_count = excluded.owners_count,
         listed_count = excluded.listed_count,
         raw_payload = excluded.raw_payload,
         updated_at = CURRENT_TIMESTAMP`
    ).bind(
      STATS_COLLECTION_SLUG,
      capturedAt,
      row.total_sales,
      row.total_volume_text,
      row.one_day_sales,
      row.one_day_volume_text,
      row.seven_day_sales,
      row.seven_day_volume_text,
      row.thirty_day_sales,
      row.thirty_day_volume_text,
      row.floor_eth,
      row.owners_count,
      row.listed_count,
      serializeRaw(rawStats),
    ).run();
    await recordOpenSeaStatsIngestHealth(db, capturedAt, null);
    return { persisted: true, capturedAt };
  } catch (error) {
    return {
      persisted: false,
      capturedAt,
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function persistCollectionMarketSnapshot(
  db: D1Database,
  input: CollectionMarketSnapshotInput,
): Promise<boolean> {
  const capturedAt = asIsoDate(input.capturedAt, new Date().toISOString()) as string;
  try {
    await db.prepare(
      `INSERT INTO collection_market_snapshots (
         collection_slug, captured_at, floor_eth, top_offer_eth,
         listed_count, owners_count, source
       ) VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(collection_slug, captured_at) DO UPDATE SET
         floor_eth = excluded.floor_eth,
         top_offer_eth = excluded.top_offer_eth,
         listed_count = excluded.listed_count,
         owners_count = excluded.owners_count,
         source = excluded.source`
    ).bind(
      input.collectionSlug ?? STATS_COLLECTION_SLUG,
      capturedAt,
      input.floorEth ?? null,
      input.topOfferEth ?? null,
      input.listedCount ?? null,
      input.ownersCount ?? null,
      input.source ?? "opensea",
    ).run();
    return true;
  } catch {
    return false;
  }
}

function makeSaleKey(input: NormalizedSaleInput): string {
  if (input.canonicalKey?.trim()) return input.canonicalKey.trim();
  const identity =
    nullableText(input.transactionHash) ??
    nullableText(input.orderHash) ??
    nullableText(input.eventId) ??
    `${input.soldAt}:${input.buyerWallet ?? ""}:${input.sellerWallet ?? ""}`;
  return `${input.chainId ?? 8453}:${identity.toLowerCase()}:${input.tokenId}`;
}

export async function recordNormalizedSale(
  db: D1Database,
  input: NormalizedSaleInput,
): Promise<boolean> {
  if (!Number.isInteger(input.tokenId) || input.tokenId < 1 || input.tokenId > WARPLETS_TOTAL_SUPPLY) {
    return false;
  }
  const soldAt = asIsoDate(input.soldAt);
  if (!soldAt || soldAt < ANALYTICS_EPOCH) return false;
  const canonicalKey = makeSaleKey(input);

  try {
    await db.prepare(
      `INSERT INTO warplet_sales (
         canonical_key, chain_id, collection_slug, token_id,
         transaction_hash, order_hash, event_id,
         buyer_wallet, seller_wallet, buyer_fid, seller_fid,
         marketplace, price_raw, payment_decimals, payment_symbol,
         payment_address, price_eth, price_usd, sold_at, source,
         raw_payload, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
       ON CONFLICT(canonical_key) DO UPDATE SET
         transaction_hash = COALESCE(excluded.transaction_hash, warplet_sales.transaction_hash),
         order_hash = COALESCE(excluded.order_hash, warplet_sales.order_hash),
         event_id = COALESCE(excluded.event_id, warplet_sales.event_id),
         buyer_wallet = CASE
           WHEN excluded.source LIKE 'dune:%' AND warplet_sales.source NOT LIKE 'dune:%'
             THEN COALESCE(warplet_sales.buyer_wallet, excluded.buyer_wallet)
           ELSE COALESCE(excluded.buyer_wallet, warplet_sales.buyer_wallet)
         END,
         seller_wallet = CASE
           WHEN excluded.source LIKE 'dune:%' AND warplet_sales.source NOT LIKE 'dune:%'
             THEN COALESCE(warplet_sales.seller_wallet, excluded.seller_wallet)
           ELSE COALESCE(excluded.seller_wallet, warplet_sales.seller_wallet)
         END,
         buyer_fid = COALESCE(excluded.buyer_fid, warplet_sales.buyer_fid),
         seller_fid = COALESCE(excluded.seller_fid, warplet_sales.seller_fid),
         marketplace = CASE
           WHEN excluded.source LIKE 'dune:%' AND warplet_sales.source NOT LIKE 'dune:%'
             THEN COALESCE(warplet_sales.marketplace, excluded.marketplace)
           ELSE COALESCE(excluded.marketplace, warplet_sales.marketplace)
         END,
         price_raw = CASE
           WHEN excluded.source LIKE 'dune:%' AND warplet_sales.source NOT LIKE 'dune:%'
             THEN COALESCE(warplet_sales.price_raw, excluded.price_raw)
           ELSE COALESCE(excluded.price_raw, warplet_sales.price_raw)
         END,
         payment_decimals = CASE
           WHEN excluded.source LIKE 'dune:%' AND warplet_sales.source NOT LIKE 'dune:%'
             THEN COALESCE(warplet_sales.payment_decimals, excluded.payment_decimals)
           ELSE COALESCE(excluded.payment_decimals, warplet_sales.payment_decimals)
         END,
         payment_symbol = CASE
           WHEN excluded.source LIKE 'dune:%' AND warplet_sales.source NOT LIKE 'dune:%'
             THEN COALESCE(warplet_sales.payment_symbol, excluded.payment_symbol)
           ELSE COALESCE(excluded.payment_symbol, warplet_sales.payment_symbol)
         END,
         payment_address = CASE
           WHEN excluded.source LIKE 'dune:%' AND warplet_sales.source NOT LIKE 'dune:%'
             THEN COALESCE(warplet_sales.payment_address, excluded.payment_address)
           ELSE COALESCE(excluded.payment_address, warplet_sales.payment_address)
         END,
         price_eth = CASE
           WHEN excluded.source LIKE 'dune:%' AND warplet_sales.source NOT LIKE 'dune:%'
             THEN COALESCE(warplet_sales.price_eth, excluded.price_eth)
           ELSE COALESCE(excluded.price_eth, warplet_sales.price_eth)
         END,
         price_usd = CASE
           WHEN excluded.source LIKE 'dune:%' AND warplet_sales.source NOT LIKE 'dune:%'
             THEN COALESCE(warplet_sales.price_usd, excluded.price_usd)
           ELSE COALESCE(excluded.price_usd, warplet_sales.price_usd)
         END,
         sold_at = CASE
           WHEN excluded.source LIKE 'dune:%' AND warplet_sales.source NOT LIKE 'dune:%'
             THEN warplet_sales.sold_at
           ELSE excluded.sold_at
         END,
         source = CASE
           WHEN excluded.source LIKE 'dune:%'
             AND warplet_sales.source NOT LIKE 'dune:%'
             THEN warplet_sales.source
           ELSE excluded.source
         END,
         raw_payload = CASE
           WHEN excluded.source LIKE 'dune:%' AND warplet_sales.source NOT LIKE 'dune:%'
             THEN COALESCE(warplet_sales.raw_payload, excluded.raw_payload)
           ELSE COALESCE(excluded.raw_payload, warplet_sales.raw_payload)
         END,
         updated_at = CURRENT_TIMESTAMP`
    ).bind(
      canonicalKey,
      input.chainId ?? 8453,
      input.collectionSlug ?? STATS_COLLECTION_SLUG,
      input.tokenId,
      nullableText(input.transactionHash)?.toLowerCase() ?? null,
      nullableText(input.orderHash)?.toLowerCase() ?? null,
      nullableText(input.eventId),
      normalizeWallet(input.buyerWallet),
      normalizeWallet(input.sellerWallet),
      input.buyerFid ?? null,
      input.sellerFid ?? null,
      nullableText(input.marketplace),
      asDecimalText(input.priceRaw),
      input.paymentDecimals ?? null,
      nullableText(input.paymentSymbol)?.toUpperCase() ?? null,
      nullableText(input.paymentAddress)?.toLowerCase() ?? null,
      input.priceEth ?? null,
      input.priceUsd ?? null,
      soldAt,
      input.source,
      serializeRaw(input.rawPayload),
    ).run();
    try {
      await db.prepare(
        `INSERT INTO warplet_sale_sources (
           canonical_key, source, external_id, observed_at, raw_payload,
           buyer_wallet, seller_wallet, marketplace, price_eth, price_usd,
           payment_symbol, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
         ON CONFLICT(canonical_key, source) DO UPDATE SET
           external_id = COALESCE(excluded.external_id, warplet_sale_sources.external_id),
           observed_at = excluded.observed_at,
           raw_payload = COALESCE(excluded.raw_payload, warplet_sale_sources.raw_payload),
           buyer_wallet = COALESCE(excluded.buyer_wallet, warplet_sale_sources.buyer_wallet),
           seller_wallet = COALESCE(excluded.seller_wallet, warplet_sale_sources.seller_wallet),
           marketplace = COALESCE(excluded.marketplace, warplet_sale_sources.marketplace),
           price_eth = COALESCE(excluded.price_eth, warplet_sale_sources.price_eth),
           price_usd = COALESCE(excluded.price_usd, warplet_sale_sources.price_usd),
           payment_symbol = COALESCE(
             excluded.payment_symbol,
             warplet_sale_sources.payment_symbol
           ),
           updated_at = CURRENT_TIMESTAMP`
      ).bind(
        canonicalKey,
        input.source,
        nullableText(input.eventId),
        soldAt,
        serializeRaw(input.rawPayload),
        normalizeWallet(input.buyerWallet),
        normalizeWallet(input.sellerWallet),
        nullableText(input.marketplace),
        input.priceEth ?? null,
        input.priceUsd ?? null,
        nullableText(input.paymentSymbol)?.toUpperCase() ?? null,
      ).run();
    } catch {
      // Provenance storage is optional until the Dune migration is applied.
    }
    return true;
  } catch {
    return false;
  }
}

const HOLDER_SOURCE_CTE = `
  owned_tokens AS (
    SELECT
      LOWER(TRIM(m.owner_wallet)) AS wallet,
      m.token_id,
      -- x10_rarity is the collection's 1..10,000 rarity ordinal. x10_rank is
      -- the underlying score and is not suitable for a displayed "Best #N".
      COALESCE(md.x10_rarity, m.token_id) AS rarity_rank,
      m.updated_at
    FROM warplet_market_state m
    LEFT JOIN warplets_metadata md ON md.token_id = m.token_id
    WHERE m.owner_wallet IS NOT NULL
      AND TRIM(m.owner_wallet) <> ''
      AND LOWER(TRIM(m.owner_wallet)) <> '${ZERO_ADDRESS}'
  ),
  owner_tokens_ranked AS (
    SELECT
      wallet,
      token_id,
      rarity_rank,
      updated_at,
      ROW_NUMBER() OVER (
        PARTITION BY wallet
        ORDER BY rarity_rank ASC, token_id ASC
      ) AS token_position
    FROM owned_tokens
  ),
  holder_source AS (
    SELECT
      wallet,
      COUNT(*) AS owned_count,
      MIN(rarity_rank) AS best_rarity_rank,
      MAX(CASE WHEN token_position = 1 THEN token_id END) AS best_token_id,
      MAX(updated_at) AS updated_at,
      json_array(
        MAX(CASE WHEN token_position = 1 THEN token_id END),
        MAX(CASE WHEN token_position = 2 THEN token_id END),
        MAX(CASE WHEN token_position = 3 THEN token_id END),
        MAX(CASE WHEN token_position = 4 THEN token_id END),
        MAX(CASE WHEN token_position = 5 THEN token_id END)
      ) AS preview_token_ids_json
    FROM owner_tokens_ranked
    GROUP BY wallet
  )`;

function parsePreviewTokenIds(value: unknown): number[] {
  if (typeof value !== "string") return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((tokenId) => asInteger(tokenId))
      .filter((tokenId): tokenId is number =>
        tokenId !== null && tokenId >= 1 && tokenId <= WARPLETS_TOTAL_SUPPLY)
      .slice(0, 5);
  } catch {
    return [];
  }
}

export async function rebuildHolderLeaderboard(
  db: D1Database,
): Promise<{ rebuilt: boolean; holderCount: number; reason?: string }> {
  if (!(await tableExists(db, "holder_leaderboard"))) {
    return { rebuilt: false, holderCount: 0, reason: "holder_leaderboard_missing" };
  }

  try {
    await db.batch([
      db.prepare("DELETE FROM holder_leaderboard"),
      db.prepare(
        `INSERT INTO holder_leaderboard (
           wallet, owned_count, best_rarity_rank, best_token_id,
           preview_token_ids_json, updated_at
         )
         WITH ${HOLDER_SOURCE_CTE}
         SELECT
           wallet,
           owned_count,
           best_rarity_rank,
           best_token_id,
           preview_token_ids_json,
           CURRENT_TIMESTAMP
         FROM holder_source`
      ),
    ]);
    const row = await db.prepare("SELECT COUNT(*) AS count FROM holder_leaderboard")
      .first<{ count: number }>();
    return { rebuilt: true, holderCount: row?.count ?? 0 };
  } catch (error) {
    return {
      rebuilt: false,
      holderCount: 0,
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function refreshHolderLeaderboardWallets(
  db: D1Database,
  wallets: Iterable<string | null | undefined>,
): Promise<{ updated: number; removed: number; skipped: boolean }> {
  if (!(await tableExists(db, "holder_leaderboard"))) {
    return { updated: 0, removed: 0, skipped: true };
  }

  const normalized = [...new Set(
    [...wallets].map(normalizeWallet).filter((wallet): wallet is string => wallet !== null),
  )];
  if (normalized.length === 0) return { updated: 0, removed: 0, skipped: false };

  let updated = 0;
  let removed = 0;
  try {
    for (const wallet of normalized) {
      const result = await db.prepare(
        `SELECT
           m.token_id,
           COALESCE(md.x10_rarity, m.token_id) AS rarity_rank
         FROM warplet_market_state m
         LEFT JOIN warplets_metadata md ON md.token_id = m.token_id
         WHERE LOWER(TRIM(m.owner_wallet)) = ?
         ORDER BY rarity_rank ASC, m.token_id ASC`
      ).bind(wallet).all<{ token_id: number; rarity_rank: number }>();
      const tokens = result.results ?? [];
      if (tokens.length === 0) {
        await db.prepare("DELETE FROM holder_leaderboard WHERE wallet = ?").bind(wallet).run();
        removed += 1;
        continue;
      }

      const preview = tokens.slice(0, 5).map((row) => row.token_id);
      const best = tokens[0];
      await db.prepare(
        `INSERT INTO holder_leaderboard (
           wallet, owned_count, best_rarity_rank, best_token_id,
           preview_token_ids_json, updated_at
         ) VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
         ON CONFLICT(wallet) DO UPDATE SET
           owned_count = excluded.owned_count,
           best_rarity_rank = excluded.best_rarity_rank,
           best_token_id = excluded.best_token_id,
           preview_token_ids_json = excluded.preview_token_ids_json,
           updated_at = CURRENT_TIMESTAMP`
      ).bind(
        wallet,
        tokens.length,
        best.rarity_rank,
        best.token_id,
        JSON.stringify(preview),
      ).run();
      updated += 1;
    }
    return { updated, removed, skipped: false };
  } catch {
    return { updated, removed, skipped: true };
  }
}

async function ensureHolderLeaderboard(db: D1Database): Promise<boolean> {
  if (!(await tableExists(db, "holder_leaderboard"))) return false;
  try {
    const row = await db.prepare("SELECT 1 AS ready FROM holder_leaderboard LIMIT 1").first<{ ready: number }>();
    return row?.ready === 1;
  } catch {
    return false;
  }
}

function holderCte(materialized: boolean): string {
  return materialized
    ? `holder_source AS (
         SELECT
           wallet, owned_count, best_rarity_rank, best_token_id,
           preview_token_ids_json, updated_at
         FROM holder_leaderboard
       )`
    : HOLDER_SOURCE_CTE;
}

async function loadProfilesForWallets(
  db: D1Database,
  wallets: Iterable<string | null>,
): Promise<Map<string, Profile>> {
  const normalized = [...new Set(
    [...wallets].map(normalizeWallet).filter((wallet): wallet is string => wallet !== null),
  )];
  if (normalized.length === 0 || !(await tableExists(db, "wallet_farcaster_links"))) {
    return new Map();
  }

  try {
    const result = await db.prepare(
      `WITH ranked_profiles AS (
         SELECT
           LOWER(wallet) AS wallet,
           fid,
           username,
           display_name,
           pfp_url,
           x_username,
           score,
           ROW_NUMBER() OVER (
             PARTITION BY LOWER(wallet)
             ORDER BY COALESCE(score, -1) DESC, fid ASC
           ) AS profile_rank
         FROM wallet_farcaster_links
         WHERE LOWER(wallet) IN (
           SELECT LOWER(CAST(value AS TEXT))
           FROM json_each(?)
         )
       )
       SELECT wallet, fid, username, display_name, pfp_url, x_username, score
       FROM ranked_profiles
       WHERE profile_rank = 1`
    ).bind(JSON.stringify(normalized)).all<{
      wallet: string;
      fid: number | null;
      username: string | null;
      display_name: string | null;
      pfp_url: string | null;
      x_username: string | null;
      score: number | null;
    }>();

    return new Map((result.results ?? []).map((row) => [
      row.wallet,
      {
        wallet: row.wallet,
        fid: row.fid,
        username: row.username,
        displayName: row.display_name,
        pfpUrl: row.pfp_url,
        xUsername: row.x_username,
        score: row.score,
      },
    ]));
  } catch {
    return new Map();
  }
}

function decodeHolderCursor(raw: string | null): HolderCursor | null {
  if (!raw) return null;
  try {
    const normalized = raw.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
    const parsed = JSON.parse(atob(padded)) as Record<string, unknown>;
    const rank = asInteger(parsed.rank);
    const ownedCount = asInteger(parsed.ownedCount);
    const bestRarityRank = asInteger(parsed.bestRarityRank);
    const wallet = normalizeWallet(parsed.wallet);
    return rank !== null && rank >= 0 &&
      ownedCount !== null && ownedCount > 0 &&
      bestRarityRank !== null && wallet
      ? { rank, ownedCount, bestRarityRank, wallet }
      : null;
  } catch {
    return null;
  }
}

function encodeHolderCursor(row: HolderCursor): string {
  const base64 = btoa(JSON.stringify(row));
  return base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

async function loadHolderBaseRows(
  db: D1Database,
  limit: number,
  cursor: HolderCursor | null,
  materializedOverride?: boolean,
): Promise<{ rows: HolderBaseRow[]; materialized: boolean }> {
  const materialized = materializedOverride ?? await ensureHolderLeaderboard(db);
  const cursorSql = cursor
    ? `WHERE (
         owned_count < ?
         OR (owned_count = ? AND best_rarity_rank > ?)
         OR (owned_count = ? AND best_rarity_rank = ? AND wallet > ?)
       )`
    : "";
  const bindings = cursor
    ? [
      cursor.ownedCount,
      cursor.ownedCount,
      cursor.bestRarityRank,
      cursor.ownedCount,
      cursor.bestRarityRank,
      cursor.wallet,
      limit,
    ]
    : [limit];

  const result = await db.prepare(
    `WITH ${holderCte(materialized)}
     SELECT
       wallet,
       owned_count,
       best_rarity_rank,
       best_token_id,
       preview_token_ids_json,
       updated_at
     FROM holder_source
     ${cursorSql}
     ORDER BY owned_count DESC, best_rarity_rank ASC, wallet ASC
     LIMIT ?`
  ).bind(...bindings).all<{
    wallet: string;
    owned_count: number;
    best_rarity_rank: number;
    best_token_id: number;
    preview_token_ids_json: string;
    updated_at: string | null;
  }>();

  return {
    materialized,
    rows: (result.results ?? []).map((row, index) => ({
      rank: (cursor?.rank ?? 0) + index + 1,
      wallet: row.wallet,
      ownedCount: row.owned_count,
      bestRarityRank: row.best_rarity_rank,
      bestTokenId: row.best_token_id,
      previewTokenIds: parsePreviewTokenIds(row.preview_token_ids_json),
      updatedAt: row.updated_at,
    })),
  };
}

async function loadOneHolder(
  db: D1Database,
  wallet: string,
  materializedOverride?: boolean,
): Promise<{ row: HolderBaseRow | null; materialized: boolean; totalHolders: number }> {
  const materialized = materializedOverride ?? await ensureHolderLeaderboard(db);
  const result = await db.prepare(
    `WITH ${holderCte(materialized)},
     target_holder AS (
       SELECT *
       FROM holder_source
       WHERE wallet = ?
       LIMIT 1
     )
     SELECT
       target.wallet,
       target.owned_count,
       target.best_rarity_rank,
       target.best_token_id,
       target.preview_token_ids_json,
       target.updated_at,
       1 + (
         SELECT COUNT(*)
         FROM holder_source candidate
         WHERE candidate.owned_count > target.owned_count
            OR (
              candidate.owned_count = target.owned_count
              AND candidate.best_rarity_rank < target.best_rarity_rank
            )
            OR (
              candidate.owned_count = target.owned_count
              AND candidate.best_rarity_rank = target.best_rarity_rank
              AND candidate.wallet < target.wallet
            )
       ) AS absolute_rank,
       (SELECT COUNT(*) FROM holder_source) AS total_holders
     FROM target_holder target`
  ).bind(wallet).first<{
    absolute_rank: number;
    total_holders: number;
    wallet: string;
    owned_count: number;
    best_rarity_rank: number;
    best_token_id: number;
    preview_token_ids_json: string;
    updated_at: string | null;
  }>();

  if (!result) {
    const count = await db.prepare(
      `WITH ${holderCte(materialized)}
       SELECT COUNT(*) AS count FROM holder_source`
    ).first<{ count: number }>();
    return { row: null, materialized, totalHolders: count?.count ?? 0 };
  }

  return {
    materialized,
    totalHolders: result.total_holders,
    row: {
      rank: result.absolute_rank,
      wallet: result.wallet,
      ownedCount: result.owned_count,
      bestRarityRank: result.best_rarity_rank,
      bestTokenId: result.best_token_id,
      previewTokenIds: parsePreviewTokenIds(result.preview_token_ids_json),
      updatedAt: result.updated_at,
    },
  };
}

async function loadCurrentMarket(db: D1Database): Promise<MarketCurrent> {
  const [metadata, state, collection] = await Promise.all([
    db.prepare("SELECT COUNT(*) AS count FROM warplets_metadata")
      .first<{ count: number }>()
      .catch(() => null),
    db.prepare(
      `SELECT
         COUNT(CASE WHEN listing_eth IS NOT NULL THEN 1 END) AS listed_count,
         COUNT(DISTINCT CASE
           WHEN owner_wallet IS NOT NULL
            AND TRIM(owner_wallet) <> ''
            AND LOWER(TRIM(owner_wallet)) <> ?
           THEN LOWER(TRIM(owner_wallet))
         END) AS owner_count,
         MAX(owner_checked_at) AS ownership_updated_at,
         MAX(updated_at) AS updated_at
       FROM warplet_market_state`
    ).bind(ZERO_ADDRESS).first<{
      listed_count: number;
      owner_count: number;
      ownership_updated_at: string | null;
      updated_at: string | null;
    }>().catch(() => null),
    db.prepare(
      `SELECT
         floor_eth,
         floor_updated_at,
         top_offer_eth,
         top_offer_currency_symbol,
         COALESCE(top_offer_updated_at, top_offer_created_at) AS top_offer_at,
         updated_at
       FROM opensea_collection_market_state
       WHERE collection_slug = ?
       LIMIT 1`
    ).bind(STATS_COLLECTION_SLUG).first<{
      floor_eth: number | null;
      floor_updated_at: string | null;
      top_offer_eth: number | null;
      top_offer_currency_symbol: string | null;
      top_offer_at: string | null;
      updated_at: string | null;
    }>().catch(() => null),
  ]);

  const times = [
    state?.updated_at,
    collection?.updated_at,
    collection?.floor_updated_at,
    collection?.top_offer_at,
  ]
    .filter((value): value is string => Boolean(value))
    .sort((left, right) => sortableTimestamp(left) - sortableTimestamp(right));

  return {
    itemCount: metadata?.count || WARPLETS_TOTAL_SUPPLY,
    floorEth: collection?.floor_eth ?? null,
    floorAt: collection?.floor_updated_at ?? collection?.updated_at ?? null,
    topOfferEth: collection?.top_offer_eth ?? null,
    topOfferSymbol: collection?.top_offer_currency_symbol ?? "WETH",
    topOfferAt: collection?.top_offer_at ?? collection?.updated_at ?? null,
    listedCount: state?.listed_count ?? 0,
    ownerCount: state?.owner_count ?? 0,
    marketUpdatedAt: times.at(-1) ?? null,
    ownershipUpdatedAt: state?.ownership_updated_at ?? null,
  };
}

async function loadBaseline(db: D1Database): Promise<BaselineRow | null> {
  if (!(await tableExists(db, "analytics_metric_baselines"))) return null;
  try {
    return await db.prepare(
      `SELECT
         analytics_epoch,
         opensea_total_sales,
         opensea_total_volume_text,
         verified_at
       FROM analytics_metric_baselines
       WHERE collection_slug = ? AND analytics_epoch = ?
       ORDER BY CASE WHEN verified_at IS NULL THEN 1 ELSE 0 END, version DESC
       LIMIT 1`
    ).bind(STATS_COLLECTION_SLUG, ANALYTICS_EPOCH).first<BaselineRow>();
  } catch {
    return null;
  }
}

async function loadLatestStatsSnapshot(db: D1Database): Promise<StatsSnapshotRow | null> {
  if (!(await tableExists(db, "opensea_stats_snapshots"))) return null;
  try {
    return await db.prepare(
      `SELECT
         captured_at, updated_at, total_sales, total_volume_text,
         one_day_sales, one_day_volume_text,
         seven_day_sales, seven_day_volume_text,
         thirty_day_sales, thirty_day_volume_text,
         floor_eth, owners_count, listed_count,
         (
           SELECT stale
           FROM analytics_ingest_state
           WHERE source_key = 'opensea:collection_stats'
           LIMIT 1
         ) AS ingest_stale
       FROM opensea_stats_snapshots
       WHERE collection_slug = ?
       ORDER BY captured_at DESC
       LIMIT 1`
    ).bind(STATS_COLLECTION_SLUG).first<StatsSnapshotRow>();
  } catch {
    return null;
  }
}

async function loadStatsSnapshotNear(
  db: D1Database,
  target: string,
): Promise<StatsSnapshotRow | null> {
  if (!(await tableExists(db, "opensea_stats_snapshots"))) return null;
  try {
    return await db.prepare(
      `SELECT
         captured_at, updated_at, total_sales, total_volume_text,
         one_day_sales, one_day_volume_text,
         seven_day_sales, seven_day_volume_text,
         thirty_day_sales, thirty_day_volume_text,
         floor_eth, owners_count, listed_count
       FROM opensea_stats_snapshots
       WHERE collection_slug = ? AND captured_at <= ?
       ORDER BY captured_at DESC
       LIMIT 1`
    ).bind(STATS_COLLECTION_SLUG, target).first<StatsSnapshotRow>();
  } catch {
    return null;
  }
}

type ParsedDecimal = { integer: bigint; scale: number };

function parseDecimal(value: string | null): ParsedDecimal | null {
  if (!value || !/^\d+(?:\.\d+)?$/.test(value)) return null;
  const [whole, fraction = ""] = value.split(".");
  try {
    return {
      integer: BigInt(`${whole}${fraction}`),
      scale: fraction.length,
    };
  } catch {
    return null;
  }
}

function decimalDifference(
  currentValue: string | null,
  baselineValue: string | null,
): { text: string; value: number } | null {
  const current = parseDecimal(currentValue);
  const baseline = parseDecimal(baselineValue);
  if (!current || !baseline) return null;
  const scale = Math.max(current.scale, baseline.scale);
  const currentInteger = current.integer * 10n ** BigInt(scale - current.scale);
  const baselineInteger = baseline.integer * 10n ** BigInt(scale - baseline.scale);
  const difference = currentInteger - baselineInteger;
  if (difference < 0n) return null;
  const digits = difference.toString().padStart(scale + 1, "0");
  const text = scale === 0
    ? digits
    : `${digits.slice(0, -scale)}.${digits.slice(-scale)}`.replace(/(?:\.0+|(\.\d*?)0+)$/, "$1");
  return { text, value: Number(text) };
}

function weiToEth(raw: string | null, decimals = 18): number | null {
  if (!raw || !/^\d+$/.test(raw) || decimals < 0 || decimals > 36) return null;
  try {
    const padded = raw.padStart(decimals + 1, "0");
    const text = decimals === 0
      ? padded
      : `${padded.slice(0, -decimals)}.${padded.slice(-decimals)}`;
    const value = Number(text);
    return Number.isFinite(value) ? value : null;
  } catch {
    return null;
  }
}

async function hasCompleteSalesCoverage(
  db: D1Database,
  start: string,
  end: string,
): Promise<boolean> {
  if (!(await tableExists(db, "analytics_ingest_state"))) return false;
  try {
    // Neither OpenSea nor Dune promises zero indexing lag. Requiring coverage
    // through the exact request timestamp would make an otherwise complete
    // backfill become incomplete again a few milliseconds later.
    const requestedEnd = Date.parse(end);
    const laggedEnd = Number.isFinite(requestedEnd)
      ? new Date(Math.max(Date.parse(start), requestedEnd - 6 * 3_600_000)).toISOString()
      : end;
    const state = await db.prepare(
      `SELECT coverage_start, coverage_end
       FROM analytics_ingest_state
       WHERE source_key IN (
         'sales:post_reset_backfill',
         'opensea:sales_backfill',
         'dune:trades'
       )
         AND complete = 1
         AND stale = 0
         AND coverage_start IS NOT NULL
         AND coverage_start <= ?
         AND coverage_end IS NOT NULL
         AND coverage_end >= ?
       ORDER BY coverage_start ASC
       LIMIT 1`
    ).bind(start, laggedEnd).first<{ coverage_start: string; coverage_end: string | null }>();
    return Boolean(state);
  } catch {
    return false;
  }
}

async function loadSales(
  db: D1Database,
  start: string,
  tokenId?: number,
): Promise<{ rows: SaleRow[]; source: string; complete: boolean; coverageStart: string }> {
  const requestedEnd = new Date().toISOString();
  const tokenWhere = tokenId ? " AND token_id = ?" : "";
  const bindings = tokenId ? [STATS_COLLECTION_SLUG, start, tokenId] : [STATS_COLLECTION_SLUG, start];

  if (await tableExists(db, "warplet_sales")) {
    try {
      const result = await db.prepare(
        `SELECT
           canonical_key, token_id, transaction_hash, order_hash,
           buyer_wallet, seller_wallet, buyer_fid, seller_fid,
           marketplace, price_eth, price_usd, payment_symbol, sold_at, source
         FROM warplet_sales
         WHERE collection_slug = ? AND sold_at >= ?${tokenWhere}
         ORDER BY sold_at ASC, token_id ASC
         LIMIT ${SALES_LIMIT}`
      ).bind(...bindings).all<{
        canonical_key: string;
        token_id: number;
        transaction_hash: string | null;
        order_hash: string | null;
        buyer_wallet: string | null;
        seller_wallet: string | null;
        buyer_fid: number | null;
        seller_fid: number | null;
        marketplace: string | null;
        price_eth: number | null;
        price_usd: number | null;
        payment_symbol: string | null;
        sold_at: string;
        source: string;
      }>();
      const rows = (result.results ?? []).map((row) => ({
        key: row.canonical_key,
        tokenId: row.token_id,
        transactionHash: row.transaction_hash,
        orderHash: row.order_hash,
        buyerWallet: normalizeWallet(row.buyer_wallet),
        sellerWallet: normalizeWallet(row.seller_wallet),
        buyerFid: row.buyer_fid,
        sellerFid: row.seller_fid,
        marketplace: row.marketplace,
        priceEth: row.price_eth,
        priceUsd: row.price_usd,
        paymentSymbol: row.payment_symbol,
        soldAt: row.sold_at,
        source: row.source,
      }));
      const coverageComplete = await hasCompleteSalesCoverage(db, start, requestedEnd);
      if (rows.length > 0 || coverageComplete) {
        const hasDuneRows = rows.some((row) => row.source.toLowerCase().startsWith("dune:"));
        return {
          rows,
          source: hasDuneRows ? "dune_onchain_sales" : "normalized_sales",
          complete: coverageComplete && rows.length < SALES_LIMIT,
          coverageStart: coverageComplete ? start : rows[0]?.soldAt ?? start,
        };
      }
    } catch {
      // Continue to legacy/fallback sources while the migration or backfill catches up.
    }
  }

  if (await tableExists(db, "warplet_activity_events")) {
    try {
      const activityTokenWhere = tokenId ? " AND token_id = ?" : "";
      const activityBindings = tokenId ? [start, tokenId] : [start];
      const result = await db.prepare(
        `SELECT
           id, token_id, actor_wallet, actor_fid,
           counterparty_wallet, counterparty_fid,
           transaction_hash, order_hash, amount_eth,
           currency_symbol, source, occurred_at
         FROM warplet_activity_events
         WHERE event_type = 'sold'
           AND occurred_at >= ?${activityTokenWhere}
         ORDER BY occurred_at ASC, id ASC
         LIMIT ${SALES_LIMIT}`
      ).bind(...activityBindings).all<{
        id: number;
        token_id: number;
        actor_wallet: string | null;
        actor_fid: number | null;
        counterparty_wallet: string | null;
        counterparty_fid: number | null;
        transaction_hash: string | null;
        order_hash: string | null;
        amount_eth: number | null;
        currency_symbol: string | null;
        source: string;
        occurred_at: string;
      }>();
      const seen = new Set<string>();
      const rows = (result.results ?? []).flatMap((row): SaleRow[] => {
        const key = `${row.transaction_hash ?? row.order_hash ?? `activity-${row.id}`}:${row.token_id}`;
        if (seen.has(key)) return [];
        seen.add(key);
        return [{
          key,
          tokenId: row.token_id,
          transactionHash: row.transaction_hash,
          orderHash: row.order_hash,
          buyerWallet: normalizeWallet(row.counterparty_wallet),
          sellerWallet: normalizeWallet(row.actor_wallet),
          buyerFid: row.counterparty_fid,
          sellerFid: row.actor_fid,
          marketplace: row.source || "opensea",
          priceEth: row.amount_eth,
          priceUsd: null,
          paymentSymbol: row.currency_symbol ?? "ETH",
          soldAt: row.occurred_at,
          source: "warplet_activity_events",
        }];
      });
      if (rows.length > 0) {
        return {
          rows,
          source: "warplet_activity_events",
          complete: false,
          coverageStart: rows[0]?.soldAt ?? start,
        };
      }
    } catch {
      // Continue to older fallbacks.
    }
  }

  if (await tableExists(db, "opensea")) {
    try {
      const legacyTokenWhere = tokenId ? " AND CAST(token_id AS INTEGER) = ?" : "";
      const legacyBindings = tokenId ? [start, tokenId] : [start];
      const result = await db.prepare(
        `SELECT
           id, token_id, wallet_from, wallet_to, transaction_hash,
           sale_price_wei, payment_token, event_timestamp
         FROM opensea
         WHERE LOWER(event_type) IN ('sale', 'sold', 'successful')
           AND event_timestamp >= ?
           AND UPPER(COALESCE(payment_token, 'ETH')) IN ('ETH', 'WETH')${legacyTokenWhere}
         ORDER BY event_timestamp ASC, id ASC
         LIMIT ${SALES_LIMIT}`
      ).bind(...legacyBindings).all<{
        id: number;
        token_id: string | null;
        wallet_from: string | null;
        wallet_to: string | null;
        transaction_hash: string | null;
        sale_price_wei: string | null;
        payment_token: string | null;
        event_timestamp: string;
      }>();
      const seen = new Set<string>();
      const rows = (result.results ?? []).flatMap((row): SaleRow[] => {
        const parsedTokenId = asInteger(row.token_id);
        if (!parsedTokenId) return [];
        const key = `${row.transaction_hash ?? `legacy-${row.id}`}:${parsedTokenId}`;
        if (seen.has(key)) return [];
        seen.add(key);
        return [{
          key,
          tokenId: parsedTokenId,
          transactionHash: row.transaction_hash,
          orderHash: null,
          buyerWallet: normalizeWallet(row.wallet_to),
          sellerWallet: normalizeWallet(row.wallet_from),
          buyerFid: null,
          sellerFid: null,
          marketplace: "opensea",
          priceEth: weiToEth(row.sale_price_wei),
          priceUsd: null,
          paymentSymbol: row.payment_token ?? "ETH",
          soldAt: row.event_timestamp,
          source: "legacy_opensea",
        }];
      });
      if (rows.length > 0) {
        return {
          rows,
          source: "legacy_opensea",
          complete: false,
          coverageStart: rows[0]?.soldAt ?? start,
        };
      }
    } catch {
      // Continue to the latest-per-token market-state fallback.
    }
  }

  try {
    const fallbackTokenWhere = tokenId ? " AND token_id = ?" : "";
    const fallbackBindings = tokenId ? [start, tokenId] : [start];
    const result = await db.prepare(
      `SELECT
         token_id, sale_tx_hash, owner_wallet, owner_fid, seller_wallet,
         sale_eth, sale_currency_symbol, sold_at
       FROM warplet_market_state
       WHERE sold_at >= ? AND sale_eth IS NOT NULL${fallbackTokenWhere}
       ORDER BY sold_at ASC, token_id ASC
       LIMIT ${SALES_LIMIT}`
    ).bind(...fallbackBindings).all<{
      token_id: number;
      sale_tx_hash: string | null;
      owner_wallet: string | null;
      owner_fid: number | null;
      seller_wallet: string | null;
      sale_eth: number | null;
      sale_currency_symbol: string | null;
      sold_at: string;
    }>();
    const rows = (result.results ?? []).map((row): SaleRow => ({
      key: `${row.sale_tx_hash ?? row.sold_at}:${row.token_id}`,
      tokenId: row.token_id,
      transactionHash: row.sale_tx_hash,
      orderHash: null,
      buyerWallet: normalizeWallet(row.owner_wallet),
      sellerWallet: normalizeWallet(row.seller_wallet),
      buyerFid: row.owner_fid,
      sellerFid: null,
      marketplace: "opensea",
      priceEth: row.sale_eth,
      priceUsd: null,
      paymentSymbol: row.sale_currency_symbol ?? "ETH",
      soldAt: row.sold_at,
      source: "market_state_latest",
    }));
    return {
      rows,
      source: "market_state_latest",
      complete: false,
      coverageStart: rows[0]?.soldAt ?? start,
    };
  } catch {
    return { rows: [], source: "unavailable", complete: false, coverageStart: start };
  }
}

function summarizeSales(rows: SaleRow[]): {
  sales: number;
  volumeEth: number;
  medianEth: number | null;
  uniqueBuyers: number;
  uniqueSellers: number;
  repeatBuyers: number;
} {
  const priced = rows
    .map((row) => row.priceEth)
    .filter((price): price is number => price !== null && Number.isFinite(price) && price >= 0)
    .sort((a, b) => a - b);
  const buyers = new Map<string, number>();
  const sellers = new Set<string>();
  for (const row of rows) {
    if (row.buyerWallet) buyers.set(row.buyerWallet, (buyers.get(row.buyerWallet) ?? 0) + 1);
    if (row.sellerWallet) sellers.add(row.sellerWallet);
  }
  const median = priced.length === 0
    ? null
    : priced.length % 2 === 1
      ? priced[(priced.length - 1) / 2] ?? null
      : ((priced[priced.length / 2 - 1] ?? 0) + (priced[priced.length / 2] ?? 0)) / 2;
  return {
    sales: rows.length,
    volumeEth: priced.reduce((sum, price) => sum + price, 0),
    medianEth: median,
    uniqueBuyers: buyers.size,
    uniqueSellers: sellers.size,
    repeatBuyers: [...buyers.values()].filter((count) => count > 1).length,
  };
}

async function loadMarketActivityMix(
  db: D1Database,
  start: string,
): Promise<{
  list: { count: number; valueEth: number };
  offer: { count: number; valueEth: number };
  sale: { count: number; valueEth: number };
}> {
  const empty = {
    list: { count: 0, valueEth: 0 },
    offer: { count: 0, valueEth: 0 },
    sale: { count: 0, valueEth: 0 },
  };
  if (!(await tableExists(db, "warplet_activity_events"))) return empty;
  try {
    const result = await db.prepare(
      `SELECT
         CASE
           WHEN LOWER(event_type) IN ('listed', 'listing') THEN 'list'
           WHEN LOWER(event_type) IN ('offered', 'offer', 'collection_top_offer', 'trait_top_offer') THEN 'offer'
           WHEN LOWER(event_type) IN ('sale', 'sold') THEN 'sale'
         END AS activity_kind,
         COUNT(*) AS activity_count,
         COALESCE(SUM(amount_eth), 0) AS value_eth
       FROM warplet_activity_events
       WHERE occurred_at >= ?
         AND LOWER(event_type) IN (
           'listed', 'listing',
           'offered', 'offer', 'collection_top_offer', 'trait_top_offer',
           'sale', 'sold'
         )
       GROUP BY activity_kind`
    ).bind(start).all<{
      activity_kind: "list" | "offer" | "sale";
      activity_count: number;
      value_eth: number;
    }>();
    for (const row of result.results ?? []) {
      if (!row.activity_kind || !(row.activity_kind in empty)) continue;
      empty[row.activity_kind] = {
        count: Math.max(0, Number(row.activity_count) || 0),
        valueEth: Math.max(0, Number(row.value_eth) || 0),
      };
    }
    return empty;
  } catch {
    return empty;
  }
}

type HolderSummary = {
  holderCount: number;
  tokenCount: number;
  exactlyOneWallets: number;
  multipleWallets: number;
  largestHolding: number;
  top10Percentage: number;
  top100Percentage: number;
  cohortSize: number | null;
  currentCohortOwners: number | null;
  cohortRetentionPercentage: number | null;
  materialized: boolean;
  updatedAt: string | null;
};

async function loadHolderSummary(
  db: D1Database,
  materializedOverride?: boolean,
): Promise<HolderSummary> {
  const materialized = materializedOverride ?? await ensureHolderLeaderboard(db);
  const cte = holderCte(materialized);
  const [summary, concentration] = await Promise.all([
    db.prepare(
      `WITH ${cte}
       SELECT
         COUNT(*) AS holder_count,
         COALESCE(SUM(owned_count), 0) AS token_count,
         COALESCE(SUM(CASE WHEN owned_count = 1 THEN 1 ELSE 0 END), 0) AS exactly_one,
         COALESCE(SUM(CASE WHEN owned_count > 1 THEN 1 ELSE 0 END), 0) AS multiple,
         COALESCE(MAX(owned_count), 0) AS largest,
         MAX(updated_at) AS updated_at
       FROM holder_source`
    ).first<{
      holder_count: number;
      token_count: number;
      exactly_one: number;
      multiple: number;
      largest: number;
      updated_at: string | null;
    }>(),
    db.prepare(
      `WITH ${cte},
       top_holders AS (
         SELECT owned_count
         FROM holder_source
         ORDER BY owned_count DESC, best_rarity_rank ASC, wallet ASC
         LIMIT 100
       )
       SELECT
         COALESCE((
           SELECT SUM(owned_count)
           FROM (
             SELECT owned_count
             FROM top_holders
             LIMIT 10
           )
         ), 0) AS top_10,
         COALESCE(SUM(owned_count), 0) AS top_100
       FROM top_holders`
    ).first<{ top_10: number; top_100: number }>(),
  ]);

  let cohortSize: number | null = null;
  let currentCohortOwners: number | null = null;
  if (await tableExists(db, "analytics_owner_baseline")) {
    try {
      const cohort = await db.prepare(
        `WITH cohort AS (
           SELECT LOWER(TRIM(owner_wallet)) AS wallet, MAX(owner_fid) AS fid
           FROM analytics_owner_baseline
           GROUP BY LOWER(TRIM(owner_wallet))
         ),
         current_owners AS (
           SELECT LOWER(TRIM(owner_wallet)) AS wallet
           FROM warplet_market_state
           WHERE owner_wallet IS NOT NULL AND TRIM(owner_wallet) <> ''
           GROUP BY LOWER(TRIM(owner_wallet))
         )
         SELECT
           COUNT(*) AS cohort_size,
           SUM(CASE WHEN EXISTS (
           SELECT 1
           FROM current_owners c
             WHERE c.wallet = cohort.wallet
           ) THEN 1 ELSE 0 END) AS retained
         FROM cohort`
      ).first<{ cohort_size: number; retained: number }>();
      if (cohort?.cohort_size) {
        cohortSize = cohort.cohort_size;
        currentCohortOwners = cohort.retained ?? 0;
      }
    } catch {
      cohortSize = null;
      currentCohortOwners = null;
    }
  }

  const tokenCount = summary?.token_count ?? 0;
  return {
    holderCount: summary?.holder_count ?? 0,
    tokenCount,
    exactlyOneWallets: summary?.exactly_one ?? 0,
    multipleWallets: summary?.multiple ?? 0,
    largestHolding: summary?.largest ?? 0,
    top10Percentage: safePercentage(concentration?.top_10 ?? 0, tokenCount || WARPLETS_TOTAL_SUPPLY),
    top100Percentage: safePercentage(concentration?.top_100 ?? 0, tokenCount || WARPLETS_TOTAL_SUPPLY),
    cohortSize,
    currentCohortOwners,
    cohortRetentionPercentage:
      cohortSize && currentCohortOwners !== null
        ? safePercentage(currentCohortOwners, cohortSize)
        : null,
    materialized,
    updatedAt: summary?.updated_at ?? null,
  };
}

async function loadFloorSeries(
  db: D1Database,
  start: string,
): Promise<Array<{ at: string; floorEth: number | null; topOfferEth: number | null }>> {
  if (await tableExists(db, "collection_market_snapshots")) {
    try {
      const result = await db.prepare(
        `SELECT captured_at, floor_eth, top_offer_eth
         FROM collection_market_snapshots
         WHERE collection_slug = ? AND captured_at >= ?
         ORDER BY captured_at ASC
         LIMIT 2000`
      ).bind(STATS_COLLECTION_SLUG, start).all<{
        captured_at: string;
        floor_eth: number | null;
        top_offer_eth: number | null;
      }>();
      if ((result.results ?? []).length > 0) {
        return (result.results ?? []).map((row) => ({
          at: row.captured_at,
          floorEth: row.floor_eth,
          topOfferEth: row.top_offer_eth,
        }));
      }
    } catch {
      // Fall through to collection-stat snapshots.
    }
  }

  if (await tableExists(db, "opensea_stats_snapshots")) {
    try {
      const result = await db.prepare(
        `SELECT captured_at, floor_eth
         FROM opensea_stats_snapshots
         WHERE collection_slug = ? AND captured_at >= ? AND floor_eth IS NOT NULL
         ORDER BY captured_at ASC
         LIMIT 2000`
      ).bind(STATS_COLLECTION_SLUG, start).all<{
        captured_at: string;
        floor_eth: number | null;
      }>();
      return (result.results ?? []).map((row) => ({
        at: row.captured_at,
        floorEth: row.floor_eth,
        topOfferEth: null,
      }));
    } catch {
      return [];
    }
  }
  return [];
}

async function loadDuneMarketEnrichment(
  db: D1Database,
  start: string,
): Promise<{
  transferCount: number | null;
  marketplaceCount: number | null;
  marketplaces: Array<{
    marketplace: string;
    sales: number;
    volumeEth: number;
    volumeUsd: number;
    uniqueBuyers: number;
    uniqueSellers: number;
  }>;
  complete: boolean;
  asOf: string | null;
}> {
  if (
    !(await tableExists(db, "analytics_daily_chain_activity")) ||
    !(await tableExists(db, "warplet_sale_sources"))
  ) {
    return {
      transferCount: null,
      marketplaceCount: null,
      marketplaces: [],
      complete: false,
      asOf: null,
    };
  }
  try {
    const [daily, marketplaceRows, marketplaceTotal, state] = await Promise.all([
      db.prepare(
        `SELECT
           COALESCE(SUM(transfer_count), 0) AS transfer_count
         FROM analytics_daily_chain_activity
         WHERE day >= DATE(?)`
      ).bind(start).first<{ transfer_count: number }>(),
      db.prepare(
        `SELECT
           COALESCE(NULLIF(LOWER(TRIM(ss.marketplace)), ''), 'unknown') AS marketplace,
           COUNT(*) AS sales,
           COALESCE(SUM(ss.price_eth), 0) AS volume_eth,
           COALESCE(SUM(ss.price_usd), 0) AS volume_usd,
           COUNT(DISTINCT ss.buyer_wallet) AS unique_buyers,
           COUNT(DISTINCT ss.seller_wallet) AS unique_sellers
         FROM warplet_sale_sources ss
         WHERE ss.observed_at >= ?
           AND ss.source = 'dune:nft.trades'
         GROUP BY COALESCE(NULLIF(LOWER(TRIM(ss.marketplace)), ''), 'unknown')
         ORDER BY volume_eth DESC, marketplace ASC
         LIMIT 20`
      ).bind(start).all<{
        marketplace: string;
        sales: number;
        volume_eth: number;
        volume_usd: number;
        unique_buyers: number;
        unique_sellers: number;
      }>(),
      db.prepare(
        `SELECT COUNT(DISTINCT COALESCE(
           NULLIF(LOWER(TRIM(marketplace)), ''),
           'unknown'
         )) AS marketplace_count
         FROM warplet_sale_sources
         WHERE observed_at >= ?
           AND source = 'dune:nft.trades'`
      ).bind(start).first<{ marketplace_count: number }>(),
      db.prepare(
        `SELECT
           MAX(CASE WHEN source_key = 'dune:trades' THEN coverage_start END) AS trades_start,
           MAX(CASE WHEN source_key = 'dune:trades' THEN coverage_end END) AS trades_end,
           MAX(CASE WHEN source_key = 'dune:transfers' THEN coverage_start END) AS transfers_start,
           MAX(CASE WHEN source_key = 'dune:transfers' THEN coverage_end END) AS transfers_end,
           MAX(last_success_at) AS last_success_at,
           MAX(stale) AS stale,
           MAX(CASE
             WHEN source_key = 'dune:trades' AND complete = 1 AND stale = 0
             THEN 1 ELSE 0
           END) AS trades_complete,
           MAX(CASE
             WHEN source_key = 'dune:transfers' AND complete = 1 AND stale = 0
             THEN 1 ELSE 0
           END) AS transfers_complete
         FROM analytics_ingest_state
         WHERE source_key IN ('dune:trades', 'dune:transfers')`
      ).first<{
        trades_start: string | null;
        trades_end: string | null;
        transfers_start: string | null;
        transfers_end: string | null;
        last_success_at: string | null;
        stale: number | null;
        trades_complete: number;
        transfers_complete: number;
      }>(),
    ]);
    const marketplaces = (marketplaceRows.results ?? []).map((row) => ({
      marketplace: row.marketplace,
      sales: row.sales,
      volumeEth: row.volume_eth,
      volumeUsd: row.volume_usd,
      uniqueBuyers: row.unique_buyers,
      uniqueSellers: row.unique_sellers,
    }));
    const requiredCoverageEnd = new Date(Date.now() - 6 * 3_600_000).toISOString();
    const tradesReady = Boolean(
      state?.trades_complete === 1 &&
      state.trades_start &&
      state.trades_start <= start &&
      state.trades_end &&
      state.trades_end >= requiredCoverageEnd
    );
    const transfersReady = Boolean(
      state?.transfers_complete === 1 &&
      state.transfers_start &&
      state.transfers_start <= start &&
      state.transfers_end &&
      state.transfers_end >= requiredCoverageEnd
    );
    return {
      transferCount: transfersReady ? daily?.transfer_count ?? 0 : null,
      marketplaceCount: tradesReady ? marketplaceTotal?.marketplace_count ?? 0 : null,
      marketplaces: tradesReady ? marketplaces : [],
      complete: tradesReady && transfersReady && state?.stale !== 1,
      asOf: state?.last_success_at ?? null,
    };
  } catch {
    return {
      transferCount: null,
      marketplaceCount: null,
      marketplaces: [],
      complete: false,
      asOf: null,
    };
  }
}

function buildDailySeries(rows: SaleRow[]): Array<{
  date: string;
  sales: number;
  volumeEth: number;
}> {
  const days = new Map<string, { sales: number; volumeEth: number }>();
  for (const row of rows) {
    const date = row.soldAt.slice(0, 10);
    const day = days.get(date) ?? { sales: 0, volumeEth: 0 };
    day.sales += 1;
    day.volumeEth += row.priceEth ?? 0;
    days.set(date, day);
  }
  return [...days.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, values]) => ({ date, ...values }));
}

async function getFloorChange1d(
  db: D1Database,
  currentFloor: number | null,
): Promise<{ value: number | null; source: string; asOf: string | null }> {
  if (currentFloor === null) return { value: null, source: "unavailable", asOf: null };
  const target = new Date(Date.now() - 86_400_000).toISOString();

  if (await tableExists(db, "collection_market_snapshots")) {
    try {
      const row = await db.prepare(
        `SELECT captured_at, floor_eth
         FROM collection_market_snapshots
         WHERE collection_slug = ? AND captured_at <= ? AND floor_eth IS NOT NULL
         ORDER BY captured_at DESC
         LIMIT 1`
      ).bind(STATS_COLLECTION_SLUG, target).first<{
        captured_at: string;
        floor_eth: number;
      }>();
      if (row?.floor_eth && row.floor_eth > 0) {
        return {
          value: ((currentFloor - row.floor_eth) / row.floor_eth) * 100,
          source: "market_snapshots",
          asOf: row.captured_at,
        };
      }
    } catch {
      // Continue to OpenSea stat snapshots.
    }
  }

  const row = await loadStatsSnapshotNear(db, target);
  return row?.floor_eth && row.floor_eth > 0
    ? {
      value: ((currentFloor - row.floor_eth) / row.floor_eth) * 100,
      source: "opensea_stats_snapshots",
      asOf: row.captured_at,
    }
    : { value: null, source: "unavailable", asOf: null };
}

type HeadlineTotals = {
  sales: number;
  volumeEth: number;
  source: string;
  complete: boolean;
  asOf: string | null;
};

async function chooseHeadlineTotals(
  db: D1Database,
  range: StatsRange,
  rangeStart: string,
  latest: StatsSnapshotRow | null,
  baseline: BaselineRow | null,
  observed: ReturnType<typeof summarizeSales>,
): Promise<HeadlineTotals> {
  const intervalIsEntirelyPostReset = (days: number) =>
    Date.now() - days * 86_400_000 >= Date.parse(ANALYTICS_EPOCH);
  if (
    latest &&
    range === "7d" &&
    intervalIsEntirelyPostReset(7) &&
    latest.seven_day_sales !== null &&
    latest.seven_day_volume_text !== null
  ) {
    return {
      sales: latest.seven_day_sales,
      volumeEth: Number(latest.seven_day_volume_text),
      source: "opensea_seven_day",
      complete: true,
      asOf: latest.updated_at,
    };
  }
  if (
    latest &&
    range === "30d" &&
    intervalIsEntirelyPostReset(30) &&
    latest.thirty_day_sales !== null &&
    latest.thirty_day_volume_text !== null
  ) {
    return {
      sales: latest.thirty_day_sales,
      volumeEth: Number(latest.thirty_day_volume_text),
      source: "opensea_thirty_day",
      complete: true,
      asOf: latest.updated_at,
    };
  }
  if (
    latest &&
    range === "all" &&
    baseline?.verified_at &&
    baseline.opensea_total_sales !== null &&
    baseline.opensea_total_volume_text !== null &&
    latest.total_sales !== null
  ) {
    const volume = decimalDifference(latest.total_volume_text, baseline.opensea_total_volume_text);
    const sales = latest.total_sales - baseline.opensea_total_sales;
    if (volume && sales >= 0) {
      return {
        sales,
        volumeEth: volume.value,
        source: "opensea_aggregate_delta",
        complete: true,
        asOf: latest.updated_at,
      };
    }
  }
  if (
    latest &&
    (range === "90d" || range === "1y") &&
    latest.total_sales !== null &&
    latest.total_volume_text !== null
  ) {
    const earlier = await loadStatsSnapshotNear(db, rangeStart);
    if (earlier && earlier.total_sales !== null && earlier.total_volume_text !== null) {
      const volume = decimalDifference(latest.total_volume_text, earlier.total_volume_text);
      const sales = latest.total_sales - earlier.total_sales;
      if (volume && sales >= 0) {
        return {
          sales,
          volumeEth: volume.value,
          source: "opensea_snapshot_delta",
          complete: true,
          asOf: latest.updated_at,
        };
      }
    }
  }

  return {
    sales: observed.sales,
    volumeEth: observed.volumeEth,
    source: "observed_events",
    complete: false,
    asOf: null,
  };
}

function buildMeta(input: {
  range: StatsRange;
  coverageStart: string;
  baseline: BaselineRow | null;
  complete: boolean;
  stale: boolean;
  sources: StatsSource[];
}): StatsMeta {
  const generatedAt = new Date().toISOString();
  const sourceAsOf = input.sources
    .map((source) => source.asOf)
    .filter((value): value is string => Boolean(value))
    .sort((left, right) => sortableTimestamp(left) - sortableTimestamp(right))
    .at(-1);
  return {
    analyticsEpoch: ANALYTICS_EPOCH,
    asOf: sourceAsOf ?? generatedAt,
    generatedAt,
    range: input.range,
    coverageStart: input.coverageStart,
    baselineAsOf: input.baseline?.verified_at ?? null,
    complete: input.complete,
    stale: input.stale,
    sources: input.sources,
  };
}

export async function handleStatsOverviewGet(
  context: EventContext<StatsEnv, string, unknown>,
): Promise<Response> {
  const url = new URL(context.request.url);
  const range = getRange(url);
  const rangeStart = getRangeStart(range);

  try {
    const [current, holders, baseline, latest, sales, dune, socialHolders] = await Promise.all([
      loadCurrentMarket(context.env.WARPLETS),
      loadHolderSummary(context.env.WARPLETS),
      loadBaseline(context.env.WARPLETS),
      loadLatestStatsSnapshot(context.env.WARPLETS),
      loadSales(context.env.WARPLETS, rangeStart),
      loadDuneIntegration(context.env),
      loadSocialHolderCounts(context.env.WARPLETS),
    ]);
    const floorChange = await getFloorChange1d(context.env.WARPLETS, current.floorEth);
    const observed = summarizeSales(sales.rows);
    const headline = await chooseHeadlineTotals(
      context.env.WARPLETS,
      range,
      rangeStart,
      latest,
      baseline,
      observed,
    );
    const headlineAsOf = headline.asOf ?? sales.rows.at(-1)?.soldAt ?? null;
    const last24Rows = rangeStart <= new Date(Date.now() - 86_400_000).toISOString()
      ? sales.rows.filter((sale) => sale.soldAt >= new Date(Date.now() - 86_400_000).toISOString())
      : (await loadSales(
        context.env.WARPLETS,
        new Date(Date.now() - 86_400_000).toISOString(),
      )).rows;
    const last24 = summarizeSales(last24Rows);
    const volume24h = latest?.one_day_volume_text !== null && latest?.one_day_volume_text !== undefined
      ? Number(latest.one_day_volume_text)
      : last24.volumeEth;
    const volume24Source = latest?.one_day_volume_text !== null && latest?.one_day_volume_text !== undefined
      ? "opensea_one_day"
      : "observed_events";
    const volume24AsOf = volume24Source === "opensea_one_day"
      ? latest?.updated_at ?? null
      : last24Rows.at(-1)?.soldAt ?? null;
    const ownersCount = latest?.owners_count ?? current.ownerCount;
    const ownersSource = latest?.owners_count !== null && latest?.owners_count !== undefined
      ? "opensea_stats"
      : "current_ownership";
    const ownershipAsOf = [
      holders.updatedAt,
      current.ownershipUpdatedAt,
    ]
      .filter((value): value is string => Boolean(value))
      .sort((left, right) => sortableTimestamp(left) - sortableTimestamp(right))
      .at(-1) ?? null;
    const supply = current.itemCount || WARPLETS_TOTAL_SUPPLY;
    const complete =
      headline.complete &&
      Boolean(latest) &&
      !latest?.ingest_stale &&
      holders.tokenCount > 0 &&
      floorChange.value !== null;
    const stale =
      Boolean(latest?.ingest_stale) ||
      isStale(latest?.updated_at ?? current.marketUpdatedAt);

    return jsonStats({
      ...buildMeta({
        range,
        coverageStart: sales.coverageStart,
        baseline,
        complete,
        stale,
        sources: [
          {
            id: "current_market",
            label: "OpenSea and current D1 market state",
            complete: Boolean(current.marketUpdatedAt),
            asOf: current.marketUpdatedAt,
          },
          {
            id: headline.source,
            label: headline.source.startsWith("opensea") ? "OpenSea collection analytics" : "Observed sale activity",
            complete: headline.complete,
            asOf: headlineAsOf,
            ...(!headline.complete ? { note: "Verified OpenSea reset baseline or complete history is not available yet." } : {}),
          },
          {
            id: "ownership",
            label: "Current D1 ownership",
            complete: holders.tokenCount >= supply,
            asOf: ownershipAsOf,
          },
          ...(dune.status !== "disabled"
            ? [{
                id: "dune_onchain",
                label: "Dune onchain enrichment",
                complete: dune.status === "live",
                asOf: dune.asOf,
                ...(dune.lastError ? { note: dune.lastError } : {}),
              }]
            : []),
        ],
      }),
      integrations: { dune },
      metrics: {
        items: metric(supply, "items", "local_metadata", supply === WARPLETS_TOTAL_SUPPLY, null),
        floorPrice: metric(current.floorEth, "ETH", "current_market", current.floorEth !== null, current.floorAt),
        floorChange1dPercent: metric(
          floorChange.value,
          "%",
          floorChange.source,
          floorChange.value !== null,
          floorChange.asOf,
        ),
        topOffer: metric(
          current.topOfferEth,
          current.topOfferSymbol ?? "WETH",
          "current_market",
          current.topOfferEth !== null,
          current.topOfferAt,
        ),
        volume24h: metric(
          volume24h,
          "ETH",
          volume24Source,
          volume24Source === "opensea_one_day",
          volume24AsOf,
        ),
        totalVolume: metric(
          headline.volumeEth,
          "ETH",
          headline.source,
          headline.complete,
          headlineAsOf,
          range === "all" ? "Since Jul 2, 2026" : undefined,
        ),
        sales: metric(headline.sales, "sales", headline.source, headline.complete, headlineAsOf),
        listed: {
          count: current.listedCount,
          percentage: safePercentage(current.listedCount, supply),
          supply,
          source: "current_market",
          complete: holders.tokenCount > 0,
          asOf: current.marketUpdatedAt,
        },
        ownersUnique: {
          count: ownersCount,
          percentage: safePercentage(ownersCount, supply),
          supply,
          source: ownersSource,
          complete: ownersCount > 0,
          asOf: ownersSource === "opensea_stats" ? latest?.updated_at ?? null : ownershipAsOf,
        },
        farcasterHolders: {
          count: socialHolders.farcasterHolderCount,
          percentage: safePercentage(socialHolders.farcasterHolderCount, socialHolders.holderCount),
          totalHolders: socialHolders.holderCount,
          source: "wallet_farcaster_links",
          complete: socialHolders.holderCount > 0,
        },
        identityCoverage: {
          resolvedWallets: socialHolders.farcasterHolderCount,
          totalWallets: socialHolders.holderCount,
          percentage: safePercentage(socialHolders.farcasterHolderCount, socialHolders.holderCount),
          source: "wallet_farcaster_links",
          complete: socialHolders.holderCount > 0,
        },
        fairOwnership: {
          uniqueOwnershipPercentage: safePercentage(holders.holderCount, supply),
          exactlyOneWallets: holders.exactlyOneWallets,
          multipleWallets: holders.multipleWallets,
          largestHolding: holders.largestHolding,
          top10Percentage: holders.top10Percentage,
          top100Percentage: holders.top100Percentage,
          cohortSize: holders.cohortSize,
          currentCohortOwners: holders.currentCohortOwners,
          cohortRetentionPercentage: holders.cohortRetentionPercentage,
          source: holders.materialized ? "holder_leaderboard" : "current_ownership",
          complete: holders.tokenCount >= supply && holders.cohortSize !== null,
        },
      },
    }, { noStore: url.searchParams.get("refresh") === "1" });
  } catch (error) {
    return jsonError(
      "stats_overview_unavailable",
      error instanceof Error ? error.message : String(error),
    );
  }
}

async function loadProfilesForFids(
  db: D1Database,
  fids: Iterable<number | null>,
): Promise<Map<number, Profile>> {
  const normalized = [...new Set(
    [...fids].filter((fid): fid is number => Number.isInteger(fid) && Number(fid) > 0),
  )];
  const profiles = new Map<number, Profile>();
  if (normalized.length === 0) return profiles;

  if (await tableExists(db, "wallet_farcaster_links")) {
    try {
      const result = await db.prepare(
        `WITH ranked_profiles AS (
           SELECT
             LOWER(wallet) AS wallet,
             fid,
             username,
             display_name,
             pfp_url,
             x_username,
             score,
             ROW_NUMBER() OVER (
               PARTITION BY fid
               ORDER BY COALESCE(score, -1) DESC, LOWER(wallet) ASC
             ) AS profile_rank
           FROM wallet_farcaster_links
           WHERE fid IN (
             SELECT CAST(value AS INTEGER)
             FROM json_each(?)
           )
         )
         SELECT wallet, fid, username, display_name, pfp_url, x_username, score
         FROM ranked_profiles
         WHERE profile_rank = 1`
      ).bind(JSON.stringify(normalized)).all<{
        wallet: string;
        fid: number;
        username: string | null;
        display_name: string | null;
        pfp_url: string | null;
        x_username: string | null;
        score: number | null;
      }>();
      for (const row of result.results ?? []) {
        profiles.set(row.fid, {
          wallet: row.wallet,
          fid: row.fid,
          username: row.username,
          displayName: row.display_name,
          pfpUrl: row.pfp_url,
          xUsername: row.x_username,
          score: row.score,
        });
      }
    } catch {
      // Fall through to the older Farcaster user cache when wallet links are incomplete.
    }
  }

  if (await tableExists(db, "warplets_users")) {
    try {
      const result = await db.prepare(
        `SELECT fid, username, display_name, pfp_url, x_username, score, primary_eth_address
         FROM warplets_users
         WHERE fid IN (
           SELECT CAST(value AS INTEGER)
           FROM json_each(?)
         )`
      ).bind(JSON.stringify(normalized)).all<{
        fid: number;
        username: string | null;
        display_name: string | null;
        pfp_url: string | null;
        x_username: string | null;
        score: number | null;
        primary_eth_address: string | null;
      }>();
      for (const row of result.results ?? []) {
        const current = profiles.get(row.fid);
        profiles.set(row.fid, {
          wallet: current?.wallet ?? normalizeWallet(row.primary_eth_address) ?? "",
          fid: row.fid,
          username: current?.username ?? row.username,
          displayName: current?.displayName ?? row.display_name,
          pfpUrl: current?.pfpUrl ?? row.pfp_url,
          xUsername: current?.xUsername ?? row.x_username,
          score: current?.score ?? row.score,
        });
      }
    } catch {
      // A known FID remains useful even when no cached public profile is available.
    }
  }

  return profiles;
}

function publicProfile(profile: Profile | null): Omit<Profile, "wallet"> | null {
  return profile
    ? {
      fid: profile.fid,
      username: profile.username,
      displayName: profile.displayName,
      pfpUrl: profile.pfpUrl,
      xUsername: profile.xUsername,
      score: profile.score,
    }
    : null;
}

async function decorateSales(db: D1Database, rows: SaleRow[]): Promise<Array<SaleRow & {
  buyerProfile: Omit<Profile, "wallet"> | null;
  sellerProfile: Omit<Profile, "wallet"> | null;
}>> {
  const [walletProfiles, fidProfiles] = await Promise.all([
    loadProfilesForWallets(db, rows.flatMap((row) => [row.buyerWallet, row.sellerWallet])),
    loadProfilesForFids(db, rows.flatMap((row) => [row.buyerFid, row.sellerFid])),
  ]);
  return rows.map((row) => ({
    ...row,
    buyerProfile: publicProfile(
      (row.buyerWallet ? walletProfiles.get(row.buyerWallet) : null) ??
      (row.buyerFid ? fidProfiles.get(row.buyerFid) : null) ??
      null,
    ),
    sellerProfile: publicProfile(
      (row.sellerWallet ? walletProfiles.get(row.sellerWallet) : null) ??
      (row.sellerFid ? fidProfiles.get(row.sellerFid) : null) ??
      null,
    ),
  }));
}

function buildSalePoints(rows: Awaited<ReturnType<typeof decorateSales>>): Array<{
  key: string;
  at: string;
  tokenId: number;
  tokenIds: number[];
  count: number;
  priceEth: number | null;
  priceUsd: number | null;
  transactionHash: string | null;
  marketplace: string | null;
  buyerWallet: string | null;
  sellerWallet: string | null;
  buyerProfile: Omit<Profile, "wallet"> | null;
  sellerProfile: Omit<Profile, "wallet"> | null;
}> {
  const grouped = new Map<string, Awaited<ReturnType<typeof decorateSales>>>();
  for (const row of rows) {
    const key = row.transactionHash
      ? `${row.transactionHash}:${row.priceEth ?? "unknown"}`
      : row.key;
    grouped.set(key, [...(grouped.get(key) ?? []), row]);
  }
  return [...grouped.entries()].map(([key, group]) => {
    const first = group[0] as (typeof group)[number];
    return {
      key,
      at: first.soldAt,
      tokenId: first.tokenId,
      tokenIds: group.map((row) => row.tokenId),
      count: group.length,
      priceEth: first.priceEth,
      priceUsd: first.priceUsd,
      transactionHash: first.transactionHash,
      marketplace: first.marketplace,
      buyerWallet: first.buyerWallet,
      sellerWallet: first.sellerWallet,
      buyerProfile: first.buyerProfile,
      sellerProfile: first.sellerProfile,
    };
  });
}

export async function handleStatsMarketGet(
  context: EventContext<StatsEnv, string, unknown>,
): Promise<Response> {
  const url = new URL(context.request.url);
  const range = getRange(url);
  const rangeStart = getRangeStart(range);

  try {
    const [current, baseline, latest, sales, floorSeries, dune, duneMarket, activityMix, activityChart] = await Promise.all([
      loadCurrentMarket(context.env.WARPLETS),
      loadBaseline(context.env.WARPLETS),
      loadLatestStatsSnapshot(context.env.WARPLETS),
      loadSales(context.env.WARPLETS, rangeStart),
      loadFloorSeries(context.env.WARPLETS, rangeStart),
      loadDuneIntegration(context.env),
      loadDuneMarketEnrichment(context.env.WARPLETS, rangeStart),
      loadMarketActivityMix(context.env.WARPLETS, rangeStart),
      loadActivityChart(context.env.WARPLETS, range, null),
    ]);
    const observed = summarizeSales(sales.rows);
    const headline = await chooseHeadlineTotals(
      context.env.WARPLETS,
      range,
      rangeStart,
      latest,
      baseline,
      observed,
    );
    const headlineAsOf = headline.asOf ?? sales.rows.at(-1)?.soldAt ?? null;
    const decorated = await decorateSales(context.env.WARPLETS, sales.rows);
    const spreadEth =
      current.floorEth !== null && current.topOfferEth !== null
        ? current.floorEth - current.topOfferEth
        : null;
    const spreadPercent =
      spreadEth !== null && current.floorEth && current.floorEth > 0
        ? (spreadEth / current.floorEth) * 100
        : null;
    const complete =
      headline.complete &&
      sales.complete &&
      floorSeries.length > 0 &&
      !latest?.ingest_stale;
    const stale =
      Boolean(latest?.ingest_stale) ||
      isStale(latest?.updated_at ?? current.marketUpdatedAt);
    const marketActivitySeries = activityChart.buckets.map((bucket) => {
      const events = asRecord(bucket.events);
      const listing = asRecord(events?.listing);
      const offer = asRecord(events?.offer);
      return {
        date: String(bucket.startAt ?? ""),
        listings: Math.max(0, Number(listing?.count) || 0),
        offers: Math.max(0, Number(offer?.count) || 0),
      };
    });
    const listingActivityCount = marketActivitySeries.reduce((sum, row) => sum + row.listings, 0);
    const offerActivityCount = marketActivitySeries.reduce((sum, row) => sum + row.offers, 0);

    return jsonStats({
      ...buildMeta({
        range,
        coverageStart: sales.coverageStart,
        baseline,
        complete,
        stale,
        sources: [
          {
            id: "current_market",
            label: "OpenSea current market state",
            complete: Boolean(current.marketUpdatedAt),
            asOf: current.marketUpdatedAt,
          },
          {
            id: headline.source,
            label: headline.source.startsWith("opensea") ? "OpenSea collection analytics" : "Observed activity",
            complete: headline.complete,
            asOf: headlineAsOf,
          },
          {
            id: sales.source,
            label: "Observed sale events",
            complete: sales.complete,
            asOf: sales.rows.at(-1)?.soldAt ?? null,
          },
          {
            id: "market_snapshots",
            label: "D1 market snapshots",
            complete: floorSeries.length > 0,
            asOf: floorSeries.at(-1)?.at ?? null,
          },
          ...(dune.status !== "disabled"
            ? [{
                id: "dune_onchain",
                label: "Dune onchain trades and transfers",
                complete: dune.status === "live" && duneMarket.complete,
                asOf: dune.asOf ?? duneMarket.asOf,
                ...(dune.lastError ? { note: dune.lastError } : {}),
              }]
            : []),
        ],
      }),
      integrations: { dune },
      metrics: {
        floorPrice: metric(current.floorEth, "ETH", "current_market", current.floorEth !== null, current.floorAt),
        topOffer: metric(
          current.topOfferEth,
          current.topOfferSymbol ?? "WETH",
          "current_market",
          current.topOfferEth !== null,
          current.topOfferAt,
        ),
        spread: {
          valueEth: spreadEth,
          percentage: spreadPercent,
          source: "current_market",
          complete: spreadEth !== null,
          asOf: current.marketUpdatedAt,
        },
        listings: metric(
          current.listedCount,
          "listings",
          "current_market",
          current.itemCount > 0,
          current.marketUpdatedAt,
        ),
        listingActivity: metric(
          listingActivityCount,
          "listings",
          "observed_activity",
          sales.complete,
          sales.rows.at(-1)?.soldAt ?? current.marketUpdatedAt,
        ),
        offerActivity: metric(
          offerActivityCount,
          "offers",
          "observed_activity",
          sales.complete,
          sales.rows.at(-1)?.soldAt ?? current.marketUpdatedAt,
        ),
        sales: metric(headline.sales, "sales", headline.source, headline.complete, headlineAsOf),
        volume: metric(headline.volumeEth, "ETH", headline.source, headline.complete, headlineAsOf),
        medianSale: metric(observed.medianEth, "ETH", sales.source, sales.complete, sales.rows.at(-1)?.soldAt ?? null),
        uniqueBuyers: metric(
          observed.uniqueBuyers,
          "buyers",
          sales.source,
          sales.complete,
          sales.rows.at(-1)?.soldAt ?? null,
        ),
        uniqueSellers: metric(
          observed.uniqueSellers,
          "sellers",
          sales.source,
          sales.complete,
          sales.rows.at(-1)?.soldAt ?? null,
        ),
        repeatBuyers: metric(
          observed.repeatBuyers,
          "buyers",
          sales.source,
          sales.complete,
          sales.rows.at(-1)?.soldAt ?? null,
        ),
        activityMix: {
          ...activityMix,
          source: "observed_activity",
          complete: sales.complete,
          asOf: sales.rows.at(-1)?.soldAt ?? current.marketUpdatedAt,
        },
        onchainTransfers: metric(
          duneMarket.transferCount,
          "transfers",
          "dune_onchain_transfers",
          duneMarket.complete,
          duneMarket.asOf,
        ),
        marketplaceCount: metric(
          duneMarket.marketplaceCount,
          "marketplaces",
          "dune_onchain_sales",
          duneMarket.complete,
          duneMarket.asOf,
        ),
      },
      series: {
        daily: buildDailySeries(sales.rows),
        salePrices: buildSalePoints(decorated),
        floor: floorSeries,
        listings: marketActivitySeries,
        offers: marketActivitySeries,
        marketplaces: duneMarket.marketplaces,
      },
    }, { noStore: url.searchParams.get("refresh") === "1" });
  } catch (error) {
    return jsonError(
      "stats_market_unavailable",
      error instanceof Error ? error.message : String(error),
    );
  }
}

async function loadSocialHolderCounts(db: D1Database): Promise<{
  holderCount: number;
  farcasterHolderCount: number;
}> {
  try {
    const row = await db.prepare(
      `WITH owners AS (
         SELECT
           LOWER(TRIM(owner_wallet)) AS wallet,
           MAX(owner_fid) AS owner_fid
         FROM warplet_market_state
         WHERE owner_wallet IS NOT NULL
           AND TRIM(owner_wallet) <> ''
           AND LOWER(TRIM(owner_wallet)) <> ?
         GROUP BY LOWER(TRIM(owner_wallet))
       )
       SELECT
         COUNT(*) AS holder_count,
         SUM(CASE
           WHEN owner_fid IS NOT NULL OR EXISTS (
             SELECT 1 FROM wallet_farcaster_links l
             WHERE LOWER(l.wallet) = owners.wallet
           )
           THEN 1 ELSE 0
         END) AS farcaster_holder_count
       FROM owners`
    ).bind(ZERO_ADDRESS).first<{
      holder_count: number;
      farcaster_holder_count: number;
    }>();
    return {
      holderCount: row?.holder_count ?? 0,
      farcasterHolderCount: row?.farcaster_holder_count ?? 0,
    };
  } catch {
    return { holderCount: 0, farcasterHolderCount: 0 };
  }
}

async function loadSocialCommunity(db: D1Database): Promise<Array<{
  wallet: string;
  ownedCount: number;
  fid: number;
  username: string | null;
  displayName: string | null;
  pfpUrl: string | null;
  score: number | null;
}>> {
  const materialized = await ensureHolderLeaderboard(db);
  try {
    const result = await db.prepare(
      `WITH ${holderCte(materialized)},
       owner_fid_counts AS (
         SELECT
           LOWER(TRIM(owner_wallet)) AS wallet,
           owner_fid AS fid,
           COUNT(*) AS token_count
         FROM warplet_market_state
         WHERE owner_wallet IS NOT NULL
           AND TRIM(owner_wallet) <> ''
           AND owner_fid IS NOT NULL
         GROUP BY LOWER(TRIM(owner_wallet)), owner_fid
       ),
       ranked_owner_fids AS (
         SELECT
           wallet,
           fid,
           ROW_NUMBER() OVER (
             PARTITION BY wallet
             ORDER BY token_count DESC, fid ASC
           ) AS identity_rank
         FROM owner_fid_counts
       ),
       ranked_links AS (
         SELECT
           LOWER(wallet) AS wallet,
           fid,
           ROW_NUMBER() OVER (
             PARTITION BY LOWER(wallet)
             ORDER BY COALESCE(score, -1) DESC, fid ASC
           ) AS identity_rank
         FROM wallet_farcaster_links
       )
       SELECT
         h.wallet,
         h.owned_count,
         COALESCE(o.fid, l.fid) AS fid
       FROM holder_source h
       LEFT JOIN ranked_owner_fids o
         ON o.wallet = h.wallet AND o.identity_rank = 1
       LEFT JOIN ranked_links l
         ON l.wallet = h.wallet AND l.identity_rank = 1
       WHERE COALESCE(o.fid, l.fid) IS NOT NULL
       ORDER BY h.owned_count DESC, h.best_rarity_rank ASC, h.wallet ASC
       LIMIT 40`
    ).all<{
      wallet: string;
      owned_count: number;
      fid: number;
    }>();
    const rows = result.results ?? [];
    const profiles = await loadProfilesForFids(db, rows.map((row) => row.fid));
    return rows.map((row) => ({
      wallet: row.wallet,
      ownedCount: row.owned_count,
      fid: row.fid,
      username: profiles.get(row.fid)?.username ?? null,
      displayName: profiles.get(row.fid)?.displayName ?? null,
      pfpUrl: profiles.get(row.fid)?.pfpUrl ?? null,
      score: profiles.get(row.fid)?.score ?? null,
    }));
  } catch {
    return [];
  }
}

async function loadRecentSocialListings(db: D1Database): Promise<Array<{
  tokenId: number;
  wallet: string;
  listingEth: number;
  listedAt: string | null;
  profile: Omit<Profile, "wallet"> | null;
}>> {
  try {
    const result = await db.prepare(
      `SELECT
         token_id,
         LOWER(TRIM(owner_wallet)) AS wallet,
         owner_fid,
         listing_eth,
         listed_at
       FROM warplet_market_state
       WHERE listing_eth IS NOT NULL
         AND owner_wallet IS NOT NULL
         AND (
           owner_fid IS NOT NULL
           OR EXISTS (
             SELECT 1 FROM wallet_farcaster_links l
             WHERE LOWER(l.wallet) = LOWER(TRIM(warplet_market_state.owner_wallet))
           )
         )
       ORDER BY listed_at DESC, token_id ASC
       LIMIT 25`
    ).all<{
      token_id: number;
      wallet: string;
      owner_fid: number | null;
      listing_eth: number;
      listed_at: string | null;
    }>();
    const rows = result.results ?? [];
    const [walletProfiles, fidProfiles] = await Promise.all([
      loadProfilesForWallets(db, rows.map((row) => row.wallet)),
      loadProfilesForFids(db, rows.map((row) => row.owner_fid)),
    ]);
    return rows.map((row) => ({
      tokenId: row.token_id,
      wallet: row.wallet,
      listingEth: row.listing_eth,
      listedAt: row.listed_at,
      profile: publicProfile(
        (row.owner_fid ? fidProfiles.get(row.owner_fid) : null) ??
        walletProfiles.get(row.wallet) ??
        (row.owner_fid
          ? {
              wallet: row.wallet,
              fid: row.owner_fid,
              username: null,
              displayName: null,
              pfpUrl: null,
              score: null,
              xUsername: null,
            }
          : null),
      ),
    }));
  } catch {
    return [];
  }
}

function buildSocialDailySeries(
  rows: Awaited<ReturnType<typeof decorateSales>>,
): Array<{ date: string; sales: number; volumeEth: number }> {
  const days = new Map<string, { sales: number; volumeEth: number }>();
  for (const row of rows) {
    if (!row.buyerProfile && !row.sellerProfile) continue;
    const date = row.soldAt.slice(0, 10);
    const day = days.get(date) ?? { sales: 0, volumeEth: 0 };
    day.sales += 1;
    day.volumeEth += row.priceEth ?? 0;
    days.set(date, day);
  }
  return [...days.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, values]) => ({ date, ...values }));
}

async function loadDuneSocialLinkedActivity(
  db: D1Database,
  start: string,
): Promise<{ count: number; asOf: string | null; complete: boolean }> {
  if (
    !(await tableExists(db, "warplet_sale_sources")) ||
    !(await tableExists(db, "analytics_ingest_state"))
  ) {
    return { count: 0, asOf: null, complete: false };
  }
  try {
    const [activity, state] = await Promise.all([
      db.prepare(
        `SELECT COUNT(*) AS activity_count
         FROM warplet_sale_sources ss
         WHERE ss.source = 'dune:nft.trades'
           AND ss.observed_at >= ?
           AND (
             EXISTS (
               SELECT 1 FROM wallet_farcaster_links l
               WHERE LOWER(TRIM(l.wallet)) = LOWER(TRIM(ss.buyer_wallet))
             )
             OR EXISTS (
               SELECT 1 FROM wallet_farcaster_links l
               WHERE LOWER(TRIM(l.wallet)) = LOWER(TRIM(ss.seller_wallet))
             )
           )`
      ).bind(start).first<{ activity_count: number }>(),
      db.prepare(
        `SELECT coverage_start, coverage_end, last_success_at, complete, stale
         FROM analytics_ingest_state
         WHERE source_key = 'dune:trades'
         LIMIT 1`
      ).first<{
        coverage_start: string | null;
        coverage_end: string | null;
        last_success_at: string | null;
        complete: number;
        stale: number;
      }>(),
    ]);
    const requiredEnd = new Date(Date.now() - 6 * 3_600_000).toISOString();
    const complete = Boolean(
      state?.complete === 1 &&
      state.stale !== 1 &&
      state.coverage_start &&
      state.coverage_start <= start &&
      state.coverage_end &&
      state.coverage_end >= requiredEnd
    );
    return {
      count: activity?.activity_count ?? 0,
      asOf: state?.last_success_at ?? null,
      complete,
    };
  } catch {
    return { count: 0, asOf: null, complete: false };
  }
}

export async function handleStatsSocialGet(
  context: EventContext<StatsEnv, string, unknown>,
): Promise<Response> {
  const url = new URL(context.request.url);
  const range = getRange(url);
  const rangeStart = getRangeStart(range);

  try {
    const [allSales, holderCounts, listings, baseline, currentMarket, dune] = await Promise.all([
      loadSales(context.env.WARPLETS, ANALYTICS_EPOCH),
      loadSocialHolderCounts(context.env.WARPLETS),
      loadRecentSocialListings(context.env.WARPLETS),
      loadBaseline(context.env.WARPLETS),
      loadCurrentMarket(context.env.WARPLETS),
      loadDuneIntegration(context.env),
    ]);
    const decoratedAll = await decorateSales(context.env.WARPLETS, allSales.rows);
    const selected = decoratedAll.filter((row) => row.soldAt >= rangeStart);
    const socialRows = selected.filter((row) => row.buyerProfile || row.sellerProfile);
    const socialBuyers = new Set(
      socialRows
        .filter((row) => row.buyerProfile)
        .map((row) => row.buyerWallet ?? `fid:${row.buyerProfile?.fid ?? "unknown"}`),
    );
    const socialSellers = new Set(
      socialRows
        .filter((row) => row.sellerProfile)
        .map((row) => row.sellerWallet ?? `fid:${row.sellerProfile?.fid ?? "unknown"}`),
    );
    const firstPurchase = new Map<string, string>();
    for (const row of decoratedAll) {
      if (!row.buyerProfile) continue;
      const key = row.buyerWallet ?? `fid:${row.buyerProfile.fid ?? "unknown"}`;
      const current = firstPurchase.get(key);
      if (!current || row.soldAt < current) firstPurchase.set(key, row.soldAt);
    }
    const newBuyers = [...socialBuyers].filter((key) => {
      const first = firstPurchase.get(key);
      return first !== undefined && first >= rangeStart;
    }).length;
    const volumeEth = socialRows.reduce((sum, row) => sum + (row.priceEth ?? 0), 0);
    const identityCoveragePercentage = safePercentage(
      holderCounts.farcasterHolderCount,
      holderCounts.holderCount,
    );
    const complete = allSales.complete && holderCounts.holderCount > 0;
    const activityAsOf = allSales.rows.at(-1)?.soldAt ?? null;

    return jsonStats({
      ...buildMeta({
        range,
        coverageStart: allSales.coverageStart,
        baseline,
        complete,
        stale: isStale(currentMarket.marketUpdatedAt),
        sources: [
          {
            id: "current_market",
            label: "Current D1 ownership and listings",
            complete: Boolean(currentMarket.marketUpdatedAt),
            asOf: currentMarket.marketUpdatedAt,
          },
          {
            id: "wallet_farcaster_links",
            label: "Cached Farcaster identities",
            complete: holderCounts.holderCount > 0,
            asOf: null,
            note: "Identity coverage reflects resolved wallets; unresolved wallets are not classified as non-Farcaster.",
          },
          {
            id: allSales.source,
            label: "Observed sale activity",
            complete: allSales.complete,
            asOf: activityAsOf,
          },
          {
            id: "current_social_listings",
            label: "Current Farcaster-linked listings",
            complete: true,
            asOf: listings.map((row) => row.listedAt).filter(Boolean).sort().at(-1) ?? null,
          },
          ...(dune.status !== "disabled"
            ? [{
                id: "dune_social_onchain",
                label: "Dune onchain activity joined to Farcaster identities",
                complete: dune.status === "live",
                asOf: dune.asOf,
                ...(dune.lastError ? { note: dune.lastError } : {}),
              }]
            : []),
        ],
      }),
      integrations: { dune },
      metrics: {
        farcasterHolders: {
          count: holderCounts.farcasterHolderCount,
          percentage: identityCoveragePercentage,
          totalHolders: holderCounts.holderCount,
          source: "wallet_farcaster_links",
          complete: holderCounts.holderCount > 0,
        },
        identityCoverage: {
          resolvedWallets: holderCounts.farcasterHolderCount,
          totalWallets: holderCounts.holderCount,
          percentage: identityCoveragePercentage,
          source: "wallet_farcaster_links",
          complete: holderCounts.holderCount > 0,
        },
        activeBuyers: metric(
          socialBuyers.size,
          "buyers",
          allSales.source,
          allSales.complete,
          activityAsOf,
        ),
        activeSellers: metric(
          socialSellers.size,
          "sellers",
          allSales.source,
          allSales.complete,
          activityAsOf,
        ),
        sales: metric(
          socialRows.length,
          "sales",
          allSales.source,
          allSales.complete,
          activityAsOf,
        ),
        volume: metric(
          volumeEth,
          "ETH",
          allSales.source,
          allSales.complete,
          activityAsOf,
        ),
        newBuyers: metric(newBuyers, "buyers", allSales.source, allSales.complete, activityAsOf),
        returningBuyers: metric(
          Math.max(0, socialBuyers.size - newBuyers),
          "buyers",
          allSales.source,
          allSales.complete,
          activityAsOf,
        ),
      },
      series: {
        // High-volume sale charts are served as bounded aggregates by
        // /api/stats/activity?chart=1. Keep the legacy key without transferring
        // every sale into the browser.
        sales: [],
      },
      recentActivity: socialRows.slice(-20).reverse(),
      recentListings: listings,
    }, { noStore: url.searchParams.get("refresh") === "1" });
  } catch (error) {
    return jsonError(
      "stats_social_unavailable",
      error instanceof Error ? error.message : String(error),
    );
  }
}

export async function handleStatsSocialHighlightsGet(
  context: EventContext<StatsEnv, string, unknown>,
): Promise<Response> {
  const url = new URL(context.request.url);
  const range = getRange(url);
  const requestedFid = asInteger(url.searchParams.get("fid"));
  const sessionToken =
    context.request.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim() ||
    null;

  try {
    const session = await verifyActionSessionToken(context.env.ACTION_SESSION_SECRET, sessionToken);
    if (!session.valid || (requestedFid !== null && requestedFid !== session.fid)) {
      return jsonStats({
        ...buildMeta({
          range,
          coverageStart: getRangeStart(range),
          baseline: await loadBaseline(context.env.WARPLETS),
          complete: true,
          stale: false,
          sources: [],
        }),
        available: false,
        viewer: null,
        friends: [],
        matchedFids: [],
      }, { private: true });
    }

    const result = await context.env.WARPLETS.prepare(
      `SELECT
         best_friend_fid,
         mutual_affinity_score,
         fetched_at
       FROM warplets_user_best_friends
       WHERE user_fid = ?
       ORDER BY COALESCE(mutual_affinity_score, -1) DESC, best_friend_fid ASC
       LIMIT 100`
    ).bind(session.fid).all<{
      best_friend_fid: number;
      mutual_affinity_score: number | null;
      fetched_at: string;
    }>();
    // Return the small cached friend set directly. Holders and Social already carry
    // their own FIDs, so the client can intersect this list with the records it is
    // rendering without an expensive collection-wide wallet/FID join.
    const friends = (result.results ?? [])
      .map((row, index) => ({
        fid: row.best_friend_fid,
        rank: index + 1,
      }));
    const includeHolderDetails = url.searchParams.get("holders") === "1";
    const friendFids = friends.map((friend) => friend.fid);
    let friendHolders: Array<Record<string, unknown>> = [];
    if (includeHolderDetails && friendFids.length > 0) {
      const materialized = await ensureHolderLeaderboard(context.env.WARPLETS);
      const [holderRows, currentMarket] = await Promise.all([
        context.env.WARPLETS.prepare(
          `WITH ${holderCte(materialized)},
           friend_fids AS (
             SELECT CAST(value AS INTEGER) AS fid FROM json_each(?)
           ),
           ranked_holders AS (
             SELECT *, ROW_NUMBER() OVER (
               ORDER BY owned_count DESC, best_rarity_rank ASC, wallet ASC
             ) AS rank
             FROM holder_source
           ),
           identity_wallets AS (
             SELECT DISTINCT LOWER(TRIM(owner_wallet)) AS wallet, owner_fid AS fid
             FROM warplet_market_state
             WHERE owner_wallet IS NOT NULL
               AND owner_fid IN (SELECT fid FROM friend_fids)
             UNION
             SELECT DISTINCT LOWER(TRIM(wallet)) AS wallet, fid
             FROM wallet_farcaster_links
             WHERE fid IN (SELECT fid FROM friend_fids)
           )
           SELECT h.rank, h.wallet, h.owned_count, h.best_rarity_rank,
                  h.best_token_id, h.preview_token_ids_json, i.fid
           FROM ranked_holders h
           INNER JOIN identity_wallets i ON i.wallet = h.wallet`
        ).bind(JSON.stringify(friendFids)).all<{
          rank: number;
          wallet: string;
          owned_count: number;
          best_rarity_rank: number | null;
          best_token_id: number | null;
          preview_token_ids_json: string;
          fid: number;
        }>(),
        loadCurrentMarket(context.env.WARPLETS),
      ]);
      const holderProfiles = await loadProfilesForFids(
        context.env.WARPLETS,
        (holderRows.results ?? []).map((row) => row.fid),
      );
      const rankByFid = new Map(friends.map((friend) => [friend.fid, friend.rank]));
      const seenFriendWallets = new Set<string>();
      friendHolders = (holderRows.results ?? [])
        .map((row) => {
          const previewTokenIds = parsePreviewTokenIds(row.preview_token_ids_json);
          return {
            rank: row.rank,
            wallet: row.wallet,
            ownedCount: row.owned_count,
            fid: row.fid,
            username: holderProfiles.get(row.fid)?.username ?? null,
            displayName: holderProfiles.get(row.fid)?.displayName ?? null,
            pfpUrl: holderProfiles.get(row.fid)?.pfpUrl ?? null,
            friendRank: rankByFid.get(row.fid) ?? 101,
            bestRarityRank: row.best_rarity_rank,
            bestTokenId: row.best_token_id,
            previewTokenIds,
            remainingCount: Math.max(0, row.owned_count - previewTokenIds.length),
            ownedPct: safePercentage(row.owned_count, WARPLETS_TOTAL_SUPPLY),
            floorValueEth: currentMarket.floorEth === null ? null : row.owned_count * currentMarket.floorEth,
          };
        })
        .sort((left, right) => Number(left.friendRank) - Number(right.friendRank) || String(left.wallet).localeCompare(String(right.wallet)))
        .filter((row) => {
          const wallet = String(row.wallet);
          if (seenFriendWallets.has(wallet)) return false;
          seenFriendWallets.add(wallet);
          return true;
        });
    }
    const fetchedAt = (result.results ?? [])
      .map((row) => row.fetched_at)
      .filter(Boolean)
      .sort()
      .at(-1) ?? null;
    const stale = isStale(fetchedAt, 30 * 86_400_000);

    return jsonStats({
      ...buildMeta({
        range,
        coverageStart: getRangeStart(range),
        baseline: await loadBaseline(context.env.WARPLETS),
        complete: true,
        stale,
        sources: [{
          id: "neynar_top_100",
          label: "Neynar-ranked Top 100 Friends cache",
          complete: Boolean(fetchedAt),
          asOf: fetchedAt,
          note: "The UI highlights collection-relevant matches from this ranked subset; this is not the viewer's complete following graph.",
        }],
      }),
      available: Boolean(fetchedAt),
      viewer: { fid: session.fid },
      friends,
      ...(includeHolderDetails ? { friendHolders } : {}),
      matchedFids: friends.map((friend) => friend.fid),
    }, { private: true });
  } catch (error) {
    return jsonError(
      "stats_social_highlights_unavailable",
      error instanceof Error ? error.message : String(error),
    );
  }
}

function toHolderApiRow(
  row: HolderBaseRow,
  floorEth: number | null,
  profile: Profile | null,
  viewerWallet: string | null,
): HolderApiRow {
  const ownedPct = safePercentage(row.ownedCount, WARPLETS_TOTAL_SUPPLY);
  const remainingCount = Math.max(0, row.ownedCount - row.previewTokenIds.length);
  return {
    ...row,
    ownedPct,
    supplyPercentage: ownedPct,
    remainingCount,
    remainingPreviewCount: remainingCount,
    floorValueEth: floorEth === null ? null : row.ownedCount * floorEth,
    fid: profile?.fid ?? null,
    username: profile?.username ?? null,
    displayName: profile?.displayName ?? null,
    pfpUrl: profile?.pfpUrl ?? null,
    xUsername: profile?.xUsername ?? null,
    isViewer: viewerWallet === row.wallet,
    isTopFriend: false,
  };
}

export async function loadStatsFriendHoldersForShare(
  env: StatsEnv,
  viewerFid: number,
): Promise<{ rows: HolderApiRow[]; totalHolders: number; asOf: string | null }> {
  await ensureHolderLeaderboard(env.WARPLETS);
  const [friends, total, market] = await Promise.all([
    env.WARPLETS.prepare(
      `WITH friend_wallets AS (
         SELECT
           LOWER(TRIM(m.owner_wallet)) AS wallet,
           m.owner_fid AS fid,
           bf.mutual_affinity_score,
           ROW_NUMBER() OVER (
             PARTITION BY LOWER(TRIM(m.owner_wallet))
             ORDER BY COALESCE(bf.mutual_affinity_score, -1) DESC, m.owner_fid ASC
           ) AS identity_rank
         FROM warplet_market_state m
         JOIN warplets_user_best_friends bf ON bf.best_friend_fid = m.owner_fid
         WHERE bf.user_fid = ?
           AND m.owner_wallet IS NOT NULL
           AND TRIM(m.owner_wallet) <> ''
         UNION ALL
         SELECT
           LOWER(TRIM(l.wallet)) AS wallet,
           l.fid,
           bf.mutual_affinity_score,
           ROW_NUMBER() OVER (
             PARTITION BY LOWER(TRIM(l.wallet))
             ORDER BY COALESCE(bf.mutual_affinity_score, -1) DESC, l.fid ASC
           ) AS identity_rank
         FROM wallet_farcaster_links l
         JOIN warplets_user_best_friends bf ON bf.best_friend_fid = l.fid
         WHERE bf.user_fid = ?
       ),
       ranked_friend_wallets AS (
         SELECT wallet, fid,
           ROW_NUMBER() OVER (
             PARTITION BY wallet
             ORDER BY identity_rank ASC, COALESCE(mutual_affinity_score, -1) DESC, fid ASC
           ) AS wallet_rank
         FROM friend_wallets
       ),
       ranked_holders AS (
         SELECT h.*,
           ROW_NUMBER() OVER (
             ORDER BY h.owned_count DESC, h.best_rarity_rank ASC, h.wallet ASC
           ) AS rank
         FROM holder_leaderboard h
       )
       SELECT
         h.rank, h.wallet, h.owned_count, h.best_rarity_rank, h.best_token_id,
         h.preview_token_ids_json, h.updated_at, f.fid
       FROM ranked_holders h
       JOIN ranked_friend_wallets f ON f.wallet = h.wallet AND f.wallet_rank = 1
       WHERE h.wallet <> ?
       ORDER BY h.rank ASC
       LIMIT 10`,
    ).bind(viewerFid, viewerFid, ZERO_ADDRESS).all<{
      rank: number;
      wallet: string;
      owned_count: number;
      best_rarity_rank: number;
      best_token_id: number;
      preview_token_ids_json: string;
      updated_at: string | null;
      fid: number;
    }>(),
    env.WARPLETS.prepare("SELECT COUNT(*) AS count, MAX(updated_at) AS updated_at FROM holder_leaderboard")
      .first<{ count: number; updated_at: string | null }>(),
    loadCurrentMarket(env.WARPLETS),
  ]);
  const sourceRows = friends.results ?? [];
  const profiles = await loadProfilesForFids(env.WARPLETS, sourceRows.map((row) => row.fid));
  const rows = sourceRows.map((row) => toHolderApiRow({
    rank: row.rank,
    wallet: row.wallet,
    ownedCount: row.owned_count,
    bestRarityRank: row.best_rarity_rank,
    bestTokenId: row.best_token_id,
    previewTokenIds: parsePreviewTokenIds(row.preview_token_ids_json),
    updatedAt: row.updated_at,
  }, market.floorEth, profiles.get(row.fid) ?? null, null));
  return {
    rows,
    totalHolders: Number(total?.count) || 0,
    asOf: total?.updated_at ?? null,
  };
}

async function loadHolderActivity(
  db: D1Database,
  wallets: string[],
): Promise<Map<string, {
  averageHoldingDays: number | null;
  oldestCurrentHoldingAt: string | null;
  acquiredSinceEpoch: number;
  disposedSinceEpoch: number;
}>> {
  const activity = new Map<string, {
    averageHoldingDays: number | null;
    oldestCurrentHoldingAt: string | null;
    acquiredSinceEpoch: number;
    disposedSinceEpoch: number;
  }>();
  const normalized = [...new Set(wallets.map(normalizeWallet).filter(
    (wallet): wallet is string => wallet !== null,
  ))];
  if (
    normalized.length === 0 ||
    !(await tableExists(db, "holder_activity_summary"))
  ) {
    return activity;
  }
  try {
    const result = await db.prepare(
      `SELECT
         wallet,
         average_current_holding_days,
         oldest_current_holding_at,
         acquired_since_epoch,
         disposed_since_epoch
       FROM holder_activity_summary
       WHERE wallet IN (SELECT LOWER(value) FROM json_each(?))`
    ).bind(JSON.stringify(normalized)).all<{
      wallet: string;
      average_current_holding_days: number | null;
      oldest_current_holding_at: string | null;
      acquired_since_epoch: number;
      disposed_since_epoch: number;
    }>();
    for (const row of result.results ?? []) {
      activity.set(row.wallet, {
        averageHoldingDays: row.average_current_holding_days,
        oldestCurrentHoldingAt: row.oldest_current_holding_at,
        acquiredSinceEpoch: row.acquired_since_epoch,
        disposedSinceEpoch: row.disposed_since_epoch,
      });
    }
  } catch {
    // Holder activity is optional Dune enrichment.
  }
  return activity;
}

function parseHolderLimit(url: URL): number {
  const raw = asInteger(url.searchParams.get("limit"));
  return raw === null ? 100 : Math.max(1, Math.min(100, raw));
}

export async function handleStatsHoldersGet(
  context: EventContext<StatsEnv, string, unknown>,
): Promise<Response> {
  const url = new URL(context.request.url);
  const limit = parseHolderLimit(url);
  const rawCursor = url.searchParams.get("cursor");
  const cursor = decodeHolderCursor(rawCursor);
  if (rawCursor && !cursor) {
    return jsonError("invalid_holder_cursor", "The holder cursor is invalid.", 400);
  }
  const viewerWallet = normalizeWallet(url.searchParams.get("wallet"));
  if (url.searchParams.get("wallet") && !viewerWallet) {
    return jsonError("invalid_wallet", "Wallet must be a valid EVM address.", 400);
  }

  try {
    const materialized = await ensureHolderLeaderboard(context.env.WARPLETS);
    const [page, summary, market, dune] = await Promise.all([
      loadHolderBaseRows(context.env.WARPLETS, limit + 1, cursor, materialized),
      loadHolderSummary(context.env.WARPLETS, materialized),
      loadCurrentMarket(context.env.WARPLETS),
      loadDuneIntegration(context.env),
    ]);
    const hasMore = page.rows.length > limit;
    const visible = page.rows.slice(0, limit);
    const [profiles, holderActivity] = await Promise.all([
      loadProfilesForWallets(
        context.env.WARPLETS,
        visible.map((row) => row.wallet),
      ),
      loadHolderActivity(
        context.env.WARPLETS,
        visible.map((row) => row.wallet),
      ),
    ]);
    const rows = visible.map((row) => ({
      ...toHolderApiRow(row, market.floorEth, profiles.get(row.wallet) ?? null, viewerWallet),
      ...(holderActivity.get(row.wallet) ?? {}),
    }));
    const last = hasMore ? visible.at(-1) : null;
    const nextCursor = last
      ? encodeHolderCursor({
        rank: last.rank,
        ownedCount: last.ownedCount,
        bestRarityRank: last.bestRarityRank,
        wallet: last.wallet,
      })
      : null;
    let viewer: HolderApiRow | null = null;
    if (viewerWallet) {
      const viewerResult = await loadOneHolder(context.env.WARPLETS, viewerWallet, materialized);
      if (viewerResult.row) {
        const [viewerProfiles, viewerActivity] = await Promise.all([
          loadProfilesForWallets(context.env.WARPLETS, [viewerWallet]),
          loadHolderActivity(context.env.WARPLETS, [viewerWallet]),
        ]);
        const viewerProfile = viewerProfiles.get(viewerWallet) ?? null;
        viewer = {
          ...toHolderApiRow(viewerResult.row, market.floorEth, viewerProfile, viewerWallet),
          ...(viewerActivity.get(viewerWallet) ?? {}),
        };
      }
    }
    const complete = summary.tokenCount >= market.itemCount;
    const ownershipAsOf = [
      summary.updatedAt,
      market.ownershipUpdatedAt,
    ]
      .filter((value): value is string => Boolean(value))
      .sort((left, right) => sortableTimestamp(left) - sortableTimestamp(right))
      .at(-1) ?? null;

    return jsonStats({
      ...buildMeta({
        range: "all",
        coverageStart: ANALYTICS_EPOCH,
        baseline: await loadBaseline(context.env.WARPLETS),
        complete,
        stale: isStale(ownershipAsOf),
        sources: [{
          id: page.materialized ? "holder_leaderboard" : "current_ownership",
          label: page.materialized ? "Materialized D1 holder leaderboard" : "Current D1 ownership",
          complete,
          asOf: ownershipAsOf,
        }],
      }),
      integrations: { dune },
      summary: {
        holderCount: summary.holderCount,
        tokenCount: summary.tokenCount,
        supply: market.itemCount,
        uniqueOwnershipPercentage: safePercentage(summary.holderCount, market.itemCount),
        singleItemHolders: summary.exactlyOneWallets,
        exactlyOneWallets: summary.exactlyOneWallets,
        multiItemHolders: summary.multipleWallets,
        multipleWallets: summary.multipleWallets,
        largestHolding: summary.largestHolding,
        top10Pct: summary.top10Percentage,
        top10Percentage: summary.top10Percentage,
        top100Pct: summary.top100Percentage,
        top100Percentage: summary.top100Percentage,
        cohortSize: summary.cohortSize,
        currentCohortOwners: summary.currentCohortOwners,
        cohortRetentionPct: summary.cohortRetentionPercentage,
        cohortRetentionPercentage: summary.cohortRetentionPercentage,
      },
      floor: {
        eth: market.floorEth,
        currency: "ETH",
        source: "current_market",
        asOf: market.floorAt,
      },
      rows,
      viewer,
      nextCursor,
    }, {
      private: Boolean(viewerWallet),
      noStore: url.searchParams.get("refresh") === "1",
    });
  } catch (error) {
    return jsonError(
      "stats_holders_unavailable",
      error instanceof Error ? error.message : String(error),
    );
  }
}

export async function handleStatsHoldersMeGet(
  context: EventContext<StatsEnv, string, unknown>,
): Promise<Response> {
  const url = new URL(context.request.url);
  const rawWallet = url.searchParams.get("wallet");
  const rawFid = url.searchParams.get("fid");
  const fid = rawFid === null ? null : asInteger(rawFid);
  let wallet = normalizeWallet(rawWallet);
  if (rawFid !== null && (fid === null || fid <= 0)) {
    return jsonError("invalid_fid", "FID must be a positive integer.", 400);
  }
  if (!rawWallet && fid !== null) {
    await ensureHolderLeaderboard(context.env.WARPLETS);
    wallet = await context.env.WARPLETS.prepare(
      `WITH candidate_wallets(wallet) AS (
         SELECT LOWER(TRIM(owner_wallet))
         FROM warplet_market_state
         WHERE owner_fid = ?
           AND owner_wallet IS NOT NULL
           AND TRIM(owner_wallet) <> ''
         UNION
         SELECT LOWER(TRIM(wallet))
         FROM wallet_farcaster_links
         WHERE fid = ?
         UNION
         SELECT LOWER(TRIM(owner_wallet))
         FROM analytics_owner_baseline
         WHERE owner_fid = ?
       )
       SELECT h.wallet
       FROM holder_leaderboard h
       JOIN candidate_wallets c ON c.wallet = h.wallet
       WHERE h.wallet <> ?
       ORDER BY
         h.owned_count DESC,
         h.best_rarity_rank ASC,
         h.wallet ASC
       LIMIT 1`
    ).bind(fid, fid, fid, ZERO_ADDRESS).first<{ wallet: string }>()
      .then((row) => normalizeWallet(row?.wallet))
      .catch(() => null);
  }
  if (!rawWallet && fid === null) {
    return jsonStats({
      analyticsEpoch: ANALYTICS_EPOCH,
      asOf: null,
      row: null,
      holder: null,
      totalHolders: null,
    }, { private: true });
  }
  if (rawWallet && !wallet) {
    return jsonError("invalid_wallet", "Wallet must be a valid EVM address.", 400);
  }

  try {
    if (!wallet) {
      const materialized = await ensureHolderLeaderboard(context.env.WARPLETS);
      const total = await context.env.WARPLETS.prepare(
        `WITH ${holderCte(materialized)}
         SELECT COUNT(*) AS count, MAX(updated_at) AS updated_at FROM holder_source`
      ).first<{ count: number; updated_at: string | null }>();
      return jsonStats({
        analyticsEpoch: ANALYTICS_EPOCH,
        asOf: total?.updated_at ?? null,
        row: null,
        holder: null,
        totalHolders: total?.count ?? 0,
        complete: materialized,
        stale: false,
      }, { private: true });
    }
    const [holder, market, dune] = await Promise.all([
      loadOneHolder(context.env.WARPLETS, wallet),
      loadCurrentMarket(context.env.WARPLETS),
      loadDuneIntegration(context.env),
    ]);
    const profile = holder.row
      ? (await loadProfilesForWallets(context.env.WARPLETS, [wallet])).get(wallet) ?? null
      : null;
    const originalFidTokenId = holder.row && profile?.fid
      ? await context.env.WARPLETS.prepare(
        `SELECT m.token_id
         FROM warplets_metadata m
         JOIN warplet_market_state s ON s.token_id = m.token_id
         WHERE CAST(m.fid_value AS INTEGER) = ?
           AND LOWER(TRIM(s.owner_wallet)) = ?
         ORDER BY m.token_id ASC
         LIMIT 1`
      ).bind(profile.fid, wallet).first<{ token_id: number }>()
        .then((match) => asInteger(match?.token_id))
        .catch(() => null)
      : null;
    const holderActivity = holder.row
      ? await loadHolderActivity(context.env.WARPLETS, [wallet])
      : new Map();
    const row = holder.row
      ? {
          ...toHolderApiRow(holder.row, market.floorEth, profile, wallet),
          originalFidTokenId,
          ...(holderActivity.get(wallet) ?? {}),
        }
      : null;
    const holderAsOf = [
      holder.row?.updatedAt ?? null,
      market.ownershipUpdatedAt,
    ]
      .filter((value): value is string => Boolean(value))
      .sort((left, right) => sortableTimestamp(left) - sortableTimestamp(right))
      .at(-1) ?? null;
    return jsonStats({
      analyticsEpoch: ANALYTICS_EPOCH,
      asOf: holderAsOf,
      row,
      holder: row,
      totalHolders: holder.totalHolders,
      complete: holder.materialized,
      stale: isStale(holderAsOf),
      integrations: { dune },
    }, { private: true });
  } catch (error) {
    return jsonError(
      "stats_holder_unavailable",
      error instanceof Error ? error.message : String(error),
    );
  }
}

export async function handleStatsPriceHistoryGet(
  context: EventContext<StatsEnv, string, unknown>,
): Promise<Response> {
  const tokenId = asInteger(context.params.tokenId);
  if (tokenId === null || tokenId < 1 || tokenId > WARPLETS_TOTAL_SUPPLY) {
    return jsonError("invalid_token_id", "Token ID must be between 1 and 10000.", 400);
  }

  try {
    const [sales, item, baseline, dune] = await Promise.all([
      loadSales(context.env.WARPLETS, ANALYTICS_EPOCH, tokenId),
      context.env.WARPLETS.prepare(
        `SELECT token_id, name, jpg_url
         FROM warplets_metadata
         WHERE token_id = ?
         LIMIT 1`
      ).bind(tokenId).first<{
        token_id: number;
        name: string;
        jpg_url: string | null;
      }>().catch(() => null),
      loadBaseline(context.env.WARPLETS),
      loadDuneIntegration(context.env),
    ]);
    const decorated = await decorateSales(context.env.WARPLETS, sales.rows);
    const history = decorated.map((row) => ({
      key: row.key,
      at: row.soldAt,
      timestamp: row.soldAt,
      tokenId: row.tokenId,
      salePrice: row.priceEth,
      priceEth: row.priceEth,
      priceUsd: row.priceUsd,
      currency: row.paymentSymbol ?? "ETH",
      transactionHash: row.transactionHash,
      txHash: row.transactionHash,
      marketplace: row.marketplace,
      buyerWallet: row.buyerWallet,
      sellerWallet: row.sellerWallet,
      buyerFid: row.buyerProfile?.fid ?? row.buyerFid,
      buyerUsername: row.buyerProfile?.username ?? null,
      buyerPfpUrl: row.buyerProfile?.pfpUrl ?? null,
      avatarUrl: row.buyerProfile?.pfpUrl ?? null,
      sellerFid: row.sellerProfile?.fid ?? row.sellerFid,
      sellerUsername: row.sellerProfile?.username ?? null,
      isTopFriend: false,
    }));
    const lastAt = history.at(-1)?.at ?? null;
    return jsonStats({
      ...buildMeta({
        range: "all",
        coverageStart: sales.coverageStart,
        baseline,
        complete: sales.complete,
        stale: false,
        sources: [{
          id: sales.source,
          label: "Observed sale history",
          complete: sales.complete,
          asOf: lastAt,
          ...(!sales.complete ? { note: "Only the currently available post-reset history is shown." } : {}),
        }],
      }),
      integrations: { dune },
      tokenId,
      item: item
        ? { tokenId: item.token_id, name: item.name, jpgUrl: item.jpg_url }
        : { tokenId, name: `#${tokenId}`, jpgUrl: null },
      series: { history },
      sales: history,
    });
  } catch (error) {
    return jsonError(
      "stats_price_history_unavailable",
      error instanceof Error ? error.message : String(error),
    );
  }
}

type ActivityCursor = { at: string; key: string };

type ActivityChartRepresentativeRow = {
  bucket_index: number;
  event_type: string;
  event_count: number;
  average_price_eth: number | null;
  canonical_key: string;
  token_id: number;
  price_eth: number | null;
  transaction_hash: string | null;
  from_wallet: string | null;
  from_fid: number | null;
  to_wallet: string | null;
  to_fid: number | null;
  occurred_at: string;
};

function activityBucketCount(range: StatsRange): number {
  return range === "7d" ? 7 : range === "1y" ? 12 : 10;
}

function getActivityRangeStart(range: StatsRange, now = new Date()): string {
  if (range === "all") return ANALYTICS_EPOCH;
  const days = range === "7d" ? 7 : range === "90d" ? 90 : range === "1y" ? 365 : 30;
  return new Date(now.getTime() - days * 86_400_000).toISOString();
}

function buildActivityBucketBounds(range: StatsRange, now = new Date()): Array<{ index: number; startAt: string; endAt: string }> {
  // Activity charts retain their complete selected time scale even when it begins
  // before the Jul 2 analytics epoch. The query simply finds no earlier events.
  const rangeStartMs = Date.parse(getActivityRangeStart(range, now));
  const rangeEndMs = now.getTime();
  const count = activityBucketCount(range);
  const duration = Math.max(1, rangeEndMs - rangeStartMs);
  return Array.from({ length: count }, (_, index) => ({
    index,
    startAt: new Date(rangeStartMs + (duration * index) / count).toISOString(),
    endAt: new Date(index === count - 1 ? rangeEndMs : rangeStartMs + (duration * (index + 1)) / count).toISOString(),
  }));
}

async function loadActivityChart(
  db: D1Database,
  range: StatsRange,
  tokenId: number | null,
  friendsViewerFid: number | null = null,
  favouritesWallet: string | null = null,
): Promise<{
  rangeStart: string;
  rangeEnd: string;
  bucketCount: number;
  buckets: Array<Record<string, unknown>>;
}> {
  const bounds = buildActivityBucketBounds(range);
  const rangeStart = bounds[0]!.startAt;
  const rangeEnd = bounds.at(-1)!.endAt;
  const bucketCase = bounds.map(() => "WHEN occurred_at >= ? AND occurred_at < ? THEN ?").join(" ");
  const bucketBindings = bounds.flatMap((bucket) => [bucket.startAt, bucket.endAt, bucket.index]);
  const tokenClause = tokenId !== null ? "AND a.token_id = ?" : "";
  const favouritesClause = favouritesWallet !== null ? `AND EXISTS (
       SELECT 1
       FROM warplet_favourites wf, json_each(wf.token_ids) favourite
       WHERE wf.wallet = ?
         AND CAST(favourite.value AS INTEGER) = a.token_id
     )` : "";
  const friendsClause = friendsViewerFid !== null ? `AND EXISTS (
       SELECT 1 FROM warplets_user_best_friends bf
       WHERE bf.user_fid = ?
         AND (
           bf.best_friend_fid IN (
             a.from_fid,
             CASE WHEN a.event_type = 'offer' THEN m.owner_fid ELSE a.to_fid END
           )
           OR EXISTS (
             SELECT 1 FROM wallet_farcaster_links l
             WHERE l.fid = bf.best_friend_fid
               AND LOWER(TRIM(l.wallet)) IN (
                 LOWER(TRIM(a.from_wallet)),
                 LOWER(TRIM(CASE WHEN a.event_type = 'offer' THEN m.owner_wallet ELSE a.to_wallet END))
               )
           )
         )
     )` : "";
  const result = await db.prepare(
    `WITH ranked_activity AS (
       SELECT a.*,
         CASE WHEN a.event_type = 'offer' THEN m.owner_wallet ELSE a.to_wallet END AS effective_to_wallet,
         CASE WHEN a.event_type = 'offer' THEN m.owner_fid ELSE a.to_fid END AS effective_to_fid,
         ROW_NUMBER() OVER (
           PARTITION BY CASE
             WHEN a.event_type = 'sale' THEN CAST(a.token_id AS TEXT) || ':' || COALESCE(LOWER(a.transaction_hash), LOWER(a.order_hash), a.canonical_key)
             ELSE a.canonical_key
           END
           ORDER BY CASE WHEN a.source LIKE 'opensea%' THEN 0 ELSE 1 END, a.updated_at DESC, a.canonical_key DESC
         ) AS duplicate_rank
       FROM warplet_market_activity a
       LEFT JOIN warplet_market_state m ON m.token_id = a.token_id
       WHERE a.event_type IN ('sale', 'listing', 'offer', 'transfer')
         AND a.occurred_at >= ? AND a.occurred_at < ?
         ${tokenClause}
         ${friendsClause}
         ${favouritesClause}
     ), bucketed AS (
       SELECT *, CASE ${bucketCase} ELSE NULL END AS bucket_index
       FROM ranked_activity
       WHERE duplicate_rank = 1
         AND NOT (
           event_type = 'transfer' AND EXISTS (
             SELECT 1 FROM warplet_market_activity sale
             WHERE sale.event_type = 'sale'
               AND sale.token_id = ranked_activity.token_id
               AND sale.transaction_hash IS NOT NULL
               AND LOWER(sale.transaction_hash) = LOWER(ranked_activity.transaction_hash)
           )
         )
     ), summarized AS (
       SELECT *,
         COUNT(*) OVER (PARTITION BY bucket_index, event_type) AS event_count,
         AVG(price_eth) OVER (PARTITION BY bucket_index, event_type) AS average_price_eth,
         ROW_NUMBER() OVER (
           PARTITION BY bucket_index, event_type
           ORDER BY CASE WHEN event_type = 'transfer' THEN 0 ELSE COALESCE(price_eth, -1) END DESC,
                    occurred_at DESC, canonical_key DESC
         ) AS representative_rank
       FROM bucketed
       WHERE bucket_index IS NOT NULL
     )
     SELECT bucket_index, event_type, event_count, average_price_eth, canonical_key, token_id,
            price_eth, transaction_hash, from_wallet, from_fid,
            effective_to_wallet AS to_wallet, effective_to_fid AS to_fid, occurred_at
     FROM summarized
     WHERE representative_rank = 1
     ORDER BY bucket_index ASC`
  ).bind(
    rangeStart,
    rangeEnd,
    ...(tokenId !== null ? [tokenId] : []),
    ...(friendsViewerFid !== null ? [friendsViewerFid] : []),
    ...(favouritesWallet !== null ? [favouritesWallet] : []),
    ...bucketBindings,
  ).all<ActivityChartRepresentativeRow>();
  const representatives = result.results ?? [];
  const profiles = await loadProfilesForWallets(
    db,
    representatives.flatMap((row) => [row.from_wallet, row.to_wallet]),
  );
  const byBucketAndEvent = new Map(representatives.map((row) => [`${row.bucket_index}:${row.event_type}`, row]));
  return {
    rangeStart,
    rangeEnd,
    bucketCount: bounds.length,
    buckets: bounds.map((bucket) => {
      const eventPayload = (databaseEvent: "sale" | "listing" | "offer" | "transfer") => {
        const row = byBucketAndEvent.get(`${bucket.index}:${databaseEvent}`);
        if (!row) return { count: 0, averagePriceEth: null, representativeEvent: null };
        const fromWallet = normalizeWallet(row.from_wallet);
        const toWallet = normalizeWallet(row.to_wallet);
        const fromProfile = fromWallet ? profiles.get(fromWallet) : null;
        const toProfile = toWallet ? profiles.get(toWallet) : null;
        return {
          count: row.event_count,
          averagePriceEth: databaseEvent === "transfer" ? 0 : row.average_price_eth,
          representativeEvent: {
            key: row.canonical_key,
            tokenId: row.token_id,
            priceEth: databaseEvent === "transfer" ? null : row.price_eth,
            at: row.occurred_at,
            transactionHash: row.transaction_hash,
            from: fromWallet ? { wallet: fromWallet, ...(publicProfile(fromProfile ?? null) ?? {}), fid: fromProfile?.fid ?? row.from_fid } : null,
            to: toWallet ? { wallet: toWallet, ...(publicProfile(toProfile ?? null) ?? {}), fid: toProfile?.fid ?? row.to_fid } : null,
          },
        };
      };
      const events = {
        sale: eventPayload("sale"),
        listing: eventPayload("listing"),
        offer: eventPayload("offer"),
        send: eventPayload("transfer"),
      };
      const sale = events.sale;
      return {
        ...bucket,
        events,
        saleCount: sale.count,
        averagePriceEth: sale.averagePriceEth,
        representativeSale: sale.representativeEvent ? {
          ...sale.representativeEvent,
          buyer: sale.representativeEvent.to,
          seller: sale.representativeEvent.from,
        } : null,
      };
    }),
  };
}

function decodeActivityCursor(raw: string | null): ActivityCursor | null {
  if (!raw) return null;
  try {
    const normalized = raw.replace(/-/g, "+").replace(/_/g, "/");
    const parsed = JSON.parse(atob(normalized)) as Partial<ActivityCursor>;
    return typeof parsed.at === "string" && typeof parsed.key === "string"
      ? { at: parsed.at, key: parsed.key }
      : null;
  } catch {
    return null;
  }
}

function encodeActivityCursor(cursor: ActivityCursor): string {
  return btoa(JSON.stringify(cursor)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

export async function handleStatsActivityGet(
  context: EventContext<StatsEnv, string, unknown>,
): Promise<Response> {
  const url = new URL(context.request.url);
  const range = getRange(url);
  const tokenId = asInteger(url.searchParams.get("tokenId"));
  if (tokenId !== null && (tokenId < 1 || tokenId > WARPLETS_TOTAL_SUPPLY)) {
    return jsonError("invalid_token_id", "Token ID must be between 1 and 10000.", 400);
  }
  const limit = Math.min(20, Math.max(1, asInteger(url.searchParams.get("limit")) ?? 20));
  const cursor = decodeActivityCursor(url.searchParams.get("cursor"));
  const rawEvent = url.searchParams.get("event")?.trim().toLowerCase() ?? "all";
  const event = rawEvent === "transfer" ? "send" : rawEvent;
  const validActivityEvents = new Set(["sale", "listing", "offer", "send"]);
  if (event !== "all" && !validActivityEvents.has(event)) {
    return jsonError("invalid_activity_event", "Event must be All, Sale, Listing, Offer, or Send.", 400);
  }
  const requestedEvents = url.searchParams.get("events")?.trim().toLowerCase();
  const events = requestedEvents == null
    ? event === "all" ? null : [event]
    : requestedEvents === "none" ? [] : [...new Set(requestedEvents.split(",").map((value) => value.trim() === "transfer" ? "send" : value.trim()).filter(Boolean))];
  if (events?.some((value) => !validActivityEvents.has(value))) {
    return jsonError("invalid_activity_events", "Events may contain Sale, Listing, Offer, and Send.", 400);
  }
  const databaseEvents = events?.map((value) => value === "send" ? "transfer" : value) ?? null;
  const rangeStart = getActivityRangeStart(range);
  const rangeEnd = new Date().toISOString();
  const requestedStart = url.searchParams.get("start");
  const requestedEnd = url.searchParams.get("end");
  const parsedStart = requestedStart ? Date.parse(requestedStart) : Number.NaN;
  const parsedEnd = requestedEnd ? Date.parse(requestedEnd) : Number.NaN;
  if (requestedStart && !Number.isFinite(parsedStart)) return jsonError("invalid_activity_start", "Start must be a valid datetime.", 400);
  if (requestedEnd && !Number.isFinite(parsedEnd)) return jsonError("invalid_activity_end", "End must be a valid datetime.", 400);
  const effectiveStart = new Date(Math.max(Date.parse(rangeStart), Number.isFinite(parsedStart) ? parsedStart : Number.NEGATIVE_INFINITY)).toISOString();
  const effectiveEnd = new Date(Math.min(Date.parse(rangeEnd), Number.isFinite(parsedEnd) ? parsedEnd : Number.POSITIVE_INFINITY)).toISOString();
  if (Date.parse(effectiveStart) >= Date.parse(effectiveEnd)) {
    return jsonError("invalid_activity_period", "Start must be earlier than End.", 400);
  }
  const includeChart = url.searchParams.get("chart") === "1" && !cursor;
  const friendsOnly = url.searchParams.get("friends") === "1";
  const requestedFavouritesWallet = url.searchParams.get("favouritesWallet");
  const favouritesWallet = requestedFavouritesWallet ? normalizeWallet(requestedFavouritesWallet) : null;
  if (requestedFavouritesWallet && !favouritesWallet) {
    return jsonError("invalid_favourites_wallet", "Favourites wallet must be a valid address.", 400);
  }
  const requestedFid = asInteger(url.searchParams.get("fid"));
  let viewerFid: number | null = null;
  if (friendsOnly) {
    const token = context.request.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim() || null;
    const session = await verifyActionSessionToken(context.env.ACTION_SESSION_SECRET, token);
    if (!session.valid || (requestedFid !== null && requestedFid !== session.fid)) {
      return jsonError("friends_authorization_required", "Connect to filter activity by friends.", 401);
    }
    viewerFid = session.fid;
  }

  try {
    const conditions = ["a.occurred_at >= ?", "a.occurred_at < ?"];
    const bindings: Array<string | number> = [effectiveStart, effectiveEnd];
    const countConditions = [...conditions];
    const countBindings: Array<string | number> = [...bindings];
    if (databaseEvents !== null) {
      if (databaseEvents.length === 0) conditions.push("1 = 0");
      else {
        conditions.push(`a.event_type IN (${databaseEvents.map(() => "?").join(", ")})`);
        bindings.push(...databaseEvents);
      }
    }
    if (tokenId !== null) {
      conditions.push("a.token_id = ?");
      bindings.push(tokenId);
      countConditions.push("a.token_id = ?");
      countBindings.push(tokenId);
    }
    if (friendsOnly && viewerFid !== null) {
      conditions.push(`EXISTS (
        SELECT 1 FROM warplets_user_best_friends bf
        WHERE bf.user_fid = ?
          AND (
            bf.best_friend_fid IN (a.from_fid, a.to_fid)
            OR EXISTS (
              SELECT 1 FROM wallet_farcaster_links l
              WHERE l.fid = bf.best_friend_fid
                AND LOWER(TRIM(l.wallet)) IN (LOWER(TRIM(a.from_wallet)), LOWER(TRIM(a.to_wallet)))
            )
          )
      )`);
      bindings.push(viewerFid);
      countConditions.push(conditions.at(-1)!);
      countBindings.push(viewerFid);
    }
    if (favouritesWallet !== null) {
      conditions.push(`EXISTS (
        SELECT 1
        FROM warplet_favourites wf, json_each(wf.token_ids) favourite
        WHERE wf.wallet = ?
          AND CAST(favourite.value AS INTEGER) = a.token_id
      )`);
      bindings.push(favouritesWallet);
      countConditions.push(conditions.at(-1)!);
      countBindings.push(favouritesWallet);
    }
    const filteredActivityCte = `filtered_activity AS (
         SELECT a.*,
           ROW_NUMBER() OVER (
             PARTITION BY CASE
               WHEN a.event_type = 'sale' THEN CAST(a.token_id AS TEXT) || ':' || COALESCE(LOWER(a.transaction_hash), LOWER(a.order_hash), a.canonical_key)
               ELSE a.canonical_key
             END
             ORDER BY CASE WHEN a.source LIKE 'opensea%' THEN 0 ELSE 1 END, a.updated_at DESC, a.canonical_key DESC
           ) AS duplicate_rank
         FROM warplet_market_activity a
         WHERE ${conditions.join(" AND ")}
       )`;
    const result = await context.env.WARPLETS.prepare(
      `WITH ${filteredActivityCte}
       SELECT
         a.canonical_key, a.event_type, a.token_id, a.price_eth,
         a.transaction_hash, a.order_hash, a.from_wallet, a.from_fid,
         CASE WHEN a.event_type = 'offer' THEN m.owner_wallet ELSE a.to_wallet END AS to_wallet,
         CASE WHEN a.event_type = 'offer' THEN m.owner_fid ELSE a.to_fid END AS to_fid,
         a.occurred_at
       FROM filtered_activity a
       LEFT JOIN warplet_market_state m ON m.token_id = a.token_id
       WHERE a.duplicate_rank = 1
         ${cursor ? "AND (a.occurred_at < ? OR (a.occurred_at = ? AND a.canonical_key < ?))" : ""}
         AND NOT (
           a.event_type = 'transfer' AND EXISTS (
             SELECT 1 FROM warplet_market_activity sale
             WHERE sale.event_type = 'sale'
               AND sale.token_id = a.token_id
               AND sale.transaction_hash IS NOT NULL
               AND LOWER(sale.transaction_hash) = LOWER(a.transaction_hash)
           )
         )
       ORDER BY a.occurred_at DESC, a.canonical_key DESC
       LIMIT ?`
    ).bind(...bindings, ...(cursor ? [cursor.at, cursor.at, cursor.key] : []), limit + 1).all<{
      canonical_key: string; event_type: string; token_id: number; price_eth: number | null;
      transaction_hash: string | null; order_hash: string | null;
      from_wallet: string | null; from_fid: number | null; to_wallet: string | null;
      to_fid: number | null; occurred_at: string;
    }>();
    const eventCountRows = cursor ? [] : (await context.env.WARPLETS.prepare(
      `WITH filtered_activity AS (
         SELECT a.*,
           ROW_NUMBER() OVER (
             PARTITION BY CASE
               WHEN a.event_type = 'sale' THEN CAST(a.token_id AS TEXT) || ':' || COALESCE(LOWER(a.transaction_hash), LOWER(a.order_hash), a.canonical_key)
               ELSE a.canonical_key
             END
             ORDER BY CASE WHEN a.source LIKE 'opensea%' THEN 0 ELSE 1 END, a.updated_at DESC, a.canonical_key DESC
           ) AS duplicate_rank
         FROM warplet_market_activity a
         WHERE ${countConditions.join(" AND ")}
       )
       SELECT a.event_type, COUNT(*) AS event_count
       FROM filtered_activity a
       WHERE a.duplicate_rank = 1
         AND NOT (
           a.event_type = 'transfer' AND EXISTS (
             SELECT 1 FROM warplet_market_activity sale
             WHERE sale.event_type = 'sale'
               AND sale.token_id = a.token_id
               AND sale.transaction_hash IS NOT NULL
               AND LOWER(sale.transaction_hash) = LOWER(a.transaction_hash)
           )
         )
       GROUP BY a.event_type`
    ).bind(...countBindings).all<{ event_type: string; event_count: number }>()).results ?? [];
    const eventCounts = Object.fromEntries(
      eventCountRows.map((row) => [row.event_type === "transfer" ? "send" : row.event_type, Number(row.event_count) || 0]),
    );
    const allRows = result.results ?? [];
    const hasMore = allRows.length > limit;
    const pageRows = allRows.slice(0, limit);
    const profiles = await loadProfilesForWallets(
      context.env.WARPLETS,
      pageRows.flatMap((row) => [row.from_wallet, row.to_wallet]),
    );
    const rows = pageRows.map((row) => ({
      key: row.canonical_key,
      event: row.event_type === "transfer" ? "send" : row.event_type,
      tokenId: row.token_id,
      priceEth: row.event_type === "transfer" ? null : row.price_eth,
      transactionHash: row.transaction_hash,
      orderHash: row.order_hash,
      at: row.occurred_at,
      from: row.from_wallet ? {
        wallet: normalizeWallet(row.from_wallet),
        ...(publicProfile(profiles.get(normalizeWallet(row.from_wallet) ?? "") ?? null) ?? {}),
        fid: profiles.get(normalizeWallet(row.from_wallet) ?? "")?.fid ?? row.from_fid,
      } : null,
      to: row.to_wallet ? {
        wallet: normalizeWallet(row.to_wallet),
        ...(publicProfile(profiles.get(normalizeWallet(row.to_wallet) ?? "") ?? null) ?? {}),
        fid: profiles.get(normalizeWallet(row.to_wallet) ?? "")?.fid ?? row.to_fid,
      } : null,
    }));
    const chart = includeChart
      ? await loadActivityChart(context.env.WARPLETS, range, tokenId, friendsOnly ? viewerFid : null, favouritesWallet)
      : undefined;
    const last = pageRows.at(-1);
    return jsonStats({
      analyticsEpoch: ANALYTICS_EPOCH,
      range,
      rows,
      ...(!cursor ? { eventCounts } : {}),
      ...(chart ? { chart } : {}),
      filters: { event, events, start: effectiveStart, end: effectiveEnd, favouritesWallet },
      hasMore,
      nextCursor: hasMore && last ? encodeActivityCursor({ at: last.occurred_at, key: last.canonical_key }) : null,
      asOf: pageRows[0]?.occurred_at ?? null,
    }, { private: friendsOnly });
  } catch (error) {
    return jsonError("stats_activity_unavailable", error instanceof Error ? error.message : String(error));
  }
}
