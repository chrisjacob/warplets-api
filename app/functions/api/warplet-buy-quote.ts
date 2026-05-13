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

type OpenSeaFulfillmentResponse = {
  fulfillment_data?: {
    transaction?: {
      function?: string;
      to?: string;
      value?: string | number;
      input_data?: unknown;
    };
  };
};

type OpenSeaFulfillmentOrder = {
  parameters?: {
    offerer?: string;
    offer?: OpenSeaOfferItem[];
    conduitKey?: string;
  };
};

type OpenSeaFulfillmentInputData = {
  orders?: OpenSeaFulfillmentOrder[];
};

type OpenSeaBasicOrderInputData = {
  parameters?: {
    considerationToken?: string;
    considerationAmount?: string | number;
    fulfillerConduitKey?: string;
    additionalRecipients?: Array<{
      amount?: string | number;
      recipient?: string;
    }>;
  };
};

type ApprovalRequirement = {
  tokenAddress: string;
  spender: string;
  amount: string;
  conduitKey: string;
};

const NEYNAR_VIEWER_FID = 1129138;
const OPENSEA_API_BASE = "https://api.opensea.io/api/v2";
const BASE_CHAIN = "base";
const BASE_CHAIN_ID_HEX = "0x2105";
const COLLECTION_SLUG = "10xwarplets";
const COLLECTION_CONTRACT = "0x780446dd12e080ae0db762fcd4daf313f3e359de";
const BASE_USDC = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";
const ZERO_CONDUIT_KEY = "0x0000000000000000000000000000000000000000000000000000000000000000";
const OPENSEA_CONDUIT_KEY = "0x0000007b02230091a7ed01230072f7006a004d60a8d4e71d599b8104250f0000";
const OPENSEA_CONDUIT_ADDRESS = "0x1e0049783f008a0085193e00003d00cd54003c71";


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

function normalizeBytes32(value: string | undefined, label: string): string {
  const bytes = value?.trim().toLowerCase();
  if (!bytes || !/^0x[0-9a-f]{64}$/.test(bytes)) {
    throw new Error(`${label} is missing or invalid`);
  }
  return bytes;
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
  const listings: OpenSeaListing[] = [];
  let cursor: string | undefined;
  const buyer = buyerAddress.toLowerCase();

  const bestParams = new URLSearchParams({
    include_private_listings: "true",
  });
  const bestRes = await fetch(
    `${OPENSEA_API_BASE}/listings/collection/${COLLECTION_SLUG}/nfts/${encodeURIComponent(tokenId)}/best?${bestParams.toString()}`,
    {
      headers: {
        accept: "application/json",
        "x-api-key": openseaApiKey,
        "X-API-KEY": openseaApiKey,
      },
      signal: AbortSignal.timeout(10000),
    }
  );

  if (bestRes.ok) {
    const data = (await bestRes.json()) as unknown;
    const responseObject = asObject(data);
    const nestedListing = asObject(responseObject?.listing) as OpenSeaListing | undefined;
    const listing = nestedListing ?? (responseObject as OpenSeaListing | undefined);
    if (listing?.protocol_data) {
      listings.push(listing);
    }
  } else if (bestRes.status !== 404) {
    const body = await bestRes.text().catch(() => "");
    throw new Error(`OpenSea best listing lookup failed (${bestRes.status}): ${body || "unknown error"}`);
  }

  // Legacy GET /orders/{chain}/{protocol}/listings now returns 405.
  // Use collection listings with taker + pagination and filter locally.
  for (let page = 0; page < 6; page += 1) {
    const params = new URLSearchParams({
      taker: buyerAddress,
      include_private_listings: "true",
      limit: "200",
    });
    if (cursor) params.set("next", cursor);

    const res = await fetch(`${OPENSEA_API_BASE}/listings/collection/${COLLECTION_SLUG}/all?${params.toString()}`, {
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

    const data = (await res.json()) as { listings?: OpenSeaListing[]; next?: string };
    const pageListings = Array.isArray(data.listings) ? data.listings : [];
    listings.push(...pageListings);

    if (!data.next || pageListings.length === 0) break;
    cursor = data.next;
  }

  return listings.filter((order) => {
    const taker = order.taker?.address?.toLowerCase();
    const offeredTokenId = order.protocol_data?.parameters?.offer?.[0]?.identifierOrCriteria;
    return String(offeredTokenId) === tokenId && (!taker || taker === buyer);
  });
}

async function fetchListingFulfillmentData(
  orderHash: string,
  protocolAddress: string,
  buyerAddress: string,
  openseaApiKey: string
): Promise<OpenSeaFulfillmentResponse> {
  const res = await fetch(`${OPENSEA_API_BASE}/listings/fulfillment_data`, {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      "x-api-key": openseaApiKey,
      "X-API-KEY": openseaApiKey,
    },
    body: JSON.stringify({
      listing: {
        hash: orderHash,
        chain: BASE_CHAIN,
        protocol_address: protocolAddress,
      },
      fulfiller: {
        address: buyerAddress,
      },
    }),
    signal: AbortSignal.timeout(10000),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`OpenSea fulfillment lookup failed (${res.status}): ${body || "unknown error"}`);
  }

  return (await res.json()) as OpenSeaFulfillmentResponse;
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

function resolveApprovalSpender(conduitKey: string, seaportAddress: string): string {
  if (conduitKey === ZERO_CONDUIT_KEY) {
    return seaportAddress;
  }

  if (conduitKey === OPENSEA_CONDUIT_KEY) {
    return OPENSEA_CONDUIT_ADDRESS;
  }

  throw new Error(`Unsupported OpenSea conduit key: ${conduitKey}`);
}

function getFulfillmentApprovals(
  inputData: unknown,
  buyerAddress: string,
  seaportAddress: string
): ApprovalRequirement[] {
  const fulfillmentInput = asObject(inputData) as OpenSeaFulfillmentInputData | undefined;
  const orders = fulfillmentInput?.orders;

  const buyer = buyerAddress.toLowerCase();
  const approvals = new Map<string, ApprovalRequirement & { amountBigInt: bigint }>();

  const addApproval = (tokenAddress: string, spender: string, conduitKey: string, amount: bigint) => {
    if (amount <= 0n) return;
    const key = `${tokenAddress}:${spender}:${conduitKey}`;
    const existing = approvals.get(key);
    if (existing) {
      existing.amountBigInt += amount;
      existing.amount = existing.amountBigInt.toString();
    } else {
      approvals.set(key, {
        tokenAddress,
        spender,
        amount: amount.toString(),
        conduitKey,
        amountBigInt: amount,
      });
    }
  };

  if (Array.isArray(orders)) {
    for (const order of orders) {
      const parameters = asObject(order?.parameters);
      const offerer = asString(parameters?.offerer)?.toLowerCase();
      if (offerer !== buyer) continue;

      const conduitKey = normalizeBytes32(
        asString(parameters?.conduitKey) ?? ZERO_CONDUIT_KEY,
        "Fulfillment conduit key"
      );
      const spender = resolveApprovalSpender(conduitKey, seaportAddress);
      const offer = parameters?.offer;
      if (!Array.isArray(offer)) continue;

      for (const item of offer) {
        const offerItem = asObject(item);
        if (!offerItem) continue;

        const itemType = Number(offerItem.itemType ?? 0);
        if (!isCurrencyItem(itemType)) continue;
        if (itemType !== 1) {
          throw new Error("The OpenSea fulfillment payment item is not an ERC20 token");
        }

        const tokenAddress = normalizeAddress(asString(offerItem.token), "Payment token");
        if (tokenAddress !== BASE_USDC) {
          throw new Error("The OpenSea fulfillment payment item is not Base USDC");
        }

        const amount = toBigIntValue(
          asString(offerItem.startAmount) ?? asString(offerItem.endAmount),
          0n
        );
        addApproval(tokenAddress, spender, conduitKey, amount);
      }
    }
  } else {
    const basicInput = asObject(inputData) as OpenSeaBasicOrderInputData | undefined;
    const parameters = asObject(basicInput?.parameters);
    if (!parameters) {
      throw new Error("OpenSea fulfillment payload is missing supported order parameters");
    }

    const tokenAddress = normalizeAddress(asString(parameters.considerationToken), "Payment token");
    if (tokenAddress !== BASE_USDC) {
      throw new Error("The OpenSea fulfillment payment item is not Base USDC");
    }

    const conduitKey = normalizeBytes32(
      asString(parameters.fulfillerConduitKey) ?? ZERO_CONDUIT_KEY,
      "Fulfillment conduit key"
    );
    const spender = resolveApprovalSpender(conduitKey, seaportAddress);
    let amount = toBigIntValue(
      asString(parameters.considerationAmount) ?? (typeof parameters.considerationAmount === "number" ? parameters.considerationAmount : undefined),
      0n
    );
    const additionalRecipients = parameters.additionalRecipients;
    if (Array.isArray(additionalRecipients)) {
      for (const recipient of additionalRecipients) {
        amount += toBigIntValue(
          asString(recipient.amount) ?? (typeof recipient.amount === "number" ? recipient.amount : undefined),
          0n
        );
      }
    }
    addApproval(tokenAddress, spender, conduitKey, amount);
  }

  const result = Array.from(approvals.values()).map(({ amountBigInt, ...approval }) => approval);
  if (result.length === 0) {
    throw new Error("OpenSea fulfillment payload has no buyer USDC approval items");
  }

  return result;
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

  const orderHash = listing.order_hash?.trim();
  if (!orderHash) {
    return Response.json({ error: "Listing is missing order hash" }, { status: 409 });
  }

  let fulfillmentData: OpenSeaFulfillmentResponse;
  try {
    fulfillmentData = await fetchListingFulfillmentData(orderHash, seaportAddress, buyerAddress, openseaApiKey);
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Failed to build fulfillment data" },
      { status: 503 }
    );
  }

  const fulfillmentTx = fulfillmentData.fulfillment_data?.transaction;
  const fulfillmentTo = fulfillmentTx?.to?.trim().toLowerCase() || seaportAddress;
  const fulfillmentValue = toBigIntValue(fulfillmentTx?.value, 0n);
  let approvals: ApprovalRequirement[];
  try {
    approvals = getFulfillmentApprovals(fulfillmentTx?.input_data, buyerAddress, seaportAddress);
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Unsupported OpenSea fulfillment approval path" },
      { status: 409 }
    );
  }

  // Return OpenSea fulfillment input_data so the frontend can encode matchAdvancedOrders with the maker signature.
  return Response.json({
    fid,
    rarityValue,
    buyerAddress,
    listing: {
      orderHash,
      tokenId: String(rarityValue),
      makerAddress: listing.maker?.address ?? listing.protocol_data?.parameters?.offerer ?? null,
      takerAddress: listing.taker?.address ?? buyerAddress,
      price: approvalAmount.toString(),
      currencyAddress: paymentToken,
      openseaUrl: `https://opensea.io/item/base/${COLLECTION_CONTRACT}/${rarityValue}`,
      seaportAddress,
      protocolData: listing.protocol_data ?? null,
    },
    approval: {
      tokenAddress: approvals[0].tokenAddress,
      spender: approvals[0].spender,
      amount: approvals[0].amount,
      conduitKey: approvals[0].conduitKey,
    },
    approvals,
    transaction: {
      chainIdHex: BASE_CHAIN_ID_HEX,
      to: fulfillmentTo,
      value: `0x${fulfillmentValue.toString(16)}`,
      function: fulfillmentTx?.function ?? null,
      inputData: fulfillmentTx?.input_data ?? null,
    },
  });
}
