import { jsonSecure, rateLimit } from "./security.js";

export interface OpenSeaMarketEnv {
  WARPLETS: D1Database;
  WARPLETS_KV?: KVNamespace;
  OPENSEA_API_KEY?: string;
  NEYNAR_API_KEY?: string;
}

export type MarketMoney = {
  eth: number | null;
  at: string | null;
  rawAmount: string | null;
  decimals: number | null;
  currencySymbol: string | null;
  tokenAddress: string | null;
};

export type MarketSnapshot = {
  version: "opensea-market-v1";
  generatedAt: string;
  maxAgeSeconds: number;
  listings: Record<string, MarketMoney & { orderHash: string | null; seller: string | null }>;
  offers: Record<string, MarketMoney & { orderHash: string | null; offerer: string | null }>;
  sales: Record<string, MarketMoney & { txHash: string | null; seller: string | null }>;
  owners: Record<string, { wallet: string | null; fid: number | null; checkedAt: string | null }>;
};

export type OneTokenMarketResponse = {
  tokenId: number;
  snapshot: MarketSnapshot;
  refreshed: boolean;
  refreshStatus: "fresh" | "cached" | "cooldown" | "error";
  error?: string;
};

type MarketStateRow = {
  token_id: number;
  listing_eth: number | null;
  listed_at: string | null;
  listing_order_hash: string | null;
  listing_seller_wallet: string | null;
  listing_raw_amount: string | null;
  listing_decimals: number | null;
  listing_currency_symbol: string | null;
  listing_token_address: string | null;
  offer_eth: number | null;
  offered_at: string | null;
  offer_order_hash: string | null;
  offerer_wallet: string | null;
  offer_raw_amount: string | null;
  offer_decimals: number | null;
  offer_currency_symbol: string | null;
  offer_token_address: string | null;
  sale_eth: number | null;
  sold_at: string | null;
  sale_tx_hash: string | null;
  seller_wallet: string | null;
  sale_raw_amount: string | null;
  sale_decimals: number | null;
  sale_currency_symbol: string | null;
  sale_token_address: string | null;
  owner_wallet: string | null;
  owner_fid: number | null;
  owner_checked_at: string | null;
  opensea_updated_at: string | null;
};

type MarketPatch = Partial<Omit<MarketStateRow, "token_id">> & { token_id: number };

type PaginatedIngestResult = {
  changed: number;
  tokenIds: Set<number>;
  complete: boolean;
};

type CurrencyValue = {
  rawAmount: string | null;
  decimals: number | null;
  symbol: string | null;
  tokenAddress: string | null;
  eth: number | null;
};

const OPENSEA_API_BASE = "https://api.opensea.io/api/v2";
const BASE_RPC_URL = "https://mainnet.base.org";
const BASE_CHAIN = "base";
const COLLECTION_SLUG = "10xwarplets";
const COLLECTION_CONTRACT = "0x780446dd12e080ae0db762fcd4daf313f3e359de";
const BASE_WETH = "0x4200000000000000000000000000000000000006";
const NATIVE_TOKEN_ADDRESS = "0x0000000000000000000000000000000000000000";
const SNAPSHOT_TTL_SECONDS = 600;
const FORCE_REFRESH_COOLDOWN_SECONDS = 600;
const LOCAL_FORCE_REFRESH_COOLDOWN_SECONDS = 10;
const OWNER_OF_SELECTOR = "0x6352211e";
const MARKET_SNAPSHOT_KEYS = {
  manifest: "opensea:market:manifest:v1",
  listings: "opensea:market:listings:v1",
  offers: "opensea:market:offers:v1",
  sales: "opensea:market:sales:v1",
  owners: "opensea:market:owners:v1",
} as const;

const MARKET_COLUMNS = [
  "listing_eth",
  "listed_at",
  "listing_order_hash",
  "listing_seller_wallet",
  "listing_raw_amount",
  "listing_decimals",
  "listing_currency_symbol",
  "listing_token_address",
  "offer_eth",
  "offered_at",
  "offer_order_hash",
  "offerer_wallet",
  "offer_raw_amount",
  "offer_decimals",
  "offer_currency_symbol",
  "offer_token_address",
  "sale_eth",
  "sold_at",
  "sale_tx_hash",
  "seller_wallet",
  "sale_raw_amount",
  "sale_decimals",
  "sale_currency_symbol",
  "sale_token_address",
  "owner_wallet",
  "owner_fid",
  "owner_checked_at",
  "opensea_updated_at",
] as const;

function asObject(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : undefined;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function asNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function normalizeAddress(value: unknown): string | null {
  const address = asString(value)?.toLowerCase() ?? null;
  return address && /^0x[0-9a-f]{40}$/.test(address) ? address : null;
}

function normalizeTimestamp(value: unknown): string | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    const milliseconds = value > 100000000000 ? value : value * 1000;
    return new Date(milliseconds).toISOString();
  }
  const raw = asString(value);
  if (!raw) return null;
  const ms = Date.parse(raw);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : raw;
}

function getForceRefreshCooldownSeconds(request?: Request): number {
  if (!request) return FORCE_REFRESH_COOLDOWN_SECONDS;
  const hostname = new URL(request.url).hostname.toLowerCase();
  const isLocal =
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "::1" ||
    hostname.endsWith(".localhost") ||
    hostname.startsWith("search-local.");
  return isLocal ? LOCAL_FORCE_REFRESH_COOLDOWN_SECONDS : FORCE_REFRESH_COOLDOWN_SECONDS;
}

function parseTokenId(value: unknown): number | null {
  const raw = asString(value);
  if (!raw) return null;
  const lastPart = raw.split("/").filter(Boolean).pop() ?? raw;
  const parsed = Number(lastPart);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function weiToNumber(rawAmount: string, decimals: number): number | null {
  try {
    const raw = BigInt(rawAmount);
    const divisor = 10n ** BigInt(decimals);
    const whole = raw / divisor;
    const fraction = raw % divisor;
    const padded = fraction.toString().padStart(decimals, "0").slice(0, 8);
    const parsed = Number(`${whole.toString()}.${padded}`);
    return Number.isFinite(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function isEthLikeCurrency(symbol: string | null, tokenAddress: string | null, decimals?: number | null): boolean {
  const normalizedSymbol = symbol?.toUpperCase();
  if (normalizedSymbol === "ETH" || normalizedSymbol === "WETH") return true;
  if (tokenAddress === BASE_WETH || tokenAddress === NATIVE_TOKEN_ADDRESS) return true;
  return !normalizedSymbol && !tokenAddress && decimals === 18;
}

function normalizeCurrency(rawValue: unknown): CurrencyValue {
  const obj = asObject(rawValue);
  const current = asObject(obj?.current) ?? obj;
  const currency = asObject(current?.currency) ?? asObject(obj?.payment_token) ?? asObject(obj?.token);
  const rawAmount =
    asString(current?.value) ??
    asString(current?.quantity) ??
    asString(current?.amount) ??
    asString(obj?.current_price) ??
    asString(obj?.base_price);
  const decimals =
    asNumber(currency?.decimals) ??
    asNumber(current?.decimals) ??
    asNumber(obj?.decimals) ??
    null;
  const symbol = asString(currency?.symbol) ?? asString(current?.symbol) ?? asString(obj?.symbol);
  const tokenAddress = normalizeAddress(
    currency?.address ??
    currency?.contract ??
    current?.token_address ??
    obj?.token_address
  );
  const eth = rawAmount && decimals != null && isEthLikeCurrency(symbol, tokenAddress, decimals)
    ? weiToNumber(rawAmount, decimals)
    : null;
  return { rawAmount, decimals, symbol, tokenAddress, eth };
}

function firstCurrencyFromOrderItems(items: unknown[]): CurrencyValue {
  for (const item of items) {
    const obj = asObject(item);
    if (!obj) continue;
    const itemType = asNumber(obj.itemType);
    if (itemType != null && itemType !== 0 && itemType !== 1) continue;
    const rawAmount = asString(obj.startAmount) ?? asString(obj.endAmount);
    const tokenAddress = normalizeAddress(obj.token);
    const symbol = tokenAddress === BASE_WETH || tokenAddress == null ? "ETH" : null;
    const decimals = 18;
    const eth = rawAmount && isEthLikeCurrency(symbol, tokenAddress, decimals) ? weiToNumber(rawAmount, decimals) : null;
    return { rawAmount, decimals, symbol, tokenAddress, eth };
  }
  return { rawAmount: null, decimals: null, symbol: null, tokenAddress: null, eth: null };
}

function getPrice(value: Record<string, unknown>, orderItemSide: "offer" | "consideration"): CurrencyValue {
  const direct = normalizeCurrency(value.price ?? value.payment ?? value.sale_price);
  if (direct.rawAmount) return direct;
  const parameters = asObject(asObject(value.protocol_data)?.parameters);
  return firstCurrencyFromOrderItems(asArray(parameters?.[orderItemSide]));
}

function hasCurrencyValue(value: CurrencyValue): boolean {
  return Boolean(value.rawAmount || value.eth != null);
}

function getTokenIdFromOpenSeaRow(row: Record<string, unknown>): number | null {
  const nft = asObject(row.nft);
  const asset = asObject(row.asset);
  const item = asObject(row.item);
  return (
    parseTokenId(row.token_id) ??
    parseTokenId(row.identifier) ??
    parseTokenId(nft?.identifier) ??
    parseTokenId(asset?.identifier) ??
    parseTokenId(item?.nft_id)
  );
}

function getMakerAddress(row: Record<string, unknown>): string | null {
  return (
    normalizeAddress(asObject(row.maker)?.address) ??
    normalizeAddress(asObject(row.account)?.address) ??
    normalizeAddress(row.seller) ??
    normalizeAddress(row.from_account)
  );
}

async function fetchOpenSea(path: string, apiKey: string, params?: URLSearchParams): Promise<Record<string, unknown>> {
  const suffix = params?.toString();
  const response = await fetch(`${OPENSEA_API_BASE}${path}${suffix ? `?${suffix}` : ""}`, {
    headers: {
      accept: "application/json",
      "x-api-key": apiKey,
      "X-API-KEY": apiKey,
    },
    signal: AbortSignal.timeout(12000),
  });
  if (!response.ok) {
    throw new Error(`OpenSea ${path} failed (${response.status})`);
  }
  return (await response.json()) as Record<string, unknown>;
}

async function fetchBaseRpc(method: string, params: unknown[]): Promise<unknown> {
  const response = await fetch(BASE_RPC_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) throw new Error(`Base RPC failed (${response.status})`);
  const payload = (await response.json()) as Record<string, unknown>;
  if (payload.error) throw new Error("Base RPC returned an error");
  return payload.result;
}

async function ownerOf(tokenId: number): Promise<string | null> {
  const tokenHex = BigInt(tokenId).toString(16).padStart(64, "0");
  const data = `${OWNER_OF_SELECTOR}${tokenHex}`;
  const result = await fetchBaseRpc("eth_call", [{ to: COLLECTION_CONTRACT, data }, "latest"]);
  const hex = asString(result);
  if (!hex || hex.length < 66) return null;
  return normalizeAddress(`0x${hex.slice(-40)}`);
}

async function selectPreferredFidForWallet(env: OpenSeaMarketEnv, wallet: string): Promise<number | null> {
  const cached = await env.WARPLETS.prepare(
    `SELECT fid
     FROM wallet_farcaster_links
     WHERE wallet = ?
     ORDER BY COALESCE(score, -1) DESC, fid ASC
     LIMIT 1`
  ).bind(wallet).first<{ fid: number | null }>();
  if (typeof cached?.fid === "number") return cached.fid;

  const apiKey = env.NEYNAR_API_KEY?.trim();
  if (!apiKey) return null;

  try {
    const endpoint = `https://api.neynar.com/v2/farcaster/user/bulk-by-address?addresses=${encodeURIComponent(wallet)}&viewer_fid=1129138`;
    const response = await fetch(endpoint, {
      headers: { "x-api-key": apiKey },
      signal: AbortSignal.timeout(9000),
    });
    if (!response.ok) return null;
    const payload = (await response.json()) as Record<string, unknown>;
    const users = asArray(payload[wallet]) || asArray(asObject(payload.result)?.[wallet]) || asArray(payload.users);
    const rows = users
      .map((user) => {
        const obj = asObject(user);
        const fid = asNumber(obj?.fid);
        if (!fid || !Number.isInteger(fid)) return null;
        return {
          fid,
          score: asNumber(obj?.score),
          username: asString(obj?.username),
          pfpUrl: asString(obj?.pfp_url),
        };
      })
      .filter((row): row is { fid: number; score: number | null; username: string | null; pfpUrl: string | null } => row !== null)
      .sort((a, b) => (b.score ?? -1) - (a.score ?? -1) || a.fid - b.fid);

    const now = new Date().toISOString();
    for (const row of rows) {
      await env.WARPLETS.prepare(
        `INSERT INTO wallet_farcaster_links (wallet, fid, score, username, pfp_url, fetched_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(wallet, fid) DO UPDATE SET
           score = excluded.score,
           username = excluded.username,
           pfp_url = excluded.pfp_url,
           fetched_at = excluded.fetched_at`
      ).bind(wallet, row.fid, row.score, row.username, row.pfpUrl, now).run();
    }
    return rows[0]?.fid ?? null;
  } catch {
    return null;
  }
}

async function initializeOwnersFromMetadata(db: D1Database): Promise<void> {
  await db.prepare(
    `INSERT OR IGNORE INTO warplet_market_state (
       token_id, owner_wallet, owner_checked_at, created_at, updated_at
     )
     SELECT token_id, LOWER(TRIM(warplet_wallet)), NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
     FROM warplets_metadata
     WHERE warplet_wallet IS NOT NULL AND TRIM(warplet_wallet) <> ''`
  ).run();
}

async function upsertMarketStateIfChanged(db: D1Database, patch: MarketPatch): Promise<boolean> {
  const current = await db
    .prepare(`SELECT ${MARKET_COLUMNS.join(", ")} FROM warplet_market_state WHERE token_id = ?`)
    .bind(patch.token_id)
    .first<Record<string, unknown>>();

  const updates = MARKET_COLUMNS.filter((column) => Object.prototype.hasOwnProperty.call(patch, column));
  if (updates.length === 0) return false;

  const changed = updates.some((column) => {
    const next = patch[column as keyof MarketPatch] ?? null;
    const prev = current?.[column] ?? null;
    return String(next ?? "") !== String(prev ?? "");
  });
  if (current && !changed) return false;

  const now = new Date().toISOString();
  if (!current) {
    const insertColumns = ["token_id", ...updates, "created_at", "updated_at"];
    const placeholders = insertColumns.map(() => "?").join(", ");
    const values = [
      patch.token_id,
      ...updates.map((column) => patch[column as keyof MarketPatch] ?? null),
      now,
      now,
    ];
    await db.prepare(
      `INSERT INTO warplet_market_state (${insertColumns.join(", ")}) VALUES (${placeholders})`
    ).bind(...values).run();
    return true;
  }

  const values = [...updates.map((column) => patch[column as keyof MarketPatch] ?? null), now, patch.token_id];
  await db.prepare(
    `UPDATE warplet_market_state
     SET ${updates.map((column) => `${column} = ?`).join(", ")}, updated_at = ?
     WHERE token_id = ?`
  ).bind(...values).run();
  return true;
}

function snapshotFromRows(rows: MarketStateRow[], generatedAt = new Date().toISOString()): MarketSnapshot {
  const snapshot: MarketSnapshot = {
    version: "opensea-market-v1",
    generatedAt,
    maxAgeSeconds: SNAPSHOT_TTL_SECONDS,
    listings: {},
    offers: {},
    sales: {},
    owners: {},
  };

  for (const row of rows) {
    const key = String(row.token_id);
    if (row.listing_eth != null || row.listing_raw_amount) {
      snapshot.listings[key] = {
        eth: row.listing_eth,
        at: row.listed_at,
        rawAmount: row.listing_raw_amount,
        decimals: row.listing_decimals,
        currencySymbol: row.listing_currency_symbol,
        tokenAddress: row.listing_token_address,
        orderHash: row.listing_order_hash,
        seller: row.listing_seller_wallet,
      };
    }
    if (row.offer_eth != null || row.offer_raw_amount) {
      snapshot.offers[key] = {
        eth: row.offer_eth,
        at: row.offered_at,
        rawAmount: row.offer_raw_amount,
        decimals: row.offer_decimals,
        currencySymbol: row.offer_currency_symbol,
        tokenAddress: row.offer_token_address,
        orderHash: row.offer_order_hash,
        offerer: row.offerer_wallet,
      };
    }
    if (row.sale_eth != null || row.sold_at || row.sale_raw_amount) {
      snapshot.sales[key] = {
        eth: row.sale_eth,
        at: row.sold_at,
        rawAmount: row.sale_raw_amount,
        decimals: row.sale_decimals,
        currencySymbol: row.sale_currency_symbol,
        tokenAddress: row.sale_token_address,
        txHash: row.sale_tx_hash,
        seller: row.seller_wallet,
      };
    }
    if (row.owner_wallet || row.owner_fid != null || row.owner_checked_at) {
      snapshot.owners[key] = {
        wallet: row.owner_wallet,
        fid: row.owner_fid,
        checkedAt: row.owner_checked_at,
      };
    }
  }
  return snapshot;
}

export async function loadMarketSnapshotFromD1(env: OpenSeaMarketEnv): Promise<MarketSnapshot> {
  await initializeOwnersFromMetadata(env.WARPLETS);
  const rows = await env.WARPLETS.prepare(
    `SELECT token_id, ${MARKET_COLUMNS.filter((column) => column !== "opensea_updated_at").join(", ")}
     FROM warplet_market_state
     ORDER BY token_id ASC`
  ).all<MarketStateRow>();
  return snapshotFromRows(rows.results ?? []);
}

export async function loadMarketSnapshot(env: OpenSeaMarketEnv): Promise<MarketSnapshot> {
  const kv = env.WARPLETS_KV;
  if (kv) {
    const manifest = await kv.get(MARKET_SNAPSHOT_KEYS.manifest, "json") as { generatedAt?: string } | null;
    const [listings, offers, sales, owners] = await Promise.all([
      kv.get(MARKET_SNAPSHOT_KEYS.listings, "json"),
      kv.get(MARKET_SNAPSHOT_KEYS.offers, "json"),
      kv.get(MARKET_SNAPSHOT_KEYS.sales, "json"),
      kv.get(MARKET_SNAPSHOT_KEYS.owners, "json"),
    ]);
    if (manifest?.generatedAt && listings && offers && sales && owners) {
      return {
        version: "opensea-market-v1",
        generatedAt: manifest.generatedAt,
        maxAgeSeconds: SNAPSHOT_TTL_SECONDS,
        listings: listings as MarketSnapshot["listings"],
        offers: offers as MarketSnapshot["offers"],
        sales: sales as MarketSnapshot["sales"],
        owners: owners as MarketSnapshot["owners"],
      };
    }
  }
  return loadMarketSnapshotFromD1(env);
}

export async function publishMarketSnapshot(env: OpenSeaMarketEnv): Promise<MarketSnapshot> {
  const snapshot = await loadMarketSnapshotFromD1(env);
  const kv = env.WARPLETS_KV;
  if (kv) {
    await Promise.all([
      kv.put(MARKET_SNAPSHOT_KEYS.manifest, JSON.stringify({
        version: snapshot.version,
        generatedAt: snapshot.generatedAt,
        maxAgeSeconds: snapshot.maxAgeSeconds,
      }), { expirationTtl: SNAPSHOT_TTL_SECONDS * 6 }),
      kv.put(MARKET_SNAPSHOT_KEYS.listings, JSON.stringify(snapshot.listings), { expirationTtl: SNAPSHOT_TTL_SECONDS * 6 }),
      kv.put(MARKET_SNAPSHOT_KEYS.offers, JSON.stringify(snapshot.offers), { expirationTtl: SNAPSHOT_TTL_SECONDS * 6 }),
      kv.put(MARKET_SNAPSHOT_KEYS.sales, JSON.stringify(snapshot.sales), { expirationTtl: SNAPSHOT_TTL_SECONDS * 6 }),
      kv.put(MARKET_SNAPSHOT_KEYS.owners, JSON.stringify(snapshot.owners), { expirationTtl: SNAPSHOT_TTL_SECONDS * 6 }),
    ]);
  }
  return snapshot;
}

async function processListing(env: OpenSeaMarketEnv, row: Record<string, unknown>): Promise<boolean> {
  const tokenId = getTokenIdFromOpenSeaRow(row);
  if (!tokenId) return false;
  const price = getPrice(row, "consideration");
  return upsertMarketStateIfChanged(env.WARPLETS, {
    token_id: tokenId,
    listing_eth: price.eth,
    listed_at: normalizeTimestamp(row.created_date ?? row.listed_at ?? row.event_timestamp),
    listing_order_hash: asString(row.order_hash),
    listing_seller_wallet: getMakerAddress(row),
    listing_raw_amount: price.rawAmount,
    listing_decimals: price.decimals,
    listing_currency_symbol: price.symbol,
    listing_token_address: price.tokenAddress,
    opensea_updated_at: new Date().toISOString(),
  });
}

async function processOffer(env: OpenSeaMarketEnv, row: Record<string, unknown>): Promise<boolean> {
  const tokenId = getTokenIdFromOpenSeaRow(row);
  if (!tokenId) return false;
  const price = getPrice(row, "offer");
  return upsertMarketStateIfChanged(env.WARPLETS, {
    token_id: tokenId,
    offer_eth: price.eth,
    offered_at: normalizeTimestamp(row.created_date ?? row.offered_at ?? row.event_timestamp),
    offer_order_hash: asString(row.order_hash),
    offerer_wallet: getMakerAddress(row),
    offer_raw_amount: price.rawAmount,
    offer_decimals: price.decimals,
    offer_currency_symbol: price.symbol,
    offer_token_address: price.tokenAddress,
    opensea_updated_at: new Date().toISOString(),
  });
}

async function clearTokenMarketSide(
  env: OpenSeaMarketEnv,
  tokenId: number,
  side: "listing" | "offer",
): Promise<boolean> {
  const now = new Date().toISOString();
  if (side === "listing") {
    return upsertMarketStateIfChanged(env.WARPLETS, {
      token_id: tokenId,
      listing_eth: null,
      listed_at: null,
      listing_order_hash: null,
      listing_seller_wallet: null,
      listing_raw_amount: null,
      listing_decimals: null,
      listing_currency_symbol: null,
      listing_token_address: null,
      opensea_updated_at: now,
    });
  }

  return upsertMarketStateIfChanged(env.WARPLETS, {
    token_id: tokenId,
    offer_eth: null,
    offered_at: null,
    offer_order_hash: null,
    offerer_wallet: null,
    offer_raw_amount: null,
    offer_decimals: null,
    offer_currency_symbol: null,
    offer_token_address: null,
    opensea_updated_at: now,
  });
}

async function processSaleOrTransfer(env: OpenSeaMarketEnv, row: Record<string, unknown>): Promise<boolean> {
  const tokenId = getTokenIdFromOpenSeaRow(row);
  if (!tokenId) return false;
  const eventType = asString(row.event_type)?.toLowerCase();
  const price = getPrice(row, "consideration");
  const buyer = normalizeAddress(row.to_address ?? row.to_account ?? asObject(row.to_account)?.address ?? asObject(row.winner_account)?.address);
  const seller = normalizeAddress(row.from_address ?? row.from_account ?? asObject(row.from_account)?.address ?? asObject(row.seller)?.address);
  const checkedAt = new Date().toISOString();
  const ownerWallet = buyer;
  const ownerFid = ownerWallet ? await selectPreferredFidForWallet(env, ownerWallet) : null;
  const patch: MarketPatch = {
    token_id: tokenId,
    opensea_updated_at: checkedAt,
  };
  if (ownerWallet) {
    patch.owner_wallet = ownerWallet;
    patch.owner_fid = ownerFid;
    patch.owner_checked_at = checkedAt;
  }
  if (eventType === "sale") {
    patch.sale_eth = price.eth;
    patch.sold_at = normalizeTimestamp(row.event_timestamp ?? row.created_date ?? row.sold_at);
    patch.sale_tx_hash = asString(row.transaction) ?? asString(asObject(row.transaction)?.transaction_hash);
    patch.seller_wallet = seller;
    patch.sale_raw_amount = price.rawAmount;
    patch.sale_decimals = price.decimals;
    patch.sale_currency_symbol = price.symbol;
    patch.sale_token_address = price.tokenAddress;
  }
  return upsertMarketStateIfChanged(env.WARPLETS, patch);
}

async function ingestPaginated(
  env: OpenSeaMarketEnv,
  apiKey: string,
  path: string,
  rowKeys: string[],
  processor: (env: OpenSeaMarketEnv, row: Record<string, unknown>) => Promise<boolean>,
  maxPages: number,
): Promise<PaginatedIngestResult> {
  let cursor: string | null = null;
  let changed = 0;
  let complete = false;
  const tokenIds = new Set<number>();
  for (let page = 0; page < maxPages; page += 1) {
    const params = new URLSearchParams({ limit: "200" });
    if (cursor) params.set("next", cursor);
    const payload = await fetchOpenSea(path, apiKey, params);
    const rows = rowKeys.flatMap((key) => asArray(payload[key]));
    for (const item of rows) {
      const row = asObject(item);
      if (!row) continue;
      const tokenId = getTokenIdFromOpenSeaRow(row);
      if (tokenId) tokenIds.add(tokenId);
      if (await processor(env, row)) changed += 1;
    }
    cursor = asString(payload.next);
    if (!cursor || rows.length === 0) {
      complete = true;
      break;
    }
  }
  return { changed, tokenIds, complete };
}

async function clearInactiveMarketRows(
  db: D1Database,
  side: "listing" | "offer",
  activeTokenIds: Set<number>,
): Promise<number> {
  const config = side === "listing"
    ? {
      selectWhere: `listing_raw_amount IS NOT NULL OR listing_eth IS NOT NULL OR listed_at IS NOT NULL OR listing_order_hash IS NOT NULL`,
      clearSql: `listing_eth = NULL,
        listed_at = NULL,
        listing_order_hash = NULL,
        listing_seller_wallet = NULL,
        listing_raw_amount = NULL,
        listing_decimals = NULL,
        listing_currency_symbol = NULL,
        listing_token_address = NULL`,
    }
    : {
      selectWhere: `offer_raw_amount IS NOT NULL OR offer_eth IS NOT NULL OR offered_at IS NOT NULL OR offer_order_hash IS NOT NULL`,
      clearSql: `offer_eth = NULL,
        offered_at = NULL,
        offer_order_hash = NULL,
        offerer_wallet = NULL,
        offer_raw_amount = NULL,
        offer_decimals = NULL,
        offer_currency_symbol = NULL,
        offer_token_address = NULL`,
    };

  const current = await db.prepare(
    `SELECT token_id FROM warplet_market_state WHERE ${config.selectWhere}`
  ).all<{ token_id: number }>();
  const staleTokenIds = (current.results ?? [])
    .map((row) => row.token_id)
    .filter((tokenId) => Number.isInteger(tokenId) && !activeTokenIds.has(tokenId));
  if (staleTokenIds.length === 0) return 0;

  const now = new Date().toISOString();
  for (let index = 0; index < staleTokenIds.length; index += 50) {
    const chunk = staleTokenIds.slice(index, index + 50);
    const placeholders = chunk.map(() => "?").join(", ");
    await db.prepare(
      `UPDATE warplet_market_state
       SET ${config.clearSql}, updated_at = ?
       WHERE token_id IN (${placeholders})`
    ).bind(now, ...chunk).run();
  }
  return staleTokenIds.length;
}

async function ingestCollectionEvents(
  env: OpenSeaMarketEnv,
  apiKey: string,
  eventType: "sale" | "transfer",
  after: string | null,
): Promise<number> {
  const eventParams = new URLSearchParams({ limit: "200" });
  eventParams.set("event_type", eventType);
  if (after) eventParams.set("after", after);

  const events = await fetchOpenSea(`/events/collection/${COLLECTION_SLUG}`, apiKey, eventParams);
  let changed = 0;
  for (const event of asArray(events.asset_events ?? events.events)) {
    const row = asObject(event);
    if (!row) continue;
    if (await processSaleOrTransfer(env, row)) {
      changed += 1;
    }
  }
  return changed;
}

async function fetchLatestTokenSale(apiKey: string, tokenId: number): Promise<Record<string, unknown> | null> {
  const eventParams = new URLSearchParams({ event_type: "sale", limit: "50" });
  let payload: Record<string, unknown>;
  try {
    payload = await fetchOpenSea(
      `/events/chain/${BASE_CHAIN}/contract/${COLLECTION_CONTRACT}/nfts/${encodeURIComponent(String(tokenId))}`,
      apiKey,
      eventParams,
    );
  } catch {
    const fallbackParams = new URLSearchParams({ event_type: "sale", limit: "200" });
    payload = await fetchOpenSea(`/events/collection/${COLLECTION_SLUG}`, apiKey, fallbackParams);
  }
  const rows = asArray(payload.asset_events ?? payload.events)
    .map((event) => asObject(event))
    .filter((event): event is Record<string, unknown> => Boolean(event))
    .map((event): Record<string, unknown> => ({ ...event, event_type: asString(event.event_type) ?? "sale", identifier: String(tokenId) }))
    .filter((event) => getTokenIdFromOpenSeaRow(event) === tokenId);

  rows.sort((a, b) => {
    const aTimestamp = Date.parse(normalizeTimestamp(a["event_timestamp"] ?? a["created_date"] ?? a["sold_at"]) ?? "");
    const bTimestamp = Date.parse(normalizeTimestamp(b["event_timestamp"] ?? b["created_date"] ?? b["sold_at"]) ?? "");
    return (Number.isFinite(bTimestamp) ? bTimestamp : 0) - (Number.isFinite(aTimestamp) ? aTimestamp : 0);
  });

  return rows[0] ?? null;
}

export async function ingestOpenSeaMarket(env: OpenSeaMarketEnv): Promise<{ changed: number; generatedAt: string }> {
  const apiKey = env.OPENSEA_API_KEY?.trim();
  if (!apiKey) throw new Error("OPENSEA_API_KEY is not configured");

  await initializeOwnersFromMetadata(env.WARPLETS);
  let changed = 0;
  const listings = await ingestPaginated(env, apiKey, `/listings/collection/${COLLECTION_SLUG}/all`, ["listings", "orders"], processListing, 50);
  changed += listings.changed;
  if (listings.complete) changed += await clearInactiveMarketRows(env.WARPLETS, "listing", listings.tokenIds);

  const offers = await ingestPaginated(env, apiKey, `/offers/collection/${COLLECTION_SLUG}/all`, ["offers", "orders"], processOffer, 50);
  changed += offers.changed;
  if (offers.complete) changed += await clearInactiveMarketRows(env.WARPLETS, "offer", offers.tokenIds);

  const last = await env.WARPLETS.prepare("SELECT value FROM opensea_ingest_state WHERE key = 'events_after'").first<{ value: string | null }>();
  const after = last?.value ?? null;
  for (const eventType of ["sale", "transfer"] as const) {
    changed += await ingestCollectionEvents(env, apiKey, eventType, after);
  }

  await env.WARPLETS.prepare(
    `INSERT INTO opensea_ingest_state (key, value, updated_at)
     VALUES ('events_after', ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
  ).bind(String(Math.floor(Date.now() / 1000)), new Date().toISOString()).run();

  const snapshot = await publishMarketSnapshot(env);
  return { changed, generatedAt: snapshot.generatedAt };
}

export async function refreshOneTokenMarket(
  env: OpenSeaMarketEnv,
  tokenId: number,
  request?: Request,
): Promise<OneTokenMarketResponse> {
  if (!Number.isInteger(tokenId) || tokenId <= 0) {
    throw new Error("Invalid token id");
  }

  const subject = String(tokenId);
  const cooldownSeconds = getForceRefreshCooldownSeconds(request);
  const cooldownNamespace = cooldownSeconds === LOCAL_FORCE_REFRESH_COOLDOWN_SECONDS
    ? "opensea-token-refresh-local"
    : "opensea-token-refresh";
  const refreshRate = await rateLimit(env.WARPLETS_KV, cooldownNamespace, subject, 1, cooldownSeconds);
  if (!refreshRate.allowed) {
    return {
      tokenId,
      snapshot: await loadOneTokenSnapshot(env, tokenId),
      refreshed: false,
      refreshStatus: "cooldown",
    };
  }

  const apiKey = env.OPENSEA_API_KEY?.trim();
  if (!apiKey) {
    return {
      tokenId,
      snapshot: await loadOneTokenSnapshot(env, tokenId),
      refreshed: false,
      refreshStatus: "error",
      error: "OPENSEA_API_KEY is not configured",
    };
  }

  try {
    const [listingPayload, offerPayload, salePayload, ownerWallet] = await Promise.all([
      fetchOpenSea(`/listings/collection/${COLLECTION_SLUG}/nfts/${encodeURIComponent(String(tokenId))}/best`, apiKey).catch(() => null),
      fetchOpenSea(`/offers/collection/${COLLECTION_SLUG}/nfts/${encodeURIComponent(String(tokenId))}/best`, apiKey).catch(() => null),
      fetchLatestTokenSale(apiKey, tokenId).catch(() => null),
      ownerOf(tokenId).catch(() => null),
    ]);
    const now = new Date().toISOString();
    if (listingPayload) {
      const listing = asObject(listingPayload.listing) ?? listingPayload;
      const listingRow = { ...listing, identifier: String(tokenId), created_date: listing.created_date ?? now };
      if (hasCurrencyValue(getPrice(listingRow, "consideration"))) {
        await processListing(env, listingRow);
      } else {
        await clearTokenMarketSide(env, tokenId, "listing");
      }
    } else {
      await clearTokenMarketSide(env, tokenId, "listing");
    }
    if (offerPayload) {
      const offer = asObject(offerPayload.offer) ?? offerPayload;
      const offerRow = { ...offer, identifier: String(tokenId), created_date: offer.created_date ?? now };
      if (hasCurrencyValue(getPrice(offerRow, "offer"))) {
        await processOffer(env, offerRow);
      } else {
        await clearTokenMarketSide(env, tokenId, "offer");
      }
    } else {
      await clearTokenMarketSide(env, tokenId, "offer");
    }
    if (salePayload) {
      await processSaleOrTransfer(env, salePayload);
    }
    if (ownerWallet) {
      const ownerFid = await selectPreferredFidForWallet(env, ownerWallet);
      await upsertMarketStateIfChanged(env.WARPLETS, {
        token_id: tokenId,
        owner_wallet: ownerWallet,
        owner_fid: ownerFid,
        owner_checked_at: now,
        opensea_updated_at: now,
      });
    }
    await publishMarketSnapshot(env);
    return {
      tokenId,
      snapshot: await loadOneTokenSnapshot(env, tokenId),
      refreshed: true,
      refreshStatus: "fresh",
    };
  } catch (error) {
    return {
      tokenId,
      snapshot: await loadOneTokenSnapshot(env, tokenId),
      refreshed: false,
      refreshStatus: "error",
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function loadOneTokenSnapshot(env: OpenSeaMarketEnv, tokenId: number): Promise<MarketSnapshot> {
  const row = await env.WARPLETS.prepare(
    `SELECT token_id, ${MARKET_COLUMNS.filter((column) => column !== "opensea_updated_at").join(", ")}
     FROM warplet_market_state
     WHERE token_id = ?`
  ).bind(tokenId).first<MarketStateRow>();
  return snapshotFromRows(row ? [row] : [], new Date().toISOString());
}

export function marketJson(data: unknown, init?: ResponseInit): Response {
  const response = jsonSecure(data, init);
  response.headers.set("cache-control", "public, max-age=60, stale-while-revalidate=600");
  return response;
}
