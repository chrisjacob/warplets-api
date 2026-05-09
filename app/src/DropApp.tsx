import { useEffect, useState, type FormEvent } from "react";
import sdk from "@farcaster/miniapp-sdk";
import confetti from "canvas-confetti";
import { Text } from "@neynar/ui/typography";
import { encodeFunctionData, erc20Abi, getAddress, type Address } from "viem";
import MiniAppShell from "./MiniAppShell";
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
  buyInOpenseaOn: string | null;
  buyInFarcasterWalletOn: string | null;
  rewardedOn: string | null;
  recentBuys?: unknown;
  rewardedUsers?: unknown;
  outreachCandidates?: unknown;
  actionSessionToken?: string | null;
};

type RecentBuysResponse = {
  buyers?: unknown;
  bestFriends?: unknown;
  rewardedUsers?: unknown;
  outreachCandidates?: unknown;
  actionSessionToken?: string | null;
};

type RewardAction = {
  id: number;
  slug: string;
  name: string;
  description: string;
  appAction: string | null;
  appActionContent: string | null;
  appActionEmbeds: string[];
  url: string | null;
  image: string | null;
  verificationMethod: string;
  appSlug: string;
  completed: boolean;
  verification: string | null;
};

type RecentBuyer = {
  fid: number;
  pfpUrl: string;
  score: number | null;
};

type BestFriend = {
  fid: number;
  mutualAffinityScore: number;
  username: string;
};

type OutreachCandidate = {
  farcasterUsernames: string[];
  xUsernames: string[];
  tokenIds: number[];
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
    return `⚠️ Supply goes public in ${countdown}.`;
  }

  return `⚠️ Price increases $${currentPrice} → $${nextPrice} in ${countdown}.`;
}

function getUrgencyDetails(nowMs: number): { currentPrice: number; nextPrice: number; countdown: string } {
  const elapsedMs = Math.max(0, nowMs - LAUNCH_AT_UTC_MS);
  const tierIndex = Math.min(9, Math.floor(elapsedMs / CHANGE_PERIOD_MS));
  const currentPrice = (tierIndex + 1) * 10;
  const nextPrice = Math.min(100, currentPrice + 10);
  const nextChangeMs = LAUNCH_AT_UTC_MS + CHANGE_PERIOD_MS * (tierIndex + 1);
  const countdown = tierIndex >= 9 ? "0 Minutes" : formatUrgencyCountdown(nextChangeMs - nowMs);
  return { currentPrice, nextPrice, countdown };
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

function normalizeRecentBuys(rows: unknown): RecentBuyer[] {
  if (!Array.isArray(rows)) return [];

  return rows
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
}

function normalizeBestFriends(rows: unknown): BestFriend[] {
  if (!Array.isArray(rows)) return [];

  return rows
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const row = item as { fid?: unknown; mutualAffinityScore?: unknown; username?: unknown };
      if (typeof row.fid !== "number" || !Number.isFinite(row.fid)) return null;
      if (typeof row.mutualAffinityScore !== "number" || !Number.isFinite(row.mutualAffinityScore)) return null;
      if (typeof row.username !== "string" || row.username.trim().length === 0) return null;

      return {
        fid: row.fid,
        mutualAffinityScore: row.mutualAffinityScore,
        username: row.username,
      } satisfies BestFriend;
    })
    .filter((item): item is BestFriend => item !== null);
}

function rankBuyersWithBestFriends(buyers: RecentBuyer[], bestFriends: BestFriend[]): RecentBuyer[] {
  if (bestFriends.length === 0) return buyers.slice(0, 10);

  const bestFriendsByFid = new Map<number, BestFriend>();
  bestFriends.forEach((friend) => bestFriendsByFid.set(friend.fid, friend));

  const friendBuyers: RecentBuyer[] = [];
  const otherBuyers: RecentBuyer[] = [];

  buyers.forEach((buyer) => {
    if (bestFriendsByFid.has(buyer.fid)) {
      friendBuyers.push(buyer);
    } else {
      otherBuyers.push(buyer);
    }
  });

  friendBuyers.sort((a, b) => {
    const aScore = bestFriendsByFid.get(a.fid)?.mutualAffinityScore ?? 0;
    const bScore = bestFriendsByFid.get(b.fid)?.mutualAffinityScore ?? 0;
    return bScore - aScore;
  });

  return [...friendBuyers, ...otherBuyers].slice(0, 10);
}

function normalizeOutreachCandidates(value: unknown): OutreachCandidate {
  if (!value || typeof value !== "object") {
    return { farcasterUsernames: [], xUsernames: [], tokenIds: [] };
  }

  const raw = value as { farcasterUsernames?: unknown; xUsernames?: unknown; tokenIds?: unknown };
  const farcasterUsernames = Array.isArray(raw.farcasterUsernames)
    ? raw.farcasterUsernames
      .filter((item): item is string => typeof item === "string" && item.trim().length > 0)
      .map((item) => item.trim())
      .slice(0, 10)
    : [];
  const xUsernames = Array.isArray(raw.xUsernames)
    ? raw.xUsernames
      .filter((item): item is string => typeof item === "string" && item.trim().length > 0)
      .map((item) => item.trim())
      .slice(0, 10)
    : [];

  const tokenIds = Array.isArray(raw.tokenIds)
    ? raw.tokenIds
      .filter((item): item is number => typeof item === "number" && Number.isInteger(item) && item > 0)
      .slice(0, 10)
    : [];

  return { farcasterUsernames, xUsernames, tokenIds };
}

function buildCastVerificationUrl(hash: string, username: string): string {
  const cleanHash = hash.trim();
  const cleanUsername = username.trim();
  if (cleanUsername.length > 0) {
    return `https://farcaster.xyz/${cleanUsername}/${cleanHash}`;
  }
  return `https://farcaster.xyz/~/conversations/${cleanHash}`;
}

function ActionChevronRightIcon() {
  return (
    <svg
      className="h-6 w-6"
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      focusable="false"
    >
      <path
        d="M9.5 5L16 12L9.5 19"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function ActionCheckIcon() {
  return (
    <svg
      className="h-6 w-6"
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      focusable="false"
    >
      <path
        d="M5 12.5L10 17L19 8"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
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
  const [hasRewarded, setHasRewarded] = useState(false);
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
  const [waitlistStatusMessage, setWaitlistStatusMessage] = useState("");
  const [showWaitlistModal, setShowWaitlistModal] = useState(false);
  const [recentBuys, setRecentBuys] = useState<RecentBuyer[]>([]);
  const [rewardedUsers, setRewardedUsers] = useState<RecentBuyer[]>([]);
  const [bestFriends, setBestFriends] = useState<BestFriend[]>([]);
  const [outreachCandidates, setOutreachCandidates] = useState<OutreachCandidate>({ farcasterUsernames: [], xUsernames: [], tokenIds: [] });
  const [showUnlockRewardPage, setShowUnlockRewardPage] = useState(false);
  const [rewardActions, setRewardActions] = useState<RewardAction[]>([]);
  const [rewardActionsLoading, setRewardActionsLoading] = useState(false);
  const [runningActionSlug, setRunningActionSlug] = useState<string | null>(null);
  const [didUnlockCelebrate, setDidUnlockCelebrate] = useState(false);
  const [pendingActionUntilMs, setPendingActionUntilMs] = useState<Record<string, number>>({});
  const [optimisticCompletedActions, setOptimisticCompletedActions] = useState<Record<string, boolean>>({});
  const [actionSessionToken, setActionSessionToken] = useState<string>("");
  const [pendingNotificationId, setPendingNotificationId] = useState<string | null>(null);
  const [notificationOpenSent, setNotificationOpenSent] = useState(false);

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
        const res = await fetch("/api/warplet-status");
        if (!res.ok) return;

        const data = (await res.json()) as RecentBuysResponse;
        const buyers = normalizeRecentBuys(data.buyers);
        const friends = normalizeBestFriends(data.bestFriends);
        setBestFriends(friends);
        setRecentBuys(rankBuyersWithBestFriends(buyers, friends));
        setRewardedUsers(normalizeRecentBuys(data.rewardedUsers));
        setOutreachCandidates(normalizeOutreachCandidates(data.outreachCandidates));
        setActionSessionToken(typeof data.actionSessionToken === "string" ? data.actionSessionToken : "");
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

        // If launched from a notification, stage open-tracking until we have a signed action session token.
        const loc = context.location as { type?: string; notification?: { notificationId?: string } } | undefined;
        if (loc?.type === "notification" && loc.notification?.notificationId) {
          setPendingNotificationId(loc.notification.notificationId);
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
        setActionSessionToken(typeof data.actionSessionToken === "string" ? data.actionSessionToken : "");
        const buyers = normalizeRecentBuys(data.recentBuys);
        setRewardedUsers(normalizeRecentBuys(data.rewardedUsers));
        setOutreachCandidates(normalizeOutreachCandidates(data.outreachCandidates));

        try {
          const friendsRes = await fetch(`/api/warplet-status?fid=${context.user.fid}`);
          if (friendsRes.ok) {
            const friendsData = (await friendsRes.json()) as RecentBuysResponse;
            if (typeof friendsData.actionSessionToken === "string" && friendsData.actionSessionToken.length > 0) {
              setActionSessionToken(friendsData.actionSessionToken);
            }
            const friends = normalizeBestFriends(friendsData.bestFriends);
            setBestFriends(friends);
            setRecentBuys(rankBuyersWithBestFriends(buyers, friends));
          } else if (buyers.length > 0) {
            setRecentBuys(buyers);
          }
        } catch {
          if (buyers.length > 0) {
            setRecentBuys(buyers);
          }
        }

        if (typeof data.rarityValue === "number" && (data.buyInOpenseaOn || data.buyInFarcasterWalletOn)) {
          setPurchasedTokenId(String(data.rarityValue));
        }

        setHasRewarded(Boolean(data.rewardedOn));

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

  useEffect(() => {
    if (!pendingNotificationId || notificationOpenSent || !actionSessionToken) return;

    fetch("/api/notifications/open", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        notificationId: pendingNotificationId,
        sessionToken: actionSessionToken,
        appSlug: "drop",
      }),
    })
      .then(() => {
        setNotificationOpenSent(true);
      })
      .catch(() => {
        // Fire-and-forget telemetry; never block UX.
      });
  }, [actionSessionToken, notificationOpenSent, pendingNotificationId]);

  const searchParams = typeof window !== "undefined" ? new URLSearchParams(window.location.search) : new URLSearchParams();
  const forceNoMatch = typeof window !== "undefined" && searchParams.get("match") === "false";
  const debugEnabled = typeof window !== "undefined" && searchParams.get("debug") === "1";
  const forceUnlock = typeof window !== "undefined" && searchParams.get("unlock") === "1";
  const forceActionsPage = typeof window !== "undefined" && searchParams.get("actions") === "1";
  const currentHost = typeof window !== "undefined" ? window.location.host : "";
  const showDebugChip = debugEnabled;
  const isMatched = !forceNoMatch && Boolean(status?.matched && typeof status.rarityValue === "number");
  const hasPurchased = !forceNoMatch && Boolean(purchasedTokenId);
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
    ? `https://warplets.10x.meme/${purchasedTokenId}.webp`
    : isMatched
      ? `https://warplets.10x.meme/${status?.rarityValue}.avif`
      : "https://warplets.10x.meme/3081.png";
  const title = hasPurchased
    ? "Welcome to 10X! Want rewards?"
    : isMatched
      ? "Congratulations! You're on the list..."
      : "Aw Snap... You're not on the list.";
  const badgeLabel = hasPurchased
    ? "🎉 NFT Drop Claimed"
    : isMatched
      ? "🔓 Private 10K NFT Drop"
      : "🔒 Private 10K NFT Drop";
  const buttonLabel = hasPurchased
    ? "🎁 Unlock Rewards"
    : isMatched
      ? isPurchasing
        ? "Processing in Wallet..."
        : "Buy in Farcaster Wallet"
      : "🎁 But! Click Here To Unlock Rewards";
  const shareButtonPulseClass = hasPurchased && !hasRewarded ? "share-cta-pulse-x" : "";
  const urgencyMessage = isMatched && !hasPurchased
    ? getUrgencyMessage(typeof status?.rarityValue === "number" ? status.rarityValue : null, nowMs)
    : null;
  const showWaitlistCta = hasRewarded || (!isMatched && hasClickedOpenSea);
  const avatarUsers = hasPurchased || !isMatched ? rewardedUsers : recentBuys;
  const avatarLabel = hasPurchased || !isMatched ? "Rewarded:" : "Buyers:";
  const displayRewardActions = (forceUnlock
    ? rewardActions.map((action) => ({ ...action, completed: true }))
    : rewardActions.map((action) => ({
        ...action,
        completed: action.completed || optimisticCompletedActions[action.slug] === true,
      })));
  const completedActionsCount = displayRewardActions.reduce((count, action) => (action.completed ? count + 1 : count), 0);
  const unlockedRewardCount = forceUnlock ? 5 : Math.min(5, Math.floor(completedActionsCount / 2));
  const hasAnyUnlockedRewards = unlockedRewardCount > 0;
  const rewardChecklistRows = [
    { emoji: "😍", index: 1, title: "More Warplets!" },
    { emoji: "🤓", index: 2, title: "Buyers Cheatsheet" },
    { emoji: "🤯", index: 3, title: "The Matrix Explained" },
    { emoji: "🤣", index: 4, title: "The Matrix Uploaded" },
    { emoji: "💰", index: 5, title: "Fuel for Builders" },
  ];
  const actionsNeededForReward = (rewardIndex: number): number => {
    const requiredActions = rewardIndex * 2;
    return Math.max(0, requiredActions - completedActionsCount);
  };
  const rewardTokenId = !isMatched
    ? "760"
    : (purchasedTokenId ?? (typeof status?.rarityValue === "number" ? String(status.rarityValue) : null));
  const castOutreach = outreachCandidates.farcasterUsernames.slice(0, 10).join(" ");
  const tweetOutreach = outreachCandidates.xUsernames.slice(0, 10).join(" ");
  const headerTitle = showUnlockRewardPage && !isMenuRoute
    ? "Unlock Rewards"
    : getHeaderTitle("drop", isMenuRoute);
  const pageBadgeLabel = showUnlockRewardPage ? "Help 10X Warplets Go Viral!" : badgeLabel;
  const pageTitle = showUnlockRewardPage ? "Complete actions 👉 Unlock rewards" : title;

  const fetchRewardActions = async (showLoading = true): Promise<RewardAction[]> => {
    if (showLoading) {
      setRewardActionsLoading(true);
    }
    try {
      const query = actionSessionToken
        ? `?appSlug=drop&sessionToken=${encodeURIComponent(actionSessionToken)}`
        : "?appSlug=drop";
      const response = await fetch(`/api/actions${query}`);
      if (!response.ok) {
        throw new Error(await readErrorResponse(response));
      }
      const data = (await response.json()) as { actions?: RewardAction[] };
      if (Array.isArray(data.actions)) {
        setRewardActions(data.actions);
        return data.actions;
      } else {
        setRewardActions([]);
        return [];
      }
    } catch (err) {
      console.error("Failed to load reward actions:", err);
      setActionError(getErrorMessage(err));
      setRewardActions([]);
      return [];
    } finally {
      if (showLoading) {
        setRewardActionsLoading(false);
      }
    }
  };

  const completeRewardAction = async (
    actionSlug: string,
    verification: string | null,
    outreachTokenIds?: number[]
  ) => {
    if (!fid || !actionSessionToken) return;

    const response = await fetch("/api/actions-complete", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        fid,
        actionSlug,
        verification: verification ?? undefined,
        outreachTokenIds: outreachTokenIds && outreachTokenIds.length > 0 ? outreachTokenIds : undefined,
        sessionToken: actionSessionToken,
      }),
    });

    if (!response.ok) {
      throw new Error(await readErrorResponse(response));
    }
  };

  const isActionPending = (slug: string): boolean => (pendingActionUntilMs[slug] ?? 0) > Date.now();
  const isActionCompleted = (action: RewardAction): boolean => action.completed || optimisticCompletedActions[action.slug] === true;

  const isAssumeSuccessActionSlug = (slug: string): boolean => (
    slug === "drop-follow-x-10xmeme" ||
    slug === "drop-follow-x-10xchris" ||
    slug === "drop-join-telegram" ||
    slug === "drop-email-10x"
  );

  const getActionDisplayName = (action: RewardAction): string => {
    if (action.slug === "drop-cast") return "Post on Farcaster";
    if (action.slug === "drop-follow-fc-10xmeme") return "Follow @10XMeme.eth";
    if (action.slug === "drop-follow-fc-10xchris") return "Follow @10XChris.eth";
    if (action.slug === "drop-follow-x-10xmeme") return "Follow @10XMemeX on X";
    if (action.slug === "drop-follow-x-10xchris") return "Follow @10XChrisX on X";
    if (action.slug === "drop-email-10x") return "Email 10x@10x.meme";
    return action.name;
  };

  const refreshStatusForRewardPage = async (currentFid: number) => {
    const statusRes = await fetch("/api/warplet-status", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ fid: currentFid }),
    });
    if (!statusRes.ok) return;
    const nextStatus = (await statusRes.json()) as WarpletStatus;
    setStatus(nextStatus);
    setActionSessionToken(typeof nextStatus.actionSessionToken === "string" ? nextStatus.actionSessionToken : "");
    setOutreachCandidates(normalizeOutreachCandidates(nextStatus.outreachCandidates));
  };

  const setActionPendingThenComplete = (slug: string) => {
    const completeAtMs = Date.now() + 10000;
    setPendingActionUntilMs((prev) => ({ ...prev, [slug]: completeAtMs }));
    window.setTimeout(() => {
      setPendingActionUntilMs((prev) => ({ ...prev, [slug]: 0 }));
      setOptimisticCompletedActions((prev) => ({ ...prev, [slug]: true }));
    }, 10000);
  };

  const runRewardAction = async (action: RewardAction) => {
    if (!fid || runningActionSlug) return;
    if (isActionPending(action.slug)) return;

    setRunningActionSlug(action.slug);
    setActionError("");
    const alreadyCompleted = isActionCompleted(action);
    if (!alreadyCompleted) {
      setActionPendingThenComplete(action.slug);
    }

    try {
      if (action.slug === "drop-follow-fc-10xmeme") {
        await sdk.actions.viewProfile({ fid: 1313340 });
        if (!alreadyCompleted) {
          completeRewardAction(action.slug, `opened:${new Date().toISOString()}`).catch(() => {});
        }
      } else if (action.slug === "drop-follow-fc-10xchris") {
        await sdk.actions.viewProfile({ fid: 1129138 });
        if (!alreadyCompleted) {
          completeRewardAction(action.slug, `opened:${new Date().toISOString()}`).catch(() => {});
        }
      } else if (action.slug === "drop-join-fc-channel") {
        await sdk.actions.openUrl("https://farcaster.xyz/~/channel/10xmeme");
        if (!alreadyCompleted) {
          completeRewardAction(action.slug, `opened:${new Date().toISOString()}`).catch(() => {});
        }
      } else if (isAssumeSuccessActionSlug(action.slug)) {
        if (action.url) {
          await sdk.actions.openUrl(action.url);
        }
        if (!alreadyCompleted) {
          completeRewardAction(action.slug, `opened:${new Date().toISOString()}`).catch(() => {});
        }
      } else if (action.slug === "drop-cast") {
        const urgency = getUrgencyDetails(nowMs);
        const castRarityLine = formattedTokenId && topPercentLabel
          ? `My rarity #${formattedTokenId} of 10,000! 👀`
          : "My rarity is 10,000! 👀";
        const outreachLine = castOutreach.length > 0 ? `\n\nFYI you're on the list ${castOutreach}` : "";
        const raritySection = isMatched ? `\n\n${castRarityLine}\n\n...what's your rarity?` : "";
        const castResult = await sdk.actions.composeCast({
          text:
            `🟢 10X Warplets (Private 10K NFT Drop)\n\nPrice $${urgency.currentPrice} → $${urgency.nextPrice} in ${urgency.countdown}.\nSupply private → public every 10 days.\nAre you on the list? Don't miss out.${raritySection}${outreachLine}`,
          embeds: purchasedTokenId
            ? ["https://drop.10x.meme", `https://warplets.10x.meme/${purchasedTokenId}.${SHARE_IMAGE_EXTENSION}`]
            : ["https://drop.10x.meme"],
        });
        if (!alreadyCompleted) {
          const verification = castResult?.cast?.hash
            ? buildCastVerificationUrl(castResult.cast.hash, viewerUsername)
            : `dismissed:${new Date().toISOString()}`;
          completeRewardAction(action.slug, verification, outreachCandidates.tokenIds).catch(() => {});
        }
      } else if (action.slug === "drop-tweet") {
        const urgency = getUrgencyDetails(nowMs);
        const castRarityLine = formattedTokenId && topPercentLabel
          ? `My rarity #${formattedTokenId} of 10,000! 👀`
          : "My rarity is 10,000! 👀";
        const outreachLine = tweetOutreach.length > 0 ? `FYI you're on the list ${tweetOutreach}\n\n` : "";
        const raritySection = isMatched ? `${castRarityLine}\n\n...what's your rarity?\n\n` : "";
        const text = `🟢 10X Warplets (Private 10K NFT Drop)\n\nPrice $${urgency.currentPrice} → $${urgency.nextPrice} in ${urgency.countdown}.\nSupply private → public every 10 days.\nAre you on the list? Don't miss out.\n\n1️⃣ Join Farcaster: https://farcaster.xyz/~/code/RUZLHN\n2️⃣ Visit mini-app: https://farcaster.xyz/miniapps/cSNbxgFkuFRi/10x-warplets-drop\n\n${raritySection}${outreachLine}`;
        const intentUrl = `https://x.com/intent/post?${new URLSearchParams({
          text,
          url: "",
          hashtags: "10XWarplets",
          via: "10XMemeX",
        }).toString()}`;
        await sdk.actions.openUrl(intentUrl);
        if (!alreadyCompleted) {
          completeRewardAction(action.slug, intentUrl, outreachCandidates.tokenIds).catch(() => {});
        }
      } else if (action.slug === "drop-waitlist-email") {
        // Waitlist action uses email submit flow below.
      } else if (action.url) {
        await sdk.actions.openUrl(action.url);
      }

      fetchRewardActions(false).catch(() => {});
      refreshStatusForRewardPage(fid).catch(() => {});
    } catch (err) {
      console.error("Failed to run reward action:", err);
      setActionError(getErrorMessage(err));
    } finally {
      setRunningActionSlug(null);
    }
  };

  const handleWaitlistRewardAction = async (action: RewardAction) => {
    if (!fid) {
      setActionError("Your Farcaster account is not ready yet.");
      return;
    }

    if (!waitlistEmail.trim()) {
      setActionError("Please enter a valid email.");
      return;
    }

    setRunningActionSlug(action.slug);
    setWaitlistSubmitting(true);
    setActionError("");
    setWaitlistStatusMessage("");

    try {
      const response = await fetch("/api/email/subscribe", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email: waitlistEmail.trim(),
          fid,
          sessionToken: actionSessionToken || undefined,
          username: viewerUsername || undefined,
          tokenId: typeof status?.rarityValue === "number" ? status.rarityValue : null,
          matched: Boolean(isMatched),
        }),
      });

      if (!response.ok) {
        const text = await response.text();
        throw new Error(text || "Failed to join waitlist.");
      }

      const payload = (await response.json()) as { alreadyVerified?: boolean; verificationEmailSent?: boolean };
      setWaitlistSubmitted(true);
      if (payload.alreadyVerified) {
        await completeRewardAction(action.slug, `email:${waitlistEmail.trim().toLowerCase()}`);
        setWaitlistStatusMessage("Email already verified. Action completed.");
      } else {
        setWaitlistStatusMessage(payload.verificationEmailSent
          ? "Verification email sent. Verify your email to unlock this action."
          : "Subscribed. Please verify your email to unlock this action.");
      }
      setShowWaitlistModal(false);

      await fetchRewardActions();
      await refreshStatusForRewardPage(fid);
    } catch (err) {
      setActionError(getErrorMessage(err));
    } finally {
      setWaitlistSubmitting(false);
      setRunningActionSlug(null);
    }
  };

  const handlePrimaryAction = async () => {
    if (hasPurchased && purchasedTokenId) {
      setActionError("");
      launchTopConfetti();

      try {
        const urgency = getUrgencyDetails(nowMs);
        const castRarityLine = formattedTokenId && topPercentLabel
          ? `My rarity #${formattedTokenId} of 10,000! 👀`
          : "My rarity is 10,000! 👀";
        const outreachLine = castOutreach.length > 0 ? `\n\nFYI you're on the list ${castOutreach}` : "";
        const castResult = await sdk.actions.composeCast({
          text:
            `🟢 10X Warplets (Private 10K NFT Drop)\n\nPrice $${urgency.currentPrice} → $${urgency.nextPrice} in ${urgency.countdown}.\nSupply private → public every 10 days.\nAre you on the list? Don't miss out.\n\n${castRarityLine}\n\n...what's your rarity?${outreachLine}`,
          embeds: ["https://drop.10x.meme", `https://warplets.10x.meme/${purchasedTokenId}.${SHARE_IMAGE_EXTENSION}`],
        });

        if (castResult?.cast?.hash && fid) {
          const verification = buildCastVerificationUrl(castResult.cast.hash, viewerUsername);
          await completeRewardAction("drop-cast", verification, outreachCandidates.tokenIds);
          await fetchRewardActions();
          await refreshStatusForRewardPage(fid);
        }
      } catch (err) {
        console.error("Failed to open cast composer:", err);
        const message = getErrorMessage(err).toLowerCase();
        const userRejected = message.includes("rejected by user");
        if (!userRejected) {
          setActionError(getErrorMessage(err));
        }
      } finally {
        setShowUnlockRewardPage(true);
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
        setStatus(prev => (prev ? { ...prev, buyInFarcasterWalletOn: new Date().toISOString() } : prev));
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

    setActionError("");

    try {
      const urgency = getUrgencyDetails(nowMs);
      const outreachLine = castOutreach.length > 0 ? `\n\nFYI you're on the list ${castOutreach}` : "";
      const castResult = await sdk.actions.composeCast({
        text:
          `🟢 10X Warplets (Private 10K NFT Drop)\n\nPrice $${urgency.currentPrice} → $${urgency.nextPrice} in ${urgency.countdown}.\nSupply private → public every 10 days.\nAre you on the list? Don't miss out.${outreachLine}`,
        embeds: ["https://drop.10x.meme"],
      });

      if (castResult?.cast?.hash && fid) {
        const verification = buildCastVerificationUrl(castResult.cast.hash, viewerUsername);
        await completeRewardAction("drop-cast", verification, outreachCandidates.tokenIds);
        await fetchRewardActions();
        await refreshStatusForRewardPage(fid);
      }
    } catch (err) {
      console.error("Failed to open cast composer:", err);
      const message = getErrorMessage(err).toLowerCase();
      const userRejected = message.includes("rejected by user");
      if (!userRejected) {
        setActionError(getErrorMessage(err));
      }
    } finally {
      setShowUnlockRewardPage(true);
    }
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
          sessionToken: actionSessionToken || undefined,
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

  useEffect(() => {
    if (!showUnlockRewardPage || !fid) return;
    fetchRewardActions().catch(() => {});
  }, [showUnlockRewardPage, fid, actionSessionToken]);

  useEffect(() => {
    if (loading || error || !fid || !actionSessionToken || showUnlockRewardPage || forceUnlock || forceActionsPage) return;

    fetchRewardActions(false)
      .then((actions) => {
        if (actions.some((action) => action.completed)) {
          setShowUnlockRewardPage(true);
        }
      })
      .catch(() => {});
  }, [loading, error, fid, actionSessionToken, showUnlockRewardPage, forceUnlock, forceActionsPage]);

  useEffect(() => {
    if (!forceUnlock && !forceActionsPage) return;
    setShowUnlockRewardPage(true);
  }, [forceUnlock, forceActionsPage]);

  useEffect(() => {
    if (!showUnlockRewardPage || !hasAnyUnlockedRewards || didUnlockCelebrate) return;
    launchTopConfetti();
    setDidUnlockCelebrate(true);
  }, [showUnlockRewardPage, hasAnyUnlockedRewards, didUnlockCelebrate]);

  return (
    <MiniAppShell>
      <div className="relative z-10 w-full">
        <MiniAppHeader
          appSlug="drop"
          title={headerTitle}
          canGoBack={canGoBack}
          onBack={actions.goBack}
          onLogo={actions.openHubRoot}
          onMenu={actions.openMenu}
        />
      </div>

      {isMenuRoute ? (
        <div className="relative z-10 w-full">
          <MiniAppMenuPage appSlug="drop" />
        </div>
      ) : (
        <div className="relative z-10 w-full max-w-md mx-auto text-center space-y-2 px-4 pt-2">
          <div className="relative px-4 pt-2 text-center mb-4">
            <Text className="text-[clamp(1.6rem,5vw,1.6rem)] font-bold leading-tight whitespace-nowrap" style={{ color: "#00FF00" }}>
              {pageBadgeLabel}
            </Text>
            <Text className="mt-3 text-lg font-semibold" style={{ color: "#00FF00" }}>
              {pageTitle}
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

          {!loading && !error && !showOpenInFarcaster && showUnlockRewardPage && (
            <div className="space-y-4 px-4 pb-28">
              {rewardActionsLoading && (
                <Text className="text-sm text-center" style={{ color: "#b7ffb7" }}>
                  Loading reward tasks...
                </Text>
              )}

              {!rewardActionsLoading && displayRewardActions.length === 0 && (
                <Text className="text-sm text-center" style={{ color: "#b7ffb7" }}>
                  Reward tasks will appear here soon.
                </Text>
              )}

              {!rewardActionsLoading && displayRewardActions.length > 0 && (
                <div className="rounded-2xl border border-[#00FF00]/35 bg-[#041204]/85 px-3 py-0">
                  {[
                    "drop-cast",
                    "drop-tweet",
                    "drop-follow-fc-10xmeme",
                    "drop-follow-fc-10xchris",
                    "drop-follow-x-10xmeme",
                    "drop-follow-x-10xchris",
                    "drop-join-fc-channel",
                    "drop-join-telegram",
                    "drop-waitlist-email",
                    "drop-email-10x",
                  ]
                    .map((slug) => displayRewardActions.find((action) => action.slug === slug))
                    .filter((action): action is RewardAction => Boolean(action))
                    .map((action, index) => {
                      const actionCompleted = isActionCompleted(action);
                      const actionPending = isActionPending(action.slug);
                      const actionFlat = actionCompleted || actionPending;

                      return (
                    <div
                      key={action.id}
                      onClick={() => {
                        if (actionPending || runningActionSlug === action.slug) return;
                        if (action.slug === "drop-waitlist-email" && !actionCompleted) {
                          setShowWaitlistModal(true);
                          return;
                        }
                        runRewardAction(action).catch(() => {});
                      }}
                      className={`px-2 py-2 text-left cursor-pointer ${index > 0 ? "border-t border-[#00FF00]/15" : ""}`}
                      role="button"
                      tabIndex={0}
                      onKeyDown={(event) => {
                        if (event.key !== "Enter" && event.key !== " ") return;
                        event.preventDefault();
                        if (actionPending || runningActionSlug === action.slug) return;
                        if (action.slug === "drop-waitlist-email" && !actionCompleted) {
                          setShowWaitlistModal(true);
                          return;
                        }
                        runRewardAction(action).catch(() => {});
                      }}
                    >
                      <div className="flex items-center justify-between gap-3">
                        <Text className="text-base font-bold" style={{ color: "#00FF00" }}>
                          {getActionDisplayName(action)}
                        </Text>
                        <button
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation();
                            if (actionPending || runningActionSlug === action.slug) return;
                            if (action.slug === "drop-waitlist-email" && !actionCompleted) {
                              setShowWaitlistModal(true);
                              return;
                            }
                            runRewardAction(action).catch(() => {});
                          }}
                          disabled={actionPending || runningActionSlug === action.slug}
                          className={`h-10 w-10 shrink-0 rounded-[10px] text-4xl leading-none font-black transition-all duration-100 cursor-pointer inline-flex items-center justify-center ${
                            actionFlat
                              ? actionCompleted
                                ? "border border-[#00FF00] shadow-none active:translate-x-0 active:translate-y-0 active:shadow-none"
                                : "border border-gray-700 shadow-none active:translate-x-0 active:translate-y-0 active:shadow-none"
                              : "border border-[#009900] bg-[#00FF00] shadow-[2px_4px_0_#008000] active:translate-x-[1px] active:translate-y-[2px] active:shadow-[1px_2px_0_#008000]"
                          }`}
                          style={{
                            backgroundColor: actionCompleted ? "rgb(0, 80, 0)" : (actionPending ? "#374151" : undefined),
                            color: actionCompleted ? "#00FF00" : (actionPending ? "white" : "rgb(0, 80, 0)"),
                          }}
                        >
                          {actionCompleted ? <ActionCheckIcon /> : (
                            actionPending || runningActionSlug === action.slug ? (
                              <span className="inline-block h-5 w-5 rounded-full border-2 border-white border-r-transparent align-middle animate-spin" />
                            ) : <ActionChevronRightIcon />
                          )}
                        </button>
                      </div>
                    </div>
                  )})}
                </div>
              )}

              <div className="mt-2 space-y-5">
                <div className="space-y-3">
                  <Text className="text-lg font-bold text-left" style={{ color: "#00FF00" }}>
                    {unlockedRewardCount >= 1 ? "😍 Reward #1 More Warplets!" : "😍 Reward #1"}
                  </Text>
                  <div className="rounded-2xl border border-[#00FF00]/35 bg-[#041204]/85 px-4 py-4 space-y-4">
                    {unlockedRewardCount >= 1 ? (
                    <div className="text-left">
                      <Text className="mt-1 text-sm" style={{ color: "#b7ffb7" }}>
                        {!isMatched
                          ? "Each 10X Warplet NFT has 6 formats available!"
                          : "Each 10X Warplet NFT has 6 formats available!"}
                      </Text>
                      <Text className="mt-1 text-sm" style={{ color: "#b7ffb7" }}>
                        {!isMatched
                          ? "Download our collections mascot Warplet #760 in a variety of image and video formats."
                          : "Download your Warplet in a variety of image and video formats."}
                      </Text>
                      <Text className="mt-1 text-sm" style={{ color: "#b7ffb7" }}>
                        {!isMatched
                          ? "Perfect for sharing on social media, articles, videos and memes!"
                          : "Perfect for sharing on social media, using as your profile picture, or just flexing your NFT!"}
                      </Text>
                      <Text className="mt-1 text-sm" style={{ color: "#b7ffb7" }}>
                        CC0 (Creative Commons Zero) licensed.
                      </Text>
                      <Text className="mt-1 text-sm" style={{ color: "#b7ffb7" }}>
                        Expand the Warplets universe.
                      </Text>
                      <Text className="mt-1 text-md font-bold" style={{ color: "#b7ffb7" }}>
                        Build. Remix. Have fun!
                      </Text>
                      {rewardTokenId && (
                        <div className="mt-4 grid grid-cols-2 gap-3">
                            {[
                              { ext: "gif", label: ".GIF 500x500 ~5MB" },
                              { ext: "mp4", label: ".MP4 1024x1024 ~2MB" },
                              { ext: "avif", label: ".AVIF 1024x1024 ~0.5MB" },
                              { ext: "webp", label: ".WEBP 1024x1024 ~0.25MB" },
                              { ext: "png", label: ".PNG 1024x1024 ~1MB" },
                              { ext: "jpg", label: ".JPG 256x256 ~0.01MB" },
                            ].map((item) => (
                              <div
                                key={item.ext}
                                className="rounded-2xl border border-[#00FF00]/35 bg-[#031103] p-0 overflow-hidden"
                              >
                                <button
                                  type="button"
                                  onClick={() => {
                                    const url = `https://warplets.10x.meme/${rewardTokenId}.${item.ext}`;
                                    sdk.actions.openUrl(url).catch(() => {});
                                  }}
                                  className="w-full aspect-square overflow-hidden rounded-t-xl rounded-b-none bg-black cursor-pointer block"
                                >
                                  {item.ext === "mp4" ? (
                                    <video
                                      src={`https://warplets.10x.meme/${rewardTokenId}.${item.ext}`}
                                      className="h-full w-full object-cover"
                                      muted
                                    loop
                                    autoPlay
                                    playsInline
                                  />
                                ) : (
                                  <img
                                    src={`https://warplets.10x.meme/${rewardTokenId}.${item.ext}`}
                                    alt={item.label}
                                    className="h-full w-full object-cover"
                                      loading="lazy"
                                    />
                                  )}
                                </button>
                                <button
                                  type="button"
                                  onClick={() => {
                                    const url = `https://warplets.10x.meme/${rewardTokenId}.${item.ext}`;
                                    sdk.actions.openUrl(url).catch(() => {});
                                  }}
                                  className="w-full rounded-none border-0 bg-[#00FF00] px-2 py-2 text-[11px] font-bold text-center transition-all duration-100 cursor-pointer"
                                  style={{ color: "rgb(0, 80, 0)" }}
                                >
                                  <span className="flex flex-col leading-tight">
                                    {item.label.split(" ").map((part) => (
                                      <span key={`${item.ext}-${part}`}>{part}</span>
                                    ))}
                                  </span>
                                </button>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                    ) : (
                      <Text className="text-sm font-semibold text-left" style={{ color: "#b7ffb7" }}>
                        {`🔒 ${actionsNeededForReward(1)} actions needed to unlock.`}
                      </Text>
                    )}
                  </div>
                </div>

                <div className="space-y-3">
                  <Text className="text-lg font-bold text-left" style={{ color: "#00FF00" }}>
                    {unlockedRewardCount >= 2 ? "🤓 Reward #2 Buyers Cheatsheet" : "🤓 Reward #2"}
                  </Text>
                  <div className="rounded-2xl border border-[#00FF00]/35 bg-[#041204]/85 px-4 py-4 space-y-4">
                    {unlockedRewardCount >= 2 ? (
                    <div className="text-left">
                      <Text className="mt-1 text-sm leading-relaxed" style={{ color: "#b7ffb7" }}>
                        Download the full 10X Warplets metadata spreadsheet. Use this to dig deep into the collections data points that formed each NFTs rarity. Filter, Sort, Search with ease. It's your cheatsheet to finding the best warplets on the market!{" "}
                        <button
                          type="button"
                          className="underline cursor-pointer"
                          style={{ color: "#00FF00" }}
                          onClick={() => {
                            sdk.actions.openUrl("https://link.10x.meme/csv").catch(() => {});
                          }}
                        >
                          https://link.10x.meme/csv
                        </button>
                      </Text>
                    </div>
                    ) : (
                      <Text className="text-sm font-semibold text-left" style={{ color: "#b7ffb7" }}>
                        {`🔒 ${actionsNeededForReward(2)} actions needed to unlock.`}
                      </Text>
                    )}
                  </div>
                </div>

                <div className="space-y-3">
                  <Text className="text-lg font-bold text-left" style={{ color: "#00FF00" }}>
                    {unlockedRewardCount >= 3 ? "🤯 Reward #3 The Matrix Explained" : "🤯 Reward #3"}
                  </Text>
                  <div className="rounded-2xl border border-[#00FF00]/35 bg-[#041204]/85 px-4 py-4 space-y-4">
                    {unlockedRewardCount >= 3 ? (
                    <div className="text-left">
                      <Text className="mt-1 text-sm leading-relaxed" style={{ color: "#b7ffb7" }}>
                        The Matrix lore is weaved into the 10X Warplets. Revisits the iconic red pill scene: choice, control, and waking up from comforting illusions.
                      </Text>
                      <button
                        type="button"
                        className="mt-2 underline cursor-pointer"
                        style={{ color: "#00FF00" }}
                        onClick={() => {
                          sdk.actions.openUrl("https://www.youtube.com/watch?v=6rrPP-QOF3k").catch(() => {});
                        }}
                      >
                        https://www.youtube.com/watch?v=6rrPP-QOF3k
                      </button>
                      <Text className="mt-2 text-sm leading-relaxed" style={{ color: "#b7ffb7" }}>
                        Go deep into the making of The Matrix. Philosophy, cycles of control, simulated freedom, and the terrifying idea that even escaping the system may still be part of the system.
                      </Text>
                      <button
                        type="button"
                        className="mt-2 underline cursor-pointer"
                        style={{ color: "#00FF00" }}
                        onClick={() => {
                          sdk.actions.openUrl("https://www.youtube.com/watch?v=kK0JtvYg5-s").catch(() => {});
                        }}
                      >
                        https://www.youtube.com/watch?v=kK0JtvYg5-s
                      </button>
                    </div>
                    ) : (
                      <Text className="text-sm font-semibold text-left" style={{ color: "#b7ffb7" }}>
                        {`🔒 ${actionsNeededForReward(3)} actions needed to unlock.`}
                      </Text>
                    )}
                  </div>
                </div>

                <div className="space-y-3">
                  <Text className="text-lg font-bold text-left" style={{ color: "#00FF00" }}>
                    {unlockedRewardCount >= 4 ? "🤣 Reward #4 The Matrix Uploaded" : "🤣 Reward #4"}
                  </Text>
                  <div className="rounded-2xl border border-[#00FF00]/35 bg-[#041204]/85 px-4 py-4 space-y-4">
                    {unlockedRewardCount >= 4 ? (
                    <div className="text-left">
                      <Text className="mt-1 text-sm leading-relaxed" style={{ color: "#b7ffb7" }}>
                        10X Warplets are all about having FUN! Checkout this hillarious playlist of videos on YouTube:{" "}
                        <button
                          type="button"
                          className="underline cursor-pointer"
                          style={{ color: "#00FF00" }}
                          onClick={() => {
                            sdk.actions.openUrl("https://www.youtube.com/watch?v=ug2aoVZYgaU&list=PLj-tHdTcFWloQkdL1Ps-JOSSPW-_VwQWx").catch(() => {});
                          }}
                        >
                          https://www.youtube.com/watch?v=ug2aoVZYgaU&list=PLj-tHdTcFWloQkdL1Ps-JOSSPW-_VwQWx
                        </button>
                      </Text>
                    </div>
                    ) : (
                      <Text className="text-sm font-semibold text-left" style={{ color: "#b7ffb7" }}>
                        {`🔒 ${actionsNeededForReward(4)} actions needed to unlock.`}
                      </Text>
                    )}
                  </div>
                </div>

                <div className="space-y-3">
                  <Text className="text-lg font-bold text-left" style={{ color: "#00FF00" }}>
                    {unlockedRewardCount >= 5 ? "💰 Reward #5 Fuel for Builders" : "💰 Reward #5"}
                  </Text>
                  <div className="rounded-2xl border border-[#00FF00]/35 bg-[#041204]/85 px-4 py-4 space-y-4">
                    {unlockedRewardCount >= 5 ? (
                    <div className="text-left">
                      <Text className="mt-1 text-sm leading-relaxed" style={{ color: "#b7ffb7" }}>
                        The $1M Warplet is in a Dutch Auction, with the listing price dropping from $1,000,000 to $100 over 30 days. From the sale of that NFT, 50% of the funds will be airdroped in $USDC. The actions you've completed here will award you Bonus entries into a competition to win this prize (if you choose to enter). The mini app for entering is still being built. You are early! Learn more about the $1M Warplet and Fuel for Builder airdrop on OpenSea:{" "}
                        <button
                          type="button"
                          className="underline cursor-pointer"
                          style={{ color: "#00FF00" }}
                          onClick={() => {
                            sdk.actions.openUrl("https://opensea.io/collection/1m-warplet-1-the-one").catch(() => {});
                          }}
                        >
                          https://opensea.io/collection/1m-warplet-1-the-one
                        </button>
                      </Text>
                    </div>
                    ) : (
                      <Text className="text-sm font-semibold text-left" style={{ color: "#b7ffb7" }}>
                        {`🔒 ${actionsNeededForReward(5)} actions needed to unlock.`}
                      </Text>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}

          {!loading && !error && !showOpenInFarcaster && showUnlockRewardPage && (
            <div className="fixed bottom-3 left-0 right-0 z-30 px-4">
              <div className="mx-auto w-full max-w-md rounded-xl border border-[#00FF00]/45 bg-black/85 px-4 py-3 backdrop-blur-sm">
                <Text className="text-xs font-semibold text-center" style={{ color: "#b7ffb7" }}>
                  Complete 2 Actions = Unlock Reward
                </Text>
                <Text className="mt-1 text-sm font-bold text-center" style={{ color: "#00FF00" }}>
                  {`Progress: ${completedActionsCount}/10 actions • ${unlockedRewardCount}/5 rewards`}
                </Text>
              </div>
            </div>
          )}

          {!loading && !error && !showOpenInFarcaster && showUnlockRewardPage && showWaitlistModal && (
            <div
              className="fixed inset-0 z-40 flex items-center justify-center px-4 bg-black/70 backdrop-blur-[2px]"
              onClick={() => setShowWaitlistModal(false)}
            >
              <div
                className="w-full max-w-sm rounded-2xl border border-[#00FF00]/45 bg-[#041204] p-5 shadow-[0_0_40px_rgba(0,255,0,0.15)]"
                onClick={(event) => event.stopPropagation()}
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <Text className="text-xl font-bold text-left" style={{ color: "#00FF00" }}>
                      Join 10X Meme Waitlist
                    </Text>
                    <Text className="mt-2 text-sm text-left" style={{ color: "#b7ffb7" }}>
                      Get in early. Don&apos;t miss out.
                    </Text>
                  </div>
                  <button
                    type="button"
                    aria-label="Close waitlist popup"
                    className="text-[#b7ffb7] hover:text-white text-lg font-bold leading-none cursor-pointer"
                    onClick={() => setShowWaitlistModal(false)}
                  >
                    X
                  </button>
                </div>

                <div className="mt-4 space-y-3">
                  <input
                    type="email"
                    value={waitlistEmail}
                    onChange={(event) => setWaitlistEmail(event.target.value)}
                    placeholder="Email"
                    className="w-full rounded-xl border border-[#00FF00]/35 bg-black/70 px-3 py-2 text-sm text-white outline-none"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      const waitlistAction = displayRewardActions.find((item) => item.slug === "drop-waitlist-email");
                      if (!waitlistAction) return;
                      handleWaitlistRewardAction(waitlistAction).catch(() => {});
                    }}
                    disabled={waitlistSubmitting || runningActionSlug === "drop-waitlist-email"}
                    className="w-full rounded-[14px] border border-[#009900] bg-[#00FF00] px-4 py-2.5 text-base font-bold shadow-[3px_6px_0_#008000] transition-all duration-100 active:translate-x-[1px] active:translate-y-[3px] active:shadow-[1px_3px_0_#008000] disabled:translate-x-0 disabled:translate-y-0 disabled:shadow-none disabled:bg-gray-700 disabled:border-gray-700 cursor-pointer"
                    style={{ color: "rgb(0, 80, 0)" }}
                  >
                    {waitlistSubmitting ? (
                      <span className="inline-block h-4 w-4 rounded-full border-2 border-[rgb(0,80,0)] border-r-transparent align-middle animate-spin" />
                    ) : "Continue"}
                  </button>
                  {waitlistStatusMessage && (
                    <Text className="text-xs text-left" style={{ color: "#b7ffb7" }}>
                      {waitlistStatusMessage}
                    </Text>
                  )}
                </div>
              </div>
            </div>
          )}

          {!loading && !error && !showOpenInFarcaster && !showUnlockRewardPage && (
            <div className="space-y-0">
              <div className="px-4 pb-5 pt-0 space-y-3">
                <div className="w-full rounded-[20px] p-[2px] bg-[#00FF00]/20 border border-[#00FF00]/45">
                  <img
                    src={imageUrl}
                    alt="Loading..."
                    className="w-full rounded-[18px]"
                    loading="eager"
                  />
                  {!hasPurchased && isMatched && displayTokenId && topPercentLabel && (
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

                {(hasPurchased || !isMatched) && (
                  <Text className="mt-3 text-lg font-semibold" style={{ color: "#b7ffb7" }}>
                    5 Rewards... 😍→🤓→🤯→🤣→💰!️
                  </Text>
                )}

                {avatarUsers.length > 0 && (
                  <div className="mt-4 flex items-center justify-center gap-2">
                    <Text className="text-sm font-semibold whitespace-nowrap" style={{ color: "#b7ffb7" }}>
                      {avatarLabel}
                    </Text>
                    <div className="flex flex-nowrap overflow-x-auto pb-1">
                      {avatarUsers.map((user) => (
                        <button
                          key={user.fid}
                          type="button"
                          className="h-8 w-8 min-h-8 min-w-8 shrink-0 rounded-full overflow-hidden cursor-pointer -ml-2 first:ml-0"
                          style={{ border: "2px solid #00FF00" }}
                          title={`View profile ${user.fid}`}
                          onClick={() => {
                            sdk.actions.viewProfile({ fid: user.fid }).catch(() => {});
                          }}
                        >
                          <img
                            src={user.pfpUrl}
                            alt={`User ${user.fid}`}
                            className="h-full w-full object-cover"
                            loading="lazy"
                          />
                        </button>
                      ))}
                    </div>
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
    </MiniAppShell>
  );
}





