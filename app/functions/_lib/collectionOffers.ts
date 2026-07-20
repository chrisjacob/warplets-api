import {
  asArray,
  asNumber,
  asObject,
  asString,
  classifyOpenSeaOffer,
  fetchOpenSea,
  isEthLikeCurrency,
  marketJson,
  normalizeAddress,
  selectPreferredFidForWallet,
  upsertCriteriaOfferFromRow,
  weiToNumber,
  type MarketMoney,
  type OpenSeaMarketEnv,
} from "./openseaMarket.js";
import { jsonSecure } from "./security.js";
import { recordWarpletActivity } from "./warpletNotifications.js";

export type CollectionOffersEnv = OpenSeaMarketEnv;

type CollectionOfferRow = {
  order_hash: string;
  collection_slug: string;
  criteria_kind: "collection";
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
};

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

function requireOpenSeaApiKey(env: CollectionOffersEnv): string {
  const apiKey = env.OPENSEA_API_KEY?.trim();
  if (!apiKey) throw new Error("OPENSEA_API_KEY is not configured");
  return apiKey;
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
    asObject(payload.parameters) ??
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
  const hex = asString(payload.result);
  return hex ? BigInt(hex).toString() : "0";
}

async function fetchCollectionFees(apiKey: string): Promise<Array<{ recipient: string; bps: number }>> {
  const payload = await fetchOpenSea(`/collections/${COLLECTION_SLUG}`, apiKey);
  return asArray(payload.fees ?? asObject(payload.collection)?.fees)
    .map((row) => {
      const fee = asObject(row);
      const recipient = normalizeAddress(fee?.recipient);
      const percent = asNumber(fee?.fee);
      return recipient && percent != null && percent > 0 ? { recipient, bps: Math.round(percent * 100) } : null;
    })
    .filter((fee): fee is { recipient: string; bps: number } => Boolean(fee));
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
}): { parameters: Record<string, unknown>; typedData: Record<string, unknown>; totalRaw: string } {
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
    zoneHash: asString(parametersFromBuild?.zoneHash) ?? ZERO_HASH,
    salt: randomUint256String(),
    conduitKey: asString(parametersFromBuild?.conduitKey) ?? OPENSEA_CONDUIT_KEY,
    counter: input.counter,
  };
  return {
    parameters,
    totalRaw,
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

async function loadBidderProfiles(env: CollectionOffersEnv, wallets: string[], apiKey: string): Promise<Map<string, BidderProfile>> {
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

  const missing = normalized.filter((wallet) => {
    const current = profiles.get(wallet);
    return !current?.pfpUrl || !current?.xUsername;
  }).slice(0, 30);
  await Promise.all(missing.map(async (wallet) => {
    const current = profiles.get(wallet);
    try {
      const account = await fetchOpenSea(`/accounts/${encodeURIComponent(wallet)}`, apiKey);
      const pfpUrl = asString(account.profile_image_url ?? account.profileImageUrl ?? account.image_url);
      const openseaUsername = asString(account.username ?? asObject(account.user)?.username);
      const fid = current?.fid ?? await selectPreferredFidForWallet(env, wallet);
      let xUsername = current?.xUsername ?? null;
      if (!xUsername && fid != null) {
        xUsername = await env.WARPLETS.prepare(
          "SELECT x_username FROM warplets_users WHERE fid = ? LIMIT 1",
        ).bind(fid).first<{ x_username: string | null }>()
          .then((row) => normalizeSocialUsername(row?.x_username))
          .catch(() => null);
      }
      profiles.set(wallet, buildBidderProfile({
        wallet,
        fid,
        username: current?.username ?? null,
        displayName: current?.displayName ?? asString(account.display_name ?? account.name),
        pfpUrl: current?.pfpUrl ?? pfpUrl,
        xUsername,
        openseaUsername,
      }));
    } catch {
      profiles.set(wallet, current ?? buildBidderProfile({
        wallet,
        fid: null,
        username: null,
        displayName: null,
        pfpUrl: null,
      }));
    }
  }));
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
  const profiles = await loadBidderProfiles(context.env, wallets, apiKey);
  const offers = rows
    .reduce<CollectionOffer[]>((items, row) => {
      const offerer = normalizeAddress(row.offerer_wallet);
      if (!offerer) return items;
      const profile = profiles.get(offerer) ?? buildBidderProfile({ wallet: offerer });
      items.push({
        orderHash: row.order_hash,
        protocolAddress: row.protocol_address,
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
  const body = await context.request.json() as Record<string, unknown>;
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
  const apiKey = requireOpenSeaApiKey(context.env);
  const [counter, fees, built] = await Promise.all([
    fetchSeaportCounter(wallet),
    fetchCollectionFees(apiKey),
    openSeaPost(apiKey, "/offers/build", {
      offerer: wallet,
      quantity,
      criteria: { collection: { slug: COLLECTION_SLUG } },
      protocol_address: DEFAULT_SEAPORT_PROTOCOL,
      offer_protection_enabled: true,
    }).catch(() => null),
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
    wethApproval: { tokenAddress: BASE_WETH, spender: OPENSEA_CONDUIT_ADDRESS, amount: order.totalRaw },
    totalRaw: order.totalRaw,
  });
}

export async function handleCollectionOfferSubmit(context: Parameters<PagesFunction<CollectionOffersEnv>>[0]): Promise<Response> {
  const body = await context.request.json() as Record<string, unknown>;
  const payload = asObject(body.payload) ?? body;
  const parameters = asObject(payload.parameters);
  const signature = asString(payload.signature);
  const protocolAddress = normalizeAddress(payload.protocol_address) ?? DEFAULT_SEAPORT_PROTOCOL;
  if (!parameters || !signature) return jsonSecure({ error: "missing_signature" }, { status: 400 });
  const apiKey = requireOpenSeaApiKey(context.env);
  let result: Record<string, unknown>;
  try {
    result = await openSeaPost(apiKey, "/offers", {
      protocol_data: { parameters, signature },
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
    const row = { ...result, order_hash: orderHash, protocol_address: protocolAddress, protocol_data: { parameters, signature }, status: "ACTIVE", remaining_quantity: quantity };
    await upsertCriteriaOfferFromRow(context.env, row, { recordActivity: false }).catch(() => false);
    await updateCollectionOfferDisplayFields(context.env, row);
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
      source: "search:collection-offers",
      rawPayload: { actionId: asString(body.actionId), quantity, result },
    }).catch((error) => console.error("Failed to record collection offer submit activity", error));
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
  const orderParameters = await Promise.all(orders.map((order) => loadOrderParameters(apiKey, order.orderHash, order.protocolAddress)));
  return jsonSecure({
    status: "ready",
    actionId: asString(body.actionId) ?? crypto.randomUUID(),
    orders,
    protocolAddress: orders[0]?.protocolAddress ?? DEFAULT_SEAPORT_PROTOCOL,
    orderParameters,
    chainIdHex: BASE_CHAIN_ID_HEX,
  });
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
