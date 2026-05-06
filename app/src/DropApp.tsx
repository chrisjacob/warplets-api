import { useEffect, useState, type FormEvent } from "react";
import sdk from "@farcaster/miniapp-sdk";
import confetti from "canvas-confetti";
import { Text } from "@neynar/ui/typography";
import { encodeFunctionData, erc20Abi, getAddress, type Address } from "viem";
import {
  MiniAppHeader,
  MiniAppMenuPage,
  getHeaderTitle,
  useMiniAppChrome,
} from "./miniAppChrome.tsx";

type WarpletStatus = {
  fid: number;
  exists: boolean;
  matched: boolean;
  rarityValue: number | null;
  buyTransactionOn: string | null;
  sharedOn: string | null;
};

type RecentBuyer = {
  fid: number;
  pfpUrl: string;
  score: number | null;
};

type RawOfferItem = {
  itemType: number | string;
  token: string;
  identifierOrCriteria: string;
  startAmount: string;
  endAmount: string;
};

type RawConsiderationItem = RawOfferItem & {
  recipient: string;
};

type RawOrderParameters = {
  offerer: string;
  zone: string;
  offer: RawOfferItem[];
  consideration: RawConsiderationItem[];
  orderType: number | string;
  startTime: string;
  endTime: string;
  zoneHash: string;
  salt: string;
  conduitKey: string;
  totalOriginalConsiderationItems: number | string;
};

type BuyQuoteResponse = {
  buyerAddress: string;
  listing: {
    orderHash: string | null;
    tokenId: string;
    makerAddress: string | null;
    takerAddress: string | null;
    price: string;
    currencyAddress: string;
    openseaUrl: string;
    seaportAddress: string;
    protocolData: {
      parameters: RawOrderParameters;
      signature: string;
    } | null;
  };
  approval: {
    tokenAddress: string;
    spender: string;
    amount: string;
  };
  transaction: {
    chainIdHex: string;
    to: string;
    value: `0x${string}`;
    inputData?: unknown;
  };
};

type EthereumProvider = {
  request(args: { method: string; params?: unknown[] }): Promise<unknown>;
};

type RpcError = {
  code?: number;
  message?: string;
};

// ---------------------------------------------------------------------------
// Seaport matchOrders encoding (moved from Pages Function to avoid viem in CF Pages)
// ---------------------------------------------------------------------------

type ContractOfferItem = {
  itemType: number;
  token: Address;
  identifierOrCriteria: bigint;
  startAmount: bigint;
  endAmount: bigint;
};

type ContractConsiderationItem = ContractOfferItem & { recipient: Address };

type ContractOrderParameters = {
  offerer: Address;
  zone: Address;
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

type AdvancedOrder = {
  parameters: ContractOrderParameters;
  numerator: bigint;
  denominator: bigint;
  signature: `0x${string}`;
  extraData: `0x${string}`;
};

type CriteriaResolver = {
  orderIndex: bigint;
  side: number;
  index: bigint;
  identifier: bigint;
  criteriaProof: `0x${string}`[];
};

type FulfillmentComponent = {
  orderIndex: bigint;
  itemIndex: bigint;
};

type Fulfillment = {
  offerComponents: FulfillmentComponent[];
  considerationComponents: FulfillmentComponent[];
};

type RawFulfillmentInput = {
  orders: Array<{
    parameters: RawOrderParameters;
    numerator: number | string;
    denominator: number | string;
    signature: string;
    extraData: string;
  }>;
  criteriaResolvers: Array<{
    orderIndex: number | string;
    side: number | string;
    index: number | string;
    identifier: number | string;
    criteriaProof: string[];
  }>;
  fulfillments: Array<{
    offerComponents: Array<{ orderIndex: number | string; itemIndex: number | string }>;
    considerationComponents: Array<{ orderIndex: number | string; itemIndex: number | string }>;
  }>;
  recipient?: string;
};

const MATCH_ADVANCED_ORDERS_ABI = [
  {
    type: "function",
    name: "matchAdvancedOrders",
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
          { name: "numerator", type: "uint120" },
          { name: "denominator", type: "uint120" },
          { name: "signature", type: "bytes" },
          { name: "extraData", type: "bytes" },
        ],
      },
      {
        name: "criteriaResolvers",
        type: "tuple[]",
        components: [
          { name: "orderIndex", type: "uint256" },
          { name: "side", type: "uint8" },
          { name: "index", type: "uint256" },
          { name: "identifier", type: "uint256" },
          { name: "criteriaProof", type: "bytes32[]" },
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
      { name: "recipient", type: "address" },
    ],
    outputs: [],
  },
] as const;

function toBigInt(value: string | number | bigint | undefined, fallback = 0n): bigint {
  if (typeof value === "bigint") return value;
  if (typeof value === "number") return BigInt(value);
  if (typeof value === "string" && value.length > 0) return BigInt(value);
  return fallback;
}

function rawToContractOrderParameters(params: RawOrderParameters): ContractOrderParameters {
  return {
    offerer: getAddress(params.offerer),
    zone: getAddress(params.zone),
    offer: params.offer.map(item => ({
      itemType: Number(item.itemType),
      token: getAddress(item.token),
      identifierOrCriteria: toBigInt(item.identifierOrCriteria),
      startAmount: toBigInt(item.startAmount),
      endAmount: toBigInt(item.endAmount),
    })),
    consideration: params.consideration.map(item => ({
      itemType: Number(item.itemType),
      token: getAddress(item.token),
      identifierOrCriteria: toBigInt(item.identifierOrCriteria),
      startAmount: toBigInt(item.startAmount),
      endAmount: toBigInt(item.endAmount),
      recipient: getAddress(item.recipient),
    })),
    orderType: Number(params.orderType),
    startTime: toBigInt(params.startTime),
    endTime: toBigInt(params.endTime),
    zoneHash: params.zoneHash as `0x${string}`,
    salt: toBigInt(params.salt),
    conduitKey: params.conduitKey as `0x${string}`,
    totalOriginalConsiderationItems: toBigInt(params.totalOriginalConsiderationItems),
  };
}

function buildMatchAdvancedOrdersArgs(
  inputData: RawFulfillmentInput,
  fallbackRecipient: Address
): [AdvancedOrder[], CriteriaResolver[], Fulfillment[], Address] {
  const orders: AdvancedOrder[] = inputData.orders.map(order => ({
    parameters: rawToContractOrderParameters(order.parameters),
    numerator: toBigInt(order.numerator, 1n),
    denominator: toBigInt(order.denominator, 1n),
    signature: (order.signature || "0x") as `0x${string}`,
    extraData: (order.extraData || "0x") as `0x${string}`,
  }));

  const criteriaResolvers: CriteriaResolver[] = (inputData.criteriaResolvers ?? []).map(resolver => ({
    orderIndex: toBigInt(resolver.orderIndex),
    side: Number(resolver.side),
    index: toBigInt(resolver.index),
    identifier: toBigInt(resolver.identifier),
    criteriaProof: (resolver.criteriaProof ?? []) as `0x${string}`[],
  }));

  const fulfillments: Fulfillment[] = (inputData.fulfillments ?? []).map(f => ({
    offerComponents: (f.offerComponents ?? []).map(c => ({
      orderIndex: toBigInt(c.orderIndex),
      itemIndex: toBigInt(c.itemIndex),
    })),
    considerationComponents: (f.considerationComponents ?? []).map(c => ({
      orderIndex: toBigInt(c.orderIndex),
      itemIndex: toBigInt(c.itemIndex),
    })),
  }));

  const recipient = getAddress(inputData.recipient || fallbackRecipient);
  return [orders, criteriaResolvers, fulfillments, recipient];
}

const BASE_CHAIN_CONFIG = {
  chainId: "0x2105",
  chainName: "Base",
  nativeCurrency: {
    name: "Ether",
    symbol: "ETH",
    decimals: 18,
  },
  rpcUrls: ["https://mainnet.base.org"],
  blockExplorerUrls: ["https://basescan.org"],
};

function getErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  const rpcError = error as RpcError | undefined;
  if (rpcError?.message) {
    return rpcError.message;
  }

  return "Something went wrong while opening the Farcaster Wallet flow.";
}

function isUnsupportedMethodError(error: unknown): boolean {
  const rpcError = error as RpcError | undefined;
  const msg = (rpcError?.message || "").toLowerCase();
  return msg.includes("does not support the requested method") || msg.includes("method not found");
}

async function getWalletAccounts(provider: EthereumProvider): Promise<string[]> {
  try {
    const requested = (await provider.request({ method: "eth_requestAccounts" })) as string[];
    if (Array.isArray(requested) && requested.length > 0) {
      return requested;
    }
  } catch (error) {
    if (!isUnsupportedMethodError(error)) {
      throw error;
    }
  }

  const existing = (await provider.request({ method: "eth_accounts" })) as string[];
  if (!Array.isArray(existing) || existing.length === 0) {
    throw new Error("No wallet account is connected.");
  }
  return existing;
}

async function readErrorResponse(response: Response): Promise<string> {
  try {
    const payload = (await response.json()) as { error?: string };
    if (payload.error) {
      return payload.error;
    }
  } catch {
    // Fall through to text body.
  }

  const text = await response.text().catch(() => "");
  return text || `Request failed with status ${response.status}`;
}

async function postTrackingUpdate(path: string, fid: number): Promise<void> {
  const res = await fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ fid }),
  });

  if (!res.ok) {
    throw new Error(await readErrorResponse(res));
  }
}

async function ensureChain(provider: EthereumProvider, chainIdHex: string): Promise<void> {
  let currentChainId: string | undefined;
  try {
    currentChainId = (await provider.request({ method: "eth_chainId" })) as string;
    if (currentChainId?.toLowerCase() === chainIdHex.toLowerCase()) {
      return;
    }
  } catch (error) {
    if (!isUnsupportedMethodError(error)) {
      throw error;
    }
    // Some embedded providers do not expose chain methods; continue and let sendTransaction surface any chain mismatch.
    return;
  }

  try {
    await provider.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: chainIdHex }],
    });
  } catch (error) {
    if (isUnsupportedMethodError(error)) {
      return;
    }

    const rpcError = error as RpcError;
    if (rpcError.code !== 4902) {
      throw error;
    }

    try {
      await provider.request({
        method: "wallet_addEthereumChain",
        params: [BASE_CHAIN_CONFIG],
      });
    } catch (addError) {
      if (!isUnsupportedMethodError(addError)) {
        throw addError;
      }
    }
  }
}

async function waitForTransactionReceipt(
  provider: EthereumProvider,
  hash: string,
  timeoutMs = 120000
): Promise<void> {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    let receipt: { status?: string } | null;
    try {
      receipt = (await provider.request({
        method: "eth_getTransactionReceipt",
        params: [hash],
      })) as { status?: string } | null;
    } catch (error) {
      if (isUnsupportedMethodError(error)) {
        // Embedded wallets may not expose receipt polling.
        return;
      }
      throw error;
    }

    if (receipt?.status === "0x1") {
      return;
    }

    if (receipt?.status === "0x0") {
      throw new Error("The transaction was reverted onchain.");
    }

    await new Promise(resolve => window.setTimeout(resolve, 1500));
  }

  throw new Error("Timed out waiting for the wallet transaction to confirm.");
}

const LAUNCH_AT_UTC_MS = Date.UTC(2026, 4, 1, 0, 1, 0);
const CHANGE_PERIOD_MS = 10 * 24 * 60 * 60 * 1000;
const SHARE_IMAGE_EXTENSION = "avif";

function formatUrgencyCountdown(remainingMs: number): string {
  const clamped = Math.max(0, remainingMs);
  const totalSeconds = Math.floor(clamped / 1000);
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);

  if (days > 0) {
    return `${days} Day${days === 1 ? "" : "s"} ${hours} Hour${hours === 1 ? "" : "s"}`;
  }

  if (hours > 0) {
    return `${hours} Hour${hours === 1 ? "" : "s"} ${minutes} Minute${minutes === 1 ? "" : "s"}`;
  }

  return `${minutes} Minute${minutes === 1 ? "" : "s"}`;
}

function getUrgencyMessage(tokenId: number | null, nowMs: number): string | null {
  if (!tokenId || tokenId <= 0) return null;

  const elapsedMs = Math.max(0, nowMs - LAUNCH_AT_UTC_MS);
  const tierIndex = Math.min(9, Math.floor(elapsedMs / CHANGE_PERIOD_MS));
  const currentPrice = (tierIndex + 1) * 10;
  const nextPrice = currentPrice + 10;

  if (tierIndex >= 9) {
    return "Final price: $100. Last chance.";
  }

  const nextChangeMs = LAUNCH_AT_UTC_MS + CHANGE_PERIOD_MS * (tierIndex + 1);
  const countdown = formatUrgencyCountdown(nextChangeMs - nowMs);

  const alreadyPublicThreshold = 10001 - tierIndex * 1000;
  const nextBatchMin = 10001 - (tierIndex + 1) * 1000;

  if (tokenId >= alreadyPublicThreshold) {
    return "Listed for public sale. Don't miss out!";
  }

  if (tokenId >= nextBatchMin) {
    return `Supply goes public in ${countdown}.`;
  }

  return `Price increases $${currentPrice} → $${nextPrice} in ${countdown}.`;
}

function formatTopPercent(tokenId: number): string {
  const rawPercent = (tokenId / 10000) * 100;

  let topPercent: number;
  if (rawPercent >= 10) {
    topPercent = Math.ceil(rawPercent / 10) * 10;
  } else if (rawPercent >= 1) {
    topPercent = Math.ceil(rawPercent);
  } else if (rawPercent >= 0.1) {
    topPercent = Math.ceil(rawPercent * 10) / 10;
  } else {
    topPercent = rawPercent;
  }

  return topPercent.toFixed(0);
}

export default function App() {
  const FARCASTER_MINIAPP_URL = "https://farcaster.xyz/miniapps/uR3Rzs-k6AnV/10x";
  const { isMenuRoute, canGoBack, actions } = useMiniAppChrome("drop");
  const [fid, setFid] = useState<number | null>(null);
  const [status, setStatus] = useState<WarpletStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>("");
  const [actionError, setActionError] = useState<string>("");
  const [didCelebrate, setDidCelebrate] = useState(false);
  const [isPurchasing, setIsPurchasing] = useState(false);
  const [purchasedTokenId, setPurchasedTokenId] = useState<string | null>(null);
  const [hasShared, setHasShared] = useState(false);
  const [showOpenInFarcaster, setShowOpenInFarcaster] = useState(false);
  const [showAddAppPrompt, setShowAddAppPrompt] = useState(false);
  const [notificationsOnlyPrompt, setNotificationsOnlyPrompt] = useState(false);
  const [nowMs, setNowMs] = useState(Date.now());
  const [hasClickedOpenSea, setHasClickedOpenSea] = useState(false);
  const [waitlistEmail, setWaitlistEmail] = useState("");
  const [waitlistSubmitting, setWaitlistSubmitting] = useState(false);
  const [waitlistSubmitted, setWaitlistSubmitted] = useState(false);
  const [hasFollowedX, setHasFollowedX] = useState(false);
  const [viewerUsername, setViewerUsername] = useState("");
  const [recentBuys, setRecentBuys] = useState<RecentBuyer[]>([]);

  const launchTopConfetti = () => {
    const colors = ["#ff4d4d", "#ffd93d", "#57e389", "#4da3ff", "#b07bff", "#ff7ac8"];
    const bursts = [0.12, 0.3, 0.5, 0.7, 0.88];

    for (const [index, x] of bursts.entries()) {
      setTimeout(() => {
        confetti({
          particleCount: 65,
          spread: 68,
          startVelocity: 36,
          gravity: 0.92,
          ticks: 300,
          scalar: 1.05,
          origin: { x, y: 0 },
          colors,
        });
      }, index * 160);
    }
  };

  useEffect(() => {
    const loadRecentBuys = async () => {
      try {
        const recentRes = await fetch("/api/recent-buys");
        if (!recentRes.ok) return;

        const recentPayload = (await recentRes.json()) as { buyers?: unknown };
        if (!Array.isArray(recentPayload.buyers)) return;

        const normalized = recentPayload.buyers
          .map((item) => {
            if (!item || typeof item !== "object") return null;
            const row = item as { fid?: unknown; pfpUrl?: unknown; score?: unknown };
            if (typeof row.fid !== "number" || !Number.isFinite(row.fid)) return null;
            if (typeof row.pfpUrl !== "string" || row.pfpUrl.trim().length === 0) return null;

            return {
              fid: row.fid,
              pfpUrl: row.pfpUrl,
              score: typeof row.score === "number" && Number.isFinite(row.score) ? row.score : null,
            } satisfies RecentBuyer;
          })
          .filter((item): item is RecentBuyer => item !== null)
          .slice(0, 10);

        setRecentBuys(normalized);
      } catch {
        // Ignore non-critical social proof errors.
      }
    };

    loadRecentBuys();
  }, []);

  useEffect(() => {
    const init = async () => {
      let shouldCallReady = false;

      try {
        const inMiniApp =
          typeof sdk.isInMiniApp === "function" ? await sdk.isInMiniApp() : true;

        if (!inMiniApp) {
          setShowOpenInFarcaster(true);
          return;
        }

        shouldCallReady = true;
        const context = await sdk.context;
        setFid(context.user.fid);
        const username =
          typeof (context.user as { username?: unknown } | undefined)?.username === "string"
            ? String((context.user as { username?: string }).username)
            : "";
        setViewerUsername(username);

        const isProdHost =
          typeof window !== "undefined" &&
          (window.location.host === "drop.10x.meme" ||
            (window.location.host === "app.10x.meme" && window.location.pathname.startsWith("/drop")));
        const addParamSet = typeof window !== "undefined" && new URLSearchParams(window.location.search).get("add") === "1";
        const shouldPromptAddApp =
          (isProdHost || addParamSet) &&
          (!context.client.added || !context.client.notificationDetails);
        const isNotificationsOnly = shouldPromptAddApp && context.client.added && !context.client.notificationDetails;
        setShowAddAppPrompt(shouldPromptAddApp);
        setNotificationsOnlyPrompt(isNotificationsOnly);

        // If launched from a notification, record the open for analytics
        const loc = context.location as { type?: string; notification?: { notificationId?: string } } | undefined;
        if (loc?.type === "notification" && loc.notification?.notificationId) {
          fetch("/api/notifications/open", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              notificationId: loc.notification.notificationId,
              fid: context.user.fid,
              appSlug: "drop",
            }),
          }).catch(() => {}); // fire-and-forget; never block UX
        }

        const res = await fetch("/api/warplet-status", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ fid: context.user.fid }),
        });

        if (!res.ok) {
          const text = await res.text();
          throw new Error(`Failed to load status (${res.status}): ${text}`);
        }

        const data = (await res.json()) as WarpletStatus;
        setStatus(data);

        if (typeof data.rarityValue === "number" && data.buyTransactionOn) {
          setPurchasedTokenId(String(data.rarityValue));
        }

        setHasShared(Boolean(data.sharedOn));

      } catch (err) {
        console.error("Failed to get user context:", err);
        const message = err instanceof Error ? err.message : String(err);
        const normalized = message.toLowerCase();
        const looksLikeBrowserLaunch =
          normalized.includes("context is undefined") ||
          normalized.includes("can't access property \"user\"") ||
          normalized.includes("cannot read properties of undefined");

        if (looksLikeBrowserLaunch) {
          setShowOpenInFarcaster(true);
          setError("");
        } else {
          setError(message);
        }
      } finally {
        setLoading(false);
      }
      // Hide the splash screen once the app is ready
      if (shouldCallReady) {
        sdk.actions.ready();
      }
    };
    init();
  }, []);

  const searchParams = typeof window !== "undefined" ? new URLSearchParams(window.location.search) : new URLSearchParams();
  const forceNoMatch = typeof window !== "undefined" && searchParams.get("match") === "false";
  const debugEnabled = typeof window !== "undefined" && searchParams.get("debug") === "1";
  const currentHost = typeof window !== "undefined" ? window.location.host : "";
  const showDebugChip = debugEnabled;
  const isMatched = !forceNoMatch && Boolean(status?.matched && typeof status.rarityValue === "number");
  const hasPurchased = Boolean(purchasedTokenId);
  const displayTokenId = purchasedTokenId ?? (typeof status?.rarityValue === "number" ? String(status.rarityValue) : null);
  const formattedTokenId =
    displayTokenId && Number.isFinite(Number(displayTokenId))
      ? Number(displayTokenId).toLocaleString("en-US")
      : displayTokenId;
  const topPercentLabel =
    displayTokenId && Number.isFinite(Number(displayTokenId))
      ? formatTopPercent(Number(displayTokenId))
      : null;

  useEffect(() => {
    if (loading || error || !isMatched || didCelebrate) return;

    launchTopConfetti();
    setDidCelebrate(true);
  }, [loading, error, isMatched, didCelebrate]);

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      setNowMs(Date.now());
    }, 1000);

    return () => {
      window.clearInterval(intervalId);
    };
  }, []);

  const imageUrl = hasPurchased
    ? `https://warplets.10x.meme/${purchasedTokenId}.gif`
    : isMatched
      ? `https://warplets.10x.meme/${status?.rarityValue}.avif`
      : "https://warplets.10x.meme/3081.png";
  const title = hasPurchased
    ? "Purchased! Welcome to 10X."
    : isMatched
      ? "Congratulations! You're on the list..."
      : "Oh Snap... You're not on the list.";
  const badgeLabel = hasPurchased
    ? "🎉 NFT Drop Claimed"
    : isMatched
      ? "🔓 Private 10K NFT Drop"
      : "🔒 Private 10K NFT Drop";
  const buttonLabel = hasPurchased
    ? "Share & Claim Yours"
    : isMatched
      ? isPurchasing
        ? "Processing in Wallet..."
        : "Buy in Farcaster Wallet"
      : "Visit OpenSea to find out why...";
  const shareButtonPulseClass = hasPurchased && !hasShared ? "share-cta-pulse-x" : "";
  const urgencyMessage = isMatched && !hasPurchased
    ? getUrgencyMessage(typeof status?.rarityValue === "number" ? status.rarityValue : null, nowMs)
    : null;
  const showWaitlistCta = hasShared || (!isMatched && hasClickedOpenSea);

  const handlePrimaryAction = async () => {
    if (hasPurchased && purchasedTokenId) {
      setActionError("");
      launchTopConfetti();

      try {
        const castResult = await sdk.actions.composeCast({
          text:
            `💚 Claim your 10X Warplet!\n\n10X Rarity #${Number(purchasedTokenId).toLocaleString("en-US")} of 10,000.\n\nPrice increases every 10 days.\n\nSupply decreases every 10 days.\n\nDon't miss out...`,
          embeds: ["https://drop.10x.meme", `https://warplets.10x.meme/${purchasedTokenId}.${SHARE_IMAGE_EXTENSION}`],
        });

        if (castResult?.cast?.hash && fid) {
          await postTrackingUpdate("/api/warplet-share", fid);
          setHasShared(true);
          setStatus(prev => (prev ? { ...prev, sharedOn: new Date().toISOString() } : prev));
        }
      } catch (err) {
        console.error("Failed to open cast composer:", err);
        setActionError(getErrorMessage(err));
      }

      return;
    }

    if (isMatched) {
      if (!fid) {
        setActionError("Your Farcaster account is not ready yet.");
        return;
      }

      setActionError("");
      setIsPurchasing(true);

      try {
        const quoteRes = await fetch("/api/warplet-buy-quote", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ fid }),
        });

        if (!quoteRes.ok) {
          throw new Error(await readErrorResponse(quoteRes));
        }

        const quote = (await quoteRes.json()) as BuyQuoteResponse;

        if (!quote.transaction.inputData) {
          throw new Error("The listing is missing OpenSea fulfillment data.");
        }

        const provider = (await sdk.wallet.getEthereumProvider()) as EthereumProvider | null;
        if (!provider) {
          throw new Error("Farcaster Wallet is unavailable in this client.");
        }

        const accounts = await getWalletAccounts(provider);
        const activeAccount = getAddress(accounts?.[0] ?? "");

        if (activeAccount.toLowerCase() !== quote.buyerAddress.toLowerCase()) {
          throw new Error("Switch Farcaster Wallet to your primary Farcaster address before buying this Warplet.");
        }

        await ensureChain(provider, quote.transaction.chainIdHex || BASE_CHAIN_CONFIG.chainId);

        const fulfillmentInput = quote.transaction.inputData as RawFulfillmentInput | undefined;
        if (!fulfillmentInput?.orders?.length) {
          throw new Error("OpenSea fulfillment payload is missing for this listing.");
        }

        const matchAdvancedOrdersArgs = buildMatchAdvancedOrdersArgs(fulfillmentInput, activeAccount);
        const matchOrdersData = encodeFunctionData({
          abi: MATCH_ADVANCED_ORDERS_ABI,
          functionName: "matchAdvancedOrders",
          args: matchAdvancedOrdersArgs,
        });

        const allowanceCallData = encodeFunctionData({
          abi: erc20Abi,
          functionName: "allowance",
          args: [activeAccount, getAddress(quote.approval.spender)],
        });

        let currentAllowance = 0n;
        try {
          const allowanceResult = (await provider.request({
            method: "eth_call",
            params: [
              {
                to: quote.approval.tokenAddress,
                data: allowanceCallData,
              },
              "latest",
            ],
          })) as string;
          currentAllowance = BigInt(allowanceResult || "0x0");
        } catch (error) {
          if (!isUnsupportedMethodError(error)) {
            throw error;
          }
          // If eth_call is unsupported, proceed with approval to avoid blocking purchase.
          currentAllowance = 0n;
        }

        const requiredAllowance = BigInt(quote.approval.amount);

        if (currentAllowance < requiredAllowance) {
          const approvalData = encodeFunctionData({
            abi: erc20Abi,
            functionName: "approve",
            args: [getAddress(quote.approval.spender), requiredAllowance],
          });

          const approvalHash = (await provider.request({
            method: "eth_sendTransaction",
            params: [
              {
                from: activeAccount,
                to: quote.approval.tokenAddress,
                data: approvalData,
                value: "0x0",
              },
            ],
          })) as string;

          await waitForTransactionReceipt(provider, approvalHash);
        }

        const purchaseHash = (await provider.request({
          method: "eth_sendTransaction",
          params: [
            {
              from: activeAccount,
              to: quote.transaction.to,
              data: matchOrdersData,
              value: quote.transaction.value,
            },
          ],
        })) as string;

        await waitForTransactionReceipt(provider, purchaseHash);
        setPurchasedTokenId(quote.listing.tokenId);
        setStatus(prev => (prev ? { ...prev, buyTransactionOn: new Date().toISOString() } : prev));
        launchTopConfetti();

        try {
          await postTrackingUpdate("/api/warplet-purchase-complete", fid);
        } catch (persistError) {
          console.error("Failed to persist purchase tracking state:", persistError);
          setActionError("Purchase succeeded, but persisting claim state failed. Please refresh in a moment.");
        }
      } catch (err) {
        console.error("Failed to complete Warplet purchase:", err);
        setActionError(getErrorMessage(err));
      } finally {
        setIsPurchasing(false);
      }

      return;
    }

    setHasClickedOpenSea(true);
    await sdk.actions.openUrl("https://opensea.io/collection/10xwarplets/overview");
  };

  const handleOpenSeaAction = async () => {
    setHasClickedOpenSea(true);
    await sdk.actions.openUrl("https://opensea.io/collection/10xwarplets/overview");
  };

  const handleSplashAction = async () => {
    await sdk.actions.openUrl("https://10x.meme");
  };

  const handleConfirmAddAppPrompt = async () => {
    setShowAddAppPrompt(false);
    try {
      await sdk.actions.addMiniApp();
    } catch (err) {
      console.error("Failed to open add mini app prompt:", err);
      setActionError(getErrorMessage(err));
    }
  };

  const handleWaitlistSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!waitlistEmail.trim()) {
      setActionError("Please enter a valid email.");
      return;
    }

    setWaitlistSubmitting(true);
    setActionError("");

    try {
      const response = await fetch("/api/email/subscribe", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email: waitlistEmail.trim(),
          fid,
          username: viewerUsername || undefined,
          tokenId: typeof status?.rarityValue === "number" ? status.rarityValue : null,
          matched: Boolean(isMatched),
        }),
      });

      if (!response.ok) {
        const text = await response.text();
        throw new Error(text || "Failed to join waitlist.");
      }

      setWaitlistSubmitted(true);
    } catch (err) {
      setActionError(getErrorMessage(err));
    } finally {
      setWaitlistSubmitting(false);
    }
  };

  const handleFollowX = async () => {
    await sdk.actions.openUrl("https://x.com/10XMemeX");
    setHasFollowedX(true);
  };

  const handleJoinTelegram = async () => {
    await sdk.actions.openUrl("https://t.me/X10XMeme");
  };

  useEffect(() => {
    if (!actionError) return;

    const timeoutId = window.setTimeout(() => {
      setActionError("");
    }, 5000);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [actionError]);

  return (
    <div
      className="relative min-h-screen bg-black text-white flex flex-col items-center pb-8 overflow-hidden"
      style={{ fontFamily: '"Roboto Mono", system-ui, sans-serif' }}
    >
      {/* Animated background */}
      <video
        src="/matrix_bg_1080x1080.mp4"
        autoPlay
        loop
        muted
        playsInline
        aria-hidden="true"
        className="brand-bg-video"
      />
      <div className="brand-bg-overlay" aria-hidden="true" />

      <div className="relative z-10 w-full">
        <MiniAppHeader
          appSlug="drop"
          title={getHeaderTitle("drop", isMenuRoute)}
          canGoBack={canGoBack}
          onBack={actions.goBack}
          onLogo={actions.openHubRoot}
          onMenu={actions.openMenu}
        />
      </div>

      {isMenuRoute ? (
        <div className="relative z-10 w-full max-w-5xl mx-auto">
          <MiniAppMenuPage appSlug="drop" />
        </div>
      ) : (
        <div className="relative z-10 w-full max-w-md text-center space-y-2 px-4 pt-2">
          <div className="relative px-4 pt-2 text-center mb-4">
            <Text className="text-[clamp(1.6rem,5vw,1.6rem)] font-bold leading-tight whitespace-nowrap" style={{ color: "#00FF00" }}>
              {badgeLabel}
            </Text>
            <Text className="mt-3 text-lg font-semibold" style={{ color: "#00FF00" }}>
              {title}
            </Text>
          </div>

          {loading && <Text className="text-sm" style={{ color: "#00FF00" }}>Loading your 10X Warplet status...</Text>}

          {!loading && error && (
            <Text className="text-sm text-red-400">{error}</Text>
          )}

          {!loading && showOpenInFarcaster && (
            <div className="px-4 pb-2 pt-3 flex justify-center">
              <a
                href={FARCASTER_MINIAPP_URL}
                className="inline-block w-[329px] max-w-full px-5 py-3 rounded-[20px] border border-[#009900] bg-[#00FF00] hover:bg-[#33ff33] font-bold text-lg transition-all duration-100 shadow-[3px_6px_0_#008000] active:translate-x-[1px] active:translate-y-[3px] active:shadow-[1px_3px_0_#008000]"
                style={{ color: "rgb(0, 80, 0)" }}
              >
                Open mini app in Farcaster
              </a>
            </div>
          )}

          {!loading && !error && !showOpenInFarcaster && (
            <div className="space-y-0">
              <div className="px-4 pb-5 pt-0 space-y-3">
                <div className="w-full rounded-[20px] p-[2px] bg-[#00FF00]/20 border border-[#00FF00]/45">
                  <img
                    src={imageUrl}
                    alt="Loading..."
                    className="w-full rounded-[18px]"
                    loading="eager"
                  />
                  {isMatched && displayTokenId && topPercentLabel && (
                    <Text className="pt-1 pb-1 text-base font-bold text-center" style={{ color: "#00FF00" }}>
                      {`Rarity #${formattedTokenId} of 10,000 👀 Top ${topPercentLabel}%!`}
                    </Text>
                  )}
                </div>
              </div>
              <div className="px-4">
                <button
                  onClick={handlePrimaryAction}
                  disabled={isPurchasing}
                  className={`w-full mt-0 px-5 py-3 rounded-[20px] border border-[#009900] bg-[#00FF00] hover:bg-[#33ff33] font-bold text-lg transition-all duration-100 shadow-[3px_6px_0_#008000] active:translate-x-[1px] active:translate-y-[3px] active:shadow-[1px_3px_0_#008000] disabled:bg-gray-700 disabled:border-gray-700 disabled:shadow-none disabled:translate-x-0 disabled:translate-y-0 cursor-pointer ${shareButtonPulseClass}`}
                  style={{ color: isPurchasing ? "#ffffff" : "rgb(0, 80, 0)", fontWeight: 700 }}
                >
                  {buttonLabel}
                </button>

                {urgencyMessage && (
                  <Text className="mt-3 text-sm font-semibold" style={{ color: "#b7ffb7" }}>
                    {urgencyMessage}
                  </Text>
                )}

                {recentBuys.length > 0 && (
                  <div className="mt-3 text-left">
                    <Text className="text-xs font-semibold" style={{ color: "#b7ffb7" }}>
                      Recent Buys:
                    </Text>
                    <div className="mt-2 flex flex-nowrap gap-2 overflow-x-auto pb-1">
                      {recentBuys.map((buyer) => (
                        <button
                          key={buyer.fid}
                          type="button"
                          className="h-8 w-8 rounded-full overflow-hidden cursor-pointer"
                          style={{ border: "1px solid #00FF00" }}
                          title={`View profile ${buyer.fid}`}
                          onClick={() => {
                            sdk.actions.viewProfile({ fid: buyer.fid }).catch(() => {});
                          }}
                        >
                          <img
                            src={buyer.pfpUrl}
                            alt={`Buyer ${buyer.fid}`}
                            className="h-full w-full object-cover"
                            loading="lazy"
                          />
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {showWaitlistCta && (
                  <div className="mt-5 rounded-2xl border border-[#00FF00]/35 bg-[#041204]/85 px-4 py-4 text-left">
                    {!waitlistSubmitted ? (
                      <form onSubmit={handleWaitlistSubmit} className="space-y-3">
                        <Text className="text-sm font-bold" style={{ color: "#00FF00" }}>
                          Join 10X Meme Waitlist
                        </Text>
                        <input
                          type="email"
                          value={waitlistEmail}
                          onChange={(event) => setWaitlistEmail(event.target.value)}
                          placeholder="Email"
                          required
                          className="w-full rounded-xl border border-[#00FF00]/35 bg-black/70 px-3 py-2 text-sm text-white outline-none"
                        />
                        <button
                          type="submit"
                          disabled={waitlistSubmitting}
                          className="w-full rounded-xl px-4 py-2 font-bold border border-[#009900] bg-[#00FF00] hover:bg-[#33ff33] disabled:bg-gray-700 disabled:border-gray-700 cursor-pointer"
                          style={{ color: waitlistSubmitting ? "#ffffff" : "rgb(0, 80, 0)" }}
                        >
                          {waitlistSubmitting ? "Joining..." : "Join Waitlist"}
                        </button>
                      </form>
                    ) : (
                      <div className="space-y-3">
                        <Text className="text-sm font-bold" style={{ color: "#00FF00" }}>
                          You're on the list.
                        </Text>
                        <Text className="text-xs" style={{ color: "#b7ffb7" }}>
                          Check your inbox for a verification email.
                        </Text>
                        {!hasFollowedX ? (
                          <button
                            type="button"
                            onClick={handleFollowX}
                            className="w-full rounded-xl px-4 py-2 font-bold border border-[#009900] bg-[#00FF00] hover:bg-[#33ff33] cursor-pointer"
                            style={{ color: "rgb(0, 80, 0)" }}
                          >
                            Follow 10X on X
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={handleJoinTelegram}
                            className="w-full rounded-xl px-4 py-2 font-bold border border-[#009900] bg-[#00FF00] hover:bg-[#33ff33] cursor-pointer"
                            style={{ color: "rgb(0, 80, 0)" }}
                          >
                            Join 10X on Telegram
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {actionError && (
        <div className="fixed bottom-4 left-4 right-4 z-20 max-w-md mx-auto">
          <div className="rounded-xl border border-red-300/70 bg-red-950/90 px-4 py-3 shadow-lg backdrop-blur-sm">
            <div className="flex items-start justify-between gap-3">
              <Text className="text-sm text-red-100 text-left">{actionError}</Text>
              <button
                type="button"
                aria-label="Dismiss error message"
                className="text-red-200 hover:text-white text-sm font-bold leading-none cursor-pointer"
                onClick={() => setActionError("")}
              >
                ✕
              </button>
            </div>
          </div>
        </div>
      )}

      {showAddAppPrompt && !loading && !showOpenInFarcaster && (
        <div className="fixed inset-0 z-40 flex items-center justify-center px-4 bg-black/70 backdrop-blur-[2px]">
          <div className="w-full max-w-sm rounded-2xl border border-[#00FF00]/45 bg-[#041204] p-5 shadow-[0_0_40px_rgba(0,255,0,0.15)]">
            <Text className="text-xl font-bold text-left" style={{ color: "#00FF00" }}>
              🟢 Don&apos;t miss out
            </Text>
            <Text className="mt-3 text-sm text-left" style={{ color: "#b7ffb7" }}>
              {notificationsOnlyPrompt
                ? "Please turn on notifications so you don\u2019t miss out on important updates."
                : "Please Add Mini App and enable notifications so you don\u2019t miss out on important updates."}
            </Text>
            <div className="mt-5 grid grid-cols-1 gap-3">
              <button
                type="button"
                onClick={handleConfirmAddAppPrompt}
                className="w-full px-4 py-3 rounded-[14px] border border-[#009900] bg-[#00FF00] hover:bg-[#33ff33] font-bold transition-colors cursor-pointer"
                style={{ color: "rgb(0, 80, 0)" }}
              >
                Ok, let&apos;s go!
              </button>
            </div>
          </div>
        </div>
      )}

      {showDebugChip && (
        <div className="fixed left-3 top-[76px] z-30 max-w-[92vw] rounded-lg border border-cyan-300/70 bg-black/90 px-3 py-2 text-left shadow-xl backdrop-blur-sm">
          <Text className="text-[11px] leading-tight" style={{ color: "#67e8f9" }}>
            {`debug host=${currentHost || "n/a"}`}
          </Text>
          <Text className="text-[11px] leading-tight" style={{ color: "#67e8f9" }}>
            {`fid=${fid ?? "null"} rawMatched=${status?.matched ?? "null"} rarity=${status?.rarityValue ?? "null"}`}
          </Text>
          <Text className="text-[11px] leading-tight" style={{ color: "#67e8f9" }}>
            {`forceNoMatch=${forceNoMatch} computedMatched=${isMatched} debugParam=${debugEnabled}`}
          </Text>
          <Text className="text-[11px] leading-tight" style={{ color: "#67e8f9" }}>
            {`error=${error || "none"}`}
          </Text>
        </div>
      )}
    </div>
  );
}
