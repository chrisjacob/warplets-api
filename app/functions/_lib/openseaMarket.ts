import { jsonSecure, rateLimit } from "./security.js";
import { WARPLETS_APP_HOSTS } from "../../shared/warpletsApp.js";
import {
  deactivateActiveItemOffer,
  recordWarpletActivity,
  upsertActiveItemOffer,
} from "./warpletNotifications.js";
import {
  ANALYTICS_EPOCH,
  persistCollectionMarketSnapshot,
  persistOpenSeaStatsSnapshot,
  rebuildHolderLeaderboard,
  recordNormalizedSale,
  refreshHolderLeaderboardWallets,
} from "./stats.js";
import { resolveWalletProfiles } from "./walletProfiles.js";
import { fetchBaseRpc, fetchBaseRpcBatch, type BaseRpcEnv } from "./baseRpc.js";

export interface OpenSeaMarketEnv extends BaseRpcEnv {
  WARPLETS: D1Database;
  WARPLETS_KV?: KVNamespace;
  OPENSEA_API_KEY?: string;
  NEYNAR_API_KEY?: string;
  OPENSEA_MARKET_INGEST_ENABLED?: string;
  OPENSEA_MARKET_INGEST_INTERVAL_MINUTES?: string;
}

export type OpenSeaMarketNotificationMode = "queue" | "suppress";

export type OpenSeaMarketIngestOptions = {
  bootstrap?: boolean;
  notificationMode?: OpenSeaMarketNotificationMode;
};

export type OpenSeaMarketBootstrapState = {
  complete: boolean;
  completedEventTypes: string[];
  pendingEventTypes: string[];
};

export type OpenSeaMarketIngestResult = {
  changed: number;
  generatedAt: string;
  bootstrap: OpenSeaMarketBootstrapState;
  notificationMode: OpenSeaMarketNotificationMode;
};

export type ScheduledOpenSeaMarketResult =
  | { status: "disabled" | "bootstrap_required" | "fresh"; lastSuccessAt?: string | null }
  | ({ status: "ingested" } & OpenSeaMarketIngestResult);

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

export type TraitCriterion = {
  traitType: string;
  traitValue: string;
};

export type MarketSnapshot = {
  version: "opensea-market-v1" | "opensea-market-v2";
  generatedAt: string;
  maxAgeSeconds: number;
  collection?: {
    floor: MarketMoney | null;
    topOffer: MarketOrderMoney & { offerer: string | null; source: "collection" } | null;
  };
  listings: Record<string, MarketOrderMoney & { seller: string | null }>;
  offers: Record<string, MarketOrderMoney & { offerer: string | null; source?: "item" }>;
  traitOffers: Record<string, MarketOrderMoney & { offerer: string | null; source: "trait"; traits: TraitCriterion[] }>;
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
  owner_event_at: string | null;
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
  orderHashes: Set<string>;
  complete: boolean;
};

type EventIngestResult = {
  changed: number;
  complete: boolean;
  nextCursor: string | null;
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

type CriteriaKind = "trait" | "collection";

type CriteriaOfferRow = {
  order_hash: string;
  collection_slug: string;
  criteria_kind: CriteriaKind;
  traits_json: string | null;
  offer_eth: number | null;
  offer_raw_amount: string | null;
  offer_decimals: number | null;
  offer_currency_symbol: string | null;
  offer_token_address: string | null;
  offerer_wallet: string | null;
  protocol_address: string | null;
  encoded_token_ids: string | null;
  active: number;
  remaining_quantity?: number | null;
  order_status?: string | null;
  offered_at: string | null;
  opensea_updated_at: string | null;
  raw_payload: string | null;
};

type WalletFarcasterLinkRow = {
  fid: number | null;
  username?: string | null;
  pfp_url?: string | null;
  x_username?: string | null;
  profile_bio_text?: string | null;
  follower_count?: number | null;
  following_count?: number | null;
};

const OPENSEA_API_BASE = "https://api.opensea.io/api/v2";
const BASE_CHAIN = "base";
const COLLECTION_SLUG = "10xwarplets";
const COLLECTION_CONTRACT = "0x780446dd12e080ae0db762fcd4daf313f3e359de";
const BASE_WETH = "0x4200000000000000000000000000000000000006";
const NATIVE_TOKEN_ADDRESS = "0x0000000000000000000000000000000000000000";
const SNAPSHOT_TTL_SECONDS = 600;
const FORCE_REFRESH_COOLDOWN_SECONDS = 600;
const LOCAL_FORCE_REFRESH_COOLDOWN_SECONDS = 10;
const EVENT_INGEST_MAX_PAGES = 10;
const EVENT_INGEST_OVERLAP_SECONDS = 6 * 60 * 60;
const EVENT_TYPES = ["sale", "transfer", "listing", "offer"] as const;
const BOOTSTRAP_COMPLETE_KEY = "market_ingest:bootstrap_complete";
const LAST_SUCCESS_KEY = "market_ingest:last_success_at";
const DEFAULT_SCHEDULE_INTERVAL_MINUTES = 10;
const OWNER_OF_SELECTOR = "0x6352211e";
const MARKET_SNAPSHOT_KEYS = {
  manifest: "opensea:market:manifest:v1",
  collection: "opensea:market:collection:v1",
  listings: "opensea:market:listings:v1",
  offers: "opensea:market:offers:v1",
  traitOffers: "opensea:market:trait-offers:v1",
  sales: "opensea:market:sales:v1",
  owners: "opensea:market:owners:v1",
} as const;

function enabled(value: string | undefined): boolean {
  return /^(?:1|true|yes|on)$/i.test(value?.trim() ?? "");
}

export function resolveOpenSeaMarketNotificationMode(
  bootstrapComplete: boolean,
  options: OpenSeaMarketIngestOptions = {},
): OpenSeaMarketNotificationMode {
  if (options.bootstrap || !bootstrapComplete) return "suppress";
  return options.notificationMode ?? "queue";
}

export function isOpenSeaMarketIngestDue(
  lastSuccessAt: string | null | undefined,
  nowMs: number,
  intervalMinutes: number,
): boolean {
  const lastSuccessMs = Date.parse(lastSuccessAt ?? "");
  return !Number.isFinite(lastSuccessMs) || nowMs - lastSuccessMs >= intervalMinutes * 60_000;
}

export function ownsOpenSeaMarketLease(
  persistedOwner: string | null | undefined,
  requestedOwner: string,
): boolean {
  return persistedOwner === requestedOwner;
}

export function deriveOpenSeaMarketBootstrapState(
  resultRows: Array<{ key: string; value: string | null }>,
): OpenSeaMarketBootstrapState {
  const state = new Map(resultRows.map((row) => [row.key, row.value]));
  const completedEventTypes = EVENT_TYPES.filter((eventType) =>
    Boolean(state.get(`events_after:${eventType}`)) && !state.get(`events_cursor:${eventType}`)
  );
  const pendingEventTypes = EVENT_TYPES.filter((eventType) => !completedEventTypes.includes(eventType));
  return {
    complete: pendingEventTypes.length === 0,
    completedEventTypes: [...completedEventTypes],
    pendingEventTypes: [...pendingEventTypes],
  };
}

function marketIngestIntervalMinutes(value: string | undefined): number {
  const parsed = Number(value);
  return Number.isFinite(parsed)
    ? Math.min(60, Math.max(1, Math.floor(parsed)))
    : DEFAULT_SCHEDULE_INTERVAL_MINUTES;
}

function analyticsHourBucket(value = new Date()): string {
  const bucket = new Date(value);
  bucket.setUTCMinutes(0, 0, 0);
  return bucket.toISOString();
}

const TRAIT_COLUMN_MATCHERS: Record<string, { column: string; mode: "exact" | "pipe"; normalize?: (value: string) => string }> = {
  "10xlevel": { column: "x10_level", mode: "exact", normalize: normalizeLevelTraitValue },
  "10xrank": { column: "x10_rank", mode: "exact", normalize: normalizeNumericTraitValue },
  "10xrarity": { column: "x10_rarity", mode: "exact", normalize: normalizeNumericTraitValue },
  "castlevel": { column: "cast_level", mode: "exact", normalize: normalizeLevelTraitValue },
  "castrank": { column: "cast_rank", mode: "exact", normalize: normalizeNumericTraitValue },
  "castvalue": { column: "cast_value", mode: "exact", normalize: normalizeNumericTraitValue },
  "fidlevel": { column: "fid_level", mode: "exact", normalize: normalizeLevelTraitValue },
  "fidrank": { column: "fid_rank", mode: "exact", normalize: normalizeNumericTraitValue },
  "fidvalue": { column: "fid_value", mode: "exact", normalize: normalizeNumericTraitValue },
  "followerlevel": { column: "follower_level", mode: "exact", normalize: normalizeLevelTraitValue },
  "followerrank": { column: "follower_rank", mode: "exact", normalize: normalizeNumericTraitValue },
  "followervalue": { column: "follower_value", mode: "exact", normalize: normalizeNumericTraitValue },
  "holderlevel": { column: "holder_level", mode: "exact", normalize: normalizeLevelTraitValue },
  "holderrank": { column: "holder_rank", mode: "exact", normalize: normalizeNumericTraitValue },
  "holdervalue": { column: "holder_value", mode: "exact", normalize: normalizeNumericTraitValue },
  "lucklevel": { column: "luck_level", mode: "exact", normalize: normalizeLevelTraitValue },
  "luckrank": { column: "luck_rank", mode: "exact", normalize: normalizeNumericTraitValue },
  "luckvalue": { column: "luck_value", mode: "exact", normalize: normalizeNumericTraitValue },
  "minterlevel": { column: "minter_level", mode: "exact", normalize: normalizeLevelTraitValue },
  "minterrank": { column: "minter_rank", mode: "exact", normalize: normalizeNumericTraitValue },
  "mintervalue": { column: "minter_value", mode: "exact" },
  "neynarlevel": { column: "neynar_level", mode: "exact", normalize: normalizeLevelTraitValue },
  "neynarrank": { column: "neynar_rank", mode: "exact", normalize: normalizeNumericTraitValue },
  "neynarvalue": { column: "neynar_value", mode: "exact", normalize: normalizeNumericTraitValue },
  "nftlevel": { column: "nft_level", mode: "exact", normalize: normalizeLevelTraitValue },
  "nftrank": { column: "nft_rank", mode: "exact", normalize: normalizeNumericTraitValue },
  "nftvalue": { column: "nft_value", mode: "exact", normalize: normalizeNumericTraitValue },
  "tokenlevel": { column: "token_level", mode: "exact", normalize: normalizeLevelTraitValue },
  "tokenrank": { column: "token_rank", mode: "exact", normalize: normalizeNumericTraitValue },
  "tokenvalue": { column: "token_value", mode: "exact", normalize: normalizeNumericTraitValue },
  "volumelevel": { column: "volume_level", mode: "exact", normalize: normalizeLevelTraitValue },
  "volumerank": { column: "volume_rank", mode: "exact", normalize: normalizeNumericTraitValue },
  "volumevalue": { column: "volume_value", mode: "exact", normalize: normalizeNumericTraitValue },
  "warpletcolours": { column: "warplet_colours", mode: "pipe" },
  "warpletcolors": { column: "warplet_colours", mode: "pipe" },
  "warpletkeywords": { column: "warplet_keywords", mode: "pipe" },
  "warplettraits": { column: "warplet_traits", mode: "pipe" },
  "warpletuserispro": { column: "warplet_user_is_pro", mode: "exact", normalize: normalizeBooleanTraitValue },
  "warpletusernamefarcaster": { column: "warplet_username_farcaster", mode: "exact" },
  "warpletusernamex": { column: "warplet_username_x", mode: "exact" },
  "warpletwallet": { column: "warplet_wallet", mode: "exact" },
  "secretlevel": { column: "secret_level", mode: "exact", normalize: normalizeLevelTraitValue },
};

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
  "owner_event_at",
  "opensea_updated_at",
] as const;
const MARKET_SELECT_COLUMNS = MARKET_COLUMNS.filter((column) => column !== "opensea_updated_at").join(", ");
const LEGACY_MARKET_SELECT_COLUMNS = MARKET_COLUMNS
  .filter((column) => (
    column !== "opensea_updated_at" &&
    column !== "owner_event_at" &&
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

function normalizeTraitKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function normalizeLevelTraitValue(value: string): string {
  return value.trim().replace(/x$/i, "");
}

function normalizeNumericTraitValue(value: string): string {
  return value.trim().replace(/^\$/, "").replace(/,/g, "");
}

function normalizeBooleanTraitValue(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (normalized === "yes" || normalized === "true") return "1";
  if (normalized === "no" || normalized === "false") return "0";
  return value.trim();
}

function safeJsonString(value: unknown, maxLength = 12000): string | null {
  if (value == null) return null;
  try {
    return JSON.stringify(value).slice(0, maxLength);
  } catch {
    return null;
  }
}

function readNeynarXUsername(user: Record<string, unknown> | undefined): string | null {
  const verifiedAccounts = user?.verified_accounts;
  if (!Array.isArray(verifiedAccounts)) return null;
  for (const account of verifiedAccounts) {
    const verifiedAccount = asObject(account);
    if (!verifiedAccount) continue;
    const platform = asString(verifiedAccount.platform)?.toLowerCase();
    if (platform === "x" || platform === "twitter") {
      return asString(verifiedAccount.username);
    }
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
    hostname === WARPLETS_APP_HOSTS[0];
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
    parseTokenId(nft?.identifier) ??
    parseTokenId(asset?.identifier) ??
    parseTokenId(item?.nft_id) ??
    parseTokenId(row.identifier)
  );
}

export function readCriteriaTraits(row: Record<string, unknown>): TraitCriterion[] {
  const criteria = asObject(row.criteria);
  const rawTraits = asArray(criteria?.traits ?? row.traits);
  return rawTraits
    .map((item) => {
      const trait = asObject(item);
      const traitType = asString(trait?.traitType ?? trait?.trait_type ?? trait?.type);
      const traitValue = asString(trait?.traitValue ?? trait?.trait_value ?? trait?.value);
      return traitType && traitValue ? { traitType, traitValue } : null;
    })
    .filter((trait): trait is TraitCriterion => trait !== null);
}

export function getCriteriaEncodedTokenIds(row: Record<string, unknown>): string | null {
  const criteria = asObject(row.criteria);
  return asString(criteria?.encoded_token_ids ?? criteria?.encodedTokenIds ?? row.encoded_token_ids ?? row.encodedTokenIds);
}

export function classifyOpenSeaOffer(row: Record<string, unknown>): "item" | "trait" | "collection" {
  if (readCriteriaTraits(row).length > 0) return "trait";
  if (getTokenIdFromOpenSeaRow(row)) return "item";
  return "collection";
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

export async function ownerOf(tokenId: number, env?: BaseRpcEnv): Promise<string | null> {
  const tokenHex = BigInt(tokenId).toString(16).padStart(64, "0");
  const data = `${OWNER_OF_SELECTOR}${tokenHex}`;
  const result = await fetchBaseRpc(env, "eth_call", [{ to: COLLECTION_CONTRACT, data }, "latest"]);
  const hex = asString(result);
  if (!hex || hex.length < 66) return null;
  return normalizeAddress(`0x${hex.slice(-40)}`);
}

export async function ownersOf(tokenIds: number[], env?: BaseRpcEnv): Promise<Map<number, string>> {
  const uniqueTokenIds = [...new Set(tokenIds)].filter((tokenId) => Number.isInteger(tokenId) && tokenId > 0);
  if (uniqueTokenIds.length === 0) return new Map();
  const payload = await fetchBaseRpcBatch(env, uniqueTokenIds.map((tokenId, index) => ({
      id: index + 1,
      method: "eth_call",
      params: [{
        to: COLLECTION_CONTRACT,
        data: `${OWNER_OF_SELECTOR}${BigInt(tokenId).toString(16).padStart(64, "0")}`,
      }, "latest"],
  })));
  const owners = new Map<number, string>();
  for (const row of Array.isArray(payload) ? payload : []) {
    const tokenId = uniqueTokenIds[Number(row.id) - 1];
    const hex = asString(row.result);
    const owner = hex && hex.length >= 66 ? normalizeAddress(`0x${hex.slice(-40)}`) : null;
    if (tokenId && owner) owners.set(tokenId, owner);
  }
  return owners;
}

export async function selectPreferredFidForWallet(env: OpenSeaMarketEnv, wallet: string): Promise<number | null> {
  let cached: WalletFarcasterLinkRow | null = null;
  try {
    cached = await env.WARPLETS.prepare(
      `SELECT fid, username, pfp_url, x_username, profile_bio_text, follower_count, following_count
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
          xUsername: readNeynarXUsername(obj),
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
        xUsername: string | null;
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
             wallet, fid, score, username, display_name, pfp_url, x_username, profile_bio_text,
             follower_count, following_count, fetched_at
           )
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(wallet, fid) DO UPDATE SET
             score = COALESCE(excluded.score, wallet_farcaster_links.score),
             username = COALESCE(NULLIF(TRIM(excluded.username), ''), wallet_farcaster_links.username),
             display_name = COALESCE(NULLIF(TRIM(excluded.display_name), ''), wallet_farcaster_links.display_name),
             pfp_url = COALESCE(NULLIF(TRIM(excluded.pfp_url), ''), wallet_farcaster_links.pfp_url),
             x_username = COALESCE(NULLIF(TRIM(excluded.x_username), ''), wallet_farcaster_links.x_username),
             profile_bio_text = COALESCE(NULLIF(TRIM(excluded.profile_bio_text), ''), wallet_farcaster_links.profile_bio_text),
             follower_count = COALESCE(excluded.follower_count, wallet_farcaster_links.follower_count),
             following_count = COALESCE(excluded.following_count, wallet_farcaster_links.following_count),
             fetched_at = excluded.fetched_at`
        ).bind(
          wallet,
          row.fid,
          row.score,
          row.username,
          row.displayName,
          row.pfpUrl,
          row.xUsername,
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
             score = COALESCE(excluded.score, wallet_farcaster_links.score),
             username = COALESCE(NULLIF(TRIM(excluded.username), ''), wallet_farcaster_links.username),
             pfp_url = COALESCE(NULLIF(TRIM(excluded.pfp_url), ''), wallet_farcaster_links.pfp_url),
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

function criteriaOfferToMarket(row: CriteriaOfferRow): MarketOrderMoney & { offerer: string | null; source: "trait"; traits: TraitCriterion[] } {
  let traits: TraitCriterion[] = [];
  try {
    const parsed = row.traits_json ? JSON.parse(row.traits_json) : [];
    traits = Array.isArray(parsed)
      ? parsed
        .map((trait) => {
          const obj = asObject(trait);
          const traitType = asString(obj?.traitType);
          const traitValue = asString(obj?.traitValue);
          return traitType && traitValue ? { traitType, traitValue } : null;
        })
        .filter((trait): trait is TraitCriterion => trait !== null)
      : [];
  } catch {
    traits = [];
  }

  const quantity = Math.max(1, Math.floor(Number(row.remaining_quantity ?? 1)));
  let unitRawAmount = row.offer_raw_amount;
  if (unitRawAmount) {
    try {
      unitRawAmount = (BigInt(unitRawAmount) / BigInt(quantity)).toString();
    } catch {
      // Retain the stored amount for malformed legacy rows.
    }
  }
  const unitEth = unitRawAmount && row.offer_decimals != null
    ? weiToNumber(unitRawAmount, row.offer_decimals)
    : row.offer_eth != null
      ? row.offer_eth / quantity
      : null;
  return {
    eth: unitEth,
    at: row.offered_at,
    rawAmount: unitRawAmount,
    decimals: row.offer_decimals,
    currencySymbol: row.offer_currency_symbol,
    tokenAddress: row.offer_token_address,
    orderHash: row.order_hash,
    protocolAddress: row.protocol_address,
    offerer: row.offerer_wallet,
    source: "trait",
    traits,
  };
}

function criteriaComparableValue(row: CriteriaOfferRow): number | null {
  const quantity = Math.max(1, Math.floor(Number(row.remaining_quantity ?? 1)));
  if (row.offer_raw_amount && row.offer_decimals != null) {
    try {
      return weiToNumber((BigInt(row.offer_raw_amount) / BigInt(quantity)).toString(), row.offer_decimals);
    } catch {
      // Fall through to the decimal value.
    }
  }
  if (row.offer_eth != null) return row.offer_eth / quantity;
  return null;
}

function timestampMs(value: string | null | undefined): number | null {
  const timestamp = Date.parse(value ?? "");
  return Number.isFinite(timestamp) ? timestamp : null;
}

function criteriaOfferIsBetter(next: CriteriaOfferRow, current: ReturnType<typeof criteriaOfferToMarket> | null | undefined): boolean {
  const nextValue = criteriaComparableValue(next);
  const currentValue = getMarketOrderComparableValue(current);
  if (nextValue == null || !Number.isFinite(nextValue)) return false;
  if (currentValue == null || nextValue > currentValue) return true;
  if (nextValue < currentValue) return false;
  const nextTime = timestampMs(next.offered_at);
  const currentTime = timestampMs(current?.at);
  return nextTime != null && currentTime != null && nextTime < currentTime;
}

async function loadActiveTraitOffersForToken(db: D1Database, tokenId?: number): Promise<Map<string, ReturnType<typeof criteriaOfferToMarket>>> {
  const traitOffers = new Map<string, ReturnType<typeof criteriaOfferToMarket>>();
  let rows: D1Result<CriteriaOfferRow & { token_id: number }>;
  try {
    rows = tokenId
      ? await db.prepare(
        `SELECT o.*, m.token_id
         FROM opensea_criteria_offer_matches m
         JOIN opensea_criteria_offers o ON o.order_hash = m.order_hash
         WHERE m.collection_slug = ?
           AND m.criteria_kind = 'trait'
           AND m.token_id = ?
           AND o.active = 1`
      ).bind(COLLECTION_SLUG, tokenId).all<CriteriaOfferRow & { token_id: number }>()
      : await db.prepare(
        `SELECT o.*, m.token_id
         FROM opensea_criteria_offer_matches m
         JOIN opensea_criteria_offers o ON o.order_hash = m.order_hash
         WHERE m.collection_slug = ?
           AND m.criteria_kind = 'trait'
           AND o.active = 1`
      ).bind(COLLECTION_SLUG).all<CriteriaOfferRow & { token_id: number }>();
  } catch {
    return traitOffers;
  }

  for (const row of rows.results ?? []) {
    const key = String(row.token_id);
    const current = traitOffers.get(key);
    if (criteriaOfferIsBetter(row, current)) {
      traitOffers.set(key, criteriaOfferToMarket(row));
    }
  }
  return traitOffers;
}

async function loadActiveCollectionTopOffer(
  db: D1Database,
): Promise<{ loaded: boolean; offer: NonNullable<MarketSnapshot["collection"]>["topOffer"] }> {
  try {
    const result = await db.prepare(
      `SELECT *
       FROM opensea_criteria_offers
       WHERE collection_slug = ?
         AND criteria_kind = 'collection'
         AND active = 1
         AND COALESCE(order_status, 'ACTIVE') = 'ACTIVE'
         AND COALESCE(remaining_quantity, 1) > 0
       ORDER BY offered_at ASC, order_hash ASC`
    ).bind(COLLECTION_SLUG).all<CriteriaOfferRow>();
    const rows = result.results ?? [];
    let best: { row: CriteriaOfferRow; rawAmount: string | null; value: number } | null = null;
    for (const row of rows) {
      const quantity = Math.max(1, Math.floor(Number(row.remaining_quantity ?? 1)));
      let rawAmount = row.offer_raw_amount;
      if (rawAmount) {
        try {
          rawAmount = (BigInt(rawAmount) / BigInt(quantity)).toString();
        } catch {
          // Fall back to the decimal value below when a legacy raw amount is malformed.
        }
      }
      const value = rawAmount && row.offer_decimals != null
        ? weiToNumber(rawAmount, row.offer_decimals)
        : row.offer_eth != null
          ? row.offer_eth / quantity
          : null;
      if (value == null || !Number.isFinite(value)) continue;
      if (!best || value > best.value) best = { row, rawAmount, value };
    }
    if (!best) return { loaded: true, offer: null };
    const row = best.row;
    return {
      loaded: true,
      offer: {
        eth: best.value,
        at: row.offered_at,
        rawAmount: best.rawAmount,
        decimals: row.offer_decimals ?? 18,
        currencySymbol: row.offer_currency_symbol ?? "WETH",
        tokenAddress: row.offer_token_address ?? BASE_WETH,
        orderHash: row.order_hash,
        protocolAddress: row.protocol_address,
        offerer: row.offerer_wallet,
        source: "collection",
      },
    };
  } catch {
    // Older databases may not have the criteria-offer tables yet. In that case,
    // retain the independently ingested collection market state.
    return { loaded: false, offer: null };
  }
}

function getMarketOrderComparableValue(value: MarketOrderMoney | null | undefined): number | null {
  if (!value) return null;
  if (value.eth != null) return value.eth;
  if (value.rawAmount && value.decimals != null) return weiToNumber(value.rawAmount, value.decimals);
  return null;
}

async function matchingTokenIdsForTraits(db: D1Database, traits: TraitCriterion[]): Promise<number[]> {
  if (traits.length === 0) return [];
  const clauses: string[] = [];
  const binds: string[] = [];

  for (const trait of traits) {
    const matcher = TRAIT_COLUMN_MATCHERS[normalizeTraitKey(trait.traitType)];
    if (!matcher) return [];
    const value = matcher.normalize ? matcher.normalize(trait.traitValue) : trait.traitValue.trim();
    if (!value) return [];
    if (matcher.mode === "pipe") {
      clauses.push(`(' | ' || COALESCE(${matcher.column}, '') || ' | ') LIKE ? COLLATE NOCASE`);
      binds.push(`%| ${value} |%`);
    } else if (matcher.normalize === normalizeLevelTraitValue) {
      clauses.push(`REPLACE(UPPER(CAST(${matcher.column} AS TEXT)), 'X', '') = ?`);
      binds.push(value);
    } else {
      clauses.push(`CAST(${matcher.column} AS TEXT) = ? COLLATE NOCASE`);
      binds.push(value);
    }
  }

  const rows = await db.prepare(
    `SELECT token_id
     FROM warplets_metadata
     WHERE ${clauses.join(" AND ")}
     ORDER BY token_id ASC`
  ).bind(...binds).all<{ token_id: number }>();
  return (rows.results ?? [])
    .map((row) => Number(row.token_id))
    .filter((tokenId) => Number.isInteger(tokenId) && tokenId > 0);
}

async function replaceCriteriaOfferMatches(
  db: D1Database,
  orderHash: string,
  criteriaKind: CriteriaKind,
  tokenIds: number[],
): Promise<void> {
  await db.prepare(`DELETE FROM opensea_criteria_offer_matches WHERE order_hash = ?`).bind(orderHash).run();
  if (criteriaKind !== "trait" || tokenIds.length === 0) return;
  for (let index = 0; index < tokenIds.length; index += 50) {
    const chunk = tokenIds.slice(index, index + 50);
    const placeholders = chunk.map(() => "(?, ?, ?, ?)").join(", ");
    const values = chunk.flatMap((tokenId) => [orderHash, COLLECTION_SLUG, criteriaKind, tokenId]);
    await db.prepare(
      `INSERT OR IGNORE INTO opensea_criteria_offer_matches
         (order_hash, collection_slug, criteria_kind, token_id)
       VALUES ${placeholders}`
    ).bind(...values).run();
  }
}

async function criteriaOfferTableHasRows(db: D1Database): Promise<boolean> {
  try {
    const row = await db.prepare(
      `SELECT order_hash FROM opensea_criteria_offers WHERE collection_slug = ? LIMIT 1`
    ).bind(COLLECTION_SLUG).first<{ order_hash: string }>();
    return Boolean(row?.order_hash);
  } catch {
    return false;
  }
}

async function isBestTraitOfferForAnyMatch(db: D1Database, orderHash: string): Promise<boolean> {
  try {
    const row = await db.prepare(
      `SELECT 1 AS found
       FROM opensea_criteria_offer_matches m
       JOIN opensea_criteria_offers current_offer
         ON current_offer.order_hash = m.order_hash
       WHERE m.order_hash = ?
         AND current_offer.active = 1
         AND current_offer.offer_eth IS NOT NULL
         AND NOT EXISTS (
           SELECT 1
           FROM opensea_criteria_offer_matches competing_match
           JOIN opensea_criteria_offers competing_offer
             ON competing_offer.order_hash = competing_match.order_hash
           WHERE competing_match.token_id = m.token_id
             AND competing_offer.active = 1
             AND competing_offer.order_hash <> current_offer.order_hash
             AND (
               COALESCE(competing_offer.offer_eth, -1) > COALESCE(current_offer.offer_eth, -1)
               OR (
                 COALESCE(competing_offer.offer_eth, -1) = COALESCE(current_offer.offer_eth, -1)
                 AND COALESCE(competing_offer.offered_at, competing_offer.created_at, '') < COALESCE(current_offer.offered_at, current_offer.created_at, '')
               )
             )
         )
       LIMIT 1`
    ).bind(orderHash).first<{ found: number }>();
    return Boolean(row?.found);
  } catch {
    return false;
  }
}

export async function upsertCriteriaOfferFromRow(
  env: OpenSeaMarketEnv,
  row: Record<string, unknown>,
  options: {
    recordActivity?: boolean;
    notificationMode?: OpenSeaMarketNotificationMode;
  } = {},
): Promise<boolean> {
  const criteriaKind = classifyOpenSeaOffer(row);
  if (criteriaKind === "item") return false;
  const orderHash = asString(row.order_hash);
  if (!orderHash) return false;
  const price = getPrice(row, "offer");
  if (!hasCurrencyValue(price)) return false;

  const traits = readCriteriaTraits(row);
  if (criteriaKind === "trait" && traits.length === 0) return false;
  const now = new Date().toISOString();
  const offeredAt = getOrderCreatedAt(row) ?? now;
  const offererWallet = getMakerAddress(row);
  const protocolAddress = normalizeAddress(row.protocol_address ?? asObject(row.protocol_data)?.address);
  const encodedTokenIds = getCriteriaEncodedTokenIds(row);
  const hadCriteriaRows = await criteriaOfferTableHasRows(env.WARPLETS);
  const existing = await env.WARPLETS.prepare(
    `SELECT order_hash, offer_raw_amount, offer_eth, active, order_status
     FROM opensea_criteria_offers
     WHERE order_hash = ?`
  ).bind(orderHash).first<{
    order_hash: string;
    offer_raw_amount: string | null;
    offer_eth: number | null;
    active: number;
    order_status?: string | null;
  }>().catch(() => null);
  if (existing?.active === 0 && existing.order_status === "CANCELLED") {
    return false;
  }
  const changed = !existing ||
    existing.active !== 1 ||
    String(existing.offer_raw_amount ?? "") !== String(price.rawAmount ?? "") ||
    String(existing.offer_eth ?? "") !== String(price.eth ?? "");

  await env.WARPLETS.prepare(
    `INSERT INTO opensea_criteria_offers (
       order_hash, collection_slug, criteria_kind, traits_json,
       offer_eth, offer_raw_amount, offer_decimals, offer_currency_symbol, offer_token_address,
       offerer_wallet, protocol_address, encoded_token_ids, active,
       offered_at, opensea_updated_at, raw_payload, created_at, updated_at
     )
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?)
     ON CONFLICT(order_hash) DO UPDATE SET
       collection_slug = excluded.collection_slug,
       criteria_kind = excluded.criteria_kind,
       traits_json = excluded.traits_json,
       offer_eth = excluded.offer_eth,
       offer_raw_amount = excluded.offer_raw_amount,
       offer_decimals = excluded.offer_decimals,
       offer_currency_symbol = excluded.offer_currency_symbol,
       offer_token_address = excluded.offer_token_address,
       offerer_wallet = excluded.offerer_wallet,
       protocol_address = excluded.protocol_address,
       encoded_token_ids = excluded.encoded_token_ids,
       active = 1,
       offered_at = excluded.offered_at,
       opensea_updated_at = excluded.opensea_updated_at,
       raw_payload = excluded.raw_payload,
       updated_at = excluded.updated_at`
  ).bind(
    orderHash,
    COLLECTION_SLUG,
    criteriaKind,
    traits.length > 0 ? JSON.stringify(traits) : null,
    price.eth,
    price.rawAmount,
    price.decimals,
    price.symbol,
    price.tokenAddress,
    offererWallet,
    protocolAddress,
    encodedTokenIds,
    offeredAt,
    now,
    safeJsonString(row),
    now,
    now,
  ).run();

  const matchedTokenIds = criteriaKind === "trait" ? await matchingTokenIdsForTraits(env.WARPLETS, traits) : [];
  await replaceCriteriaOfferMatches(env.WARPLETS, orderHash, criteriaKind, matchedTokenIds);

  if (
    options.recordActivity !== false &&
    criteriaKind === "trait" &&
    changed &&
    hadCriteriaRows &&
    price.eth != null &&
    await isBestTraitOfferForAnyMatch(env.WARPLETS, orderHash)
  ) {
    await recordWarpletActivity(env, {
      eventType: "trait_top_offer",
      actorWallet: offererWallet,
      amountEth: price.eth,
      amountRaw: price.rawAmount,
      currencySymbol: price.symbol,
      orderHash,
      occurredAt: offeredAt,
      source: "opensea:ingest",
      rawPayload: { offer: row, traits },
      queue: options.notificationMode !== "suppress",
    }).catch((error) => console.error("Failed to record trait offer activity", error));
  }

  return changed;
}

function snapshotFromRows(
  rows: MarketStateRow[],
  generatedAt = new Date().toISOString(),
  collection?: NonNullable<MarketSnapshot["collection"]>,
  traitOffers?: MarketSnapshot["traitOffers"],
): MarketSnapshot {
  const snapshot: MarketSnapshot = {
    version: "opensea-market-v1",
    generatedAt,
    maxAgeSeconds: SNAPSHOT_TTL_SECONDS,
    collection: collection ?? { floor: null, topOffer: null },
    listings: {},
    offers: {},
    traitOffers: traitOffers ?? {},
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
  const activeCollectionOffer = await loadActiveCollectionTopOffer(env.WARPLETS);
  if (activeCollectionOffer.loaded) collection.topOffer = activeCollectionOffer.offer;
  const traitOffers = Object.fromEntries(await loadActiveTraitOffersForToken(env.WARPLETS));
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
  return snapshotFromRows(rows.results ?? [], new Date().toISOString(), collection, traitOffers);
}

export async function loadMarketSnapshot(env: OpenSeaMarketEnv): Promise<MarketSnapshot> {
  const kv = env.WARPLETS_KV;
  if (kv) {
    const manifest = await kv.get(MARKET_SNAPSHOT_KEYS.manifest, "json") as { generatedAt?: string } | null;
    const [collection, listings, offers, traitOffers, sales, owners] = await Promise.all([
      kv.get(MARKET_SNAPSHOT_KEYS.collection, "json"),
      kv.get(MARKET_SNAPSHOT_KEYS.listings, "json"),
      kv.get(MARKET_SNAPSHOT_KEYS.offers, "json"),
      kv.get(MARKET_SNAPSHOT_KEYS.traitOffers, "json"),
      kv.get(MARKET_SNAPSHOT_KEYS.sales, "json"),
      kv.get(MARKET_SNAPSHOT_KEYS.owners, "json"),
    ]);
    const visibleSales = sanitizeVisibleSales(sales);
    if (manifest?.generatedAt && listings && offers && visibleSales && owners) {
      const persistedTraitOffers = Object.fromEntries(await loadActiveTraitOffersForToken(env.WARPLETS));
      const activeCollectionOffer = await loadActiveCollectionTopOffer(env.WARPLETS);
      const cachedTraitOffers = (traitOffers as MarketSnapshot["traitOffers"] | null) ?? {};
      const cachedCollection = (collection as MarketSnapshot["collection"] | null) ?? { floor: null, topOffer: null };
      return {
        version: "opensea-market-v1",
        generatedAt: manifest.generatedAt,
        maxAgeSeconds: SNAPSHOT_TTL_SECONDS,
        collection: activeCollectionOffer.loaded
          ? { ...cachedCollection, topOffer: activeCollectionOffer.offer }
          : cachedCollection,
        listings: listings as MarketSnapshot["listings"],
        offers: offers as MarketSnapshot["offers"],
        traitOffers: { ...cachedTraitOffers, ...persistedTraitOffers },
        sales: visibleSales,
        owners: owners as MarketSnapshot["owners"],
      };
    }
  }
  return loadMarketSnapshotFromD1(env);
}

/**
 * Public collection state intentionally excludes the 10,000-token owner/profile
 * directory. Ownership is loaded for a single wallet (or token detail) only when
 * a feature actually needs it.
 */
export async function loadCompactMarketSnapshot(
  env: OpenSeaMarketEnv,
  options: { skipKv?: boolean } = {},
): Promise<MarketSnapshot> {
  const kv = env.WARPLETS_KV;
  if (kv && !options.skipKv) {
    const manifest = await kv.get(MARKET_SNAPSHOT_KEYS.manifest, "json") as { generatedAt?: string } | null;
    const [collection, listings, offers, traitOffers, sales] = await Promise.all([
      kv.get(MARKET_SNAPSHOT_KEYS.collection, "json"),
      kv.get(MARKET_SNAPSHOT_KEYS.listings, "json"),
      kv.get(MARKET_SNAPSHOT_KEYS.offers, "json"),
      kv.get(MARKET_SNAPSHOT_KEYS.traitOffers, "json"),
      kv.get(MARKET_SNAPSHOT_KEYS.sales, "json"),
    ]);
    const visibleSales = sanitizeVisibleSales(sales);
    if (manifest?.generatedAt && listings && offers && visibleSales) {
      const persistedTraitOffers = Object.fromEntries(await loadActiveTraitOffersForToken(env.WARPLETS));
      const activeCollectionOffer = await loadActiveCollectionTopOffer(env.WARPLETS);
      const cachedCollection = (collection as MarketSnapshot["collection"] | null) ?? { floor: null, topOffer: null };
      return {
        version: "opensea-market-v2",
        generatedAt: manifest.generatedAt,
        maxAgeSeconds: SNAPSHOT_TTL_SECONDS,
        collection: activeCollectionOffer.loaded
          ? { ...cachedCollection, topOffer: activeCollectionOffer.offer }
          : cachedCollection,
        listings: listings as MarketSnapshot["listings"],
        offers: offers as MarketSnapshot["offers"],
        traitOffers: {
          ...((traitOffers as MarketSnapshot["traitOffers"] | null) ?? {}),
          ...persistedTraitOffers,
        },
        sales: visibleSales,
        owners: {},
      };
    }
  }

  const collection = collectionSnapshotFromRow(await loadCollectionMarketRow(env.WARPLETS));
  const activeCollectionOffer = await loadActiveCollectionTopOffer(env.WARPLETS);
  if (activeCollectionOffer.loaded) collection.topOffer = activeCollectionOffer.offer;
  const traitOffers = Object.fromEntries(await loadActiveTraitOffersForToken(env.WARPLETS));
  const activeCondition = `(
    listing_eth IS NOT NULL OR listing_raw_amount IS NOT NULL OR
    offer_eth IS NOT NULL OR offer_raw_amount IS NOT NULL OR
    sale_eth IS NOT NULL
  )`;
  let rows: D1Result<MarketStateRow>;
  try {
    rows = await env.WARPLETS.prepare(
      `SELECT token_id, ${MARKET_SELECT_COLUMNS}
       FROM warplet_market_state
       WHERE ${activeCondition}
       ORDER BY token_id ASC`,
    ).all<MarketStateRow>();
  } catch {
    rows = await env.WARPLETS.prepare(
      `SELECT token_id, ${LEGACY_MARKET_SELECT_COLUMNS}
       FROM warplet_market_state
       WHERE ${activeCondition}
       ORDER BY token_id ASC`,
    ).all<MarketStateRow>();
  }
  const updated = await env.WARPLETS.prepare(
    `SELECT MAX(COALESCE(opensea_updated_at, owner_event_at, owner_checked_at, sold_at, offered_at, listed_at)) AS updated_at
     FROM warplet_market_state`,
  ).first<{ updated_at: string | null }>().catch(() => null);
  const snapshot = snapshotFromRows(
    rows.results ?? [],
    updated?.updated_at ?? new Date().toISOString(),
    collection,
    traitOffers,
  );
  return { ...snapshot, version: "opensea-market-v2", owners: {} };
}

export async function loadMarketOwnership(
  env: OpenSeaMarketEnv,
  selector: { wallet?: string | null; fid?: number | null },
): Promise<{ wallet: string | null; fid: number | null; tokenIds: number[]; owners: MarketSnapshot["owners"]; updatedAt: string }> {
  const wallet = normalizeAddress(selector.wallet);
  const fid = Number.isInteger(selector.fid) && Number(selector.fid) > 0 ? Number(selector.fid) : null;
  if (!wallet && !fid) throw new Error("wallet or fid is required");

  const condition = wallet ? "LOWER(m.owner_wallet) = ?" : "m.owner_fid = ?";
  const binding = wallet ?? fid;
  let result: D1Result<MarketStateRow>;
  try {
    result = await env.WARPLETS.prepare(
      `SELECT ${MARKET_PROFILE_SELECT_COLUMNS}
       FROM warplet_market_state m
       LEFT JOIN wallet_farcaster_links l
         ON l.wallet = m.owner_wallet AND l.fid = m.owner_fid
       WHERE ${condition}
       ORDER BY m.token_id ASC`,
    ).bind(binding).all<MarketStateRow>();
  } catch {
    result = await env.WARPLETS.prepare(
      `SELECT m.token_id, ${LEGACY_MARKET_SELECT_COLUMNS.split(", ").map((column) => `m.${column}`).join(", ")}
       FROM warplet_market_state m
       WHERE ${condition}
       ORDER BY m.token_id ASC`,
    ).bind(binding).all<MarketStateRow>();
  }

  const rows = result.results ?? [];
  const snapshot = snapshotFromRows(rows);
  const ownerWallets = rows.map((row) => row.owner_wallet).filter((value): value is string => Boolean(value));
  const fallbackProfiles = await resolveWalletProfiles(env, ownerWallets);
  for (const owner of Object.values(snapshot.owners)) {
    if (owner.pfpUrl || !owner.wallet) continue;
    owner.pfpUrl = fallbackProfiles.get(owner.wallet.toLowerCase())?.avatarUrl ?? null;
  }
  return {
    wallet: wallet ?? rows[0]?.owner_wallet ?? null,
    fid: fid ?? rows[0]?.owner_fid ?? null,
    tokenIds: rows.map((row) => row.token_id),
    owners: snapshot.owners,
    updatedAt: rows.reduce((latest, row) => {
      const candidate = row.owner_checked_at ?? row.owner_event_at ?? "";
      return candidate > latest ? candidate : latest;
    }, "") || new Date().toISOString(),
  };
}

export async function publishMarketSnapshot(env: OpenSeaMarketEnv): Promise<MarketSnapshot> {
  const snapshot = await loadCompactMarketSnapshot(env, { skipKv: true });
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
      kv.put(MARKET_SNAPSHOT_KEYS.traitOffers, JSON.stringify(snapshot.traitOffers), { expirationTtl: SNAPSHOT_TTL_SECONDS * 6 }),
      kv.put(MARKET_SNAPSHOT_KEYS.sales, JSON.stringify(snapshot.sales), { expirationTtl: SNAPSHOT_TTL_SECONDS * 6 }),
    ]);
  }
  return snapshot;
}

export async function processListing(
  env: OpenSeaMarketEnv,
  row: Record<string, unknown>,
  notificationMode: OpenSeaMarketNotificationMode = "queue",
): Promise<boolean> {
  const tokenId = getTokenIdFromOpenSeaRow(row);
  if (!tokenId) return false;
  const price = getPrice(row, "consideration");
  const rowListedAt = getOrderCreatedAt(row);
  const orderHash = asString(row.order_hash);
  const sellerWallet = getMakerAddress(row);
  await recordOpenSeaMarketEvent(env, { ...row, event_type: "listing" }).catch(() => false);
  const existing = await env.WARPLETS.prepare(
    "SELECT listed_at, listing_order_hash FROM warplet_market_state WHERE token_id = ?",
  )
      .bind(tokenId)
      .first<{ listed_at: string | null; listing_order_hash: string | null }>()
      .catch(() => null);
  const listedAt = rowListedAt ?? existing?.listed_at ?? new Date().toISOString();
  const changed = await upsertMarketStateIfChanged(env.WARPLETS, {
    token_id: tokenId,
    listing_eth: price.eth,
    listed_at: listedAt,
    listing_order_hash: orderHash,
    listing_protocol_address: normalizeAddress(row.protocol_address ?? asObject(row.protocol_data)?.address),
    listing_seller_wallet: sellerWallet,
    listing_raw_amount: price.rawAmount,
    listing_decimals: price.decimals,
    listing_currency_symbol: price.symbol,
    listing_token_address: price.tokenAddress,
    opensea_updated_at: new Date().toISOString(),
  });
  if (changed && existing && existing.listing_order_hash !== orderHash && price.eth != null) {
    await recordWarpletActivity(env, {
      eventType: "listed",
      tokenId,
      actorWallet: sellerWallet,
      amountEth: price.eth,
      amountRaw: price.rawAmount,
      currencySymbol: price.symbol,
      orderHash,
      occurredAt: listedAt,
      source: "opensea:ingest",
      rawPayload: row,
      queue: notificationMode !== "suppress",
    }).catch((error) => console.error("Failed to record listing activity", error));
  }
  return changed;
}

export async function processOffer(
  env: OpenSeaMarketEnv,
  row: Record<string, unknown>,
  notificationMode: OpenSeaMarketNotificationMode = "queue",
): Promise<boolean> {
  if (classifyOpenSeaOffer(row) !== "item") {
    return upsertCriteriaOfferFromRow(env, row, { notificationMode });
  }
  const tokenId = getTokenIdFromOpenSeaRow(row);
  if (!tokenId) return false;
  const price = getPrice(row, "offer");
  const rowOfferedAt = getOrderCreatedAt(row);
  const orderHash = asString(row.order_hash);
  const offererWallet = getMakerAddress(row);
  await recordOpenSeaMarketEvent(env, { ...row, event_type: "offer" }).catch(() => false);
  const protocolAddress = normalizeAddress(row.protocol_address ?? asObject(row.protocol_data)?.address);
  const existing = await env.WARPLETS.prepare(
    "SELECT offered_at, offer_order_hash, offer_eth, offer_raw_amount, offer_decimals FROM warplet_market_state WHERE token_id = ?",
  )
      .bind(tokenId)
      .first<{
        offered_at: string | null;
        offer_order_hash: string | null;
        offer_eth: number | null;
        offer_raw_amount: string | null;
        offer_decimals: number | null;
      }>()
      .catch(() => null);
  const offeredAt = rowOfferedAt ?? existing?.offered_at ?? new Date().toISOString();
  if (orderHash) {
    await upsertActiveItemOffer(env, {
      orderHash,
      tokenId,
      offererWallet,
      amountEth: price.eth,
      amountRaw: price.rawAmount,
      currencySymbol: price.symbol,
      protocolAddress,
      createdAt: offeredAt,
    }).catch((error) => console.error("Failed to upsert active item offer", error));
  }
  const existingValue = existing?.offer_eth ?? (
    existing?.offer_raw_amount && existing.offer_decimals != null
      ? weiToNumber(existing.offer_raw_amount, existing.offer_decimals)
      : null
  );
  const nextValue = currencyComparableValue(price);
  const shouldUpdateMarketOffer =
    !existing?.offer_order_hash ||
    existing.offer_order_hash === orderHash ||
    priceIsBetterOrOlder({
      nextValue,
      nextAt: offeredAt,
      currentValue: existingValue,
      currentAt: existing?.offered_at ?? null,
    });
  if (!shouldUpdateMarketOffer) return false;
  const changed = await upsertMarketStateIfChanged(env.WARPLETS, {
    token_id: tokenId,
    offer_eth: price.eth,
    offered_at: offeredAt,
    offer_order_hash: orderHash,
    offer_protocol_address: protocolAddress,
    offerer_wallet: offererWallet,
    offer_raw_amount: price.rawAmount,
    offer_decimals: price.decimals,
    offer_currency_symbol: price.symbol,
    offer_token_address: price.tokenAddress,
    opensea_updated_at: new Date().toISOString(),
  });
  if (changed && existing && existing.offer_order_hash !== orderHash && price.eth != null) {
    await recordWarpletActivity(env, {
      eventType: "offered",
      tokenId,
      actorWallet: offererWallet,
      amountEth: price.eth,
      amountRaw: price.rawAmount,
      currencySymbol: price.symbol,
      orderHash,
      occurredAt: offeredAt,
      source: "opensea:ingest",
      rawPayload: row,
      queue: notificationMode !== "suppress",
    }).catch((error) => console.error("Failed to record offer activity", error));
  }
  return changed;
}

export async function clearTokenMarketSide(
  env: OpenSeaMarketEnv,
  tokenId: number,
  side: "listing" | "offer",
): Promise<boolean> {
  const now = new Date().toISOString();
  if (side === "offer") {
    const previousOffer = await env.WARPLETS.prepare(
      "SELECT offer_order_hash FROM warplet_market_state WHERE token_id = ?",
    )
      .bind(tokenId)
      .first<{ offer_order_hash: string | null }>()
      .catch(() => null);
    if (previousOffer?.offer_order_hash) {
      await deactivateActiveItemOffer(env, previousOffer.offer_order_hash).catch((error) =>
        console.error("Failed to deactivate inactive item offer", error),
      );
    }
  }
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
  options: {
    clearOrdersOnOwnerChange?: boolean;
    notificationMode?: OpenSeaMarketNotificationMode;
  } = {},
): Promise<boolean> {
  const tokenId = getTokenIdFromOpenSeaRow(row);
  if (!tokenId) return false;
  const eventType = asString(row.event_type)?.toLowerCase();
  const price = getPrice(row, "consideration");
  const buyer =
    normalizeAddress(row.buyer) ??
    normalizeAddress(asObject(row.buyer)?.address) ??
    normalizeAddress(row.to_address) ??
    normalizeAddress(row.to_account) ??
    normalizeAddress(asObject(row.to_account)?.address) ??
    normalizeAddress(asObject(row.winner_account)?.address);
  const seller =
    normalizeAddress(row.seller) ??
    normalizeAddress(asObject(row.seller)?.address) ??
    normalizeAddress(row.from_address) ??
    normalizeAddress(row.from_account) ??
    normalizeAddress(asObject(row.from_account)?.address);
  const checkedAt = new Date().toISOString();
  const eventOccurredAt = normalizeTimestamp(
    row.event_timestamp ?? row.created_date ?? row.sold_at ?? row.created_at,
  );
  const ownerWallet = buyer;
  const ownerFid = ownerWallet ? await selectPreferredFidForWallet(env, ownerWallet) : null;
  const existing = await env.WARPLETS.prepare(
    `SELECT owner_wallet, owner_fid, owner_event_at, sold_at, sale_tx_hash
     FROM warplet_market_state
     WHERE token_id = ?`,
  )
    .bind(tokenId)
    .first<{
      owner_wallet: string | null;
      owner_fid: number | null;
      owner_event_at: string | null;
      sold_at: string | null;
      sale_tx_hash: string | null;
    }>()
    .catch(() => null);
  const patch: MarketPatch = {
    token_id: tokenId,
    opensea_updated_at: checkedAt,
  };
  const ownerEventIsCurrent =
    !eventOccurredAt ||
    !existing?.owner_event_at ||
    Date.parse(eventOccurredAt) >= Date.parse(existing.owner_event_at);
  if (ownerWallet && ownerEventIsCurrent) {
    patch.owner_wallet = ownerWallet;
    patch.owner_fid = ownerFid;
    patch.owner_checked_at = checkedAt;
    patch.owner_event_at = eventOccurredAt ?? checkedAt;
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
  const saleIsCurrent =
    !eventOccurredAt ||
    !existing?.sold_at ||
    Date.parse(eventOccurredAt) >= Date.parse(existing.sold_at);
  const saleTxHash =
    asString(row.transaction) ??
    asString(asObject(row.transaction)?.transaction_hash);
  if (eventType === "sale" && price.eth != null && saleIsCurrent) {
    patch.sale_eth = price.eth;
    patch.sold_at = eventOccurredAt;
    patch.sale_tx_hash = saleTxHash;
    patch.seller_wallet = seller;
    patch.sale_raw_amount = price.rawAmount;
    patch.sale_decimals = price.decimals;
    patch.sale_currency_symbol = price.symbol;
    patch.sale_token_address = price.tokenAddress;
  }
  const changed = await upsertMarketStateIfChanged(env.WARPLETS, patch);
  const existingOwnerWallet = normalizeAddress(existing?.owner_wallet);
  const previousOwnerWallet = seller ?? existingOwnerWallet;
  const previousOwnerFid = previousOwnerWallet
    ? previousOwnerWallet === existingOwnerWallet && existing?.owner_fid != null
      ? existing.owner_fid
      : await selectPreferredFidForWallet(env, previousOwnerWallet)
    : null;

  if (ownerWallet && ownerEventIsCurrent && ownerWallet !== existingOwnerWallet) {
    await refreshHolderLeaderboardWallets(env.WARPLETS, [
      existingOwnerWallet,
      previousOwnerWallet,
      ownerWallet,
    ]);
  }

  if (eventType === "sale" && price.eth != null && eventOccurredAt) {
    const eventIdValue = row.event_id ?? row.id;
    const eventId =
      typeof eventIdValue === "string" || typeof eventIdValue === "number"
        ? String(eventIdValue)
        : null;
    const order = asObject(row.order);
    await recordNormalizedSale(env.WARPLETS, {
      chainId: 8453,
      collectionSlug: COLLECTION_SLUG,
      tokenId,
      transactionHash: saleTxHash,
      orderHash:
        asString(row.order_hash) ??
        asString(order?.order_hash) ??
        asString(asObject(row.protocol_data)?.order_hash),
      eventId,
      buyerWallet: buyer,
      sellerWallet: previousOwnerWallet,
      buyerFid: ownerFid,
      sellerFid: previousOwnerFid,
      marketplace: asString(row.marketplace) ?? "opensea",
      priceRaw: price.rawAmount,
      paymentDecimals: price.decimals,
      paymentSymbol: price.symbol,
      paymentAddress: price.tokenAddress,
      priceEth: price.eth,
      soldAt: eventOccurredAt,
      source: "opensea:ingest",
      rawPayload: row,
    });
  }

  if (eventType === "sale" && price.eth != null && saleTxHash && existing?.sale_tx_hash !== saleTxHash) {
    await recordWarpletActivity(env, {
      eventType: "purchased",
      tokenId,
      actorWallet: buyer,
      ownerWallet: previousOwnerWallet,
      ownerFid: previousOwnerFid,
      counterpartyWallet: previousOwnerWallet,
      amountEth: price.eth,
      amountRaw: price.rawAmount,
      currencySymbol: price.symbol,
      transactionHash: saleTxHash,
      occurredAt: eventOccurredAt,
      source: "opensea:ingest",
      rawPayload: row,
      queue: options.notificationMode !== "suppress",
    }).catch((error) => console.error("Failed to record purchase activity", error));
    await recordWarpletActivity(env, {
      eventType: "sold",
      tokenId,
      actorWallet: previousOwnerWallet,
      actorFid: previousOwnerFid,
      ownerWallet: previousOwnerWallet,
      ownerFid: previousOwnerFid,
      counterpartyWallet: buyer,
      counterpartyFid: ownerFid,
      amountEth: price.eth,
      amountRaw: price.rawAmount,
      currencySymbol: price.symbol,
      transactionHash: saleTxHash,
      occurredAt: eventOccurredAt,
      source: "opensea:ingest",
      rawPayload: row,
      queue: options.notificationMode !== "suppress",
    }).catch((error) => console.error("Failed to record sale activity", error));
  }
  return changed;
}

async function recordOpenSeaMarketEvent(
  env: OpenSeaMarketEnv,
  row: Record<string, unknown>,
): Promise<boolean> {
  const rawType = asString(row.event_type)?.toLowerCase();
  const eventType = rawType === "sale" || rawType === "transfer" || rawType === "listing" || rawType === "offer"
    ? rawType
    : null;
  const tokenId = getTokenIdFromOpenSeaRow(row);
  if (!eventType || !tokenId) return false;
  const occurredAt = normalizeTimestamp(row.event_timestamp ?? row.created_date ?? row.sold_at ?? row.created_at);
  if (!occurredAt || occurredAt < ANALYTICS_EPOCH) return false;
  const orderHash = asString(row.order_hash) ?? asString(asObject(row.order)?.order_hash);
  const transactionHash = asString(row.transaction) ?? asString(asObject(row.transaction)?.transaction_hash);
  const eventId = asString(row.event_id ?? row.id);
  const price = getPrice(row, eventType === "offer" ? "offer" : "consideration");
  const buyer = normalizeAddress(row.buyer) ?? normalizeAddress(asObject(row.buyer)?.address) ??
    normalizeAddress(row.to_address) ?? normalizeAddress(asObject(row.to_account)?.address);
  const seller = normalizeAddress(row.seller) ?? normalizeAddress(asObject(row.seller)?.address) ??
    normalizeAddress(row.from_address) ?? normalizeAddress(asObject(row.from_account)?.address);
  const maker = getMakerAddress(row);
  const fromWallet = eventType === "offer" || eventType === "listing" ? maker : seller;
  const toWallet = eventType === "sale" || eventType === "transfer" ? buyer : null;
  const canonicalKey = `opensea:${eventType}:${eventId ?? transactionHash ?? orderHash ?? `${tokenId}:${occurredAt}:${fromWallet ?? "unknown"}`}`;
  const [fromFid, toFid] = await Promise.all([
    fromWallet ? selectPreferredFidForWallet(env, fromWallet) : Promise.resolve(null),
    toWallet ? selectPreferredFidForWallet(env, toWallet) : Promise.resolve(null),
  ]);
  const result = await env.WARPLETS.prepare(
    `INSERT INTO warplet_market_activity (
       canonical_key, event_type, token_id, price_eth, amount_raw, currency_symbol,
       transaction_hash, order_hash, from_wallet, from_fid, to_wallet, to_fid,
       occurred_at, source, raw_payload, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'opensea', ?, CURRENT_TIMESTAMP)
     ON CONFLICT(canonical_key) DO UPDATE SET
       price_eth = COALESCE(excluded.price_eth, warplet_market_activity.price_eth),
       from_wallet = COALESCE(excluded.from_wallet, warplet_market_activity.from_wallet),
       from_fid = COALESCE(excluded.from_fid, warplet_market_activity.from_fid),
       to_wallet = COALESCE(excluded.to_wallet, warplet_market_activity.to_wallet),
       to_fid = COALESCE(excluded.to_fid, warplet_market_activity.to_fid),
       raw_payload = excluded.raw_payload,
       updated_at = CURRENT_TIMESTAMP`
  ).bind(
    canonicalKey, eventType, tokenId, eventType === "transfer" ? null : price.eth,
    price.rawAmount, price.symbol, transactionHash, orderHash, fromWallet, fromFid,
    toWallet, toFid, occurredAt, JSON.stringify(row),
  ).run();
  return (result.meta.changes ?? 0) > 0;
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
  const orderHashes = new Set<string>();
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
      const orderHash = asString(row.order_hash);
      if (orderHash) orderHashes.add(orderHash);
      if (await processor(env, row)) changed += 1;
    }
    cursor = asString(payload.next);
    if (!cursor || rows.length === 0) {
      complete = true;
      break;
    }
  }
  return { changed, tokenIds, orderHashes, complete };
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
  eventType: "sale" | "transfer" | "listing" | "offer",
  after: string | null,
  initialCursor: string | null,
  notificationMode: OpenSeaMarketNotificationMode,
): Promise<EventIngestResult> {
  let cursor = initialCursor;
  let changed = 0;
  for (let page = 0; page < EVENT_INGEST_MAX_PAGES; page += 1) {
    const eventParams = new URLSearchParams({ limit: "200", event_type: eventType });
    if (after) eventParams.set("after", after);
    if (cursor) eventParams.set("next", cursor);
    const payload = await fetchOpenSea(
      `/events/collection/${COLLECTION_SLUG}`,
      apiKey,
      eventParams,
    );
    const rows = asArray(payload.asset_events ?? payload.events)
      .map((event) => asObject(event))
      .filter((event): event is Record<string, unknown> => Boolean(event))
      .sort((left, right) => {
        const leftAt = Date.parse(normalizeTimestamp(
          left.event_timestamp ?? left.created_date ?? left.sold_at ?? left.created_at,
        ) ?? "");
        const rightAt = Date.parse(normalizeTimestamp(
          right.event_timestamp ?? right.created_date ?? right.sold_at ?? right.created_at,
        ) ?? "");
        return (Number.isFinite(leftAt) ? leftAt : 0) - (Number.isFinite(rightAt) ? rightAt : 0);
    });
    for (const row of rows) {
      const recorded = await recordOpenSeaMarketEvent(env, { ...row, event_type: eventType });
      const didChange = eventType === "sale" || eventType === "transfer"
        ? (await processSaleOrTransfer(env, row, {
          clearOrdersOnOwnerChange: true,
          notificationMode,
        })) || recorded
        : recorded;
      if (didChange) {
        changed += 1;
      }
    }
    cursor = asString(payload.next);
    if (!cursor || rows.length === 0) {
      return { changed, complete: true, nextCursor: null };
    }
  }
  return { changed, complete: false, nextCursor: cursor };
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
    .map((event): Record<string, unknown> => {
      const normalized = { ...event, event_type: asString(event.event_type) ?? "sale" };
      // Some token-specific OpenSea responses omit a root identifier, while
      // collection responses can include an unrelated root identifier. Trust
      // the NFT/asset payload first and use endpoint context only when the
      // event contains no token identifier at all.
      return getTokenIdFromOpenSeaRow(normalized) == null
        ? { ...normalized, identifier: String(tokenId) }
        : normalized;
    })
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

function priceIsBetterOrOlder(input: {
  nextValue: number | null;
  nextAt: string | null;
  currentValue: number | null;
  currentAt: string | null;
}): boolean {
  if (input.nextValue == null || !Number.isFinite(input.nextValue)) return false;
  if (input.currentValue == null || input.nextValue > input.currentValue) return true;
  if (input.nextValue < input.currentValue) return false;
  const nextTime = timestampMs(input.nextAt);
  const currentTime = timestampMs(input.currentAt);
  return nextTime != null && currentTime != null && nextTime < currentTime;
}

async function refreshCollectionMarketState(
  env: OpenSeaMarketEnv,
  apiKey: string,
  notificationMode: OpenSeaMarketNotificationMode = "queue",
): Promise<number> {
  let changed = 0;
  const now = new Date().toISOString();

  try {
    let stats = await fetchOpenSea(`/collections/${COLLECTION_SLUG}/stats`, apiKey);
    const capturedAt = analyticsHourBucket(new Date(now));
    const persisted = await persistOpenSeaStatsSnapshot(env.WARPLETS, stats, capturedAt);
    if (!persisted.persisted && persisted.reason?.startsWith("opensea_stats_drift:")) {
      const retryStats = await fetchOpenSea(`/collections/${COLLECTION_SLUG}/stats`, apiKey);
      const retry = await persistOpenSeaStatsSnapshot(env.WARPLETS, retryStats, capturedAt);
      if (retry.persisted) stats = retryStats;
    }
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
      .filter((item): item is Record<string, unknown> => Boolean(item))
      .filter((item) => classifyOpenSeaOffer(item) === "collection");
    const best = offers.reduce<{
      row: Record<string, unknown>;
      price: CurrencyValue;
      value: number;
      createdAt: string | null;
    } | null>((current, row) => {
      const tokenId = getTokenIdFromOpenSeaRow(row);
      if (tokenId) return current;
      const price = getPrice(row, "offer");
      const value = currencyComparableValue(price);
      if (value == null || !Number.isFinite(value)) return current;
      const createdAt = getOrderCreatedAt(row) ?? now;
      if (
        !current ||
        priceIsBetterOrOlder({
          nextValue: value,
          nextAt: createdAt,
          currentValue: current.value,
          currentAt: current.createdAt,
        })
      ) {
        return { row, price, value, createdAt };
      }
      return current;
    }, null);

    if (best) {
      const previous = await env.WARPLETS.prepare(
        "SELECT top_offer_order_hash FROM opensea_collection_market_state WHERE collection_slug = ? LIMIT 1",
      )
        .bind(COLLECTION_SLUG)
        .first<{ top_offer_order_hash: string | null }>()
        .catch(() => null);
      const orderHash = asString(best.row.order_hash);
      const offererWallet = getMakerAddress(best.row);
      const createdAt = best.createdAt ?? now;
      if (await upsertCollectionMarketStateIfChanged(env.WARPLETS, {
        collection_slug: COLLECTION_SLUG,
        top_offer_eth: best.price.eth,
        top_offer_raw_amount: best.price.rawAmount,
        top_offer_decimals: best.price.decimals,
        top_offer_currency_symbol: best.price.symbol,
        top_offer_token_address: best.price.tokenAddress,
        top_offer_order_hash: orderHash,
        top_offer_protocol_address: normalizeAddress(best.row.protocol_address ?? asObject(best.row.protocol_data)?.address),
        top_offerer_wallet: offererWallet,
        top_offer_created_at: createdAt,
        top_offer_updated_at: now,
      })) {
        changed += 1;
        if (previous && previous.top_offer_order_hash !== orderHash && best.price.eth != null) {
          await recordWarpletActivity(env, {
            eventType: "collection_top_offer",
            actorWallet: offererWallet,
            amountEth: best.price.eth,
            amountRaw: best.price.rawAmount,
            currencySymbol: best.price.symbol,
            orderHash,
            occurredAt: createdAt,
            source: "opensea:ingest",
            rawPayload: best.row,
            queue: notificationMode !== "suppress",
          }).catch((error) => console.error("Failed to record collection offer activity", error));
        }
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

async function persistCurrentCollectionAnalyticsSnapshot(
  env: OpenSeaMarketEnv,
  capturedAt = new Date().toISOString(),
): Promise<void> {
  try {
    const [collection, counts] = await Promise.all([
      loadCollectionMarketRow(env.WARPLETS),
      env.WARPLETS.prepare(
        `SELECT
           SUM(CASE WHEN listing_eth IS NOT NULL OR listing_raw_amount IS NOT NULL THEN 1 ELSE 0 END) AS listed_count,
           COUNT(DISTINCT CASE
             WHEN owner_wallet IS NOT NULL AND TRIM(owner_wallet) <> '' THEN LOWER(TRIM(owner_wallet))
           END) AS owners_count
         FROM warplet_market_state`,
      ).first<{ listed_count: number | null; owners_count: number | null }>(),
    ]);
    await persistCollectionMarketSnapshot(env.WARPLETS, {
      collectionSlug: COLLECTION_SLUG,
      capturedAt: analyticsHourBucket(new Date(capturedAt)),
      floorEth: collection?.floor_eth ?? null,
      topOfferEth: collection?.top_offer_eth ?? null,
      listedCount: Number(counts?.listed_count ?? 0),
      ownersCount: Number(counts?.owners_count ?? 0),
      source: "opensea:ingest",
    });
  } catch {
    // Analytics snapshots are additive and must never block market freshness.
  }
}

async function reconcileHolderLeaderboardIfDue(
  env: OpenSeaMarketEnv,
  now = new Date(),
): Promise<void> {
  const sourceKey = "holders:leaderboard:reconcile";
  try {
    const state = await env.WARPLETS.prepare(
      "SELECT last_success_at FROM analytics_ingest_state WHERE source_key = ?",
    ).bind(sourceKey).first<{ last_success_at: string | null }>();
    const lastSuccessMs = Date.parse(state?.last_success_at ?? "");
    if (Number.isFinite(lastSuccessMs) && now.getTime() - lastSuccessMs < 6 * 60 * 60 * 1000) {
      return;
    }

    const result = await rebuildHolderLeaderboard(env.WARPLETS);
    if (!result.rebuilt) return;
    const completedAt = now.toISOString();
    await env.WARPLETS.prepare(
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
         updated_at = excluded.updated_at`,
    ).bind(
      sourceKey,
      completedAt,
      completedAt,
      completedAt,
      completedAt,
    ).run();
  } catch {
    // The migration may not be applied yet; holder APIs can still derive a fallback.
  }
}

async function hasOpenSeaMarketBootstrapMarker(db: D1Database): Promise<boolean> {
  const row = await db.prepare(
    "SELECT value FROM opensea_ingest_state WHERE key = ? LIMIT 1",
  ).bind(BOOTSTRAP_COMPLETE_KEY).first<{ value: string | null }>().catch(() => null);
  return Boolean(row?.value);
}

export async function loadOpenSeaMarketBootstrapState(
  db: D1Database,
): Promise<OpenSeaMarketBootstrapState> {
  let resultRows: Array<{ key: string; value: string | null }> = [];
  try {
    const rows = await db.prepare(
      `SELECT key, value
       FROM opensea_ingest_state
       WHERE key LIKE 'events_after:%' OR key LIKE 'events_cursor:%'`,
    ).all<{ key: string; value: string | null }>();
    resultRows = rows.results ?? [];
  } catch {
    // Older local databases without ingest state are not bootstrapped.
  }
  return deriveOpenSeaMarketBootstrapState(resultRows);
}

async function ingestOpenSeaMarketUnlocked(
  env: OpenSeaMarketEnv,
  notificationMode: OpenSeaMarketNotificationMode,
): Promise<OpenSeaMarketIngestResult> {
  const apiKey = env.OPENSEA_API_KEY?.trim();
  if (!apiKey) throw new Error("OPENSEA_API_KEY is not configured");

  await initializeOwnersFromMetadata(env.WARPLETS);
  let changed = 0;
  changed += await refreshCollectionMarketState(env, apiKey, notificationMode);
  const listings = await ingestPaginated(
    env,
    apiKey,
    `/listings/collection/${COLLECTION_SLUG}/all`,
    ["listings", "orders"],
    (processorEnv, row) => processListing(processorEnv, row, notificationMode),
    50,
  );
  changed += listings.changed;
  if (listings.complete) changed += await clearInactiveMarketRows(env.WARPLETS, "listing", listings.tokenIds);

  try {
    const offers = await ingestPaginated(
      env,
      apiKey,
      `/offers/collection/${COLLECTION_SLUG}/all`,
      ["offers", "orders"],
      (processorEnv, row) => processOffer(processorEnv, row, notificationMode),
      50,
    );
    changed += offers.changed;
    if (offers.complete) changed += await clearInactiveMarketRows(env.WARPLETS, "offer", offers.tokenIds);
  } catch (error) {
    console.warn("OpenSea offers ingest failed; preserving the previous offers snapshot", error);
  }

  const last = await env.WARPLETS.prepare(
    "SELECT value FROM opensea_ingest_state WHERE key = 'events_after'",
  ).first<{ value: string | null }>();
  const epochSeconds = String(Math.floor(Date.parse(ANALYTICS_EPOCH) / 1000));
  let eventsComplete = true;
  const completedAfterValues: number[] = [];
  for (const eventType of EVENT_TYPES) {
    const afterKey = `events_after:${eventType}`;
    const cursorKey = `events_cursor:${eventType}`;
    try {
      const [afterState, cursorState] = await Promise.all([
        env.WARPLETS.prepare(
          "SELECT value FROM opensea_ingest_state WHERE key = ?",
        ).bind(afterKey).first<{ value: string | null }>(),
        env.WARPLETS.prepare(
          "SELECT value FROM opensea_ingest_state WHERE key = ?",
        ).bind(cursorKey).first<{ value: string | null }>(),
      ]);
      const legacyAfter = Number(last?.value);
      const inheritedAfter = Number.isFinite(legacyAfter)
        ? String(Math.max(Number(epochSeconds), legacyAfter - EVENT_INGEST_OVERLAP_SECONDS))
        : epochSeconds;
      const after = afterState?.value ?? inheritedAfter;
      const result = await ingestCollectionEvents(
        env,
        apiKey,
        eventType,
        after,
        cursorState?.value ?? null,
        notificationMode,
      );
      changed += result.changed;
      const updatedAt = new Date().toISOString();
      if (result.complete) {
        const previousAfter = Number(after);
        const safeAfter = Math.max(
          Number.isFinite(previousAfter) ? previousAfter : Number(epochSeconds),
          Math.floor(Date.now() / 1000) - EVENT_INGEST_OVERLAP_SECONDS,
        );
        completedAfterValues.push(safeAfter);
        await env.WARPLETS.batch([
          env.WARPLETS.prepare(
            `INSERT INTO opensea_ingest_state (key, value, updated_at)
             VALUES (?, ?, ?)
             ON CONFLICT(key) DO UPDATE SET
               value = excluded.value,
               updated_at = excluded.updated_at`,
          ).bind(afterKey, String(safeAfter), updatedAt),
          env.WARPLETS.prepare(
            "DELETE FROM opensea_ingest_state WHERE key = ?",
          ).bind(cursorKey),
        ]);
      } else if (result.nextCursor) {
        eventsComplete = false;
        await env.WARPLETS.prepare(
          `INSERT INTO opensea_ingest_state (key, value, updated_at)
           VALUES (?, ?, ?)
           ON CONFLICT(key) DO UPDATE SET
             value = excluded.value,
             updated_at = excluded.updated_at`,
        ).bind(cursorKey, result.nextCursor, updatedAt).run();
      }
    } catch (error) {
      eventsComplete = false;
      console.warn(`OpenSea ${eventType} events ingest failed; preserving existing event data`, error);
    }
  }

  if (eventsComplete && completedAfterValues.length === 4) {
    await env.WARPLETS.prepare(
      `INSERT INTO opensea_ingest_state (key, value, updated_at)
       VALUES ('events_after', ?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
    ).bind(
      String(Math.min(...completedAfterValues)),
      new Date().toISOString(),
    ).run();
  }

  await Promise.all([
    persistCurrentCollectionAnalyticsSnapshot(env),
    reconcileHolderLeaderboardIfDue(env),
  ]);
  const snapshot = await publishMarketSnapshot(env);
  const bootstrap = await loadOpenSeaMarketBootstrapState(env.WARPLETS);
  if (bootstrap.complete) {
    await env.WARPLETS.prepare(
      `INSERT INTO opensea_ingest_state (key, value, updated_at)
       VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    ).bind(BOOTSTRAP_COMPLETE_KEY, snapshot.generatedAt, snapshot.generatedAt).run().catch(() => undefined);
  }
  return { changed, generatedAt: snapshot.generatedAt, bootstrap, notificationMode };
}

export async function ingestOpenSeaMarket(
  env: OpenSeaMarketEnv,
  options: OpenSeaMarketIngestOptions = {},
): Promise<OpenSeaMarketIngestResult> {
  const bootstrapComplete = await hasOpenSeaMarketBootstrapMarker(env.WARPLETS);
  const notificationMode = resolveOpenSeaMarketNotificationMode(bootstrapComplete, options);
  const lockKey = "market_ingest:lease";
  const leaseOwner = crypto.randomUUID();
  const acquiredAt = new Date().toISOString();
  try {
    await env.WARPLETS.batch([
      env.WARPLETS.prepare(
        `DELETE FROM opensea_ingest_state
         WHERE key = ? AND datetime(updated_at) < datetime('now', '-30 minutes')`,
      ).bind(lockKey),
      env.WARPLETS.prepare(
        `INSERT OR IGNORE INTO opensea_ingest_state (key, value, updated_at)
         VALUES (?, ?, ?)`,
      ).bind(lockKey, leaseOwner, acquiredAt),
    ]);
    const lease = await env.WARPLETS.prepare(
      "SELECT value FROM opensea_ingest_state WHERE key = ?",
    ).bind(lockKey).first<{ value: string | null }>();
    if (!ownsOpenSeaMarketLease(lease?.value, leaseOwner)) {
      const snapshot = await loadCompactMarketSnapshot(env);
      return {
        changed: 0,
        generatedAt: snapshot.generatedAt,
        bootstrap: await loadOpenSeaMarketBootstrapState(env.WARPLETS),
        notificationMode,
      };
    }
  } catch {
    // Older local schemas may not have ingest state yet; preserve ingestion behavior.
    return ingestOpenSeaMarketUnlocked(env, notificationMode);
  }

  try {
    return await ingestOpenSeaMarketUnlocked(env, notificationMode);
  } finally {
    await env.WARPLETS.prepare(
      "DELETE FROM opensea_ingest_state WHERE key = ? AND value = ?",
    ).bind(lockKey, leaseOwner).run().catch(() => undefined);
  }
}

export async function ingestOpenSeaMarketIfDue(
  env: OpenSeaMarketEnv,
  now = new Date(),
): Promise<ScheduledOpenSeaMarketResult> {
  if (!enabled(env.OPENSEA_MARKET_INGEST_ENABLED)) return { status: "disabled" };
  if (!(await hasOpenSeaMarketBootstrapMarker(env.WARPLETS))) {
    return { status: "bootstrap_required" };
  }
  const lastSuccess = await env.WARPLETS.prepare(
    "SELECT value FROM opensea_ingest_state WHERE key = ? LIMIT 1",
  ).bind(LAST_SUCCESS_KEY).first<{ value: string | null }>().catch(() => null);
  const intervalMinutes = marketIngestIntervalMinutes(env.OPENSEA_MARKET_INGEST_INTERVAL_MINUTES);
  if (!isOpenSeaMarketIngestDue(lastSuccess?.value, now.getTime(), intervalMinutes)) {
    return { status: "fresh", lastSuccessAt: lastSuccess?.value ?? null };
  }

  const result = await ingestOpenSeaMarket(env);
  const completedAt = new Date().toISOString();
  await env.WARPLETS.prepare(
    `INSERT INTO opensea_ingest_state (key, value, updated_at)
     VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
  ).bind(LAST_SUCCESS_KEY, completedAt, completedAt).run();
  return { status: "ingested", ...result };
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
    const [listingPayload, offerPayload, salePayload, ownerWallet, previousOwner] = await Promise.all([
      fetchOpenSea(`/listings/collection/${COLLECTION_SLUG}/nfts/${encodeURIComponent(String(tokenId))}/best`, apiKey).catch(() => null),
      fetchOpenSea(`/offers/collection/${COLLECTION_SLUG}/nfts/${encodeURIComponent(String(tokenId))}/best`, apiKey).catch(() => null),
      fetchLatestTokenSale(apiKey, tokenId).catch(() => null),
      ownerOf(tokenId, env).catch(() => null),
      env.WARPLETS.prepare(
        "SELECT owner_wallet FROM warplet_market_state WHERE token_id = ?",
      ).bind(tokenId).first<{ owner_wallet: string | null }>().catch(() => null),
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
      const offerKind = classifyOpenSeaOffer(offer);
      if (offerKind === "item") {
        const offerRow = { ...offer, identifier: String(tokenId) };
        if (hasCurrencyValue(getPrice(offerRow, "offer"))) {
          await processOffer(env, offerRow);
        } else {
          await clearTokenMarketSide(env, tokenId, "offer");
        }
      } else if (hasCurrencyValue(getPrice(offer, "offer"))) {
        await upsertCriteriaOfferFromRow(env, offer, { recordActivity: false });
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
        owner_event_at: now,
        opensea_updated_at: now,
      });
      if (ownerWallet !== previousOwner?.owner_wallet) {
        await refreshHolderLeaderboardWallets(env.WARPLETS, [
          previousOwner?.owner_wallet,
          ownerWallet,
        ]);
      }
    }
    await persistCurrentCollectionAnalyticsSnapshot(env, now);
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
  const traitOffers = Object.fromEntries(await loadActiveTraitOffersForToken(env.WARPLETS, tokenId));
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
  return snapshotFromRows(row ? [row] : [], new Date().toISOString(), collection, traitOffers);
}

export function marketJson(data: unknown, init?: ResponseInit): Response {
  const response = jsonSecure(data, init);
  response.headers.set("cache-control", "public, max-age=60, stale-while-revalidate=600");
  return response;
}

export async function marketJsonWithEtag(data: unknown, request: Request, init?: ResponseInit): Promise<Response> {
  const encoded = new TextEncoder().encode(JSON.stringify(data));
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", encoded));
  const etag = `"${Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("")}"`;
  if (request.headers.get("if-none-match") === etag) {
    return new Response(null, {
      status: 304,
      headers: {
        etag,
        "cache-control": "public, max-age=60, stale-while-revalidate=600",
      },
    });
  }
  const response = marketJson(data, init);
  response.headers.set("etag", etag);
  return response;
}
