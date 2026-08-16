import {
  asArray,
  asNumber,
  asObject,
  asString,
  classifyOpenSeaOffer,
  fetchOpenSea,
  ingestOpenSeaMarket,
  isEthLikeCurrency,
  marketJson,
  normalizeAddress,
  ownerOf,
  ownersOf,
  processOffer,
  selectPreferredFidForWallet,
  upsertMarketStateIfChanged,
  upsertCriteriaOfferFromRow,
  weiToNumber,
  type MarketMoney,
  type OpenSeaMarketEnv,
} from "./openseaMarket.js";
import { jsonSecure } from "./security.js";
import { logTradeAction } from "./openseaTrade.js";
import { recordWarpletActivity } from "./warpletNotifications.js";
import { resolveWalletProfiles } from "./walletProfiles.js";
import { concatHex, hashStruct, keccak256, toHex, type Hex } from "viem";

export type CollectionOffersEnv = OpenSeaMarketEnv;

async function refreshItemOfferOwner(env: CollectionOffersEnv, tokenId: number): Promise<void> {
  const ownerWallet = await ownerOf(tokenId).catch(() => null);
  if (!ownerWallet) return;
  const now = new Date().toISOString();
  const ownerFid = await selectPreferredFidForWallet(env, ownerWallet);
  await upsertMarketStateIfChanged(env.WARPLETS, {
    token_id: tokenId,
    owner_wallet: ownerWallet,
    owner_fid: ownerFid,
    owner_checked_at: now,
    owner_event_at: now,
    opensea_updated_at: now,
  });
}

async function refreshRecentItemOfferOwners(env: CollectionOffersEnv): Promise<void> {
  const tokenIds = await env.WARPLETS.prepare(
    `SELECT token_id
     FROM warplet_active_item_offers
     WHERE active = 1
       AND (expires_at IS NULL OR datetime(expires_at) > CURRENT_TIMESTAMP)
     GROUP BY token_id
     ORDER BY MAX(updated_at) DESC
     LIMIT 50`,
  ).all<{ token_id: number }>().then((result) =>
    (result.results ?? []).map((row) => Number(row.token_id)).filter((tokenId) => Number.isInteger(tokenId) && tokenId > 0),
  );
  const owners = await ownersOf(tokenIds);
  const now = new Date().toISOString();
  await Promise.all([...owners].map(([tokenId, ownerWallet]) => upsertMarketStateIfChanged(env.WARPLETS, {
    token_id: tokenId,
    owner_wallet: ownerWallet,
    owner_fid: null,
    owner_checked_at: now,
    owner_event_at: now,
    opensea_updated_at: now,
  })));
}

async function refreshItemOffersForToken(env: CollectionOffersEnv, tokenId: number): Promise<void> {
  const apiKey = requireOpenSeaApiKey(env);
  const rows: Record<string, unknown>[] = [];
  let cursor: string | null = null;
  let complete = false;
  for (let page = 0; page < 10; page += 1) {
    const params = new URLSearchParams({ limit: "50" });
    if (cursor) params.set("next", cursor);
    const payload = await fetchOpenSea(
      `/offers/collection/${COLLECTION_SLUG}/nfts/${encodeURIComponent(String(tokenId))}`,
      apiKey,
      params,
    );
    rows.push(...asArray(payload.offers ?? payload.orders)
      .map((item) => asObject(item))
      .filter((item): item is Record<string, unknown> => Boolean(item))
      .filter((item) => classifyOpenSeaOffer(item) === "item"));
    cursor = asString(payload.next);
    if (!cursor) {
      complete = true;
      break;
    }
  }
  await Promise.all(rows.map((row) => processOffer(env, row)));
  await refreshItemOfferOwner(env, tokenId);
  // Only deactivate missing rows after consuming the complete OpenSea result set.
  if (!complete) return;
  const activeHashes = rows
    .map((row) => asString(row.order_hash)?.toLowerCase() ?? null)
    .filter((hash): hash is string => Boolean(hash));
  if (activeHashes.length === 0) {
    await env.WARPLETS.prepare(
      "UPDATE warplet_active_item_offers SET active = 0, updated_at = CURRENT_TIMESTAMP WHERE token_id = ? AND active = 1",
    ).bind(tokenId).run();
    return;
  }
  const placeholders = activeHashes.map(() => "?").join(", ");
  await env.WARPLETS.prepare(
    `UPDATE warplet_active_item_offers
     SET active = 0, updated_at = CURRENT_TIMESTAMP
     WHERE token_id = ? AND active = 1 AND lower(order_hash) NOT IN (${placeholders})`,
  ).bind(tokenId, ...activeHashes).run();
}

type CollectionOfferRow = {
  order_hash: string;
  collection_slug: string;
  criteria_kind: "collection" | "trait";
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
  offered_at: string | null;
  opensea_updated_at: string | null;
  raw_payload: string | null;
  remaining_quantity?: number | null;
  order_status?: string | null;
  bidder_profile_json?: string | null;
  pfp_url?: string | null;
  username?: string | null;
  display_name?: string | null;
  x_username?: string | null;
  user_x_username?: string | null;
};

type BidderProfile = {
  wallet: string;
  fid: number | null;
  username: string | null;
  displayName: string | null;
  pfpUrl: string | null;
  xUsername: string | null;
  openseaUrl: string;
  farcasterUrl: string | null;
  xUrl: string | null;
  basescanUrl: string;
};

type CollectionOffer = {
  orderHash: string;
  protocolAddress: string | null;
  offerer: string;
  price: MarketMoney;
  quantity: number;
  status: string | null;
  createdAt: string | null;
  bidder: BidderProfile;
};

type CollectionOfferGroupOrder = {
  orderHash: string;
  protocolAddress: string | null;
  quantity: number;
  createdAt: string | null;
  bidder: BidderProfile;
};

type CollectionOfferGroup = {
  price: MarketMoney;
  volume: MarketMoney;
  offerCount: number;
  bidderCount: number;
  previewBidders: BidderProfile[];
  orders: CollectionOfferGroupOrder[];
  userOfferCount: number;
  userOrders: Array<{
    orderHash: string;
    protocolAddress: string | null;
    quantity: number;
  }>;
  traitType?: string;
  traitValue?: string;
};

const TRAIT_LEVELS = ["10X", "9X", "8X", "7X", "6X", "5X", "4X", "3X", "2X", "1X"] as const;
const TRAIT_ATTRIBUTES = [
  { id: "cast", traitType: "Cast Level", column: "cast_level" },
  { id: "fid", traitType: "FID Level", column: "fid_level" },
  { id: "follower", traitType: "Follower Level", column: "follower_level" },
  { id: "holder", traitType: "Holder Level", column: "holder_level" },
  { id: "luck", traitType: "Luck Level", column: "luck_level" },
  { id: "minter", traitType: "Minter Level", column: "minter_level" },
  { id: "neynar", traitType: "Neynar Level", column: "neynar_level" },
  { id: "nft", traitType: "NFT Level", column: "nft_level" },
  { id: "token", traitType: "Token Level", column: "token_level" },
  { id: "volume", traitType: "Volume Level", column: "volume_level" },
] as const;

function readTraitCriteria(row: CollectionOfferRow): { traitType: string; traitValue: string } | null {
  try {
    const traits = row.traits_json ? JSON.parse(row.traits_json) as unknown : [];
    if (!Array.isArray(traits)) return null;
    const first = asObject(traits[0]);
    const traitType = asString(first?.type ?? first?.traitType ?? first?.trait_type);
    const traitValue = asString(first?.traitValue ?? first?.value);
    return traitType && traitValue ? { traitType, traitValue } : null;
  } catch {
    return null;
  }
}

type WalletFarcasterLinkResult = {
  wallet: string;
  fid: number | null;
  username: string | null;
  display_name: string | null;
  pfp_url: string | null;
  x_username?: string | null;
  user_x_username?: string | null;
};

const OPENSEA_API_BASE = "https://api.opensea.io/api/v2";
const COLLECTION_SLUG = "10xwarplets";
const COLLECTION_CONTRACT = "0x780446dd12e080ae0db762fcd4daf313f3e359de";
const BASE_CHAIN = "base";
const BASE_CHAIN_ID = 8453;
const BASE_CHAIN_ID_HEX = "0x2105";
const BASE_WETH = "0x4200000000000000000000000000000000000006";
const DEFAULT_SEAPORT_PROTOCOL = "0x0000000000000068f116a894984e2db1123eb395";
const OPENSEA_SIGNED_ZONE_V2 = "0x000056f7000000ece9003ca63978907a00ffd100";
const OPENSEA_CONDUIT_KEY = "0x0000007b02230091a7ed01230072f7006a004d60a8d4e71d599b8104250f0000";
const OPENSEA_CONDUIT_ADDRESS = "0x1e0049783f008a0085193e00003d00cd54003c71";
const ZERO_HASH = "0x0000000000000000000000000000000000000000000000000000000000000000";
const MAX_OPENSEA_ORDER_DURATION_SECONDS = 179 * 24 * 60 * 60;
const SEAPORT_ORDER_TYPE_FULL_OPEN = 0;
const SEAPORT_ORDER_TYPE_PARTIAL_OPEN = 1;
const SEAPORT_ORDER_TYPE_FULL_RESTRICTED = 2;
const SEAPORT_ORDER_TYPE_PARTIAL_RESTRICTED = 3;
const SEAPORT_ORDER_TYPES = {
  OrderComponents: [
    { name: "offerer", type: "address" },
    { name: "zone", type: "address" },
    { name: "offer", type: "OfferItem[]" },
    { name: "consideration", type: "ConsiderationItem[]" },
    { name: "orderType", type: "uint8" },
    { name: "startTime", type: "uint256" },
    { name: "endTime", type: "uint256" },
    { name: "zoneHash", type: "bytes32" },
    { name: "salt", type: "uint256" },
    { name: "conduitKey", type: "bytes32" },
    { name: "counter", type: "uint256" },
  ],
  OfferItem: [
    { name: "itemType", type: "uint8" },
    { name: "token", type: "address" },
    { name: "identifierOrCriteria", type: "uint256" },
    { name: "startAmount", type: "uint256" },
    { name: "endAmount", type: "uint256" },
  ],
  ConsiderationItem: [
    { name: "itemType", type: "uint8" },
    { name: "token", type: "address" },
    { name: "identifierOrCriteria", type: "uint256" },
    { name: "startAmount", type: "uint256" },
    { name: "endAmount", type: "uint256" },
    { name: "recipient", type: "address" },
  ],
} as const;

export function computeSeaportOrderHash(parameters: Record<string, unknown>): Hex {
  return hashStruct({
    data: parameters,
    primaryType: "OrderComponents",
    types: SEAPORT_ORDER_TYPES,
  } as Parameters<typeof hashStruct>[0]);
}

function requireOpenSeaApiKey(env: CollectionOffersEnv): string {
  const apiKey = env.OPENSEA_API_KEY?.trim();
  if (!apiKey) throw new Error("OPENSEA_API_KEY is not configured");
  return apiKey;
}

export function openSeaPostHeaders(apiKey: string): Record<string, string> {
  return {
    accept: "application/json",
    "content-type": "application/json",
    // Header names are case-insensitive. Supplying both x-api-key and
    // X-API-KEY makes Fetch combine them into the invalid value "key, key".
    "x-api-key": apiKey,
  };
}

async function openSeaPost(apiKey: string, path: string, body: unknown): Promise<Record<string, unknown>> {
  const response = await fetch(`${OPENSEA_API_BASE}${path}`, {
    method: "POST",
    headers: openSeaPostHeaders(apiKey),
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`OpenSea ${path} failed (${response.status}): ${text || "unknown error"}`);
  }
  return (await response.json()) as Record<string, unknown>;
}

export async function openSeaPostWithTransientRetry(
  apiKey: string,
  path: string,
  body: unknown,
  attempts = 4,
  baseDelayMs = 500,
): Promise<Record<string, unknown>> {
  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await openSeaPost(apiKey, path, body);
    } catch (error) {
      lastError = error;
      const message = error instanceof Error ? error.message : String(error);
      const isTransient = /failed \((?:429|5\d\d)\)/.test(message);
      if (!isTransient || attempt + 1 >= attempts) throw error;
      await new Promise((resolve) => setTimeout(resolve, baseDelayMs * (2 ** attempt)));
    }
  }
  throw lastError;
}

function rawEthToNumber(rawAmount?: string | null): number | null {
  if (!rawAmount) return null;
  return weiToNumber(rawAmount, 18);
}

function multiplyRawAmount(rawAmount: string, quantity: number): string {
  return (BigInt(rawAmount) * BigInt(Math.max(1, Math.floor(quantity)))).toString();
}

function divideRawAmount(rawAmount: string | null | undefined, quantity: number): string | null {
  if (!rawAmount) return null;
  try {
    const divisor = BigInt(Math.max(1, Math.floor(quantity)));
    return (BigInt(rawAmount) / divisor).toString();
  } catch {
    return rawAmount;
  }
}

function assertPositiveRawAmount(rawAmount: string): string {
  try {
    if (BigInt(rawAmount) <= 0n) throw new Error("not positive");
    return rawAmount;
  } catch {
    throw new Error("Offer amount is invalid");
  }
}

function normalizeSocialUsername(value: string | null | undefined): string | null {
  const username = value?.trim().replace(/^@/, "");
  return username || null;
}

function buildBidderProfile(input: {
  wallet: string;
  fid?: number | null;
  username?: string | null;
  displayName?: string | null;
  pfpUrl?: string | null;
  xUsername?: string | null;
  openseaUsername?: string | null;
}): BidderProfile {
  const username = input.username ?? null;
  const xUsername = normalizeSocialUsername(input.xUsername);
  return {
    wallet: input.wallet,
    fid: input.fid ?? null,
    username,
    displayName: input.displayName ?? null,
    pfpUrl: input.pfpUrl ?? null,
    xUsername,
    openseaUrl: `https://opensea.io/${input.openseaUsername || input.wallet}`,
    farcasterUrl: username
      ? `https://farcaster.xyz/${username}`
      : input.fid != null
        ? `https://farcaster.xyz/~/profiles/${input.fid}`
        : null,
    xUrl: xUsername ? `https://x.com/${xUsername}` : null,
    basescanUrl: `https://basescan.org/address/${input.wallet}`,
  };
}

async function getTableColumns(env: CollectionOffersEnv, tableName: "wallet_farcaster_links" | "warplets_users"): Promise<Set<string>> {
  const result = await env.WARPLETS.prepare(`PRAGMA table_info(${tableName})`).all<{ name: string }>();
  return new Set((result.results ?? []).map((row) => row.name));
}

function randomUint256String(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return BigInt(`0x${Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("")}`).toString();
}

function firstWethAmount(items: unknown[]): string | null {
  for (const item of items) {
    const obj = asObject(item);
    if (!obj) continue;
    const token = normalizeAddress(obj.token);
    if (token !== BASE_WETH) continue;
    return asString(obj.startAmount) ?? asString(obj.endAmount);
  }
  return null;
}

function collectionCriteriaQuantity(items: unknown[]): number | null {
  for (const item of items) {
    const obj = asObject(item);
    if (!obj) continue;
    const token = normalizeAddress(obj.token);
    const itemType = asNumber(obj.itemType);
    if (token !== COLLECTION_CONTRACT || itemType !== 4) continue;
    const amount = asString(obj.startAmount) ?? asString(obj.endAmount);
    if (!amount) return 1;
    try {
      const parsed = Number(BigInt(amount));
      return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
    } catch {
      return 1;
    }
  }
  return null;
}

function parseRawPayload(row: CollectionOfferRow): Record<string, unknown> | null {
  try {
    return row.raw_payload ? JSON.parse(row.raw_payload) as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

function getProtocolParameters(payload: Record<string, unknown> | null): Record<string, unknown> | null {
  if (!payload) return null;
  return asObject(asObject(payload.protocol_data)?.parameters) ??
    asObject(asObject(payload.protocolData)?.parameters) ??
    asObject(payload.partial_parameters) ??
    asObject(payload.partialParameters) ??
    asObject(payload.parameters) ??
    (Array.isArray(payload.consideration) ? payload : null) ??
    null;
}

function readRemainingQuantity(row: Record<string, unknown>): number {
  const explicit = asNumber(row.remaining_quantity ?? row.remainingQuantity);
  if (explicit != null && explicit > 0) return Math.max(1, Math.floor(explicit));
  const parameters = getProtocolParameters(row);
  const quantity = collectionCriteriaQuantity(asArray(parameters?.consideration));
  return quantity && quantity > 0 ? quantity : 1;
}

function getUnitPriceFromRow(row: CollectionOfferRow): MarketMoney {
  const payload = parseRawPayload(row);
  const quantity = Math.max(1, Number(row.remaining_quantity ?? 1));
  const parameters = getProtocolParameters(payload);
  const totalRaw = firstWethAmount(asArray(parameters?.offer)) ?? row.offer_raw_amount;
  const unitRaw = divideRawAmount(totalRaw, quantity);
  const eth = unitRaw ? rawEthToNumber(unitRaw) : row.offer_eth;
  return {
    eth,
    at: row.offered_at,
    rawAmount: unitRaw,
    decimals: row.offer_decimals ?? 18,
    currencySymbol: row.offer_currency_symbol ?? "WETH",
    tokenAddress: row.offer_token_address ?? BASE_WETH,
  };
}

function offerIsWeth(row: CollectionOfferRow): boolean {
  const price = getUnitPriceFromRow(row);
  return isEthLikeCurrency(price.currencySymbol, normalizeAddress(price.tokenAddress), price.decimals);
}

async function fetchSeaportCounter(offerer: string): Promise<string> {
  const encodedOfferer = offerer.toLowerCase().replace(/^0x/, "").padStart(64, "0");
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const response = await fetch("https://mainnet.base.org", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "eth_call",
          params: [{ to: DEFAULT_SEAPORT_PROTOCOL, data: `0xf07ec373${encodedOfferer}` }, "latest"],
        }),
        signal: AbortSignal.timeout(10000),
      });
      if (!response.ok) throw new Error(`Base RPC failed (${response.status})`);
      const payload = (await response.json()) as Record<string, unknown>;
      if (payload.error) throw new Error(`Base RPC rejected the Seaport counter request: ${JSON.stringify(payload.error)}`);
      const hex = asString(payload.result);
      if (!hex) throw new Error("Base RPC did not return the Seaport counter");
      return BigInt(hex).toString();
    } catch (error) {
      lastError = error;
      if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 350 * (2 ** attempt)));
    }
  }
  throw lastError instanceof Error ? lastError : new Error("Base RPC could not read the Seaport counter");
}

let collectionFeesCache: { expiresAt: number; fees: Array<{ recipient: string; bps: number }> } | null = null;

export function buildSeaportCriteriaRoot(tokenIds: Array<number | string>): string {
  let layer = tokenIds
    .map((tokenId) => keccak256(toHex(BigInt(tokenId), { size: 32 })))
    .sort((left, right) => left.localeCompare(right));
  if (layer.length === 0) return "0";
  while (layer.length > 1) {
    const nextLayer: Hex[] = [];
    for (let index = 0; index < layer.length; index += 2) {
      const left = layer[index];
      const right = layer[index + 1];
      if (!right) {
        nextLayer.push(left);
        continue;
      }
      const pair = left.localeCompare(right) <= 0 ? [left, right] : [right, left];
      nextLayer.push(keccak256(concatHex(pair)));
    }
    layer = nextLayer;
  }
  return BigInt(layer[0]).toString();
}

async function buildLocalTraitCriteria(
  env: CollectionOffersEnv,
  attribute: typeof TRAIT_ATTRIBUTES[number],
  level: string,
): Promise<Record<string, unknown>> {
  const rows = await env.WARPLETS.prepare(
    `SELECT token_id FROM warplets_metadata WHERE ${attribute.column} = ? ORDER BY token_id ASC`,
  ).bind(level).all<{ token_id: number }>();
  const tokenIds = (rows.results ?? [])
    .map((row) => Number(row.token_id))
    .filter((tokenId) => Number.isInteger(tokenId) && tokenId > 0);
  if (tokenIds.length === 0) throw new Error(`No tokens matched ${attribute.traitType} ${level}`);
  return {
    parameters: {
      zone: OPENSEA_SIGNED_ZONE_V2,
      zoneHash: ZERO_HASH,
      conduitKey: OPENSEA_CONDUIT_KEY,
      orderType: SEAPORT_ORDER_TYPE_FULL_RESTRICTED,
      consideration: [{
        itemType: 4,
        token: COLLECTION_CONTRACT,
        identifierOrCriteria: buildSeaportCriteriaRoot(tokenIds),
        startAmount: "1",
        endAmount: "1",
      }],
    },
  };
}

async function fetchCollectionFees(apiKey: string): Promise<Array<{ recipient: string; bps: number }>> {
  if (collectionFeesCache && collectionFeesCache.expiresAt > Date.now()) return collectionFeesCache.fees;
  const payload = await fetchOpenSea(`/collections/${COLLECTION_SLUG}`, apiKey);
  const fees = asArray(payload.fees ?? asObject(payload.collection)?.fees)
    .map((row) => {
      const fee = asObject(row);
      const recipient = normalizeAddress(fee?.recipient);
      const percent = asNumber(fee?.fee);
      return recipient && percent != null && percent > 0 ? { recipient, bps: Math.round(percent * 100) } : null;
    })
    .filter((fee): fee is { recipient: string; bps: number } => Boolean(fee));
  collectionFeesCache = { expiresAt: Date.now() + 5 * 60 * 1000, fees };
  return fees;
}

function feeAmount(rawAmount: string, bps: number): string {
  return ((BigInt(rawAmount) * BigInt(bps)) / 10000n).toString();
}

function collectionOfferOrderType(parametersFromBuild: Record<string, unknown> | null, quantity: number): number {
  const builtOrderType = asNumber(parametersFromBuild?.orderType);
  if (quantity <= 1) return builtOrderType ?? SEAPORT_ORDER_TYPE_FULL_RESTRICTED;
  if (builtOrderType === SEAPORT_ORDER_TYPE_PARTIAL_OPEN || builtOrderType === SEAPORT_ORDER_TYPE_PARTIAL_RESTRICTED) {
    return builtOrderType;
  }
  if (builtOrderType === SEAPORT_ORDER_TYPE_FULL_OPEN) return SEAPORT_ORDER_TYPE_PARTIAL_OPEN;
  return SEAPORT_ORDER_TYPE_PARTIAL_RESTRICTED;
}

function buildCollectionOfferTypedData(input: {
  offerer: string;
  unitPriceRaw: string;
  quantity: number;
  durationSeconds: number;
  counter: string;
  fees: Array<{ recipient: string; bps: number }>;
  built?: Record<string, unknown> | null;
}): { parameters: Record<string, unknown>; typedData: Record<string, unknown>; totalRaw: string; requiredWethRaw: string } {
  const quantity = Math.min(10000, Math.max(1, Math.floor(input.quantity)));
  const totalRaw = multiplyRawAmount(input.unitPriceRaw, quantity);
  const now = Math.floor(Date.now() / 1000);
  const startTime = String(Math.max(0, now - 60));
  const durationSeconds = Math.min(MAX_OPENSEA_ORDER_DURATION_SECONDS, Math.max(60, Math.floor(input.durationSeconds)));
  const parametersFromBuild = getProtocolParameters(input.built ?? null);
  const buildConsideration = asArray(parametersFromBuild?.consideration);
  const collectionConsideration = buildConsideration.length > 0
    ? buildConsideration.map((item) => {
      const obj = { ...(asObject(item) ?? {}) };
      if (normalizeAddress(obj.token) === COLLECTION_CONTRACT) {
        obj.startAmount = String(quantity);
        obj.endAmount = String(quantity);
        obj.recipient = input.offerer;
      }
      return obj;
    })
    : [{
      itemType: 4,
      token: COLLECTION_CONTRACT,
      identifierOrCriteria: "0",
      startAmount: String(quantity),
      endAmount: String(quantity),
      recipient: input.offerer,
    }];
  const feeConsideration: Record<string, unknown>[] = input.fees
    .flatMap((fee) => {
      const amount = feeAmount(totalRaw, fee.bps);
      return BigInt(amount) > 0n ? {
        itemType: 1,
        token: BASE_WETH,
        identifierOrCriteria: "0",
        startAmount: amount,
        endAmount: amount,
        recipient: fee.recipient,
      } : [];
    });
  const requiredWethRaw = feeConsideration.reduce(
    (total, item) => total + BigInt(asString(item.startAmount) ?? "0"),
    BigInt(totalRaw),
  ).toString();
  const parameters = {
    offerer: input.offerer,
    zone: normalizeAddress(parametersFromBuild?.zone) ?? OPENSEA_SIGNED_ZONE_V2,
    offer: [{
      itemType: 1,
      token: BASE_WETH,
      identifierOrCriteria: "0",
      startAmount: totalRaw,
      endAmount: totalRaw,
    }],
    consideration: [...collectionConsideration, ...feeConsideration],
    orderType: collectionOfferOrderType(parametersFromBuild, quantity),
    startTime,
    endTime: String(Number(startTime) + durationSeconds),
    zoneHash: asString(parametersFromBuild?.zoneHash) ?? asString(parametersFromBuild?.zone_hash) ?? ZERO_HASH,
    salt: randomUint256String(),
    conduitKey: asString(parametersFromBuild?.conduitKey) ?? OPENSEA_CONDUIT_KEY,
    counter: input.counter,
  };
  return {
    parameters,
    totalRaw,
    requiredWethRaw,
    typedData: {
      domain: {
        name: "Seaport",
        version: "1.6",
        chainId: BASE_CHAIN_ID,
        verifyingContract: DEFAULT_SEAPORT_PROTOCOL,
      },
      primaryType: "OrderComponents",
      types: {
        ...SEAPORT_ORDER_TYPES,
      },
      message: parameters,
    },
  };
}

export function withOriginalConsiderationCount(parameters: Record<string, unknown>): Record<string, unknown> {
  return {
    ...parameters,
    totalOriginalConsiderationItems: asArray(parameters.consideration).length,
  };
}

async function updateCollectionOfferDisplayFields(env: CollectionOffersEnv, row: Record<string, unknown>): Promise<void> {
  const orderHash = asString(row.order_hash);
  if (!orderHash) return;
  const now = new Date().toISOString();
  await env.WARPLETS.prepare(
    `UPDATE opensea_criteria_offers
     SET remaining_quantity = ?, order_status = ?, opensea_updated_at = ?, updated_at = ?
     WHERE order_hash = ?
       AND NOT (active = 0 AND order_status = 'CANCELLED')`
  ).bind(
    readRemainingQuantity(row),
    asString(row.status) ?? "ACTIVE",
    now,
    now,
    orderHash,
  ).run().catch(() => undefined);
}

async function markMissingCollectionOffersInactive(env: CollectionOffersEnv, activeHashes: Set<string>): Promise<void> {
  const rows = await env.WARPLETS.prepare(
    `SELECT order_hash
     FROM opensea_criteria_offers
     WHERE collection_slug = ? AND criteria_kind = 'collection' AND active = 1`
  ).bind(COLLECTION_SLUG).all<{ order_hash: string }>().catch(() => ({ results: [] }));
  const stale = (rows.results ?? []).map((row) => row.order_hash).filter((hash) => !activeHashes.has(hash));
  if (stale.length === 0) return;
  const now = new Date().toISOString();
  for (let index = 0; index < stale.length; index += 50) {
    const chunk = stale.slice(index, index + 50);
    const placeholders = chunk.map(() => "?").join(", ");
    await env.WARPLETS.prepare(
      `UPDATE opensea_criteria_offers
       SET active = 0, order_status = 'INACTIVE', opensea_updated_at = ?, updated_at = ?
       WHERE order_hash IN (${placeholders})`
    ).bind(now, now, ...chunk).run();
  }
}

async function refreshCollectionOffersFromOpenSea(env: CollectionOffersEnv, wallet?: string | null): Promise<void> {
  const apiKey = requireOpenSeaApiKey(env);
  const activeHashes = new Set<string>();
  let cursor: string | null = null;
  for (let page = 0; page < 20; page += 1) {
    const params = new URLSearchParams({ limit: "200" });
    if (wallet) params.set("maker", wallet);
    if (cursor) params.set("next", cursor);
    const payload = await fetchOpenSea(`/offers/collection/${COLLECTION_SLUG}/all`, apiKey, params);
    const rows = asArray(payload.offers ?? payload.orders)
      .map((item) => asObject(item))
      .filter((item): item is Record<string, unknown> => Boolean(item))
      .filter((item) => classifyOpenSeaOffer(item) === "collection");
    for (const row of rows) {
      const orderHash = asString(row.order_hash);
      if (orderHash) activeHashes.add(orderHash);
      await upsertCriteriaOfferFromRow(env, row, { recordActivity: false });
      await updateCollectionOfferDisplayFields(env, row);
    }
    cursor = asString(payload.next);
    if (!cursor || rows.length === 0) {
      if (!wallet) await markMissingCollectionOffersInactive(env, activeHashes);
      break;
    }
  }
}

async function loadBidderProfiles(env: CollectionOffersEnv, wallets: string[], force = false): Promise<Map<string, BidderProfile>> {
  const normalized = Array.from(new Set(wallets.map((wallet) => normalizeAddress(wallet)).filter((wallet): wallet is string => Boolean(wallet))));
  const profiles = new Map<string, BidderProfile>();
  if (normalized.length === 0) return profiles;

  const placeholders = normalized.map(() => "?").join(", ");
  const [linkColumns, userColumns] = await Promise.all([
    getTableColumns(env, "wallet_farcaster_links").catch(() => new Set<string>()),
    getTableColumns(env, "warplets_users").catch(() => new Set<string>()),
  ]);
  const selectColumns = [
    "l.wallet",
    "l.fid",
    linkColumns.has("username") ? "l.username" : "NULL AS username",
    linkColumns.has("display_name") ? "l.display_name" : "NULL AS display_name",
    linkColumns.has("pfp_url") ? "l.pfp_url" : "NULL AS pfp_url",
    linkColumns.has("x_username") ? "l.x_username" : "NULL AS x_username",
    userColumns.has("fid") && userColumns.has("x_username") ? "wu.x_username AS user_x_username" : "NULL AS user_x_username",
  ];
  const joinUsers = userColumns.has("fid") ? "LEFT JOIN warplets_users wu ON wu.fid = l.fid" : "";
  const linkRows = await env.WARPLETS.prepare(
    `SELECT ${selectColumns.join(", ")}
     FROM wallet_farcaster_links l
     ${joinUsers}
     WHERE l.wallet IN (${placeholders})
     ORDER BY COALESCE(l.score, -1) DESC, l.fid ASC`
  ).bind(...normalized).all<WalletFarcasterLinkResult>().catch(() => ({ results: [] }));
  for (const row of linkRows.results ?? []) {
    const wallet = normalizeAddress(row.wallet);
    if (!wallet || profiles.has(wallet)) continue;
    profiles.set(wallet, buildBidderProfile({
      wallet,
      fid: row.fid,
      username: row.username,
      displayName: row.display_name,
      pfpUrl: row.pfp_url,
      xUsername: "x_username" in row ? (row.x_username ?? row.user_x_username ?? null) : null,
    }));
  }

  const fallbackProfiles = await resolveWalletProfiles(env, normalized, { force });
  for (const wallet of normalized) {
    const current = profiles.get(wallet) ?? buildBidderProfile({ wallet });
    if (current.pfpUrl) continue;
    const fallback = fallbackProfiles.get(wallet);
    profiles.set(wallet, buildBidderProfile({
      wallet,
      fid: current.fid,
      username: current.username,
      displayName: current.displayName,
      pfpUrl: fallback?.avatarUrl ?? null,
      xUsername: current.xUsername,
      openseaUsername: fallback?.openseaUsername,
    }));
  }
  return profiles;
}

function groupCollectionOffers(offers: CollectionOffer[], userWallet: string | null): CollectionOfferGroup[] {
  const normalizedUserWallet = normalizeAddress(userWallet);
  const groups = new Map<string, CollectionOfferGroup>();
  const orderedOffers = [...offers].sort((left, right) => {
    const priceDelta = (right.price.eth ?? -1) - (left.price.eth ?? -1);
    if (priceDelta !== 0) return priceDelta;
    const leftTime = Date.parse(left.createdAt ?? "");
    const rightTime = Date.parse(right.createdAt ?? "");
    if (Number.isFinite(leftTime) && Number.isFinite(rightTime) && leftTime !== rightTime) {
      return leftTime - rightTime;
    }
    return 0;
  });
  for (const offer of orderedOffers) {
    const key = offer.price.rawAmount ?? String(offer.price.eth ?? "");
    if (!key) continue;
    const current = groups.get(key) ?? {
      price: offer.price,
      volume: { ...offer.price, rawAmount: "0", eth: 0 },
      offerCount: 0,
      bidderCount: 0,
      previewBidders: [],
      orders: [],
      userOfferCount: 0,
      userOrders: [],
    };
    current.offerCount += offer.quantity;
    const rawVolume = offer.price.rawAmount
      ? (BigInt(current.volume.rawAmount ?? "0") + BigInt(offer.price.rawAmount) * BigInt(offer.quantity)).toString()
      : null;
    current.volume = {
      ...offer.price,
      rawAmount: rawVolume,
      eth: rawVolume ? rawEthToNumber(rawVolume) : ((current.volume.eth ?? 0) + (offer.price.eth ?? 0) * offer.quantity),
    };
    current.orders.push({
      orderHash: offer.orderHash,
      protocolAddress: offer.protocolAddress,
      quantity: offer.quantity,
      createdAt: offer.createdAt,
      bidder: offer.bidder,
    });
    if (!current.previewBidders.some((bidder) => bidder.wallet === offer.bidder.wallet)) {
      current.previewBidders.push(offer.bidder);
      current.bidderCount = current.previewBidders.length;
    }
    if (normalizedUserWallet && offer.offerer === normalizedUserWallet) {
      current.userOfferCount += offer.quantity;
      current.userOrders.push({
        orderHash: offer.orderHash,
        protocolAddress: offer.protocolAddress,
        quantity: offer.quantity,
      });
    }
    groups.set(key, current);
  }
  return Array.from(groups.values())
    .map((group) => ({
      ...group,
      previewBidders: group.previewBidders.slice(0, 5),
    }))
    .sort((a, b) => (b.price.eth ?? 0) - (a.price.eth ?? 0));
}

async function loadCollectionOffers(env: CollectionOffersEnv): Promise<CollectionOfferRow[]> {
  const rows = await env.WARPLETS.prepare(
    `SELECT o.*
     FROM opensea_criteria_offers o
     WHERE o.collection_slug = ?
       AND o.criteria_kind = 'collection'
       AND o.active = 1
       AND COALESCE(o.order_status, 'ACTIVE') = 'ACTIVE'
     ORDER BY o.offer_eth DESC, o.offered_at ASC, o.order_hash ASC`
  ).bind(COLLECTION_SLUG).all<CollectionOfferRow>().catch(() => ({ results: [] }));
  return rows.results ?? [];
}

export async function handleCollectionOffersGet(context: Parameters<PagesFunction<CollectionOffersEnv>>[0]): Promise<Response> {
  const requestUrl = new URL(context.request.url);
  const wallet = normalizeAddress(requestUrl.searchParams.get("wallet"));
  const refresh = requestUrl.searchParams.get("refresh") === "1";
  const apiKey = requireOpenSeaApiKey(context.env);
  let refreshError: string | null = null;
  if (refresh) {
    try {
      // The Collection offers page displays collection-wide state, so refresh the
      // full collection and let wallet filtering happen after cached rows load.
      await refreshCollectionOffersFromOpenSea(context.env, null);
    } catch (error) {
      refreshError = error instanceof Error ? error.message : "OpenSea refresh failed";
      console.warn("Collection offers refresh failed; returning cached offers", refreshError);
    }
  }
  const rows = (await loadCollectionOffers(context.env)).filter(offerIsWeth);
  const wallets = rows.map((row) => row.offerer_wallet).filter((wallet): wallet is string => Boolean(wallet));
  const profiles = await loadBidderProfiles(context.env, wallets, refresh);
  const offers = rows
    .reduce<CollectionOffer[]>((items, row) => {
      const offerer = normalizeAddress(row.offerer_wallet);
      if (!offerer) return items;
      const profile = profiles.get(offerer) ?? buildBidderProfile({ wallet: offerer });
      items.push({
        orderHash: row.order_hash,
        protocolAddress: row.protocol_address ?? "0x0000000000000068f116a894984e2db1123eb395",
        offerer,
        price: getUnitPriceFromRow(row),
        quantity: Math.max(1, Number(row.remaining_quantity ?? 1)),
        status: row.order_status ?? null,
        createdAt: row.offered_at,
        bidder: profile,
      });
      return items;
    }, []);
  const groups = groupCollectionOffers(offers, wallet);
  const topOffer = groups[0]?.price ?? null;
  const selectedGroups = requestUrl.searchParams.get("scope") === "your" && wallet
    ? groups.filter((group) => group.userOfferCount > 0)
    : groups;
  const count = selectedGroups.reduce((total, group) => total + (wallet && requestUrl.searchParams.get("scope") === "your" ? group.userOfferCount : group.offerCount), 0);
  const valueRaw = selectedGroups.reduce((total, group) => {
    const countForGroup = wallet && requestUrl.searchParams.get("scope") === "your" ? group.userOfferCount : group.offerCount;
    return total + BigInt(group.price.rawAmount ?? "0") * BigInt(countForGroup);
  }, 0n).toString();
  return marketJson({
    generatedAt: new Date().toISOString(),
    refreshError,
    wallet,
    topCollectionOffer: topOffer,
    stats: {
      count,
      value: {
        eth: rawEthToNumber(valueRaw),
        rawAmount: valueRaw,
        decimals: 18,
        currencySymbol: "WETH",
        tokenAddress: BASE_WETH,
        at: new Date().toISOString(),
      },
    },
    groups: selectedGroups,
  });
}

export async function handleCollectionOfferPrepare(context: Parameters<PagesFunction<CollectionOffersEnv>>[0]): Promise<Response> {
  let body: Record<string, unknown>;
  try {
    body = await context.request.json() as Record<string, unknown>;
  } catch {
    return jsonSecure({ error: "invalid_json", message: "Collection offer request was invalid" }, { status: 400 });
  }
  const wallet = normalizeAddress(body.wallet);
  const priceRaw = asString(body.priceRaw);
  const quantity = Math.min(10000, Math.max(1, Math.floor(asNumber(body.quantity) ?? 1)));
  const durationSeconds = asNumber(body.durationSeconds) ?? MAX_OPENSEA_ORDER_DURATION_SECONDS;
  if (!wallet || !priceRaw) return jsonSecure({ error: "invalid_request" }, { status: 400 });
  let normalizedPriceRaw: string;
  try {
    normalizedPriceRaw = assertPositiveRawAmount(priceRaw);
  } catch {
    return jsonSecure({ error: "invalid_price", message: "Offer amount is invalid" }, { status: 400 });
  }
  try {
    const apiKey = requireOpenSeaApiKey(context.env);
    const [counter, fees, built] = await Promise.all([
      fetchSeaportCounter(wallet),
      fetchCollectionFees(apiKey),
      openSeaPostWithTransientRetry(apiKey, "/offers/build", {
        offerer: wallet,
        quantity,
        criteria: { collection: { slug: COLLECTION_SLUG } },
        protocol_address: DEFAULT_SEAPORT_PROTOCOL,
        offer_protection_enabled: true,
      }),
    ]);
    const order = buildCollectionOfferTypedData({
      offerer: wallet,
      unitPriceRaw: normalizedPriceRaw,
      quantity,
      durationSeconds,
      counter,
      fees,
      built,
    });
    return jsonSecure({
      status: "ready",
      actionId: asString(body.actionId) ?? crypto.randomUUID(),
      protocolAddress: DEFAULT_SEAPORT_PROTOCOL,
      parameters: order.parameters,
      typedData: order.typedData,
      chainIdHex: BASE_CHAIN_ID_HEX,
      wethApproval: { tokenAddress: BASE_WETH, spender: OPENSEA_CONDUIT_ADDRESS, amount: order.requiredWethRaw },
      totalRaw: order.totalRaw,
      requiredWethRaw: order.requiredWethRaw,
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : "unknown upstream error";
    console.error("Collection offer prepare failed", { wallet, quantity, detail });
    return jsonSecure({
      error: "collection_offer_prepare_failed",
      message: `Collection offer could not be prepared: ${detail}`,
    }, { status: 502 });
  }
}

export async function handleCollectionOfferSubmit(context: Parameters<PagesFunction<CollectionOffersEnv>>[0]): Promise<Response> {
  const body = await context.request.json() as Record<string, unknown>;
  const payload = asObject(body.payload) ?? body;
  const parameters = asObject(payload.parameters);
  const signature = asString(payload.signature);
  const protocolAddress = normalizeAddress(payload.protocol_address) ?? DEFAULT_SEAPORT_PROTOCOL;
  if (!parameters || !signature) return jsonSecure({ error: "missing_signature" }, { status: 400 });
  const apiKey = requireOpenSeaApiKey(context.env);
  const submissionParameters = withOriginalConsiderationCount(parameters);
  let result: Record<string, unknown>;
  try {
    result = await openSeaPost(apiKey, "/offers", {
      protocol_data: { parameters: submissionParameters, signature },
      criteria: { collection: { slug: COLLECTION_SLUG } },
      protocol_address: protocolAddress,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "OpenSea collection offer submit failed";
    return jsonSecure({ error: "opensea_submit_failed", message }, { status: 502 });
  }
  const orderHash = asString(result.order_hash) ?? asString(result.orderHash);
  const wallet = normalizeAddress(body.wallet);
  const priceRaw = asString(body.priceRaw);
  const quantity = Math.max(1, Math.floor(asNumber(body.quantity) ?? 1));
  if (orderHash) {
    const row = { ...result, order_hash: orderHash, protocol_address: protocolAddress, protocol_data: { parameters: submissionParameters, signature }, status: "ACTIVE", remaining_quantity: quantity };
    await upsertCriteriaOfferFromRow(context.env, row, { recordActivity: false })
      .catch((error) => console.error("Collection offer submitted but local ingestion failed", { orderHash, error }));
    await updateCollectionOfferDisplayFields(context.env, row)
      .catch((error) => console.error("Collection offer submitted but display bookkeeping failed", { orderHash, error }));
  }
  if (wallet && priceRaw) {
    await recordWarpletActivity(context.env, {
      eventType: "collection_top_offer",
      actorWallet: wallet,
      actorFid: asNumber(body.fid),
      amountEth: rawEthToNumber(priceRaw),
      amountRaw: priceRaw,
      currencySymbol: "WETH",
      orderHash,
      source: "warplets:collection-offers",
      rawPayload: { actionId: asString(body.actionId), quantity, result },
    }).catch((error) => console.error("Failed to record collection offer submit activity", error));
  }
  return jsonSecure({ status: "submitted", result });
}

async function restoreIncorrectlyDeactivatedTraitOffers(env: CollectionOffersEnv): Promise<void> {
  const rows = await env.WARPLETS.prepare(
    `SELECT raw_payload
     FROM opensea_criteria_offers
     WHERE collection_slug = ?
       AND criteria_kind = 'trait'
       AND active = 0
       AND COALESCE(order_status, 'ACTIVE') = 'ACTIVE'
       AND raw_payload IS NOT NULL`
  ).bind(COLLECTION_SLUG).all<{ raw_payload: string }>().then((result) => result.results ?? []).catch(() => []);
  for (const row of rows) {
    try {
      const payload = asObject(JSON.parse(row.raw_payload));
      if (payload) await upsertCriteriaOfferFromRow(env, payload, { recordActivity: false });
    } catch (error) {
      console.warn("Failed to restore incorrectly deactivated trait offer", error);
    }
  }
}

export async function handleTraitOffersGet(context: Parameters<PagesFunction<CollectionOffersEnv>>[0]): Promise<Response> {
  const url = new URL(context.request.url);
  const wallet = normalizeAddress(url.searchParams.get("wallet"));
  const level = TRAIT_LEVELS.includes(url.searchParams.get("level") as typeof TRAIT_LEVELS[number])
    ? url.searchParams.get("level") as typeof TRAIT_LEVELS[number]
    : "10X";
  const requestedIds = url.searchParams.get("attributes")?.split(",").map((value) => value.trim().toLowerCase()).filter(Boolean) ?? [];
  const attributes = requestedIds.length > 0
    ? TRAIT_ATTRIBUTES.filter((attribute) => requestedIds.includes(attribute.id))
    : [...TRAIT_ATTRIBUTES];
  let refreshError: string | null = null;
  if (url.searchParams.get("refresh") === "1") {
    try {
      await ingestOpenSeaMarket(context.env);
    } catch (error) {
      refreshError = error instanceof Error ? error.message : "OpenSea refresh failed";
    }
  }
  await restoreIncorrectlyDeactivatedTraitOffers(context.env);
  const rows = await context.env.WARPLETS.prepare(
    `SELECT * FROM opensea_criteria_offers
     WHERE collection_slug = ? AND criteria_kind = 'trait' AND active = 1
       AND COALESCE(order_status, 'ACTIVE') = 'ACTIVE'
     ORDER BY offer_eth DESC, offered_at ASC, order_hash ASC`,
  ).bind(COLLECTION_SLUG).all<CollectionOfferRow>().then((result) => result.results ?? []).catch(() => []);
  const selectedTypes = new Set(attributes.map((attribute) => attribute.traitType.toLowerCase()));
  const filteredRows = rows.filter(offerIsWeth).map((row) => ({ row, trait: readTraitCriteria(row) }))
    .filter((item): item is { row: CollectionOfferRow; trait: { traitType: string; traitValue: string } } => Boolean(
      item.trait && selectedTypes.has(item.trait.traitType.toLowerCase()) && item.trait.traitValue.toUpperCase() === level,
    ));
  const profiles = await loadBidderProfiles(
    context.env,
    filteredRows.map(({ row }) => row.offerer_wallet).filter((value): value is string => Boolean(value)),
    url.searchParams.get("refresh") === "1",
  );
  const groups = new Map<string, CollectionOfferGroup>();
  for (const { row, trait } of filteredRows) {
    const offerer = normalizeAddress(row.offerer_wallet);
    if (!offerer) continue;
    const price = getUnitPriceFromRow(row);
    const quantity = Math.max(1, Number(row.remaining_quantity ?? 1));
    const key = `${trait.traitType.toLowerCase()}|${trait.traitValue.toUpperCase()}|${price.rawAmount ?? price.eth ?? ""}`;
    const group = groups.get(key) ?? {
      traitType: trait.traitType,
      traitValue: trait.traitValue.toUpperCase(),
      price,
      volume: { ...price, rawAmount: "0", eth: 0 },
      offerCount: 0,
      bidderCount: 0,
      previewBidders: [],
      orders: [],
      userOfferCount: 0,
      userOrders: [],
    };
    group.offerCount += quantity;
    const rawVolume = price.rawAmount ? (BigInt(group.volume.rawAmount ?? "0") + BigInt(price.rawAmount) * BigInt(quantity)).toString() : null;
    group.volume = { ...price, rawAmount: rawVolume, eth: rawVolume ? rawEthToNumber(rawVolume) : (group.volume.eth ?? 0) + (price.eth ?? 0) * quantity };
    const bidder = profiles.get(offerer) ?? buildBidderProfile({ wallet: offerer });
    group.orders.push({ orderHash: row.order_hash, protocolAddress: row.protocol_address, quantity, createdAt: row.offered_at, bidder });
    if (!group.previewBidders.some((item) => item.wallet === bidder.wallet)) group.previewBidders.push(bidder);
    group.bidderCount = group.previewBidders.length;
    if (wallet && offerer === wallet) {
      group.userOfferCount += quantity;
      group.userOrders.push({ orderHash: row.order_hash, protocolAddress: row.protocol_address, quantity });
    }
    groups.set(key, group);
  }
  const allGroups = Array.from(groups.values()).map((group) => ({ ...group, previewBidders: group.previewBidders.slice(0, 5) }))
    .sort((a, b) => (b.price.eth ?? 0) - (a.price.eth ?? 0) || (a.traitType ?? "").localeCompare(b.traitType ?? ""));
  const selectedGroups = url.searchParams.get("scope") === "your" && wallet ? allGroups.filter((group) => group.userOfferCount > 0) : allGroups;
  const yourScope = url.searchParams.get("scope") === "your" && Boolean(wallet);
  const count = selectedGroups.reduce((total, group) => total + (yourScope ? group.userOfferCount : group.offerCount), 0);
  const valueRaw = selectedGroups.reduce((total, group) => total + BigInt(group.price.rawAmount ?? "0") * BigInt(yourScope ? group.userOfferCount : group.offerCount), 0n).toString();
  const topTraitOffer = allGroups[0]?.price ?? null;
  return marketJson({
    generatedAt: new Date().toISOString(), refreshError, wallet, level,
    attributes: attributes.map((attribute) => attribute.id), topTraitOffer,
    stats: { count, value: { eth: rawEthToNumber(valueRaw), rawAmount: valueRaw, decimals: 18, currencySymbol: "WETH", tokenAddress: BASE_WETH, at: new Date().toISOString() } },
    groups: selectedGroups,
  });
}

export async function handleTraitOfferPrepare(context: Parameters<PagesFunction<CollectionOffersEnv>>[0]): Promise<Response> {
  const body = await context.request.json() as Record<string, unknown>;
  const wallet = normalizeAddress(body.wallet);
  const priceRaw = asString(body.priceRaw);
  const attribute = TRAIT_ATTRIBUTES.find((item) => item.id === asString(body.attribute)?.toLowerCase());
  const level = asString(body.level)?.toUpperCase();
  const quantity = Math.min(10000, Math.max(1, Math.floor(asNumber(body.quantity) ?? 1)));
  if (!wallet || !priceRaw || !attribute || !TRAIT_LEVELS.includes(level as typeof TRAIT_LEVELS[number])) return jsonSecure({ error: "invalid_request" }, { status: 400 });
  const traitLevel = level as typeof TRAIT_LEVELS[number];
  let normalizedPriceRaw: string;
  try { normalizedPriceRaw = assertPositiveRawAmount(priceRaw); } catch { return jsonSecure({ error: "invalid_price", message: "Offer amount is invalid" }, { status: 400 }); }
  const criteria = { collection: { slug: COLLECTION_SLUG }, traits: [{ type: attribute.traitType, value: traitLevel }] };
  try {
    const apiKey = requireOpenSeaApiKey(context.env);
    const [counter, fees, builtResult] = await Promise.all([
      fetchSeaportCounter(wallet),
      fetchCollectionFees(apiKey),
      openSeaPost(apiKey, "/offers/build", {
        offerer: wallet,
        quantity,
        criteria,
        protocol_address: DEFAULT_SEAPORT_PROTOCOL,
        offer_protection_enabled: true,
      }).then((built) => ({ built, source: "opensea" as const }))
        .catch(async (error) => {
          console.warn("OpenSea trait offer build failed; using local criteria", {
            attribute: attribute.id,
            level: traitLevel,
            error: error instanceof Error ? error.message : String(error),
          });
          return {
            built: await buildLocalTraitCriteria(context.env, attribute, traitLevel),
            source: "local" as const,
          };
        }),
    ]);
    const order = buildCollectionOfferTypedData({ offerer: wallet, unitPriceRaw: normalizedPriceRaw, quantity, durationSeconds: asNumber(body.durationSeconds) ?? MAX_OPENSEA_ORDER_DURATION_SECONDS, counter, fees, built: builtResult.built });
    return jsonSecure({ status: "ready", actionId: asString(body.actionId) ?? crypto.randomUUID(), attribute: attribute.id, traitType: attribute.traitType, traitValue: traitLevel, criteria, criteriaSource: builtResult.source, protocolAddress: DEFAULT_SEAPORT_PROTOCOL, parameters: order.parameters, typedData: order.typedData, chainIdHex: BASE_CHAIN_ID_HEX, wethApproval: { tokenAddress: BASE_WETH, spender: OPENSEA_CONDUIT_ADDRESS, amount: order.requiredWethRaw }, totalRaw: order.totalRaw, requiredWethRaw: order.requiredWethRaw });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not prepare trait offer";
    const status = message.startsWith("OpenSea ") ? 424 : 502;
    return jsonSecure({
      error: "trait_offer_prepare_failed",
      message,
      attribute: attribute.id,
      level: traitLevel,
      quantity,
    }, { status });
  }
}

export async function handleTraitOfferSubmit(context: Parameters<PagesFunction<CollectionOffersEnv>>[0]): Promise<Response> {
  const body = await context.request.json() as Record<string, unknown>;
  const payload = asObject(body.payload) ?? body;
  const parameters = asObject(payload.parameters);
  const signature = asString(payload.signature);
  const attribute = TRAIT_ATTRIBUTES.find((item) => item.id === asString(body.attribute)?.toLowerCase());
  const level = asString(body.level)?.toUpperCase();
  if (!parameters || !signature || !attribute || !TRAIT_LEVELS.includes(level as typeof TRAIT_LEVELS[number])) return jsonSecure({ error: "invalid_request" }, { status: 400 });
  const protocolAddress = normalizeAddress(payload.protocol_address) ?? DEFAULT_SEAPORT_PROTOCOL;
  const criteria = { collection: { slug: COLLECTION_SLUG }, traits: [{ type: attribute.traitType, value: level }] };
  const submissionParameters = withOriginalConsiderationCount(parameters);
  const actionId = asString(body.actionId) ?? crypto.randomUUID();
  const offerer = normalizeAddress(parameters.offerer);
  const fid = Math.max(0, Math.floor(asNumber(body.fid) ?? 0)) || null;
  const startedAt = Date.now();
  const diagnosticPayload = {
    attribute: attribute.id,
    level,
    quantity: Math.max(1, Math.floor(asNumber(body.quantity) ?? 1)),
    considerationCount: asArray(parameters.consideration).length,
    criteriaRoot: asString(asObject(asArray(parameters.consideration)[0])?.identifierOrCriteria),
    signatureLength: signature.length,
  };
  await logTradeAction(context.env, {
    actionId,
    actionName: "trait_offer_submit",
    status: "started",
    phase: "signature_success",
    fid,
    walletFrom: offerer,
    protocolAddress,
    expectedPriceRaw: asString(body.priceRaw),
    rawPayload: diagnosticPayload,
  }).catch((error) => console.error("Failed to record trait offer submit start", error));
  let result: Record<string, unknown>;
  let submissionHttpStatus = 200;
  let recoveredExistingOrder = false;
  try {
    result = await openSeaPostWithTransientRetry(
      requireOpenSeaApiKey(context.env),
      "/offers",
      { protocol_data: { parameters: submissionParameters, signature }, criteria, protocol_address: protocolAddress },
      2,
      5_000,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "OpenSea trait offer submit failed";
    const httpStatus = Number(/failed \((\d{3})\)/.exec(message)?.[1]) || null;
    if (httpStatus === 400 && /order already exists/i.test(message)) {
      const orderHash = computeSeaportOrderHash(parameters);
      result = {
        order_hash: orderHash,
        status: "ACTIVE",
        recovered_existing_order: true,
      };
      submissionHttpStatus = httpStatus;
      recoveredExistingOrder = true;
    } else {
      await logTradeAction(context.env, {
        actionId,
        actionName: "trait_offer_submit",
        status: "failed",
        phase: "api_error",
        fid,
        walletFrom: offerer,
        protocolAddress,
        expectedPriceRaw: asString(body.priceRaw),
        httpStatus,
        errorMessage: message,
        rawPayload: { ...diagnosticPayload, elapsedMs: Date.now() - startedAt },
      }).catch((logError) => console.error("Failed to record trait offer submit error", logError));
      return jsonSecure({ error: "opensea_submit_failed", message }, { status: 502 });
    }
  }
  const orderHash = asString(result.order_hash) ?? asString(result.orderHash);
  await logTradeAction(context.env, {
    actionId,
    actionName: "trait_offer_submit",
    status: "success",
    phase: "confirmed",
    fid,
    walletFrom: offerer,
    orderHash,
    protocolAddress,
    expectedPriceRaw: asString(body.priceRaw),
    httpStatus: submissionHttpStatus,
    rawPayload: { ...diagnosticPayload, elapsedMs: Date.now() - startedAt, recoveredExistingOrder },
  }).catch((error) => console.error("Failed to record trait offer submit success", error));
  if (orderHash) {
    const row = { ...result, order_hash: orderHash, protocol_address: protocolAddress, protocol_data: { parameters: submissionParameters, signature }, criteria, status: "ACTIVE", remaining_quantity: Math.max(1, Math.floor(asNumber(body.quantity) ?? 1)) };
    await upsertCriteriaOfferFromRow(context.env, row, { recordActivity: false })
      .catch((error) => console.error("Trait offer submitted but local ingestion failed", { orderHash, error }));
    await updateCollectionOfferDisplayFields(context.env, row)
      .catch((error) => console.error("Trait offer submitted but display bookkeeping failed", { orderHash, error }));
  }
  return jsonSecure({ status: "submitted", result });
}

async function loadOrderParameters(apiKey: string, orderHash: string, protocolAddress: string): Promise<Record<string, unknown>> {
  const payload = await fetchOpenSea(`/orders/chain/${BASE_CHAIN}/protocol/${encodeURIComponent(protocolAddress)}/${encodeURIComponent(orderHash)}`, apiKey);
  const order = asObject(payload.order) ?? payload;
  const protocolData = asObject(order.protocol_data) ?? asObject(order.protocolData);
  const parameters = asObject(protocolData?.parameters) ?? asObject(order.parameters);
  if (!parameters) throw new Error("OpenSea order response did not include Seaport order parameters.");
  return parameters;
}

async function loadStoredOrderParameters(env: CollectionOffersEnv, orderHash: string): Promise<Record<string, unknown> | null> {
  const row = await env.WARPLETS.prepare(
    "SELECT raw_payload FROM opensea_criteria_offers WHERE order_hash = ? LIMIT 1",
  ).bind(orderHash).first<{ raw_payload: string | null }>().catch(() => null);
  if (!row?.raw_payload) return null;
  try {
    const parsed = asObject(JSON.parse(row.raw_payload));
    const order = asObject(parsed?.order) ?? asObject(parsed?.result) ?? parsed;
    const protocolData = asObject(order?.protocol_data) ?? asObject(order?.protocolData);
    return asObject(protocolData?.parameters) ?? asObject(order?.parameters) ?? null;
  } catch {
    return null;
  }
}

export async function handleCollectionOfferCancelPrepare(context: Parameters<PagesFunction<CollectionOffersEnv>>[0]): Promise<Response> {
  const body = await context.request.json() as Record<string, unknown>;
  const rawOrders = asArray(body.orders);
  const orders = rawOrders
    .map((item) => asObject(item))
    .map((item) => item ? {
      orderHash: asString(item.orderHash),
      protocolAddress: normalizeAddress(item.protocolAddress) ?? DEFAULT_SEAPORT_PROTOCOL,
    } : null)
    .filter((item): item is { orderHash: string; protocolAddress: string } => Boolean(item?.orderHash && item.protocolAddress));
  if (orders.length === 0) return jsonSecure({ error: "missing_orders" }, { status: 400 });
  const apiKey = requireOpenSeaApiKey(context.env);
  try {
    const orderParameters = await Promise.all(orders.map(async (order) => {
      try {
        return await loadOrderParameters(apiKey, order.orderHash, order.protocolAddress);
      } catch (openSeaError) {
        const stored = await loadStoredOrderParameters(context.env, order.orderHash);
        if (stored) return stored;
        throw openSeaError;
      }
    }));
    return jsonSecure({
      status: "ready",
      actionId: asString(body.actionId) ?? crypto.randomUUID(),
      orders,
      protocolAddress: orders[0]?.protocolAddress ?? DEFAULT_SEAPORT_PROTOCOL,
      orderParameters,
      chainIdHex: BASE_CHAIN_ID_HEX,
    });
  } catch (error) {
    return jsonSecure({
      error: "cancel_prepare_failed",
      message: error instanceof Error ? error.message : "Could not load OpenSea order parameters",
    }, { status: 502 });
  }
}

export async function handleCollectionOfferCancel(context: Parameters<PagesFunction<CollectionOffersEnv>>[0]): Promise<Response> {
  const body = await context.request.json() as Record<string, unknown>;
  const rawOrders = asArray(body.orders);
  const orders = rawOrders
    .map((item) => asObject(item))
    .map((item) => item ? {
      orderHash: asString(item.orderHash),
      protocolAddress: normalizeAddress(item.protocolAddress) ?? DEFAULT_SEAPORT_PROTOCOL,
    } : null)
    .filter((item): item is { orderHash: string; protocolAddress: string } => Boolean(item?.orderHash && item.protocolAddress));
  if (orders.length === 0) return jsonSecure({ error: "missing_orders" }, { status: 400 });
  const apiKey = requireOpenSeaApiKey(context.env);
  const results = await Promise.allSettled(orders.map((order) => openSeaPost(
    apiKey,
    `/orders/chain/${BASE_CHAIN}/protocol/${encodeURIComponent(order.protocolAddress)}/${encodeURIComponent(order.orderHash)}/cancel`,
    { offererSignature: "" },
  )));
  const now = new Date().toISOString();
  for (const order of orders) {
    await context.env.WARPLETS.prepare(
      `UPDATE opensea_criteria_offers
       SET active = 0, order_status = 'CANCELLED', updated_at = ?, opensea_updated_at = ?
       WHERE order_hash = ?`
    ).bind(now, now, order.orderHash).run();
  }
  return jsonSecure({ status: "submitted", results: results.map((result) => result.status) });
}

type ActiveItemOfferRow = {
  order_hash: string;
  token_id: number;
  offerer_wallet: string | null;
  amount_eth: number | null;
  amount_raw: string | null;
  currency_symbol: string | null;
  protocol_address: string | null;
  created_at: string | null;
  expires_at: string | null;
};

export async function handleItemOffersGet(context: Parameters<PagesFunction<CollectionOffersEnv>>[0]): Promise<Response> {
  const url = new URL(context.request.url);
  const wallet = normalizeAddress(url.searchParams.get("wallet"));
  const fidValue = Number(url.searchParams.get("fid"));
  const fid = Number.isInteger(fidValue) && fidValue > 0 ? fidValue : null;
  const tokenIdValue = Number(url.searchParams.get("tokenId"));
  const tokenId = Number.isInteger(tokenIdValue) && tokenIdValue > 0 && tokenIdValue <= 10000 ? tokenIdValue : null;
  const scope = url.searchParams.get("scope");
  let refreshError: string | null = null;
  if (url.searchParams.get("refresh") === "1") {
    try {
      if (tokenId) {
        await refreshItemOffersForToken(context.env, tokenId);
      } else {
        await ingestOpenSeaMarket(context.env);
        if (scope === "for_you") await refreshRecentItemOfferOwners(context.env);
      }
    }
    catch (error) { refreshError = error instanceof Error ? error.message : "OpenSea refresh failed"; }
  }
  const requestedPage = Math.max(0, Math.floor(Number(url.searchParams.get("page")) || 0));
  const pageSize = 100;
  const baseWhere = `o.active = 1
    AND (o.expires_at IS NULL OR datetime(o.expires_at) > CURRENT_TIMESTAMP)
    AND (o.currency_symbol IS NULL OR upper(o.currency_symbol) = 'WETH')
    ${tokenId ? "AND o.token_id = ?" : ""}`;
  const baseBindings: Array<string | number> = tokenId ? [tokenId] : [];
  const scopeIsYours = scope === "your" && Boolean(wallet);
  const scopeIsForYou = scope === "for_you";
  const scopeIsFavourites = scope === "favourites";
  // A connected transaction wallet is authoritative for marketplace-owned
  // state. FID remains a Mini App bootstrap fallback only when no wallet was
  // supplied, and must never expand a different connected wallet's inventory.
  const ownerConditions = wallet
    ? ["lower(m.owner_wallet) = ?"]
    : fid
      ? ["m.owner_fid = ?"]
      : [];
  const forYouClause = scopeIsForYou
    ? ownerConditions.length > 0
      ? ` AND EXISTS (SELECT 1 FROM warplet_market_state m WHERE m.token_id = o.token_id AND (${ownerConditions.join(" OR ")}))
          AND NOT EXISTS (
            SELECT 1 FROM warplet_market_state self_owner
            WHERE self_owner.token_id = o.token_id
              AND lower(self_owner.owner_wallet) = lower(o.offerer_wallet)
          )`
      : " AND 1 = 0"
    : "";
  const favouritesClause = scopeIsFavourites
    ? wallet
      ? ` AND EXISTS (
          SELECT 1
          FROM warplet_favourites wf, json_each(wf.token_ids) favourite
          WHERE wf.wallet = ?
            AND CAST(favourite.value AS INTEGER) = o.token_id
        )`
      : " AND 1 = 0"
    : "";
  const scopedWhere = `${baseWhere}${scopeIsYours ? " AND lower(o.offerer_wallet) = ?" : ""}${forYouClause}${favouritesClause}`;
  const scopedBindings = [
    ...baseBindings,
    ...(scopeIsYours ? [wallet!] : []),
    ...(scopeIsForYou && wallet ? [wallet] : []),
    ...(scopeIsForYou && !wallet && fid ? [fid] : []),
    ...(scopeIsFavourites && wallet ? [wallet] : []),
  ];
  const aggregate = await context.env.WARPLETS.prepare(
    `SELECT COUNT(*) AS offer_count, COALESCE(SUM(amount_eth), 0) AS value_eth
     FROM warplet_active_item_offers o WHERE ${scopedWhere}`,
  ).bind(...scopedBindings).first<{ offer_count: number; value_eth: number | null }>();
  const count = Math.max(0, Number(aggregate?.offer_count ?? 0));
  const totalPages = Math.max(1, Math.ceil(count / pageSize));
  const page = Math.min(requestedPage, totalPages - 1);
  const pageRows = await context.env.WARPLETS.prepare(
    `SELECT order_hash, token_id, offerer_wallet, amount_eth, amount_raw, currency_symbol,
            protocol_address, created_at, expires_at
     FROM warplet_active_item_offers o
     WHERE ${scopedWhere}
     ORDER BY amount_eth DESC, created_at ASC, order_hash ASC
     LIMIT ? OFFSET ?`,
  ).bind(...scopedBindings, pageSize, page * pageSize).all<ActiveItemOfferRow>().then((result) => result.results ?? []);
  const topRow = await context.env.WARPLETS.prepare(
    `SELECT order_hash, token_id, offerer_wallet, amount_eth, amount_raw, currency_symbol,
            protocol_address, created_at, expires_at
     FROM warplet_active_item_offers o
     WHERE ${baseWhere}
     ORDER BY amount_eth DESC, created_at ASC, order_hash ASC
     LIMIT 1`,
  ).bind(...baseBindings).first<ActiveItemOfferRow>();
  const profiles = await loadBidderProfiles(
    context.env,
    pageRows.map((row) => row.offerer_wallet).filter((value): value is string => Boolean(value)),
    new URL(context.request.url).searchParams.get("refresh") === "1",
  );
  const topItemOffer = topRow ? {
    eth: topRow.amount_eth,
    rawAmount: topRow.amount_raw,
    decimals: 18,
    currencySymbol: topRow.currency_symbol ?? "WETH",
    tokenAddress: BASE_WETH,
    at: topRow.created_at,
  } satisfies MarketMoney : null;
  const valueEth = Number(aggregate?.value_eth ?? 0);
  return marketJson({
    generatedAt: new Date().toISOString(), refreshError, wallet, tokenId, topItemOffer,
    pagination: { page, pageSize, totalPages, totalRows: count, hasPrevious: page > 0, hasNext: page + 1 < totalPages },
    stats: {
      count,
      value: { eth: valueEth, rawAmount: null, decimals: 18, currencySymbol: "WETH", tokenAddress: BASE_WETH, at: new Date().toISOString() },
    },
    rows: pageRows.map((row) => {
      const offerer = normalizeAddress(row.offerer_wallet);
      return {
        orderHash: row.order_hash,
        tokenId: row.token_id,
        protocolAddress: row.protocol_address ?? "0x0000000000000068f116a894984e2db1123eb395",
        price: { eth: row.amount_eth, rawAmount: row.amount_raw, decimals: 18, currencySymbol: row.currency_symbol ?? "WETH", tokenAddress: BASE_WETH, at: row.created_at },
        bidder: offerer ? profiles.get(offerer) ?? buildBidderProfile({ wallet: offerer }) : null,
        isUserOffer: Boolean(wallet && offerer === wallet),
      };
    }),
  });
}
