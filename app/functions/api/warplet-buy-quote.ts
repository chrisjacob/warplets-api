/**
 * POST /api/warplet-buy-quote
 *
 * Resolves the matched viewer's private OpenSea listing and returns the
 * transaction details needed to fulfill it from Farcaster Wallet on Base.
 *
 * Body: { fid: number }
 */

import { encodeFunctionData, getAddress, toHex } from "viem";

interface Env {
  WARPLETS: D1Database;
  NEYNAR_API_KEY?: string;
  OPENSEA_API_KEY?: string;
}

interface RequestBody {
  fid?: unknown;
}

type NeynarUserRecord = {
  primary_eth_address?: string;
};

type WarpletUserRow = {
  id: number;
  primary_eth_address: string | null;
};

type WarpletMatchRow = {
  x10_rarity: number | null;
};

type OpenSeaAccount = {
  address?: string;
};

type OpenSeaOfferItem = {
  itemType?: number | string;
  token?: string;
  identifierOrCriteria?: string;
  startAmount?: string;
  endAmount?: string;
};

type OpenSeaConsiderationItem = OpenSeaOfferItem & {
  recipient?: string;
};

type OpenSeaOrderParameters = {
  offerer?: string;
  zone?: string;
  offer?: OpenSeaOfferItem[];
  consideration?: OpenSeaConsiderationItem[];
  orderType?: number | string;
  startTime?: string;
  endTime?: string;
  zoneHash?: string;
  salt?: string;
  conduitKey?: string;
  totalOriginalConsiderationItems?: number | string;
};

type OpenSeaProtocolData = {
  parameters?: OpenSeaOrderParameters;
  signature?: string;
};

type OpenSeaListing = {
  order_hash?: string;
  protocol_address?: string;
  maker?: OpenSeaAccount | null;
  taker?: OpenSeaAccount | null;
  protocol_data?: OpenSeaProtocolData | null;
};

type OpenSeaListingsResponse = {
  orders?: OpenSeaListing[];
};

type MatchOrdersFulfillment = {
  offerComponents: Array<{ orderIndex: bigint; itemIndex: bigint }>;
  considerationComponents: Array<{ orderIndex: bigint; itemIndex: bigint }>;
};

type ContractOfferItem = {
  itemType: number;
  token: `0x${string}`;
  identifierOrCriteria: bigint;
  startAmount: bigint;
  endAmount: bigint;
};

type ContractConsiderationItem = ContractOfferItem & {
  recipient: `0x${string}`;
};

type ContractOrder = {
  parameters: {
    offerer: `0x${string}`;
    zone: `0x${string}`;
    offer: ContractOfferItem[];
    consideration: ContractConsiderationItem[];
    orderType: number;
    startTime: bigint;
    endTime: bigint;
    zoneHash: `0x${string}`;
    salt: bigint;
    conduitKey: `0x${string}`;
    totalOriginalConsiderationItems: bigint;
  };
  signature: `0x${string}`;
};

const NEYNAR_VIEWER_FID = 1129138;
const OPENSEA_API_BASE = "https://api.opensea.io/api/v2";
const BASE_CHAIN = "base";
const BASE_CHAIN_ID_HEX = "0x2105";
const COLLECTION_CONTRACT = "0x780446dd12e080ae0db762fcd4daf313f3e359de";
const DISTRIBUTION_WALLET = "0x4709a4b12daf0eedae0ef48a28a056640dee0846";
const BASE_USDC = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";
const ZERO_BYTES32 = `0x${"0".repeat(64)}` as const;

const matchOrdersAbi = [
  {
    type: "function",
    name: "matchOrders",
    stateMutability: "payable",
    inputs: [
      {
        name: "orders",
        type: "tuple[]",
        components: [
          {
            name: "parameters",
            type: "tuple",
            components: [
              { name: "offerer", type: "address" },
              { name: "zone", type: "address" },
              {
                name: "offer",
                type: "tuple[]",
                components: [
                  { name: "itemType", type: "uint8" },
                  { name: "token", type: "address" },
                  { name: "identifierOrCriteria", type: "uint256" },
                  { name: "startAmount", type: "uint256" },
                  { name: "endAmount", type: "uint256" },
                ],
              },
              {
                name: "consideration",
                type: "tuple[]",
                components: [
                  { name: "itemType", type: "uint8" },
                  { name: "token", type: "address" },
                  { name: "identifierOrCriteria", type: "uint256" },
                  { name: "startAmount", type: "uint256" },
                  { name: "endAmount", type: "uint256" },
                  { name: "recipient", type: "address" },
                ],
              },
              { name: "orderType", type: "uint8" },
              { name: "startTime", type: "uint256" },
              { name: "endTime", type: "uint256" },
              { name: "zoneHash", type: "bytes32" },
              { name: "salt", type: "uint256" },
              { name: "conduitKey", type: "bytes32" },
              { name: "totalOriginalConsiderationItems", type: "uint256" },
            ],
          },
          { name: "signature", type: "bytes" },
        ],
      },
      {
        name: "fulfillments",
        type: "tuple[]",
        components: [
          {
            name: "offerComponents",
            type: "tuple[]",
            components: [
              { name: "orderIndex", type: "uint256" },
              { name: "itemIndex", type: "uint256" },
            ],
          },
          {
            name: "considerationComponents",
            type: "tuple[]",
            components: [
              { name: "orderIndex", type: "uint256" },
              { name: "itemIndex", type: "uint256" },
            ],
          },
        ],
      },
    ],
    outputs: [],
  },
] as const;

function asObject(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : undefined;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function toPositiveInteger(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : null;
}

function toBigIntValue(value: string | number | bigint | undefined, fallback = 0n): bigint {
  if (typeof value === "bigint") return value;
  if (typeof value === "number") return BigInt(value);
  if (typeof value === "string" && value.length > 0) return BigInt(value);
  return fallback;
}

function toAddress(value: string | undefined, label: string): `0x${string}` {
  const address = asString(value);
  if (!address) {
    throw new Error(`${label} is missing`);
  }
  return getAddress(address);
}

function normalizeHex32(value: string | undefined, label: string): `0x${string}` {
  const hex = asString(value);
  if (!hex || !/^0x[0-9a-fA-F]{64}$/.test(hex)) {
    throw new Error(`${label} is invalid`);
  }
  return hex.toLowerCase() as `0x${string}`;
}

function randomSalt(): bigint {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  const hex = Array.from(bytes, byte => byte.toString(16).padStart(2, "0")).join("");
  return BigInt(`0x${hex}`);
}

async function fetchNeynarUserByFid(
  fid: number,
  neynarApiKey?: string
): Promise<NeynarUserRecord | undefined> {
  const apiKey = neynarApiKey?.trim();
  if (!apiKey) return undefined;

  try {
    const endpoint = `https://api.neynar.com/v2/farcaster/user/bulk?viewer_fid=${NEYNAR_VIEWER_FID}&fids=${fid}`;
    const res = await fetch(endpoint, {
      headers: { "x-api-key": apiKey },
    });
    if (!res.ok) return undefined;

    const payload = (await res.json()) as Record<string, unknown>;
    const users = payload.users;
    if (!Array.isArray(users) || users.length === 0) return undefined;

    const user = asObject(users[0]);
    if (!user) return undefined;

    const verifiedAddresses = asObject(user.verified_addresses);
    const primaryAddresses = asObject(verifiedAddresses?.primary);

    return {
      primary_eth_address: asString(primaryAddresses?.eth_address),
    };
  } catch {
    return undefined;
  }
}

async function updatePrimaryEthAddress(
  env: Env,
  userId: number,
  primaryEthAddress: string
): Promise<void> {
  await env.WARPLETS.prepare(
    "UPDATE warplets_users SET primary_eth_address = ?, updated_on = ? WHERE id = ?"
  )
    .bind(primaryEthAddress, new Date().toISOString(), userId)
    .run();
}

async function fetchPrivateListings(
  tokenId: string,
  buyerAddress: string,
  openseaApiKey?: string
): Promise<OpenSeaListing[]> {
  const params = new URLSearchParams({
    asset_contract_address: COLLECTION_CONTRACT,
    token_ids: tokenId,
    maker: DISTRIBUTION_WALLET,
    taker: buyerAddress,
    limit: "50",
    include_private_listings: "true",
  });

  const res = await fetch(`${OPENSEA_API_BASE}/orders/${BASE_CHAIN}/seaport/listings?${params}`, {
    headers: {
      accept: "application/json",
      ...(openseaApiKey?.trim() ? { "x-api-key": openseaApiKey.trim() } : {}),
    },
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`OpenSea listing lookup failed (${res.status}): ${body || "unknown error"}`);
  }

  const data = (await res.json()) as OpenSeaListingsResponse;
  const orders = data.orders ?? [];
  return orders.filter(order => {
    const maker = order.maker?.address?.toLowerCase();
    const taker = order.taker?.address?.toLowerCase();
    return maker === DISTRIBUTION_WALLET.toLowerCase() && taker === buyerAddress.toLowerCase();
  });
}

function getListingPrice(listing: OpenSeaListing): bigint {
  const consideration = listing.protocol_data?.parameters?.consideration ?? [];
  return consideration.reduce((sum, item) => {
    const itemType = Number(item.itemType ?? 0);
    if (isCurrencyItem(itemType)) {
      return sum + toBigIntValue(item.startAmount);
    }
    return sum;
  }, 0n);
}

function selectCheapestActiveListing(listings: OpenSeaListing[]): OpenSeaListing | null {
  const nowSec = BigInt(Math.floor(Date.now() / 1000));

  const active = listings.filter(listing => {
    const endTime = toBigIntValue(listing.protocol_data?.parameters?.endTime, 0n);
    // endTime === 0n means no expiry; otherwise must be in the future
    return endTime === 0n || endTime > nowSec;
  });

  if (active.length === 0) return null;

  return active.reduce((cheapest, current) =>
    getListingPrice(current) < getListingPrice(cheapest) ? current : cheapest
  );
}

function isCurrencyItem(itemType: number): boolean {
  return itemType === 0 || itemType === 1;
}

function toContractOfferItem(item: OpenSeaOfferItem): ContractOfferItem {
  return {
    itemType: Number(item.itemType ?? 0),
    token: toAddress(item.token, "Offer item token"),
    identifierOrCriteria: toBigIntValue(item.identifierOrCriteria),
    startAmount: toBigIntValue(item.startAmount),
    endAmount: toBigIntValue(item.endAmount),
  };
}

function toContractConsiderationItem(item: OpenSeaConsiderationItem): ContractConsiderationItem {
  return {
    ...toContractOfferItem(item),
    recipient: toAddress(item.recipient, "Consideration recipient"),
  };
}

function toContractOrder(protocolData: OpenSeaProtocolData | undefined): ContractOrder {
  const parameters = protocolData?.parameters;
  if (!parameters) {
    throw new Error("Listing protocol data is missing parameters");
  }

  return {
    parameters: {
      offerer: toAddress(parameters.offerer, "Order offerer"),
      zone: toAddress(parameters.zone, "Order zone"),
      offer: (parameters.offer ?? []).map(toContractOfferItem),
      consideration: (parameters.consideration ?? []).map(toContractConsiderationItem),
      orderType: Number(parameters.orderType ?? 0),
      startTime: toBigIntValue(parameters.startTime),
      endTime: toBigIntValue(parameters.endTime),
      zoneHash: normalizeHex32(parameters.zoneHash, "Order zoneHash"),
      salt: toBigIntValue(parameters.salt),
      conduitKey: normalizeHex32(parameters.conduitKey, "Order conduitKey"),
      totalOriginalConsiderationItems: toBigIntValue(parameters.totalOriginalConsiderationItems),
    },
    signature: (asString(protocolData?.signature) ?? "0x") as `0x${string}`,
  };
}

function constructPrivateListingCounterOrder(
  order: ContractOrder,
  buyerAddress: `0x${string}`
): { counterOrder: ContractOrder; paymentItems: ContractConsiderationItem[] } {
  const paymentItems = order.parameters.consideration.filter(
    item => item.recipient.toLowerCase() !== buyerAddress.toLowerCase()
  );

  if (paymentItems.length > 0) {
    if (!paymentItems.every(item => isCurrencyItem(item.itemType))) {
      throw new Error("Private listing consideration contains non-currency payment items");
    }
    if (!paymentItems.every(item => item.itemType === paymentItems[0].itemType)) {
      throw new Error("Private listing payment items do not share the same item type");
    }
    if (!paymentItems.every(item => item.token.toLowerCase() === paymentItems[0].token.toLowerCase())) {
      throw new Error("Private listing payment items do not share the same token");
    }
  }

  const aggregatedStartAmount = paymentItems.reduce((sum, item) => sum + item.startAmount, 0n);
  const aggregatedEndAmount = paymentItems.reduce((sum, item) => sum + item.endAmount, 0n);

  const counterOrder: ContractOrder = {
    parameters: {
      offerer: buyerAddress,
      zone: order.parameters.zone,
      offer:
        paymentItems.length > 0
          ? [
              {
                itemType: paymentItems[0].itemType,
                token: paymentItems[0].token,
                identifierOrCriteria: paymentItems[0].identifierOrCriteria,
                startAmount: aggregatedStartAmount,
                endAmount: aggregatedEndAmount,
              },
            ]
          : [],
      consideration: [],
      orderType: order.parameters.orderType,
      startTime: order.parameters.startTime,
      endTime: order.parameters.endTime,
      zoneHash: order.parameters.zoneHash,
      salt: randomSalt(),
      conduitKey: order.parameters.conduitKey,
      totalOriginalConsiderationItems: 0n,
    },
    signature: "0x",
  };

  return { counterOrder, paymentItems };
}

function getPrivateListingFulfillments(order: ContractOrder): MatchOrdersFulfillment[] {
  const nftRelatedFulfillments: MatchOrdersFulfillment[] = [];

  order.parameters.offer.forEach((offerItem, offerIndex) => {
    const considerationIndex = order.parameters.consideration.findIndex(
      considerationItem =>
        considerationItem.itemType === offerItem.itemType &&
        considerationItem.token.toLowerCase() === offerItem.token.toLowerCase() &&
        considerationItem.identifierOrCriteria === offerItem.identifierOrCriteria
    );

    if (considerationIndex === -1) {
      throw new Error("Could not match offered NFT item to private listing consideration");
    }

    nftRelatedFulfillments.push({
      offerComponents: [{ orderIndex: 0n, itemIndex: BigInt(offerIndex) }],
      considerationComponents: [{ orderIndex: 0n, itemIndex: BigInt(considerationIndex) }],
    });
  });

  const currencyRelatedFulfillments: MatchOrdersFulfillment[] = [];
  order.parameters.consideration.forEach((considerationItem, considerationIndex) => {
    if (!isCurrencyItem(considerationItem.itemType)) {
      return;
    }

    currencyRelatedFulfillments.push({
      offerComponents: [{ orderIndex: 1n, itemIndex: 0n }],
      considerationComponents: [{ orderIndex: 0n, itemIndex: BigInt(considerationIndex) }],
    });
  });

  return [...nftRelatedFulfillments, ...currencyRelatedFulfillments];
}

export const onRequestPost: PagesFunction<Env> = async (context) => {
  let body: RequestBody = {};
  try {
    body = (await context.request.json()) as RequestBody;
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const fid = toPositiveInteger(body.fid);
  if (!fid) {
    return Response.json({ error: "fid is required" }, { status: 400 });
  }

  const matchRow = await context.env.WARPLETS.prepare(
    "SELECT x10_rarity FROM warplets_metadata WHERE fid_value = ? LIMIT 1"
  )
    .bind(fid)
    .first<WarpletMatchRow>();

  const rarityValue = typeof matchRow?.x10_rarity === "number" ? matchRow.x10_rarity : null;
  if (rarityValue === null) {
    return Response.json({ error: "This user does not have a private Warplet allocation" }, { status: 404 });
  }

  const userRow = await context.env.WARPLETS.prepare(
    "SELECT id, primary_eth_address FROM warplets_users WHERE fid = ? LIMIT 1"
  )
    .bind(fid)
    .first<WarpletUserRow>();

  if (!userRow) {
    return Response.json({ error: "Viewer record not found. Refresh status first." }, { status: 404 });
  }

  let buyerAddress = userRow.primary_eth_address ?? undefined;
  const neynarUser = await fetchNeynarUserByFid(fid, context.env.NEYNAR_API_KEY);
  if (neynarUser?.primary_eth_address) {
    const normalized = getAddress(neynarUser.primary_eth_address);
    if (buyerAddress?.toLowerCase() !== normalized.toLowerCase()) {
      await updatePrimaryEthAddress(context.env, userRow.id, normalized);
    }
    buyerAddress = normalized;
  }

  if (!buyerAddress) {
    return Response.json({ error: "No primary Farcaster wallet is available for this user" }, { status: 400 });
  }

  let listing: OpenSeaListing | null;
  try {
    const listings = await fetchPrivateListings(String(rarityValue), buyerAddress, context.env.OPENSEA_API_KEY);
    listing = selectCheapestActiveListing(listings);
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Failed to look up the private listing" },
      { status: 502 }
    );
  }

  if (!listing) {
    return Response.json({ error: "No active private listing was found for this user" }, { status: 404 });
  }

  if (!listing.taker?.address) {
    return Response.json({ error: "The matching listing is not a private listing" }, { status: 409 });
  }

  try {
    const normalizedBuyerAddress = getAddress(buyerAddress);
    const order = toContractOrder(listing.protocol_data ?? undefined);
    const { counterOrder, paymentItems } = constructPrivateListingCounterOrder(order, normalizedBuyerAddress);
    const fulfillments = getPrivateListingFulfillments(order);

    if (paymentItems.length === 0) {
      return Response.json({ error: "The private listing has no payment items" }, { status: 409 });
    }

    if (paymentItems[0].itemType !== 1) {
      return Response.json({ error: "The private listing is not denominated in an ERC20 token" }, { status: 409 });
    }

    const paymentToken = getAddress(paymentItems[0].token);
    if (paymentToken.toLowerCase() !== BASE_USDC.toLowerCase()) {
      return Response.json({ error: "The private listing is not priced in Base USDC" }, { status: 409 });
    }

    const approvalAmount = paymentItems.reduce((sum, item) => sum + item.startAmount, 0n);
    const data = encodeFunctionData({
      abi: matchOrdersAbi,
      functionName: "matchOrders",
      args: [[order, counterOrder], fulfillments],
    });

    return Response.json({
      fid,
      rarityValue,
      buyerAddress: normalizedBuyerAddress,
      listing: {
        orderHash: listing.order_hash ?? null,
        tokenId: String(rarityValue),
        makerAddress: listing.maker?.address ?? null,
        takerAddress: listing.taker?.address ?? null,
        price: approvalAmount.toString(),
        currencyAddress: paymentToken,
        openseaUrl: `https://opensea.io/item/base/${COLLECTION_CONTRACT}/${rarityValue}`,
      },
      approval: {
        tokenAddress: paymentToken,
        spender: getAddress(listing.protocol_address ?? order.parameters.zone),
        amount: approvalAmount.toString(),
      },
      transaction: {
        chainIdHex: BASE_CHAIN_ID_HEX,
        to: getAddress(listing.protocol_address ?? order.parameters.zone),
        data,
        value: toHex(0n),
      },
    });
  } catch (error) {
    console.error("[warplet-buy-quote] failed to build transaction", error);
    return Response.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to build the private listing purchase transaction",
      },
      { status: 500 }
    );
  }
};