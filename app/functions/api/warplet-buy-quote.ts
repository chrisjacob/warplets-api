/**
 * POST /api/warplet-buy-quote
 *
 * Resolves the matched viewer's private OpenSea listing and returns the
 * raw listing data needed to build the Seaport matchOrders transaction.
 * ABI encoding is intentionally left to the frontend (App.tsx) so that
 * this function has zero npm dependencies and runs reliably on Pages.
 *
 * Body: { fid: number }
 */

// NO npm imports — this function is dependency-free.

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

const NEYNAR_VIEWER_FID = 1129138;
const OPENSEA_API_BASE = "https://api.opensea.io/api/v2";
const BASE_CHAIN = "base";
const BASE_CHAIN_ID_HEX = "0x2105";
const COLLECTION_CONTRACT = "0x780446dd12e080ae0db762fcd4daf313f3e359de";
const DISTRIBUTION_WALLET = "0x4709a4b12daf0eedae0ef48a28a056640dee0846";
const BASE_USDC = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";


function asObject(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : undefined;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

function toPositiveInteger(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : null;
}

/** Return a lowercase address string; throws if missing or malformed. */
function normalizeAddress(value: string | undefined, label: string): string {
  const addr = value?.trim();
  if (!addr || !/^0x[0-9a-fA-F]{40}$/.test(addr)) {
    throw new Error(`${label} is missing or invalid`);
  }
  return addr.toLowerCase();
}

function isCurrencyItem(itemType: number): boolean {
  return itemType === 0 || itemType === 1;
}

function toBigIntValue(value: string | number | bigint | undefined, fallback = 0n): bigint {
  if (typeof value === "bigint") return value;
  if (typeof value === "number") return BigInt(value);
  if (typeof value === "string" && value.length > 0) return BigInt(value);
  return fallback;
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
      signal: AbortSignal.timeout(8000),
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
  openseaApiKey: string
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
      "x-api-key": openseaApiKey,
      "X-API-KEY": openseaApiKey,
    },
    signal: AbortSignal.timeout(10000),
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


export const onRequestPost: PagesFunction<Env> = async (context) => {
  try {
    return await handleRequest(context);
  } catch (err) {
    console.error("[warplet-buy-quote] unhandled error", err);
    return Response.json(
      { error: err instanceof Error ? err.message : "Internal server error" },
      { status: 500 }
    );
  }
};

async function handleRequest(context: Parameters<PagesFunction<Env>>[0]): Promise<Response> {
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

  let buyerAddress = userRow.primary_eth_address?.toLowerCase() ?? undefined;
  const neynarUser = await fetchNeynarUserByFid(fid, context.env.NEYNAR_API_KEY);
  if (neynarUser?.primary_eth_address) {
    const fresh = neynarUser.primary_eth_address.toLowerCase();
    if (buyerAddress !== fresh) {
      await updatePrimaryEthAddress(context.env, userRow.id, neynarUser.primary_eth_address);
    }
    buyerAddress = fresh;
  }

  if (!buyerAddress) {
    return Response.json({ error: "No primary Farcaster wallet is available for this user" }, { status: 400 });
  }

  let listing: OpenSeaListing | null;
  const openseaApiKey = context.env.OPENSEA_API_KEY?.trim();
  if (!openseaApiKey) {
    return Response.json(
      { error: "OpenSea API key is not configured in this Pages environment" },
      { status: 503 }
    );
  }

  try {
    const listings = await fetchPrivateListings(String(rarityValue), buyerAddress, openseaApiKey);
    listing = selectCheapestActiveListing(listings);
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Failed to look up the private listing" },
      { status: 503 }
    );
  }

  if (!listing) {
    return Response.json({ error: "No active private listing was found for this user" }, { status: 404 });
  }

  if (!listing.taker?.address) {
    return Response.json({ error: "The matching listing is not a private listing" }, { status: 409 });
  }

  // Validate USDC payment items without viem — sum consideration items going to non-buyer
  const consideration = listing.protocol_data?.parameters?.consideration ?? [];
  const paymentItems = consideration.filter(item => {
    const recipient = (item.recipient ?? "").toLowerCase();
    const itemType = Number(item.itemType ?? 0);
    return recipient !== buyerAddress && isCurrencyItem(itemType);
  });

  if (paymentItems.length === 0) {
    return Response.json({ error: "The private listing has no payment items" }, { status: 409 });
  }

  const paymentItemType = Number(paymentItems[0].itemType ?? 0);
  if (paymentItemType !== 1) {
    return Response.json({ error: "The private listing is not denominated in an ERC20 token" }, { status: 409 });
  }

  const paymentToken = (paymentItems[0].token ?? "").toLowerCase();
  if (paymentToken !== BASE_USDC) {
    return Response.json({ error: "The private listing is not priced in Base USDC" }, { status: 409 });
  }

  const approvalAmount = paymentItems.reduce((sum, item) => sum + toBigIntValue(item.startAmount), 0n);

  let seaportAddress: string;
  try {
    seaportAddress = normalizeAddress(listing.protocol_address, "Seaport protocol address");
  } catch {
    return Response.json({ error: "Listing is missing the Seaport protocol address" }, { status: 409 });
  }

  // Return raw listing data — ABI encoding (matchOrders calldata) is done client-side in App.tsx
  return Response.json({
    fid,
    rarityValue,
    buyerAddress,
    listing: {
      orderHash: listing.order_hash ?? null,
      tokenId: String(rarityValue),
      makerAddress: listing.maker?.address ?? null,
      takerAddress: listing.taker?.address ?? null,
      price: approvalAmount.toString(),
      currencyAddress: paymentToken,
      openseaUrl: `https://opensea.io/item/base/${COLLECTION_CONTRACT}/${rarityValue}`,
      seaportAddress,
      protocolData: listing.protocol_data ?? null,
    },
    approval: {
      tokenAddress: paymentToken,
      spender: seaportAddress,
      amount: approvalAmount.toString(),
    },
    transaction: {
      chainIdHex: BASE_CHAIN_ID_HEX,
      to: seaportAddress,
      value: "0x0",
    },
  });
}
