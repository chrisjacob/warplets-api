import {
  asArray,
  asNumber,
  asObject,
  asString,
  clearTokenMarketSide,
  classifyOpenSeaOffer,
  fetchOpenSea,
  fetchLatestTokenSale,
  getMakerAddress,
  getOrderCreatedAt,
  getPrice,
  hasCurrencyValue,
  loadOneTokenSnapshot,
  normalizeAddress,
  ownerOf,
  processListing,
  processOffer,
  processSaleOrTransfer,
  publishMarketSnapshot,
  readCriteriaTraits,
  selectPreferredFidForWallet,
  upsertCriteriaOfferFromRow,
  upsertMarketStateIfChanged,
  type MarketMoney,
  type MarketOrderMoney,
  type TraitCriterion,
  type OpenSeaMarketEnv,
} from "./openseaMarket.js";
import { jsonSecure } from "./security.js";
import {
  deactivateActiveItemOffer,
  recordWarpletActivity,
  upsertActiveItemOffer,
} from "./warpletNotifications.js";
import { refreshHolderLeaderboardWallets } from "./stats.js";
import { hashStruct } from "viem";

export type OpenSeaTradeEnv = OpenSeaMarketEnv;

const SEAPORT_ORDER_COMPONENT_TYPES = {
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

function deriveSeaportOrderHash(parameters: Record<string, unknown>): string | null {
  try {
    return hashStruct({
      data: parameters as never,
      primaryType: "OrderComponents",
      types: SEAPORT_ORDER_COMPONENT_TYPES,
    });
  } catch (error) {
    console.error("Failed to derive Seaport order hash", error);
    return null;
  }
}

function nestedOrderHash(result: Record<string, unknown>): string | null {
  const nested = asObject(result.order) ?? asObject(result.offer) ?? asObject(result.data);
  return asString(result.order_hash) ??
    asString(result.orderHash) ??
    asString(nested?.order_hash) ??
    asString(nested?.orderHash);
}

function seaportTimestamp(parameters: Record<string, unknown>, key: "startTime" | "endTime"): string | null {
  const seconds = Number(asString(parameters[key]) ?? asNumber(parameters[key]));
  if (!Number.isFinite(seconds) || seconds <= 0) return null;
  return new Date(seconds * 1000).toISOString();
}

export type TradeActionPhase =
  | "prepare_requested"
  | "fresh_state_mismatch"
  | "approval_requested"
  | "approval_success"
  | "signature_requested"
  | "signature_success"
  | "transaction_requested"
  | "transaction_submitted"
  | "confirmed"
  | "user_rejected"
  | "api_error"
  | "wallet_error";

export type TradeActionLogInput = {
  actionId?: string | null;
  actionName: string;
  status: string;
  phase: TradeActionPhase;
  fid?: number | null;
  tokenId?: string | number | null;
  walletFrom?: string | null;
  walletTo?: string | null;
  orderHash?: string | null;
  protocolAddress?: string | null;
  transactionHash?: string | null;
  expectedPriceRaw?: string | null;
  actualPriceRaw?: string | null;
  paymentToken?: string | null;
  paymentDecimals?: number | null;
  httpStatus?: number | null;
  walletErrorCode?: string | null;
  errorMessage?: string | null;
  rawPayload?: unknown;
};

const OPENSEA_API_BASE = "https://api.opensea.io/api/v2";
const BASE_CHAIN = "base";
const BASE_CHAIN_ID = 8453;
const BASE_CHAIN_ID_HEX = "0x2105";
const COLLECTION_SLUG = "10xwarplets";
const COLLECTION_CONTRACT = "0x780446dd12e080ae0db762fcd4daf313f3e359de";
const DEFAULT_SEAPORT_PROTOCOL = "0x0000000000000068f116a894984e2db1123eb395";
const BASE_WETH = "0x4200000000000000000000000000000000000006";
const NATIVE_ETH = "0x0000000000000000000000000000000000000000";
const BASE_RPC_URL = "https://mainnet.base.org";
const ZERO_HASH = "0x0000000000000000000000000000000000000000000000000000000000000000";
const OPENSEA_SIGNED_ZONE_V2 = "0x000056f7000000ece9003ca63978907a00ffd100";
const OPENSEA_CONDUIT_KEY = "0x0000007b02230091a7ed01230072f7006a004d60a8d4e71d599b8104250f0000";
const OPENSEA_CONDUIT_ADDRESS = "0x1e0049783f008a0085193e00003d00cd54003c71";
const SEAPORT_GET_COUNTER_SELECTOR = "0xf07ec373";
const MAX_OPENSEA_ORDER_DURATION_SECONDS = 179 * 24 * 60 * 60;

type FreshOrder = MarketOrderMoney & {
  source?: "item" | "trait" | "collection";
  seller?: string | null;
  offerer?: string | null;
  traits?: TraitCriterion[];
  protocolData?: unknown;
};

type FreshTradeState = {
  tokenId: number;
  generatedAt: string;
  listing: (FreshOrder & { seller: string | null }) | null;
  itemOffer: (FreshOrder & { offerer: string | null; source: "item" }) | null;
  traitOffer: (FreshOrder & { offerer: string | null; source: "trait"; traits: TraitCriterion[] }) | null;
  collectionOffer: (FreshOrder & { offerer: string | null; source: "collection" }) | null;
  topOffer: (FreshOrder & { offerer: string | null; source: "item" | "trait" | "collection" }) | null;
  ownItemOffer: (FreshOrder & { offerer: string | null; source: "item" }) | null;
  sale: MarketMoney | null;
  floor: MarketMoney | null;
  owner: {
    wallet: string | null;
    fid: number | null;
    checkedAt: string | null;
  };
  snapshot?: unknown;
};

type OrderFee = {
  recipient: string;
  bps: number;
};

function requireOpenSeaApiKey(env: OpenSeaTradeEnv): string {
  const apiKey = env.OPENSEA_API_KEY?.trim();
  if (!apiKey) throw new Error("OPENSEA_API_KEY is not configured");
  return apiKey;
}

function tradeJson(data: unknown, init?: ResponseInit): Response {
  const response = jsonSecure(data, init);
  response.headers.set("cache-control", "no-store");
  return response;
}

function normalizeWallet(value: unknown): string | null {
  return normalizeAddress(value);
}

function readProtocolAddress(row: Record<string, unknown>): string | null {
  return normalizeAddress(row.protocol_address ?? asObject(row.protocol_data)?.address) ?? DEFAULT_SEAPORT_PROTOCOL;
}

function orderToMarket(row: Record<string, unknown>, side: "listing" | "offer"): FreshOrder | null {
  const price = getPrice(row, side === "listing" ? "consideration" : "offer");
  if (!hasCurrencyValue(price)) return null;
  return {
    eth: price.eth,
    at: getOrderCreatedAt(row) ?? new Date().toISOString(),
    rawAmount: price.rawAmount,
    decimals: price.decimals,
    currencySymbol: price.symbol,
    tokenAddress: price.tokenAddress,
    orderHash: asString(row.order_hash),
    protocolAddress: readProtocolAddress(row),
    seller: side === "listing" ? getMakerAddress(row) : null,
    offerer: side === "offer" ? getMakerAddress(row) : null,
    protocolData: row.protocol_data ?? null,
  };
}

function comparableMarketValue(value: MarketMoney | null | undefined): number | null {
  if (!value) return null;
  if (value.eth != null) return value.eth;
  if (!value.rawAmount || value.decimals == null) return null;
  try {
    const divisor = 10n ** BigInt(value.decimals);
    const raw = BigInt(value.rawAmount);
    const whole = raw / divisor;
    const fraction = raw % divisor;
    const parsed = Number(`${whole.toString()}.${fraction.toString().padStart(value.decimals, "0").slice(0, 8)}`);
    return Number.isFinite(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function marketTimeMs(value: MarketMoney | null | undefined): number | null {
  const timestamp = Date.parse(value?.at ?? "");
  return Number.isFinite(timestamp) ? timestamp : null;
}

function compareOfferPriority(left: MarketMoney | null | undefined, right: MarketMoney | null | undefined): number {
  const leftValue = comparableMarketValue(left);
  const rightValue = comparableMarketValue(right);
  if (leftValue == null && rightValue == null) return 0;
  if (leftValue == null) return 1;
  if (rightValue == null) return -1;
  if (leftValue !== rightValue) return rightValue - leftValue;
  const leftTime = marketTimeMs(left);
  const rightTime = marketTimeMs(right);
  if (leftTime == null || rightTime == null || leftTime === rightTime) return 0;
  return leftTime - rightTime;
}

function saleEventToMarketMoney(row: Record<string, unknown> | null): MarketMoney | null {
  if (!row) return null;
  const price = getPrice(row, "consideration");
  if (price.eth == null) return null;
  return {
    eth: price.eth,
    at: getOrderCreatedAt(row) ?? new Date().toISOString(),
    rawAmount: price.rawAmount,
    decimals: price.decimals,
    currencySymbol: price.symbol,
    tokenAddress: price.tokenAddress,
  };
}

function chooseTopOffer(
  itemOffer: FreshTradeState["itemOffer"],
  traitOffer: FreshTradeState["traitOffer"],
  collectionOffer: FreshTradeState["collectionOffer"],
): FreshTradeState["topOffer"] {
  let current: FreshTradeState["topOffer"] = null;
  for (const offer of [itemOffer, traitOffer, collectionOffer]) {
    if (!offer) continue;
    if (!current) {
      current = offer;
      continue;
    }
    if (compareOfferPriority(offer, current) < 0) {
      current = offer;
    }
  }
  return current;
}

function isSpecificItemOffer(row: Record<string, unknown>, tokenId: number): boolean {
  const parameters = asObject(asObject(row.protocol_data ?? row.protocolData)?.parameters);
  const considerationItems = asArray(parameters?.consideration);
  const expectedTokenId = String(tokenId);
  return considerationItems.some((item) => {
    const consideration = asObject(item);
    if (!consideration) return false;
    const itemType = asNumber(consideration.itemType);
    const tokenAddress = normalizeAddress(consideration.token);
    const identifier = asString(consideration.identifierOrCriteria);
    return itemType === 2 &&
      tokenAddress === COLLECTION_CONTRACT &&
      identifier === expectedTokenId;
  });
}

async function openSeaPost(apiKey: string, path: string, body: unknown): Promise<Record<string, unknown>> {
  const response = await fetch(`${OPENSEA_API_BASE}${path}`, {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      "x-api-key": apiKey,
      "X-API-KEY": apiKey,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`OpenSea ${path} failed (${response.status}): ${text || "unknown error"}`);
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

async function fetchSeaportCounter(offerer: string): Promise<string> {
  const encodedOfferer = offerer.toLowerCase().replace(/^0x/, "").padStart(64, "0");
  const result = await fetchBaseRpc("eth_call", [{ to: DEFAULT_SEAPORT_PROTOCOL, data: `${SEAPORT_GET_COUNTER_SELECTOR}${encodedOfferer}` }, "latest"]);
  const hex = asString(result);
  if (!hex) return "0";
  return BigInt(hex).toString();
}

async function fetchCollectionFees(apiKey: string): Promise<OrderFee[]> {
  const payload = await fetchOpenSea(`/collections/${COLLECTION_SLUG}`, apiKey);
  const rows = asArray(payload.fees ?? asObject(payload.collection)?.fees);
  return rows
    .map((row) => {
      const fee = asObject(row);
      const recipient = normalizeAddress(fee?.recipient);
      const percent = asNumber(fee?.fee);
      if (!recipient || percent == null || percent <= 0) return null;
      return { recipient, bps: Math.round(percent * 100) };
    })
    .filter((fee): fee is OrderFee => Boolean(fee && fee.bps > 0));
}

function feeAmount(rawAmount: string, bps: number): string {
  return ((BigInt(rawAmount) * BigInt(bps)) / 10000n).toString();
}

async function fetchBestListing(apiKey: string, tokenId: number): Promise<{ row: Record<string, unknown>; market: FreshTradeState["listing"] } | null> {
  try {
    const payload = await fetchOpenSea(`/listings/collection/${COLLECTION_SLUG}/nfts/${encodeURIComponent(String(tokenId))}/best`, apiKey);
    const row = asObject(payload.listing) ?? payload;
    const market = orderToMarket({ ...row, identifier: String(tokenId) }, "listing") as FreshTradeState["listing"];
    return market ? { row, market } : null;
  } catch {
    return null;
  }
}

async function fetchBestItemOffer(apiKey: string, tokenId: number): Promise<{ row: Record<string, unknown>; market: FreshTradeState["itemOffer"] } | null> {
  try {
    const payload = await fetchOpenSea(`/offers/collection/${COLLECTION_SLUG}/nfts/${encodeURIComponent(String(tokenId))}`, apiKey, new URLSearchParams({ limit: "50" }));
    const rows = asArray(payload.offers ?? payload.orders)
      .map((item) => asObject(item))
      .filter((item): item is Record<string, unknown> => Boolean(item))
      .filter((row) => isSpecificItemOffer(row, tokenId));
    const offers = rows
      .map((row) => {
        const market = orderToMarket({ ...row, identifier: String(tokenId) }, "offer") as FreshTradeState["itemOffer"];
        return market ? { row, market: { ...market, source: "item" as const } } : null;
      })
      .filter((offer): offer is { row: Record<string, unknown>; market: NonNullable<FreshTradeState["itemOffer"]> } => offer !== null)
      .sort((left, right) => compareOfferPriority(left.market, right.market));
    return offers[0] ?? null;
  } catch {
    return null;
  }
}

async function fetchBestApplicableOffer(
  apiKey: string,
  tokenId: number,
  excludeOrderHashes: string[] = [],
): Promise<{ row: Record<string, unknown>; market: NonNullable<FreshTradeState["topOffer"]> } | null> {
  try {
    const excluded = new Set(excludeOrderHashes.map((hash) => hash.toLowerCase()).filter(Boolean));
    const payload = await fetchOpenSea(`/offers/collection/${COLLECTION_SLUG}/nfts/${encodeURIComponent(String(tokenId))}/best`, apiKey);
    const row = asObject(payload.offer) ?? payload;
    const orderHash = asString(row.order_hash)?.toLowerCase();
    if (orderHash && excluded.has(orderHash)) return null;
    const source = classifyOpenSeaOffer(row);
    const market = orderToMarket(source === "item" ? { ...row, identifier: String(tokenId) } : row, "offer");
    if (!market) return null;
    if (source === "trait") {
      return {
        row,
        market: {
          ...market,
          source: "trait",
          traits: readCriteriaTraits(row),
          offerer: market.offerer ?? null,
        },
      };
    }
    return {
      row,
      market: {
        ...market,
        source,
        offerer: market.offerer ?? null,
      },
    };
  } catch {
    return null;
  }
}

async function fetchCollectionOffer(
  apiKey: string,
  excludeOrderHashes: string[] = [],
): Promise<{ row: Record<string, unknown>; market: FreshTradeState["collectionOffer"] } | null> {
  try {
    const excluded = new Set(excludeOrderHashes.map((hash) => hash.toLowerCase()).filter(Boolean));
    const payload = await fetchOpenSea(`/offers/collection/${COLLECTION_SLUG}`, apiKey, new URLSearchParams({ limit: "200" }));
    const rows = asArray(payload.offers ?? payload.orders)
      .map((item) => asObject(item))
      .filter((item): item is Record<string, unknown> => Boolean(item))
      .filter((item) => classifyOpenSeaOffer(item) === "collection");
    const best = rows.reduce<{ row: Record<string, unknown>; market: FreshTradeState["collectionOffer"] } | null>((current, row) => {
      const orderHash = asString(row.order_hash)?.toLowerCase();
      if (orderHash && excluded.has(orderHash)) return current;
      const market = orderToMarket(row, "offer") as FreshTradeState["collectionOffer"];
      if (!market) return current;
      const next = { row, market: { ...market, source: "collection" as const } };
      return !current || compareOfferPriority(next.market, current.market) < 0 ? next : current;
    }, null);
    return best ? { row: best.row, market: best.market } : null;
  } catch {
    return null;
  }
}

async function fetchOwnItemOffer(apiKey: string, tokenId: number, wallet: string | null): Promise<FreshTradeState["ownItemOffer"]> {
  if (!wallet) return null;
  try {
    const payload = await fetchOpenSea(`/offers/collection/${COLLECTION_SLUG}/nfts/${encodeURIComponent(String(tokenId))}`, apiKey, new URLSearchParams({ limit: "50" }));
    const rows = asArray(payload.offers ?? payload.orders)
      .map((item) => asObject(item))
      .filter((item): item is Record<string, unknown> => Boolean(item));
    const normalizedWallet = wallet.toLowerCase();
    const owned = rows
      .filter((row) => isSpecificItemOffer(row, tokenId))
      .map((row) => orderToMarket({ ...row, identifier: String(tokenId) }, "offer") as FreshTradeState["ownItemOffer"])
      .filter((offer): offer is NonNullable<FreshTradeState["ownItemOffer"]> => Boolean(offer && offer.offerer?.toLowerCase() === normalizedWallet));
    owned.sort((a, b) => compareOfferPriority(a, b));
    return owned[0] ? { ...owned[0], source: "item" } : null;
  } catch {
    return null;
  }
}

async function fetchFloor(apiKey: string): Promise<MarketMoney | null> {
  try {
    const payload = await fetchOpenSea(`/collections/${COLLECTION_SLUG}/stats`, apiKey);
    const total = asObject(payload.total) ?? asObject(payload.stats) ?? payload;
    const floorEth = asNumber(total.floor_price ?? total.floorPrice);
    return floorEth == null
      ? null
      : {
        eth: floorEth,
        at: new Date().toISOString(),
        rawAmount: null,
        decimals: 18,
        currencySymbol: "ETH",
        tokenAddress: NATIVE_ETH,
      };
  } catch {
    return null;
  }
}

async function persistCollectionTradeState(
  env: OpenSeaTradeEnv,
  floor: MarketMoney | null,
  collectionOffer: FreshTradeState["collectionOffer"],
): Promise<void> {
  const now = new Date().toISOString();
  await env.WARPLETS.prepare(
    `INSERT INTO opensea_collection_market_state (
       collection_slug,
       floor_eth, floor_raw_amount, floor_decimals, floor_currency_symbol, floor_token_address, floor_updated_at,
       top_offer_eth, top_offer_raw_amount, top_offer_decimals, top_offer_currency_symbol, top_offer_token_address,
       top_offer_order_hash, top_offer_protocol_address, top_offerer_wallet, top_offer_created_at, top_offer_updated_at,
       created_at, updated_at
     )
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(collection_slug) DO UPDATE SET
       floor_eth = excluded.floor_eth,
       floor_raw_amount = excluded.floor_raw_amount,
       floor_decimals = excluded.floor_decimals,
       floor_currency_symbol = excluded.floor_currency_symbol,
       floor_token_address = excluded.floor_token_address,
       floor_updated_at = excluded.floor_updated_at,
       top_offer_eth = excluded.top_offer_eth,
       top_offer_raw_amount = excluded.top_offer_raw_amount,
       top_offer_decimals = excluded.top_offer_decimals,
       top_offer_currency_symbol = excluded.top_offer_currency_symbol,
       top_offer_token_address = excluded.top_offer_token_address,
       top_offer_order_hash = excluded.top_offer_order_hash,
       top_offer_protocol_address = excluded.top_offer_protocol_address,
       top_offerer_wallet = excluded.top_offerer_wallet,
       top_offer_created_at = excluded.top_offer_created_at,
       top_offer_updated_at = excluded.top_offer_updated_at,
       updated_at = excluded.updated_at`
  ).bind(
    COLLECTION_SLUG,
    floor?.eth ?? null,
    floor?.rawAmount ?? null,
    floor?.decimals ?? null,
    floor?.currencySymbol ?? null,
    floor?.tokenAddress ?? null,
    floor?.at ?? now,
    collectionOffer?.eth ?? null,
    collectionOffer?.rawAmount ?? null,
    collectionOffer?.decimals ?? null,
    collectionOffer?.currencySymbol ?? null,
    collectionOffer?.tokenAddress ?? null,
    collectionOffer?.orderHash ?? null,
    collectionOffer?.protocolAddress ?? null,
    collectionOffer?.offerer ?? null,
    collectionOffer?.at ?? null,
    now,
    now,
    now,
  ).run();
}

export async function logTradeAction(env: OpenSeaTradeEnv, input: TradeActionLogInput): Promise<void> {
  const actionId = input.actionId || crypto.randomUUID();
  const sanitizedPayload = input.rawPayload == null ? null : JSON.stringify(input.rawPayload).slice(0, 5000);
  await env.WARPLETS.prepare(
    `INSERT INTO opensea_action_log (
       action_id, action_name, status, phase, fid, token_id, wallet_from, wallet_to,
       order_hash, protocol_address, transaction_hash, expected_price_raw, actual_price_raw,
       payment_token, payment_decimals, http_status, wallet_error_code, error_message, raw_payload
     )
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    actionId,
    input.actionName,
    input.status,
    input.phase,
    input.fid ?? null,
    input.tokenId == null ? null : String(input.tokenId),
    input.walletFrom ? input.walletFrom.toLowerCase() : null,
    input.walletTo ? input.walletTo.toLowerCase() : null,
    input.orderHash ?? null,
    input.protocolAddress ?? null,
    input.transactionHash ?? null,
    input.expectedPriceRaw ?? null,
    input.actualPriceRaw ?? null,
    input.paymentToken ?? null,
    input.paymentDecimals ?? null,
    input.httpStatus ?? null,
    input.walletErrorCode ?? null,
    input.errorMessage ?? null,
    sanitizedPayload,
  ).run();
}

export async function getFreshTradeState(
  env: OpenSeaTradeEnv,
  tokenId: number,
  wallet?: string | null,
  options: { excludeCollectionOrderHashes?: string[] } = {},
): Promise<FreshTradeState> {
  const apiKey = requireOpenSeaApiKey(env);
  const normalizedWallet = normalizeWallet(wallet);
  const excludedCollectionOrderHashes = options.excludeCollectionOrderHashes ?? [];
  const previousOwner = await env.WARPLETS.prepare(
    "SELECT owner_wallet FROM warplet_market_state WHERE token_id = ?",
  )
    .bind(tokenId)
    .first<{ owner_wallet: string | null }>()
    .catch(() => null);
  const previousOwnerWallet = normalizeAddress(previousOwner?.owner_wallet);
  const [listing, itemOffer, bestApplicableOffer, collectionOffer, floor, ownerWallet, ownItemOffer, salePayload] = await Promise.all([
    fetchBestListing(apiKey, tokenId),
    fetchBestItemOffer(apiKey, tokenId),
    fetchBestApplicableOffer(apiKey, tokenId, excludedCollectionOrderHashes),
    fetchCollectionOffer(apiKey, excludedCollectionOrderHashes),
    fetchFloor(apiKey),
    ownerOf(tokenId).catch(() => null),
    fetchOwnItemOffer(apiKey, tokenId, normalizedWallet),
    fetchLatestTokenSale(apiKey, tokenId).catch(() => null),
  ]);

  const listingSeller = listing?.row ? getMakerAddress(listing.row) : null;
  const listingMatchesOwner = Boolean(
    listing?.market &&
    (!ownerWallet || !listingSeller || listingSeller === ownerWallet)
  );
  const activeListing = listingMatchesOwner ? listing : null;

  if (activeListing?.row && activeListing.market) {
    await processListing(env, { ...activeListing.row, identifier: String(tokenId) });
  } else {
    await clearTokenMarketSide(env, tokenId, "listing");
  }
  if (itemOffer?.row && itemOffer.market) {
    await processOffer(env, { ...itemOffer.row, identifier: String(tokenId) });
  } else {
    await clearTokenMarketSide(env, tokenId, "offer");
  }
  const traitOffer = bestApplicableOffer?.market.source === "trait"
    ? bestApplicableOffer.market as FreshTradeState["traitOffer"]
    : null;
  if (bestApplicableOffer?.row && bestApplicableOffer.market.source !== "item") {
    await upsertCriteriaOfferFromRow(env, bestApplicableOffer.row, { recordActivity: false }).catch(() => false);
  }
  await persistCollectionTradeState(env, floor, collectionOffer?.market ?? null).catch(() => {});
  if (salePayload) {
    await processSaleOrTransfer(env, salePayload, { clearOrdersOnOwnerChange: true }).catch(() => false);
  }

  const now = new Date().toISOString();
  const ownerFid = ownerWallet ? await selectPreferredFidForWallet(env, ownerWallet) : null;
  if (ownerWallet) {
    await env.WARPLETS.prepare(
      `INSERT INTO warplet_market_state (
         token_id, owner_wallet, owner_fid, owner_checked_at, owner_event_at,
         opensea_updated_at, created_at, updated_at
       )
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(token_id) DO UPDATE SET
         owner_wallet = excluded.owner_wallet,
         owner_fid = excluded.owner_fid,
         owner_checked_at = excluded.owner_checked_at,
         owner_event_at = excluded.owner_event_at,
         opensea_updated_at = excluded.opensea_updated_at,
         updated_at = excluded.updated_at`
    ).bind(tokenId, ownerWallet, ownerFid, now, now, now, now, now).run();
    if (ownerWallet !== previousOwnerWallet) {
      await refreshHolderLeaderboardWallets(env.WARPLETS, [
        previousOwnerWallet,
        ownerWallet,
      ]);
    }
  }
  await publishMarketSnapshot(env).catch(() => null);

  return {
    tokenId,
    generatedAt: now,
    listing: activeListing?.market ?? null,
    itemOffer: itemOffer?.market ?? null,
    traitOffer,
    collectionOffer: collectionOffer?.market ?? null,
    topOffer: chooseTopOffer(itemOffer?.market ?? null, traitOffer, collectionOffer?.market ?? null),
    ownItemOffer,
    sale: saleEventToMarketMoney(salePayload),
    floor,
    owner: {
      wallet: ownerWallet,
      fid: ownerFid,
      checkedAt: now,
    },
    snapshot: await loadOneTokenSnapshot(env, tokenId),
  };
}

function pricesMatch(expectedRaw: unknown, expectedOrderHash: unknown, current: FreshOrder | null): boolean {
  if (!current?.orderHash) return false;
  const expectedHash = asString(expectedOrderHash);
  const expectedPrice = asString(expectedRaw);
  if (expectedHash && current.orderHash !== expectedHash) return false;
  if (expectedPrice && current.rawAmount !== expectedPrice) return false;
  return true;
}

function rawEthToDecimalAmount(rawAmount: string): string {
  const raw = BigInt(rawAmount);
  const divisor = 10n ** 18n;
  const whole = raw / divisor;
  const fraction = raw % divisor;
  const fractionText = fraction.toString().padStart(18, "0").replace(/0+$/, "");
  return fractionText ? `${whole.toString()}.${fractionText}` : whole.toString();
}

function rawEthToNumber(rawAmount?: string | null): number | null {
  if (!rawAmount) return null;
  try {
    const raw = BigInt(rawAmount);
    const divisor = 10n ** 18n;
    const whole = raw / divisor;
    const fraction = raw % divisor;
    const parsed = Number(`${whole.toString()}.${fraction.toString().padStart(18, "0").slice(0, 8)}`);
    return Number.isFinite(parsed) ? parsed : null;
  } catch {
    return null;
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

function randomUint256String(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return BigInt(`0x${Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("")}`).toString();
}

function buildItemOfferOrder(input: {
  offerer: string;
  tokenId: number;
  priceRaw: string;
  durationSeconds: number;
  counter: string;
  fees: OrderFee[];
}): { parameters: Record<string, unknown>; typedData: Record<string, unknown> } {
  const now = Math.floor(Date.now() / 1000);
  const startTime = String(Math.max(0, now - 60));
  const durationSeconds = Math.min(MAX_OPENSEA_ORDER_DURATION_SECONDS, Math.max(60, Math.floor(input.durationSeconds)));
  const endTime = String(Number(startTime) + durationSeconds);
  const feeConsideration = input.fees
    .map((fee) => {
      const amount = feeAmount(input.priceRaw, fee.bps);
      if (BigInt(amount) <= 0n) return null;
      return {
        itemType: 1,
        token: BASE_WETH,
        identifierOrCriteria: "0",
        startAmount: amount,
        endAmount: amount,
        recipient: fee.recipient,
      };
    })
    .filter((item): item is {
      itemType: number;
      token: string;
      identifierOrCriteria: string;
      startAmount: string;
      endAmount: string;
      recipient: string;
    } => Boolean(item));
  const parameters = {
    offerer: input.offerer,
    zone: OPENSEA_SIGNED_ZONE_V2,
    offer: [{
      itemType: 1,
      token: BASE_WETH,
      identifierOrCriteria: "0",
      startAmount: input.priceRaw,
      endAmount: input.priceRaw,
    }],
    consideration: [{
      itemType: 2,
      token: COLLECTION_CONTRACT,
      identifierOrCriteria: String(input.tokenId),
      startAmount: "1",
      endAmount: "1",
      recipient: input.offerer,
    }, ...feeConsideration],
    orderType: 2,
    startTime,
    endTime,
    zoneHash: ZERO_HASH,
    salt: randomUint256String(),
    conduitKey: OPENSEA_CONDUIT_KEY,
    counter: input.counter,
  };
  return {
    parameters,
    typedData: {
      domain: {
        name: "Seaport",
        version: "1.6",
        chainId: BASE_CHAIN_ID,
        verifyingContract: DEFAULT_SEAPORT_PROTOCOL,
      },
      primaryType: "OrderComponents",
      types: {
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
      },
      message: parameters,
    },
  };
}

async function prepareListingFulfillment(apiKey: string, listing: FreshTradeState["listing"], buyerWallet: string): Promise<Record<string, unknown>> {
  if (!listing?.orderHash || !listing.protocolAddress) throw new Error("No active listing is available");
  return openSeaPost(apiKey, "/listings/fulfillment_data", {
    listing: {
      hash: listing.orderHash,
      chain: BASE_CHAIN,
      protocol_address: listing.protocolAddress,
    },
    fulfiller: { address: buyerWallet },
  });
}

async function prepareOfferFulfillment(apiKey: string, offer: NonNullable<FreshTradeState["topOffer"]>, sellerWallet: string, tokenId: number): Promise<Record<string, unknown>> {
  if (!offer.orderHash || !offer.protocolAddress) throw new Error("No active offer is available");
  return openSeaPost(apiKey, "/offers/fulfillment_data", {
    offer: {
      hash: offer.orderHash,
      chain: BASE_CHAIN,
      protocol_address: offer.protocolAddress,
    },
    fulfiller: { address: sellerWallet },
    consideration: {
      asset_contract_address: COLLECTION_CONTRACT,
      token_id: String(tokenId),
    },
  });
}

export async function handleTradeStateRequest(context: Parameters<PagesFunction<OpenSeaTradeEnv>>[0], tokenId: number): Promise<Response> {
  const url = new URL(context.request.url);
  const wallet = url.searchParams.get("wallet");
  const excludeCollectionOrderHashes = url.searchParams
    .getAll("excludeCollectionOrderHash")
    .flatMap((value) => value.split(","))
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
  return tradeJson(await getFreshTradeState(context.env, tokenId, wallet, { excludeCollectionOrderHashes }));
}

export async function handleBuyPrepare(context: Parameters<PagesFunction<OpenSeaTradeEnv>>[0]): Promise<Response> {
  const body = await context.request.json() as Record<string, unknown>;
  const tokenId = Number(body.tokenId);
  const wallet = normalizeWallet(body.wallet);
  if (!Number.isInteger(tokenId) || tokenId <= 0 || !wallet) return tradeJson({ error: "invalid_request" }, { status: 400 });
  const actionId = asString(body.actionId) ?? crypto.randomUUID();
  await logTradeAction(context.env, { actionId, actionName: "buy", status: "requested", phase: "prepare_requested", tokenId, walletFrom: wallet, expectedPriceRaw: asString(body.expectedRawAmount), orderHash: asString(body.expectedOrderHash) });
  const apiKey = requireOpenSeaApiKey(context.env);
  const state = await getFreshTradeState(context.env, tokenId, wallet);
  if (!pricesMatch(body.expectedRawAmount, body.expectedOrderHash, state.listing)) {
    await logTradeAction(context.env, { actionId, actionName: "buy", status: "mismatch", phase: "fresh_state_mismatch", tokenId, walletFrom: wallet, expectedPriceRaw: asString(body.expectedRawAmount), actualPriceRaw: state.listing?.rawAmount ?? null, orderHash: state.listing?.orderHash ?? null });
    return tradeJson({ status: "mismatch", actionId, freshState: state }, { status: 409 });
  }
  const fulfillment = await prepareListingFulfillment(apiKey, state.listing, wallet);
  return tradeJson({ status: "ready", actionId, state, fulfillment, chainIdHex: BASE_CHAIN_ID_HEX });
}

export async function handleAcceptOfferPrepare(context: Parameters<PagesFunction<OpenSeaTradeEnv>>[0]): Promise<Response> {
  const body = await context.request.json() as Record<string, unknown>;
  const tokenId = Number(body.tokenId);
  const wallet = normalizeWallet(body.wallet);
  if (!Number.isInteger(tokenId) || tokenId <= 0 || !wallet) return tradeJson({ error: "invalid_request" }, { status: 400 });
  const actionId = asString(body.actionId) ?? crypto.randomUUID();
  await logTradeAction(context.env, { actionId, actionName: "accept_offer", status: "requested", phase: "prepare_requested", tokenId, walletFrom: wallet, expectedPriceRaw: asString(body.expectedRawAmount), orderHash: asString(body.expectedOrderHash) });
  const apiKey = requireOpenSeaApiKey(context.env);
  const state = await getFreshTradeState(context.env, tokenId, wallet);
  const exactItemOffer = body.exactItemOffer === true;
  let offerToAccept = state.topOffer;
  if (exactItemOffer) {
    const expectedOrderHash = asString(body.expectedOrderHash);
    const exactRow = expectedOrderHash ? await context.env.WARPLETS.prepare(
      `SELECT order_hash, offerer_wallet, amount_eth, amount_raw, currency_symbol, protocol_address, created_at
       FROM warplet_active_item_offers
       WHERE token_id = ? AND lower(order_hash) = lower(?) AND active = 1
         AND (expires_at IS NULL OR datetime(expires_at) > CURRENT_TIMESTAMP)
       LIMIT 1`,
    ).bind(tokenId, expectedOrderHash).first<{
      order_hash: string;
      offerer_wallet: string | null;
      amount_eth: number | null;
      amount_raw: string | null;
      currency_symbol: string | null;
      protocol_address: string | null;
      created_at: string | null;
    }>() : null;
    offerToAccept = exactRow ? {
      eth: exactRow.amount_eth,
      rawAmount: exactRow.amount_raw,
      decimals: 18,
      currencySymbol: exactRow.currency_symbol ?? "WETH",
      tokenAddress: BASE_WETH,
      at: exactRow.created_at,
      orderHash: exactRow.order_hash,
      protocolAddress: exactRow.protocol_address ?? DEFAULT_SEAPORT_PROTOCOL,
      offerer: normalizeWallet(exactRow.offerer_wallet),
      source: "item" as const,
    } : null;
  }
  if (state.owner.wallet && state.owner.wallet !== wallet) {
    return tradeJson({ error: "not_token_owner", message: "Connect the wallet that owns this Warplet." }, { status: 403 });
  }
  if (!offerToAccept || !pricesMatch(body.expectedRawAmount, body.expectedOrderHash, offerToAccept)) {
    await logTradeAction(context.env, { actionId, actionName: "accept_offer", status: "mismatch", phase: "fresh_state_mismatch", tokenId, walletFrom: wallet, expectedPriceRaw: asString(body.expectedRawAmount), actualPriceRaw: state.topOffer?.rawAmount ?? null, orderHash: state.topOffer?.orderHash ?? null });
    return tradeJson({ status: "mismatch", actionId, freshState: state }, { status: 409 });
  }
  const fulfillment = await prepareOfferFulfillment(apiKey, offerToAccept, wallet, tokenId);
  return tradeJson({
    status: "ready",
    actionId,
    state,
    acceptedOffer: offerToAccept,
    fulfillment,
    chainIdHex: BASE_CHAIN_ID_HEX,
    nftApproval: {
      tokenAddress: COLLECTION_CONTRACT,
      spender: "0x1e0049783f008a0085193e00003d00cd54003c71",
    },
  });
}

export async function handleListingPrepare(context: Parameters<PagesFunction<OpenSeaTradeEnv>>[0]): Promise<Response> {
  const body = await context.request.json() as Record<string, unknown>;
  const tokenId = Number(body.tokenId);
  const wallet = normalizeWallet(body.wallet);
  const priceRaw = asString(body.priceRaw);
  const durationSeconds = Number(body.durationSeconds);
  if (!Number.isInteger(tokenId) || tokenId <= 0 || !wallet || !priceRaw || !Number.isFinite(durationSeconds)) {
    return tradeJson({ error: "invalid_request" }, { status: 400 });
  }
  const actionId = asString(body.actionId) ?? crypto.randomUUID();
  await logTradeAction(context.env, { actionId, actionName: "list", status: "requested", phase: "prepare_requested", tokenId, walletFrom: wallet, expectedPriceRaw: priceRaw });
  const apiKey = requireOpenSeaApiKey(context.env);
  const startTime = new Date().toISOString();
  const clampedDurationSeconds = Math.min(MAX_OPENSEA_ORDER_DURATION_SECONDS, Math.max(60, Math.floor(durationSeconds)));
  const endTime = new Date(Date.now() + clampedDurationSeconds * 1000).toISOString();
  const priceAmount = rawEthToDecimalAmount(priceRaw);
  const actions = await openSeaPost(apiKey, "/listings/actions", {
    address: wallet,
    items: [{
      chain: BASE_CHAIN,
      contract: COLLECTION_CONTRACT,
      token_id: String(tokenId),
      quantity: 1,
      price: { currency: NATIVE_ETH, amount: priceAmount },
      start_time: startTime,
      end_time: endTime,
    }],
  });
  return tradeJson({ status: "ready", actionId, actions, chainIdHex: BASE_CHAIN_ID_HEX });
}

export async function handleOfferPrepare(context: Parameters<PagesFunction<OpenSeaTradeEnv>>[0]): Promise<Response> {
  const body = await context.request.json() as Record<string, unknown>;
  const tokenId = Number(body.tokenId);
  const wallet = normalizeWallet(body.wallet);
  const priceRaw = asString(body.priceRaw);
  const durationSeconds = Number(body.durationSeconds);
  if (!Number.isInteger(tokenId) || tokenId <= 0 || !wallet || !priceRaw || !Number.isFinite(durationSeconds)) {
    return tradeJson({ error: "invalid_request" }, { status: 400 });
  }
  let normalizedPriceRaw: string;
  try {
    normalizedPriceRaw = assertPositiveRawAmount(priceRaw);
  } catch {
    return tradeJson({ error: "invalid_price", message: "Offer amount is invalid" }, { status: 400 });
  }
  const actionId = asString(body.actionId) ?? crypto.randomUUID();
  await logTradeAction(context.env, { actionId, actionName: "make_offer", status: "requested", phase: "prepare_requested", tokenId, walletFrom: wallet, expectedPriceRaw: normalizedPriceRaw, paymentToken: BASE_WETH, paymentDecimals: 18 });
  const apiKey = requireOpenSeaApiKey(context.env);
  const [counter, fees] = await Promise.all([
    fetchSeaportCounter(wallet),
    fetchCollectionFees(apiKey),
  ]);
  const { parameters, typedData } = buildItemOfferOrder({
    offerer: wallet,
    tokenId,
    priceRaw: normalizedPriceRaw,
    durationSeconds,
    counter,
    fees,
  });
  return tradeJson({
    status: "ready",
    actionId,
    protocol: "seaport",
    protocolAddress: DEFAULT_SEAPORT_PROTOCOL,
    parameters,
    typedData,
    chainIdHex: BASE_CHAIN_ID_HEX,
    wethApproval: { tokenAddress: BASE_WETH, spender: OPENSEA_CONDUIT_ADDRESS, amount: normalizedPriceRaw },
  });
}

export async function handleListingSubmit(context: Parameters<PagesFunction<OpenSeaTradeEnv>>[0]): Promise<Response> {
  const body = await context.request.json() as Record<string, unknown>;
  const protocol = asString(body.protocol) ?? "seaport";
  const apiKey = requireOpenSeaApiKey(context.env);
  const payload = asObject(body.payload) ?? body;
  const result = await openSeaPost(apiKey, `/orders/${BASE_CHAIN}/${encodeURIComponent(protocol)}/listings`, payload);
  const tokenId = asString(body.tokenId);
  const wallet = normalizeAddress(body.wallet);
  const priceRaw = asString(body.priceRaw);
  if (tokenId && wallet && priceRaw) {
    await recordWarpletActivity(context.env, {
      eventType: "listed",
      tokenId,
      actorWallet: wallet,
      actorFid: asNumber(body.fid),
      amountEth: rawEthToNumber(priceRaw),
      amountRaw: priceRaw,
      currencySymbol: "ETH",
      orderHash: asString(result.order_hash) ?? asString(result.orderHash),
      source: "search:trade",
      rawPayload: { actionId: asString(body.actionId), result },
    }).catch((error) => console.error("Failed to record listing submit activity", error));
  }
  return tradeJson({ status: "submitted", result });
}

export async function handleOfferSubmit(context: Parameters<PagesFunction<OpenSeaTradeEnv>>[0]): Promise<Response> {
  const body = await context.request.json() as Record<string, unknown>;
  const apiKey = requireOpenSeaApiKey(context.env);
  const protocol = asString(body.protocol) ?? "seaport";
  const payload = asObject(body.payload) ?? body;
  const parameters = asObject(payload.parameters);
  const signature = asString(payload.signature);
  const protocolAddress = asString(payload.protocol_address) ?? DEFAULT_SEAPORT_PROTOCOL;
  if (parameters && signature) {
    const result = await openSeaPost(apiKey, `/orders/${BASE_CHAIN}/${encodeURIComponent(protocol)}/offers`, {
      parameters,
      protocol_address: protocolAddress,
      signature,
    });
    const tokenId = asString(body.tokenId);
    const wallet = normalizeAddress(body.wallet);
    const priceRaw = asString(body.priceRaw);
    const orderHash = nestedOrderHash(result) ?? asString(body.orderHash) ?? deriveSeaportOrderHash(parameters);
    if (tokenId && wallet && priceRaw) {
      await upsertActiveItemOffer(context.env, {
        orderHash,
        tokenId,
        offererWallet: wallet,
        amountEth: rawEthToNumber(priceRaw),
        amountRaw: priceRaw,
        currencySymbol: "WETH",
        protocolAddress,
        createdAt: seaportTimestamp(parameters, "startTime"),
        expiresAt: seaportTimestamp(parameters, "endTime"),
      }).catch((error) => console.error("Failed to upsert submitted item offer", error));
      await recordWarpletActivity(context.env, {
        eventType: "offered",
        tokenId,
        actorWallet: wallet,
        actorFid: asNumber(body.fid),
        amountEth: rawEthToNumber(priceRaw),
        amountRaw: priceRaw,
        currencySymbol: "WETH",
        orderHash,
        source: "search:trade",
        rawPayload: { actionId: asString(body.actionId), result },
      }).catch((error) => console.error("Failed to record offer submit activity", error));
    }
    return tradeJson({ status: "submitted", orderHash, result });
  }
  const protocolData = asObject(payload.protocol_data);
  if (!protocolData) {
    return tradeJson({ error: "missing_protocol_data", message: "OpenSea offer response did not include signed protocol data." }, { status: 400 });
  }
  const result = await openSeaPost(apiKey, "/offers", {
    protocol_data: protocolData,
    criteria: { collection: { slug: COLLECTION_SLUG } },
    protocol_address: protocolAddress,
  });
  return tradeJson({ status: "submitted", result });
}

export async function handleCancelOrder(context: Parameters<PagesFunction<OpenSeaTradeEnv>>[0], actionName: "cancel_offer" | "cancel_listing"): Promise<Response> {
  const body = await context.request.json() as Record<string, unknown>;
  const orderHash = asString(body.orderHash);
  const protocolAddress = asString(body.protocolAddress);
  if (!orderHash || !protocolAddress) return tradeJson({ error: "missing_order" }, { status: 400 });
  const apiKey = requireOpenSeaApiKey(context.env);
  const result = await openSeaPost(
    apiKey,
    `/orders/chain/${BASE_CHAIN}/protocol/${encodeURIComponent(protocolAddress)}/${encodeURIComponent(orderHash)}/cancel`,
    { offererSignature: asString(body.offererSignature) ?? "" },
  );
  await logTradeAction(context.env, {
    actionId: asString(body.actionId) ?? crypto.randomUUID(),
    actionName,
    status: "submitted",
    phase: "signature_success",
    tokenId: asString(body.tokenId),
    walletFrom: asString(body.wallet),
    orderHash,
    protocolAddress,
  });
  if (actionName === "cancel_offer") {
    await deactivateActiveItemOffer(context.env, orderHash).catch((error) =>
      console.error("Failed to deactivate canceled offer", error),
    );
  }
  return tradeJson({ status: "submitted", result });
}

export async function handleCancelPrepare(context: Parameters<PagesFunction<OpenSeaTradeEnv>>[0], actionName: "cancel_offer" | "cancel_listing"): Promise<Response> {
  const body = await context.request.json() as Record<string, unknown>;
  const orderHash = asString(body.orderHash);
  const protocolAddress = asString(body.protocolAddress);
  if (!orderHash || !protocolAddress) return tradeJson({ error: "missing_order" }, { status: 400 });
  const actionId = asString(body.actionId) ?? crypto.randomUUID();
  await logTradeAction(context.env, {
    actionId,
    actionName,
    status: "requested",
    phase: "prepare_requested",
    tokenId: asString(body.tokenId),
    walletFrom: asString(body.wallet),
    orderHash,
    protocolAddress,
  });
  const apiKey = requireOpenSeaApiKey(context.env);
  const payload = await fetchOpenSea(
    `/orders/chain/${BASE_CHAIN}/protocol/${encodeURIComponent(protocolAddress)}/${encodeURIComponent(orderHash)}`,
    apiKey,
  );
  const order = asObject(payload.order) ?? payload;
  const protocolData = asObject(order.protocol_data) ?? asObject(order.protocolData);
  const orderParameters = asObject(protocolData?.parameters) ?? asObject(order.parameters);
  if (!orderParameters) {
    return tradeJson({ error: "missing_order_parameters", message: "OpenSea order response did not include Seaport order parameters." }, { status: 502 });
  }
  const resolvedProtocolAddress = normalizeAddress(protocolData?.address ?? order.protocol_address ?? order.protocolAddress) ?? protocolAddress;
  return tradeJson({
    status: "ready",
    actionId,
    orderHash,
    protocolAddress: resolvedProtocolAddress,
    orderParameters,
    chainIdHex: BASE_CHAIN_ID_HEX,
  });
}

export async function handleTradeLog(context: Parameters<PagesFunction<OpenSeaTradeEnv>>[0]): Promise<Response> {
  const body = await context.request.json() as TradeActionLogInput;
  await logTradeAction(context.env, body);
  if (body.phase === "confirmed") {
    const actionName = asString(body.actionName);
    const tokenId = asString(body.tokenId);
    const numericTokenId = tokenId ? Number(tokenId) : null;
    const walletFrom = normalizeAddress(body.walletFrom);
    const walletTo = normalizeAddress(body.walletTo);
    const priceRaw = asString(body.actualPriceRaw) ?? asString(body.expectedPriceRaw);
    if (actionName === "buy" && tokenId && walletFrom && body.transactionHash) {
      if (
        numericTokenId !== null &&
        Number.isInteger(numericTokenId) &&
        numericTokenId >= 1 &&
        numericTokenId <= 10_000
      ) {
        const verifiedOwner = await ownerOf(numericTokenId).catch(() => null);
        if (verifiedOwner === walletFrom) {
          const previousOwner = await context.env.WARPLETS.prepare(
            "SELECT owner_wallet FROM warplet_market_state WHERE token_id = ?",
          )
            .bind(numericTokenId)
            .first<{ owner_wallet: string | null }>()
            .catch(() => null);
          const previousOwnerWallet = normalizeAddress(previousOwner?.owner_wallet);
          const ownerFid = await selectPreferredFidForWallet(context.env, walletFrom);
          const now = new Date().toISOString();
          await upsertMarketStateIfChanged(context.env.WARPLETS, {
            token_id: numericTokenId,
            owner_wallet: walletFrom,
            owner_fid: ownerFid,
            owner_checked_at: now,
            owner_event_at: now,
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
          if (previousOwnerWallet !== walletFrom) {
            await refreshHolderLeaderboardWallets(context.env.WARPLETS, [
              previousOwnerWallet,
              walletFrom,
            ]);
          }
        }
      }
      await recordWarpletActivity(context.env, {
        eventType: "purchased",
        tokenId,
        actorWallet: walletFrom,
        actorFid: body.fid ?? null,
        counterpartyWallet: walletTo,
        amountEth: rawEthToNumber(priceRaw),
        amountRaw: priceRaw,
        currencySymbol: "ETH",
        orderHash: asString(body.orderHash),
        transactionHash: asString(body.transactionHash),
        source: "search:trade",
        rawPayload: body.rawPayload ?? body,
      }).catch((error) => console.error("Failed to record buy confirmation activity", error));
    }
    if (actionName === "accept_offer" && tokenId && walletFrom && body.transactionHash) {
      await recordWarpletActivity(context.env, {
        eventType: "sold",
        tokenId,
        actorWallet: walletFrom,
        actorFid: body.fid ?? null,
        counterpartyWallet: walletTo,
        amountEth: rawEthToNumber(priceRaw),
        amountRaw: priceRaw,
        currencySymbol: "WETH",
        orderHash: asString(body.orderHash),
        transactionHash: asString(body.transactionHash),
        source: "search:trade",
        rawPayload: body.rawPayload ?? body,
      }).catch((error) => console.error("Failed to record accept-offer confirmation activity", error));
    }
  }
  return tradeJson({ ok: true });
}
