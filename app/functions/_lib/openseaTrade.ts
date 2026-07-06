import {
  asArray,
  asNumber,
  asObject,
  asString,
  clearTokenMarketSide,
  fetchOpenSea,
  getMakerAddress,
  getPrice,
  hasCurrencyValue,
  loadOneTokenSnapshot,
  normalizeAddress,
  normalizeTimestamp,
  ownerOf,
  processListing,
  processOffer,
  publishMarketSnapshot,
  selectPreferredFidForWallet,
  type MarketMoney,
  type MarketOrderMoney,
  type OpenSeaMarketEnv,
} from "./openseaMarket.js";
import { jsonSecure } from "./security.js";

export type OpenSeaTradeEnv = OpenSeaMarketEnv;

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
const BASE_CHAIN_ID_HEX = "0x2105";
const COLLECTION_SLUG = "10xwarplets";
const COLLECTION_CONTRACT = "0x780446dd12e080ae0db762fcd4daf313f3e359de";
const DEFAULT_SEAPORT_PROTOCOL = "0x0000000000000068f116a894984e2db1123eb395";
const BASE_WETH = "0x4200000000000000000000000000000000000006";
const NATIVE_ETH = "0x0000000000000000000000000000000000000000";

type FreshOrder = MarketOrderMoney & {
  source?: "item" | "collection";
  seller?: string | null;
  offerer?: string | null;
  protocolData?: unknown;
};

type FreshTradeState = {
  tokenId: number;
  generatedAt: string;
  listing: (FreshOrder & { seller: string | null }) | null;
  itemOffer: (FreshOrder & { offerer: string | null; source: "item" }) | null;
  collectionOffer: (FreshOrder & { offerer: string | null; source: "collection" }) | null;
  topOffer: (FreshOrder & { offerer: string | null; source: "item" | "collection" }) | null;
  ownItemOffer: (FreshOrder & { offerer: string | null; source: "item" }) | null;
  floor: MarketMoney | null;
  owner: {
    wallet: string | null;
    fid: number | null;
    checkedAt: string | null;
  };
  snapshot?: unknown;
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
    at: normalizeTimestamp(row.created_date ?? row.listed_at ?? row.offered_at ?? row.event_timestamp),
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

function chooseTopOffer(
  itemOffer: FreshTradeState["itemOffer"],
  collectionOffer: FreshTradeState["collectionOffer"],
): FreshTradeState["topOffer"] {
  if (!itemOffer) return collectionOffer;
  if (!collectionOffer) return itemOffer;
  const itemValue = comparableMarketValue(itemOffer);
  const collectionValue = comparableMarketValue(collectionOffer);
  if (itemValue == null) return collectionOffer;
  if (collectionValue == null) return itemOffer;
  return itemValue >= collectionValue ? itemOffer : collectionOffer;
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
    const payload = await fetchOpenSea(`/offers/collection/${COLLECTION_SLUG}/nfts/${encodeURIComponent(String(tokenId))}/best`, apiKey);
    const row = asObject(payload.offer) ?? payload;
    const market = orderToMarket({ ...row, identifier: String(tokenId) }, "offer") as FreshTradeState["itemOffer"];
    return market ? { row, market: { ...market, source: "item" } } : null;
  } catch {
    return null;
  }
}

async function fetchCollectionOffer(apiKey: string): Promise<{ row: Record<string, unknown>; market: FreshTradeState["collectionOffer"] } | null> {
  try {
    const payload = await fetchOpenSea(`/offers/collection/${COLLECTION_SLUG}`, apiKey, new URLSearchParams({ limit: "200" }));
    const rows = asArray(payload.offers ?? payload.orders)
      .map((item) => asObject(item))
      .filter((item): item is Record<string, unknown> => Boolean(item));
    const best = rows.reduce<{ row: Record<string, unknown>; market: FreshTradeState["collectionOffer"]; value: number } | null>((current, row) => {
      const market = orderToMarket(row, "offer") as FreshTradeState["collectionOffer"];
      if (!market) return current;
      const value = comparableMarketValue(market);
      if (value == null) return current;
      const next = { row, market: { ...market, source: "collection" as const }, value };
      return !current || value > current.value ? next : current;
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
      .map((row) => orderToMarket({ ...row, identifier: String(tokenId) }, "offer") as FreshTradeState["ownItemOffer"])
      .filter((offer): offer is NonNullable<FreshTradeState["ownItemOffer"]> => Boolean(offer && offer.offerer?.toLowerCase() === normalizedWallet));
    owned.sort((a, b) => (comparableMarketValue(b) ?? -1) - (comparableMarketValue(a) ?? -1));
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

export async function getFreshTradeState(env: OpenSeaTradeEnv, tokenId: number, wallet?: string | null): Promise<FreshTradeState> {
  const apiKey = requireOpenSeaApiKey(env);
  const normalizedWallet = normalizeWallet(wallet);
  const [listing, itemOffer, collectionOffer, floor, ownerWallet, ownItemOffer] = await Promise.all([
    fetchBestListing(apiKey, tokenId),
    fetchBestItemOffer(apiKey, tokenId),
    fetchCollectionOffer(apiKey),
    fetchFloor(apiKey),
    ownerOf(tokenId).catch(() => null),
    fetchOwnItemOffer(apiKey, tokenId, normalizedWallet),
  ]);

  if (listing?.row && listing.market) {
    await processListing(env, { ...listing.row, identifier: String(tokenId) });
  } else {
    await clearTokenMarketSide(env, tokenId, "listing");
  }
  if (itemOffer?.row && itemOffer.market) {
    await processOffer(env, { ...itemOffer.row, identifier: String(tokenId) });
  } else {
    await clearTokenMarketSide(env, tokenId, "offer");
  }
  await persistCollectionTradeState(env, floor, collectionOffer?.market ?? null).catch(() => {});

  const now = new Date().toISOString();
  const ownerFid = ownerWallet ? await selectPreferredFidForWallet(env, ownerWallet) : null;
  if (ownerWallet) {
    await env.WARPLETS.prepare(
      `INSERT INTO warplet_market_state (token_id, owner_wallet, owner_fid, owner_checked_at, opensea_updated_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(token_id) DO UPDATE SET
         owner_wallet = excluded.owner_wallet,
         owner_fid = excluded.owner_fid,
         owner_checked_at = excluded.owner_checked_at,
         opensea_updated_at = excluded.opensea_updated_at,
         updated_at = excluded.updated_at`
    ).bind(tokenId, ownerWallet, ownerFid, now, now, now, now).run();
  }
  await publishMarketSnapshot(env).catch(() => null);

  return {
    tokenId,
    generatedAt: now,
    listing: listing?.market ?? null,
    itemOffer: itemOffer?.market ?? null,
    collectionOffer: collectionOffer?.market ?? null,
    topOffer: chooseTopOffer(itemOffer?.market ?? null, collectionOffer?.market ?? null),
    ownItemOffer,
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
  return tradeJson(await getFreshTradeState(context.env, tokenId, wallet));
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
  if (!state.topOffer || !pricesMatch(body.expectedRawAmount, body.expectedOrderHash, state.topOffer)) {
    await logTradeAction(context.env, { actionId, actionName: "accept_offer", status: "mismatch", phase: "fresh_state_mismatch", tokenId, walletFrom: wallet, expectedPriceRaw: asString(body.expectedRawAmount), actualPriceRaw: state.topOffer?.rawAmount ?? null, orderHash: state.topOffer?.orderHash ?? null });
    return tradeJson({ status: "mismatch", actionId, freshState: state }, { status: 409 });
  }
  const fulfillment = await prepareOfferFulfillment(apiKey, state.topOffer, wallet, tokenId);
  return tradeJson({
    status: "ready",
    actionId,
    state,
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
  const endTime = new Date(Date.now() + Math.max(60, Math.floor(durationSeconds)) * 1000).toISOString();
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
  const actionId = asString(body.actionId) ?? crypto.randomUUID();
  await logTradeAction(context.env, { actionId, actionName: "make_offer", status: "requested", phase: "prepare_requested", tokenId, walletFrom: wallet, expectedPriceRaw: priceRaw, paymentToken: BASE_WETH, paymentDecimals: 18 });
  const apiKey = requireOpenSeaApiKey(context.env);
  const now = Math.floor(Date.now() / 1000);
  const build = await openSeaPost(apiKey, "/offers/build", {
    offerer: wallet,
    quantity: 1,
    protocol_address: DEFAULT_SEAPORT_PROTOCOL,
    offer_protection_enabled: true,
    criteria: {
      collection: { slug: COLLECTION_SLUG },
      contract: { address: COLLECTION_CONTRACT },
      token: { identifier: String(tokenId) },
    },
    offer: {
      chain: BASE_CHAIN,
      currency: BASE_WETH,
      amount: priceRaw,
      start_time: now,
      end_time: now + Math.max(60, Math.floor(durationSeconds)),
    },
  });
  return tradeJson({ status: "ready", actionId, build, chainIdHex: BASE_CHAIN_ID_HEX, wethApproval: { tokenAddress: BASE_WETH, spender: "0x1e0049783f008a0085193e00003d00cd54003c71", amount: priceRaw } });
}

export async function handleListingSubmit(context: Parameters<PagesFunction<OpenSeaTradeEnv>>[0]): Promise<Response> {
  const body = await context.request.json() as Record<string, unknown>;
  const protocol = asString(body.protocol) ?? "seaport";
  const apiKey = requireOpenSeaApiKey(context.env);
  const payload = asObject(body.payload) ?? body;
  const result = await openSeaPost(apiKey, `/orders/${BASE_CHAIN}/${encodeURIComponent(protocol)}/listings`, payload);
  return tradeJson({ status: "submitted", result });
}

export async function handleOfferSubmit(context: Parameters<PagesFunction<OpenSeaTradeEnv>>[0]): Promise<Response> {
  const body = await context.request.json() as Record<string, unknown>;
  const apiKey = requireOpenSeaApiKey(context.env);
  const payload = asObject(body.payload) ?? body;
  const result = await openSeaPost(apiKey, "/offers", payload);
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
  return tradeJson({ ok: true });
}
