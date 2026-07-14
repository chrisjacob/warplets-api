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

export type MarketOrderMoney = MarketMoney & {
  orderHash: string | null;
  protocolAddress?: string | null;
};

export type MarketSnapshot = {
  version: "opensea-market-v1";
  generatedAt: string;
  maxAgeSeconds: number;
  collection?: {
    floor: MarketMoney | null;
    topOffer: MarketOrderMoney & { offerer: string | null; source: "collection" } | null;
  };
  listings: Record<string, MarketOrderMoney & { seller: string | null }>;
  offers: Record<string, MarketOrderMoney & { offerer: string | null; source?: "item" }>;
  sales: Record<string, MarketMoney & { txHash: string | null; seller: string | null }>;
  owners: Record<string, {
    wallet: string | null;
    fid: number | null;
    checkedAt: string | null;
    username?: string | null;
    displayName?: string | null;
    pfpUrl?: string | null;
    bio?: string | null;
    followerCount?: number | null;
    followingCount?: number | null;
  }>;
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
  listing_protocol_address: string | null;
  listing_seller_wallet: string | null;
  listing_raw_amount: string | null;
  listing_decimals: number | null;
  listing_currency_symbol: string | null;
  listing_token_address: string | null;
  offer_eth: number | null;
  offered_at: string | null;
  offer_order_hash: string | null;
  offer_protocol_address: string | null;
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
  owner_username?: string | null;
  owner_display_name?: string | null;
  owner_pfp_url?: string | null;
  owner_profile_bio_text?: string | null;
  owner_follower_count?: number | null;
  owner_following_count?: number | null;
  opensea_updated_at: string | null;
};

export type MarketPatch = Partial<Omit<MarketStateRow, "token_id">> & { token_id: number };

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

type CollectionMarketRow = {
  collection_slug: string;
  floor_eth: number | null;
  floor_raw_amount: string | null;
  floor_decimals: number | null;
  floor_currency_symbol: string | null;
  floor_token_address: string | null;
  floor_updated_at: string | null;
  top_offer_eth: number | null;
  top_offer_raw_amount: string | null;
  top_offer_decimals: number | null;
  top_offer_currency_symbol: string | null;
  top_offer_token_address: string | null;
  top_offer_order_hash: string | null;
  top_offer_protocol_address: string | null;
  top_offerer_wallet: string | null;
  top_offer_created_at: string | null;
  top_offer_updated_at: string | null;
};

type WalletFarcasterLinkRow = {
  fid: number | null;
  username?: string | null;
  pfp_url?: string | null;
  profile_bio_text?: string | null;
  follower_count?: number | null;
  following_count?: number | null;
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
  collection: "opensea:market:collection:v1",
  listings: "opensea:market:listings:v1",
  offers: "opensea:market:offers:v1",
  sales: "opensea:market:sales:v1",
  owners: "opensea:market:owners:v1",
} as const;

const MARKET_COLUMNS = [
  "listing_eth",
  "listed_at",
  "listing_order_hash",
  "listing_protocol_address",
  "listing_seller_wallet",
  "listing_raw_amount",
  "listing_decimals",
  "listing_currency_symbol",
  "listing_token_address",
  "offer_eth",
  "offered_at",
  "offer_order_hash",
  "offer_protocol_address",
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
const MARKET_SELECT_COLUMNS = MARKET_COLUMNS.filter((column) => column !== "opensea_updated_at").join(", ");
const LEGACY_MARKET_SELECT_COLUMNS = MARKET_COLUMNS
  .filter((column) => (
    column !== "opensea_updated_at" &&
    column !== "listing_protocol_address" &&
    column !== "offer_protocol_address"
  ))
  .join(", ");
const MARKET_PROFILE_SELECT_COLUMNS = [
  "m.token_id",
  ...MARKET_COLUMNS.filter((column) => column !== "opensea_updated_at").map((column) => `m.${column}`),
  "l.username AS owner_username",
  "l.display_name AS owner_display_name",
  "l.pfp_url AS owner_pfp_url",
  "l.profile_bio_text AS owner_profile_bio_text",
  "l.follower_count AS owner_follower_count",
  "l.following_count AS owner_following_count",
].join(", ");
const LEGACY_MARKET_PROFILE_SELECT_COLUMNS = [
  "m.token_id",
  ...MARKET_COLUMNS
    .filter((column) => (
      column !== "opensea_updated_at" &&
      column !== "listing_protocol_address" &&
      column !== "offer_protocol_address"
    ))
    .map((column) => `m.${column}`),
  "l.username AS owner_username",
  "l.display_name AS owner_display_name",
  "l.pfp_url AS owner_pfp_url",
  "l.profile_bio_text AS owner_profile_bio_text",
  "l.follower_count AS owner_follower_count",
  "l.following_count AS owner_following_count",
].join(", ");

export function asObject(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : undefined;
}

export function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

export function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function asNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

export function normalizeAddress(value: unknown): string | null {
  const address = asString(value)?.toLowerCase() ?? null;
  return address && /^0x[0-9a-f]{40}$/.test(address) ? address : null;
}

export function normalizeTimestamp(value: unknown): string | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    const milliseconds = value > 100000000000 ? value : value * 1000;
    return new Date(milliseconds).toISOString();
  }
  const raw = asString(value);
  if (!raw) return null;
  if (/^\d+$/.test(raw)) {
    const parsed = Number(raw);
    if (Number.isFinite(parsed)) {
      const milliseconds = parsed > 100000000000 ? parsed : parsed * 1000;
      return new Date(milliseconds).toISOString();
    }
  }
  const ms = Date.parse(raw);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : raw;
}

export function getOrderCreatedAt(row: Record<string, unknown>): string | null {
  const protocolData = asObject(row.protocol_data) ?? asObject(row.protocolData);
  const parameters = asObject(protocolData?.parameters);
  return normalizeTimestamp(
    row.created_date ??
    row.created_at ??
    row.createdDate ??
    row.listed_at ??
    row.offered_at ??
    row.event_timestamp ??
    row.start_time ??
    row.startTime ??
    parameters?.startTime ??
    parameters?.start_time
  );
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

export function weiToNumber(rawAmount: string, decimals: number): number | null {
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

export function isEthLikeCurrency(symbol: string | null, tokenAddress: string | null, decimals?: number | null): boolean {
  const normalizedSymbol = symbol?.toUpperCase();
  if (normalizedSymbol === "ETH" || normalizedSymbol === "WETH") return true;
  if (tokenAddress === BASE_WETH || tokenAddress === NATIVE_TOKEN_ADDRESS) return true;
  return !normalizedSymbol && !tokenAddress && decimals === 18;
}

export function normalizeCurrency(rawValue: unknown): CurrencyValue {
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

export function getPrice(value: Record<string, unknown>, orderItemSide: "offer" | "consideration"): CurrencyValue {
  const direct = normalizeCurrency(value.price ?? value.payment ?? value.sale_price);
  if (direct.rawAmount) return direct;
  const parameters = asObject(asObject(value.protocol_data)?.parameters);
  return firstCurrencyFromOrderItems(asArray(parameters?.[orderItemSide]));
}

export function hasCurrencyValue(value: CurrencyValue): boolean {
  return Boolean(value.rawAmount || value.eth != null);
}

export function getTokenIdFromOpenSeaRow(row: Record<string, unknown>): number | null {
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

export function getMakerAddress(row: Record<string, unknown>): string | null {
  const protocolData = asObject(row.protocol_data) ?? asObject(row.protocolData);
  const parameters = asObject(protocolData?.parameters);
  const maker = asObject(row.maker);
  const account = asObject(row.account);
  const fromAccount = asObject(row.from_account) ?? asObject(row.fromAccount);
  return (
    normalizeAddress(maker?.address) ??
    normalizeAddress(row.maker) ??
    normalizeAddress(account?.address) ??
    normalizeAddress(row.account) ??
    normalizeAddress(row.maker_address) ??
    normalizeAddress(row.makerAddress) ??
    normalizeAddress(row.seller) ??
    normalizeAddress(row.offerer) ??
    normalizeAddress(row.from_address) ??
    normalizeAddress(row.fromAddress) ??
    normalizeAddress(fromAccount?.address) ??
    normalizeAddress(parameters?.offerer)
  );
}

export async function fetchOpenSea(path: string, apiKey: string, params?: URLSearchParams): Promise<Record<string, unknown>> {
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

export async function ownerOf(tokenId: number): Promise<string | null> {
  const tokenHex = BigInt(tokenId).toString(16).padStart(64, "0");
  const data = `${OWNER_OF_SELECTOR}${tokenHex}`;
  const result = await fetchBaseRpc("eth_call", [{ to: COLLECTION_CONTRACT, data }, "latest"]);
  const hex = asString(result);
  if (!hex || hex.length < 66) return null;
  return normalizeAddress(`0x${hex.slice(-40)}`);
}

export async function selectPreferredFidForWallet(env: OpenSeaMarketEnv, wallet: string): Promise<number | null> {
  let cached: WalletFarcasterLinkRow | null = null;
  try {
    cached = await env.WARPLETS.prepare(
      `SELECT fid, username, pfp_url, profile_bio_text, follower_count, following_count
       FROM wallet_farcaster_links
       WHERE wallet = ?
       ORDER BY COALESCE(score, -1) DESC, fid ASC
       LIMIT 1`
    ).bind(wallet).first<WalletFarcasterLinkRow>();
    if (
      typeof cached?.fid === "number" &&
      cached.username &&
      cached.pfp_url &&
      (cached.profile_bio_text || cached.follower_count != null || cached.following_count != null)
    ) {
      return cached.fid;
    }
  } catch {
    cached = await env.WARPLETS.prepare(
      `SELECT fid, username, pfp_url
       FROM wallet_farcaster_links
       WHERE wallet = ?
       ORDER BY COALESCE(score, -1) DESC, fid ASC
       LIMIT 1`
    ).bind(wallet).first<WalletFarcasterLinkRow>();
    if (typeof cached?.fid === "number") return cached.fid;
  }

  const apiKey = env.NEYNAR_API_KEY?.trim();
  if (!apiKey) return typeof cached?.fid === "number" ? cached.fid : null;

  try {
    const endpoint = `https://api.neynar.com/v2/farcaster/user/bulk-by-address?addresses=${encodeURIComponent(wallet)}&viewer_fid=1129138`;
    const response = await fetch(endpoint, {
      headers: { "x-api-key": apiKey },
      signal: AbortSignal.timeout(9000),
    });
    if (!response.ok) return null;
    const payload = (await response.json()) as Record<string, unknown>;
    const result = asObject(payload.result);
    const normalizedWallet = wallet.toLowerCase();
    const payloadWalletEntry = Object.entries(payload).find(([key]) => key.toLowerCase() === normalizedWallet);
    const resultWalletEntry = result
      ? Object.entries(result).find(([key]) => key.toLowerCase() === normalizedWallet)
      : undefined;
    const userCandidates = [
      asArray(payload[wallet]),
      asArray(result?.[wallet]),
      asArray(payloadWalletEntry?.[1]),
      asArray(resultWalletEntry?.[1]),
      asArray(payload.users),
    ];
    const users = userCandidates.find((candidate) => candidate.length > 0) ?? [];
    const rows = users
      .map((user) => {
        const obj = asObject(user);
        const fid = asNumber(obj?.fid);
        if (!fid || !Number.isInteger(fid)) return null;
        const profile = asObject(obj?.profile);
        const bio = asObject(profile?.bio);
        return {
          fid,
          score: asNumber(obj?.score),
          username: asString(obj?.username),
          displayName: asString(obj?.display_name),
          pfpUrl: asString(obj?.pfp_url),
          bio: asString(bio?.text) ?? asString(obj?.profile_bio_text),
          followerCount: asNumber(obj?.follower_count),
          followingCount: asNumber(obj?.following_count),
        };
      })
      .filter((row): row is {
        fid: number;
        score: number | null;
        username: string | null;
        displayName: string | null;
        pfpUrl: string | null;
        bio: string | null;
        followerCount: number | null;
        followingCount: number | null;
      } => row !== null)
      .sort((a, b) => (b.score ?? -1) - (a.score ?? -1) || a.fid - b.fid);

    const now = new Date().toISOString();
    for (const row of rows) {
      try {
        await env.WARPLETS.prepare(
          `INSERT INTO wallet_farcaster_links (
             wallet, fid, score, username, display_name, pfp_url, profile_bio_text,
             follower_count, following_count, fetched_at
           )
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(wallet, fid) DO UPDATE SET
             score = excluded.score,
             username = excluded.username,
             display_name = excluded.display_name,
             pfp_url = excluded.pfp_url,
             profile_bio_text = excluded.profile_bio_text,
             follower_count = excluded.follower_count,
             following_count = excluded.following_count,
             fetched_at = excluded.fetched_at`
        ).bind(
          wallet,
          row.fid,
          row.score,
          row.username,
          row.displayName,
          row.pfpUrl,
          row.bio,
          row.followerCount,
          row.followingCount,
          now,
        ).run();
      } catch {
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
    }
    return rows[0]?.fid ?? (typeof cached?.fid === "number" ? cached.fid : null);
  } catch {
    return typeof cached?.fid === "number" ? cached.fid : null;
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

export async function upsertMarketStateIfChanged(db: D1Database, patch: MarketPatch): Promise<boolean> {
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

function moneyFromCollectionPrefix(row: CollectionMarketRow | null, prefix: "floor" | "top_offer"): MarketMoney | null {
  if (!row) return null;
  const rawAmount = row[`${prefix}_raw_amount` as keyof CollectionMarketRow] as string | null;
  const eth = row[`${prefix}_eth` as keyof CollectionMarketRow] as number | null;
  if (eth == null && !rawAmount) return null;
  return {
    eth,
    at: prefix === "floor" ? row.floor_updated_at : row.top_offer_created_at,
    rawAmount,
    decimals: row[`${prefix}_decimals` as keyof CollectionMarketRow] as number | null,
    currencySymbol: row[`${prefix}_currency_symbol` as keyof CollectionMarketRow] as string | null,
    tokenAddress: row[`${prefix}_token_address` as keyof CollectionMarketRow] as string | null,
  };
}

function collectionSnapshotFromRow(row: CollectionMarketRow | null): NonNullable<MarketSnapshot["collection"]> {
  const floor = moneyFromCollectionPrefix(row, "floor");
  const topOfferMoney = moneyFromCollectionPrefix(row, "top_offer");
  return {
    floor,
    topOffer: topOfferMoney && row
      ? {
        ...topOfferMoney,
        orderHash: row.top_offer_order_hash,
        protocolAddress: row.top_offer_protocol_address,
        offerer: row.top_offerer_wallet,
        source: "collection",
      }
      : null,
  };
}

async function loadCollectionMarketRow(db: D1Database): Promise<CollectionMarketRow | null> {
  try {
    return await db.prepare(
      `SELECT *
       FROM opensea_collection_market_state
       WHERE collection_slug = ?`
    ).bind(COLLECTION_SLUG).first<CollectionMarketRow>();
  } catch {
    return null;
  }
}

async function upsertCollectionMarketStateIfChanged(db: D1Database, patch: Partial<CollectionMarketRow> & { collection_slug: string }): Promise<boolean> {
  const columns = [
    "floor_eth",
    "floor_raw_amount",
    "floor_decimals",
    "floor_currency_symbol",
    "floor_token_address",
    "floor_updated_at",
    "top_offer_eth",
    "top_offer_raw_amount",
    "top_offer_decimals",
    "top_offer_currency_symbol",
    "top_offer_token_address",
    "top_offer_order_hash",
    "top_offer_protocol_address",
    "top_offerer_wallet",
    "top_offer_created_at",
    "top_offer_updated_at",
  ] as const;
  const updates = columns.filter((column) => Object.prototype.hasOwnProperty.call(patch, column));
  if (updates.length === 0) return false;

  const current = await loadCollectionMarketRow(db);
  const changed = updates.some((column) => {
    const next = patch[column] ?? null;
    const prev = current?.[column] ?? null;
    return String(next ?? "") !== String(prev ?? "");
  });
  if (current && !changed) return false;

  const now = new Date().toISOString();
  if (!current) {
    await db.prepare(
      `INSERT INTO opensea_collection_market_state (
         collection_slug, ${updates.join(", ")}, created_at, updated_at
       )
       VALUES (${["?", ...updates.map(() => "?"), "?", "?"].join(", ")})`
    ).bind(
      patch.collection_slug,
      ...updates.map((column) => patch[column] ?? null),
      now,
      now,
    ).run();
    return true;
  }

  await db.prepare(
    `UPDATE opensea_collection_market_state
     SET ${updates.map((column) => `${column} = ?`).join(", ")}, updated_at = ?
     WHERE collection_slug = ?`
  ).bind(
    ...updates.map((column) => patch[column] ?? null),
    now,
    patch.collection_slug,
  ).run();
  return true;
}

function snapshotFromRows(
  rows: MarketStateRow[],
  generatedAt = new Date().toISOString(),
  collection?: NonNullable<MarketSnapshot["collection"]>,
): MarketSnapshot {
  const snapshot: MarketSnapshot = {
    version: "opensea-market-v1",
    generatedAt,
    maxAgeSeconds: SNAPSHOT_TTL_SECONDS,
    collection: collection ?? { floor: null, topOffer: null },
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
        protocolAddress: row.listing_protocol_address,
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
        protocolAddress: row.offer_protocol_address,
        offerer: row.offerer_wallet,
        source: "item",
      };
    }
    if (row.sale_eth != null) {
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
        username: row.owner_username ?? null,
        displayName: row.owner_display_name ?? null,
        pfpUrl: row.owner_pfp_url ?? null,
        bio: row.owner_profile_bio_text ?? null,
        followerCount: row.owner_follower_count ?? null,
        followingCount: row.owner_following_count ?? null,
      };
    }
  }
  return snapshot;
}

function sanitizeVisibleSales(value: unknown): MarketSnapshot["sales"] | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const sales: MarketSnapshot["sales"] = {};
  for (const [tokenId, sale] of Object.entries(value as Record<string, Partial<MarketSnapshot["sales"][string]> | null>)) {
    if (sale && typeof sale === "object" && sale.eth != null) {
      sales[tokenId] = sale as MarketSnapshot["sales"][string];
    }
  }
  return sales;
}

export async function loadMarketSnapshotFromD1(env: OpenSeaMarketEnv): Promise<MarketSnapshot> {
  await initializeOwnersFromMetadata(env.WARPLETS);
  const collection = collectionSnapshotFromRow(await loadCollectionMarketRow(env.WARPLETS));
  let rows: D1Result<MarketStateRow>;
  try {
    rows = await env.WARPLETS.prepare(
      `SELECT ${MARKET_PROFILE_SELECT_COLUMNS}
       FROM warplet_market_state m
       LEFT JOIN wallet_farcaster_links l
         ON l.wallet = m.owner_wallet AND l.fid = m.owner_fid
       ORDER BY m.token_id ASC`
    ).all<MarketStateRow>();
  } catch {
    try {
      rows = await env.WARPLETS.prepare(
        `SELECT ${LEGACY_MARKET_PROFILE_SELECT_COLUMNS}
         FROM warplet_market_state m
         LEFT JOIN wallet_farcaster_links l
           ON l.wallet = m.owner_wallet AND l.fid = m.owner_fid
         ORDER BY m.token_id ASC`
      ).all<MarketStateRow>();
    } catch {
      rows = await env.WARPLETS.prepare(
        `SELECT token_id, ${LEGACY_MARKET_SELECT_COLUMNS}
         FROM warplet_market_state
         ORDER BY token_id ASC`
      ).all<MarketStateRow>();
    }
  }
  return snapshotFromRows(rows.results ?? [], new Date().toISOString(), collection);
}

export async function loadMarketSnapshot(env: OpenSeaMarketEnv): Promise<MarketSnapshot> {
  const kv = env.WARPLETS_KV;
  if (kv) {
    const manifest = await kv.get(MARKET_SNAPSHOT_KEYS.manifest, "json") as { generatedAt?: string } | null;
    const [collection, listings, offers, sales, owners] = await Promise.all([
      kv.get(MARKET_SNAPSHOT_KEYS.collection, "json"),
      kv.get(MARKET_SNAPSHOT_KEYS.listings, "json"),
      kv.get(MARKET_SNAPSHOT_KEYS.offers, "json"),
      kv.get(MARKET_SNAPSHOT_KEYS.sales, "json"),
      kv.get(MARKET_SNAPSHOT_KEYS.owners, "json"),
    ]);
    const visibleSales = sanitizeVisibleSales(sales);
    if (manifest?.generatedAt && listings && offers && visibleSales && owners) {
      return {
        version: "opensea-market-v1",
        generatedAt: manifest.generatedAt,
        maxAgeSeconds: SNAPSHOT_TTL_SECONDS,
        collection: (collection as MarketSnapshot["collection"] | null) ?? { floor: null, topOffer: null },
        listings: listings as MarketSnapshot["listings"],
        offers: offers as MarketSnapshot["offers"],
        sales: visibleSales,
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
      kv.put(MARKET_SNAPSHOT_KEYS.collection, JSON.stringify(snapshot.collection ?? { floor: null, topOffer: null }), { expirationTtl: SNAPSHOT_TTL_SECONDS * 6 }),
      kv.put(MARKET_SNAPSHOT_KEYS.listings, JSON.stringify(snapshot.listings), { expirationTtl: SNAPSHOT_TTL_SECONDS * 6 }),
      kv.put(MARKET_SNAPSHOT_KEYS.offers, JSON.stringify(snapshot.offers), { expirationTtl: SNAPSHOT_TTL_SECONDS * 6 }),
      kv.put(MARKET_SNAPSHOT_KEYS.sales, JSON.stringify(snapshot.sales), { expirationTtl: SNAPSHOT_TTL_SECONDS * 6 }),
      kv.put(MARKET_SNAPSHOT_KEYS.owners, JSON.stringify(snapshot.owners), { expirationTtl: SNAPSHOT_TTL_SECONDS * 6 }),
    ]);
  }
  return snapshot;
}

export async function processListing(env: OpenSeaMarketEnv, row: Record<string, unknown>): Promise<boolean> {
  const tokenId = getTokenIdFromOpenSeaRow(row);
  if (!tokenId) return false;
  const price = getPrice(row, "consideration");
  const rowListedAt = getOrderCreatedAt(row);
  const existing = rowListedAt
    ? null
    : await env.WARPLETS.prepare("SELECT listed_at FROM warplet_market_state WHERE token_id = ?")
      .bind(tokenId)
      .first<{ listed_at: string | null }>()
      .catch(() => null);
  const listedAt = rowListedAt ?? existing?.listed_at ?? new Date().toISOString();
  return upsertMarketStateIfChanged(env.WARPLETS, {
    token_id: tokenId,
    listing_eth: price.eth,
    listed_at: listedAt,
    listing_order_hash: asString(row.order_hash),
    listing_protocol_address: normalizeAddress(row.protocol_address ?? asObject(row.protocol_data)?.address),
    listing_seller_wallet: getMakerAddress(row),
    listing_raw_amount: price.rawAmount,
    listing_decimals: price.decimals,
    listing_currency_symbol: price.symbol,
    listing_token_address: price.tokenAddress,
    opensea_updated_at: new Date().toISOString(),
  });
}

export async function processOffer(env: OpenSeaMarketEnv, row: Record<string, unknown>): Promise<boolean> {
  const tokenId = getTokenIdFromOpenSeaRow(row);
  if (!tokenId) return false;
  const price = getPrice(row, "offer");
  const rowOfferedAt = getOrderCreatedAt(row);
  const existing = rowOfferedAt
    ? null
    : await env.WARPLETS.prepare("SELECT offered_at FROM warplet_market_state WHERE token_id = ?")
      .bind(tokenId)
      .first<{ offered_at: string | null }>()
      .catch(() => null);
  return upsertMarketStateIfChanged(env.WARPLETS, {
    token_id: tokenId,
    offer_eth: price.eth,
    offered_at: rowOfferedAt ?? existing?.offered_at ?? new Date().toISOString(),
    offer_order_hash: asString(row.order_hash),
    offer_protocol_address: normalizeAddress(row.protocol_address ?? asObject(row.protocol_data)?.address),
    offerer_wallet: getMakerAddress(row),
    offer_raw_amount: price.rawAmount,
    offer_decimals: price.decimals,
    offer_currency_symbol: price.symbol,
    offer_token_address: price.tokenAddress,
    opensea_updated_at: new Date().toISOString(),
  });
}

export async function clearTokenMarketSide(
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
      listing_protocol_address: null,
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
    offer_protocol_address: null,
    offerer_wallet: null,
    offer_raw_amount: null,
    offer_decimals: null,
    offer_currency_symbol: null,
    offer_token_address: null,
    opensea_updated_at: now,
  });
}

export async function processSaleOrTransfer(
  env: OpenSeaMarketEnv,
  row: Record<string, unknown>,
  options: { clearOrdersOnOwnerChange?: boolean } = {},
): Promise<boolean> {
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
    if (options.clearOrdersOnOwnerChange) {
      patch.listing_eth = null;
      patch.listed_at = null;
      patch.listing_order_hash = null;
      patch.listing_protocol_address = null;
      patch.listing_seller_wallet = null;
      patch.listing_raw_amount = null;
      patch.listing_decimals = null;
      patch.listing_currency_symbol = null;
      patch.listing_token_address = null;
      patch.offer_eth = null;
      patch.offered_at = null;
      patch.offer_order_hash = null;
      patch.offer_protocol_address = null;
      patch.offerer_wallet = null;
      patch.offer_raw_amount = null;
      patch.offer_decimals = null;
      patch.offer_currency_symbol = null;
      patch.offer_token_address = null;
    }
  }
  if (eventType === "sale" && price.eth != null) {
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
        listing_protocol_address = NULL,
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
        offer_protocol_address = NULL,
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
    if (await processSaleOrTransfer(env, row, { clearOrdersOnOwnerChange: true })) {
      changed += 1;
    }
  }
  return changed;
}

export async function fetchLatestTokenSale(apiKey: string, tokenId: number): Promise<Record<string, unknown> | null> {
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

function currencyComparableValue(value: CurrencyValue): number | null {
  if (value.eth != null) return value.eth;
  if (value.rawAmount && value.decimals != null) return weiToNumber(value.rawAmount, value.decimals);
  return null;
}

async function refreshCollectionMarketState(env: OpenSeaMarketEnv, apiKey: string): Promise<number> {
  let changed = 0;
  const now = new Date().toISOString();

  try {
    const stats = await fetchOpenSea(`/collections/${COLLECTION_SLUG}/stats`, apiKey);
    const total = asObject(stats.total) ?? asObject(stats.stats) ?? stats;
    const floorEth = asNumber(total.floor_price ?? total.floorPrice);
    if (await upsertCollectionMarketStateIfChanged(env.WARPLETS, {
      collection_slug: COLLECTION_SLUG,
      floor_eth: floorEth,
      floor_raw_amount: null,
      floor_decimals: floorEth != null ? 18 : null,
      floor_currency_symbol: floorEth != null ? "ETH" : null,
      floor_token_address: floorEth != null ? NATIVE_TOKEN_ADDRESS : null,
      floor_updated_at: now,
    })) {
      changed += 1;
    }
  } catch {
    // Collection stats should not block token market ingestion.
  }

  try {
    const params = new URLSearchParams({ limit: "200" });
    const payload = await fetchOpenSea(`/offers/collection/${COLLECTION_SLUG}`, apiKey, params);
    const offers = asArray(payload.offers ?? payload.orders)
      .map((item) => asObject(item))
      .filter((item): item is Record<string, unknown> => Boolean(item));
    const best = offers.reduce<{
      row: Record<string, unknown>;
      price: CurrencyValue;
      value: number;
    } | null>((current, row) => {
      const tokenId = getTokenIdFromOpenSeaRow(row);
      if (tokenId) return current;
      const price = getPrice(row, "offer");
      const value = currencyComparableValue(price);
      if (value == null || !Number.isFinite(value)) return current;
      if (!current || value > current.value) return { row, price, value };
      return current;
    }, null);

    if (best) {
      if (await upsertCollectionMarketStateIfChanged(env.WARPLETS, {
        collection_slug: COLLECTION_SLUG,
        top_offer_eth: best.price.eth,
        top_offer_raw_amount: best.price.rawAmount,
        top_offer_decimals: best.price.decimals,
        top_offer_currency_symbol: best.price.symbol,
        top_offer_token_address: best.price.tokenAddress,
        top_offer_order_hash: asString(best.row.order_hash),
        top_offer_protocol_address: normalizeAddress(best.row.protocol_address ?? asObject(best.row.protocol_data)?.address),
        top_offerer_wallet: getMakerAddress(best.row),
        top_offer_created_at: getOrderCreatedAt(best.row) ?? now,
        top_offer_updated_at: now,
      })) {
        changed += 1;
      }
    } else if (await upsertCollectionMarketStateIfChanged(env.WARPLETS, {
      collection_slug: COLLECTION_SLUG,
      top_offer_eth: null,
      top_offer_raw_amount: null,
      top_offer_decimals: null,
      top_offer_currency_symbol: null,
      top_offer_token_address: null,
      top_offer_order_hash: null,
      top_offer_protocol_address: null,
      top_offerer_wallet: null,
      top_offer_created_at: null,
      top_offer_updated_at: now,
    })) {
      changed += 1;
    }
  } catch {
    // Top collection offer is a display enhancement; preserve previous state on transient failures.
  }

  return changed;
}

export async function ingestOpenSeaMarket(env: OpenSeaMarketEnv): Promise<{ changed: number; generatedAt: string }> {
  const apiKey = env.OPENSEA_API_KEY?.trim();
  if (!apiKey) throw new Error("OPENSEA_API_KEY is not configured");

  await initializeOwnersFromMetadata(env.WARPLETS);
  let changed = 0;
  changed += await refreshCollectionMarketState(env, apiKey);
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
    await refreshCollectionMarketState(env, apiKey).catch(() => 0);
    if (listingPayload) {
      const listing = asObject(listingPayload.listing) ?? listingPayload;
      const listingRow = { ...listing, identifier: String(tokenId) };
      const listingSeller = getMakerAddress(listingRow);
      const listingMatchesOwner = !ownerWallet || !listingSeller || listingSeller === ownerWallet;
      if (listingMatchesOwner && hasCurrencyValue(getPrice(listingRow, "consideration"))) {
        await processListing(env, listingRow);
      } else {
        await clearTokenMarketSide(env, tokenId, "listing");
      }
    } else {
      await clearTokenMarketSide(env, tokenId, "listing");
    }
    if (offerPayload) {
      const offer = asObject(offerPayload.offer) ?? offerPayload;
      const offerRow = { ...offer, identifier: String(tokenId) };
      if (hasCurrencyValue(getPrice(offerRow, "offer"))) {
        await processOffer(env, offerRow);
      } else {
        await clearTokenMarketSide(env, tokenId, "offer");
      }
    } else {
      await clearTokenMarketSide(env, tokenId, "offer");
    }
    if (salePayload) {
      await processSaleOrTransfer(env, salePayload, { clearOrdersOnOwnerChange: true });
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
  const collection = collectionSnapshotFromRow(await loadCollectionMarketRow(env.WARPLETS));
  let row: MarketStateRow | null;
  try {
    row = await env.WARPLETS.prepare(
      `SELECT ${MARKET_PROFILE_SELECT_COLUMNS}
       FROM warplet_market_state m
       LEFT JOIN wallet_farcaster_links l
         ON l.wallet = m.owner_wallet AND l.fid = m.owner_fid
       WHERE m.token_id = ?`
    ).bind(tokenId).first<MarketStateRow>();
  } catch {
    try {
      row = await env.WARPLETS.prepare(
        `SELECT ${LEGACY_MARKET_PROFILE_SELECT_COLUMNS}
         FROM warplet_market_state m
         LEFT JOIN wallet_farcaster_links l
           ON l.wallet = m.owner_wallet AND l.fid = m.owner_fid
         WHERE m.token_id = ?`
      ).bind(tokenId).first<MarketStateRow>();
    } catch {
      row = await env.WARPLETS.prepare(
        `SELECT token_id, ${LEGACY_MARKET_SELECT_COLUMNS}
         FROM warplet_market_state
         WHERE token_id = ?`
      ).bind(tokenId).first<MarketStateRow>();
    }
  }
  return snapshotFromRows(row ? [row] : [], new Date().toISOString(), collection);
}

export function marketJson(data: unknown, init?: ResponseInit): Response {
  const response = jsonSecure(data, init);
  response.headers.set("cache-control", "public, max-age=60, stale-while-revalidate=600");
  return response;
}
