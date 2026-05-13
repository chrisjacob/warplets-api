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
import {
  hapticError,
  hapticPrimaryTap,
  hapticStrongTap,
  hapticSuccess,
  hapticTap,
} from "./haptics";

type WarpletStatus = {
  fid: number;
  exists: boolean;
  matched: boolean;
  rarityValue: number | null;
  buyInOpenseaOn: string | null;
  buyInFarcasterWalletOn: string | null;
  buyTransactionId: string | null;
  transactionError: string | null;
  rewardedOn: string | null;
  recentBuys?: unknown;
  rewardedUsers?: unknown;
  outreachCandidates?: unknown;
  referralCount?: number;
  topReferrers?: unknown;
  actionSessionToken?: string | null;
  completedActionsCount?: number;
};

type RecentBuysResponse = {
  buyers?: unknown;
  bestFriends?: unknown;
  rewardedUsers?: unknown;
  outreachCandidates?: unknown;
  referralCount?: number;
  topReferrers?: unknown;
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

type OutreachRecipient = {
  tokenId: number;
  fid: number;
  farcasterUsername: string;
  xUsername: string | null;
  mutualAffinityScore: number | null;
  source: "best_friend" | "fallback";
};

type OutreachCandidate = {
  farcasterUsernames: string[];
  xUsernames: string[];
  tokenIds: number[];
  recipients: OutreachRecipient[];
};

type TopReferrer = {
  fid: number;
  username: string;
  pfpUrl: string;
  referrals: number;
};

function getEmailFromVerification(verification: string | null): string {
  const value = verification?.trim() ?? "";
  return value.startsWith("email:") ? value.slice("email:".length).trim() : "";
}

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
    conduitKey?: string;
  };
  approvals?: Array<{
    tokenAddress: string;
    spender: string;
    amount: string;
    conduitKey?: string;
  }>;
  transaction: {
    chainIdHex: string;
    to: string;
    value: `0x${string}`;
    function?: string | null;
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

type RawBasicOrderInput = {
  parameters?: {
    considerationToken: string;
    considerationIdentifier: number | string;
    considerationAmount: number | string;
    offerer: string;
    zone: string;
    offerToken: string;
    offerIdentifier: number | string;
    offerAmount: number | string;
    basicOrderType: number | string;
    startTime: number | string;
    endTime: number | string;
    zoneHash: string;
    salt: number | string;
    offererConduitKey: string;
    fulfillerConduitKey: string;
    totalOriginalAdditionalRecipients: number | string;
    additionalRecipients: Array<{
      amount: number | string;
      recipient: string;
    }>;
    signature: string;
  };
};

type BasicOrderParameters = {
  considerationToken: Address;
  considerationIdentifier: bigint;
  considerationAmount: bigint;
  offerer: Address;
  zone: Address;
  offerToken: Address;
  offerIdentifier: bigint;
  offerAmount: bigint;
  basicOrderType: number;
  startTime: bigint;
  endTime: bigint;
  zoneHash: `0x${string}`;
  salt: bigint;
  offererConduitKey: `0x${string}`;
  fulfillerConduitKey: `0x${string}`;
  totalOriginalAdditionalRecipients: bigint;
  additionalRecipients: Array<{
    amount: bigint;
    recipient: Address;
  }>;
  signature: `0x${string}`;
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

const FULFILL_BASIC_ORDER_ABI = [
  {
    type: "function",
    name: "fulfillBasicOrder_efficient_6GL6yc",
    stateMutability: "payable",
    inputs: [
      {
        name: "parameters",
        type: "tuple",
        components: [
          { name: "considerationToken", type: "address" },
          { name: "considerationIdentifier", type: "uint256" },
          { name: "considerationAmount", type: "uint256" },
          { name: "offerer", type: "address" },
          { name: "zone", type: "address" },
          { name: "offerToken", type: "address" },
          { name: "offerIdentifier", type: "uint256" },
          { name: "offerAmount", type: "uint256" },
          { name: "basicOrderType", type: "uint8" },
          { name: "startTime", type: "uint256" },
          { name: "endTime", type: "uint256" },
          { name: "zoneHash", type: "bytes32" },
          { name: "salt", type: "uint256" },
          { name: "offererConduitKey", type: "bytes32" },
          { name: "fulfillerConduitKey", type: "bytes32" },
          { name: "totalOriginalAdditionalRecipients", type: "uint256" },
          {
            name: "additionalRecipients",
            type: "tuple[]",
            components: [
              { name: "amount", type: "uint256" },
              { name: "recipient", type: "address" },
            ],
          },
          { name: "signature", type: "bytes" },
        ],
      },
    ],
    outputs: [{ name: "fulfilled", type: "bool" }],
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
const WARPLETS_COLLECTION_CONTRACT = "0x780446dd12e080ae0db762fcd4daf313f3e359de";
const BASE_RPC_URL = BASE_CHAIN_CONFIG.rpcUrls[0];

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

async function postTrackingUpdate(
  path: string,
  fid: number,
  extras: Record<string, unknown> = {}
): Promise<void> {
  const res = await fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ fid, ...extras }),
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
        receipt = await publicRpcRequest<{ status?: string } | null>(
          "eth_getTransactionReceipt",
          [hash]
        );
      } else {
        throw error;
      }
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

function buildBasicOrderParameters(inputData: RawBasicOrderInput): BasicOrderParameters {
  const params = inputData.parameters;
  if (!params) {
    throw new Error("OpenSea fulfillment payload is missing basic order parameters.");
  }

  return {
    considerationToken: getAddress(params.considerationToken),
    considerationIdentifier: toBigInt(params.considerationIdentifier),
    considerationAmount: toBigInt(params.considerationAmount),
    offerer: getAddress(params.offerer),
    zone: getAddress(params.zone),
    offerToken: getAddress(params.offerToken),
    offerIdentifier: toBigInt(params.offerIdentifier),
    offerAmount: toBigInt(params.offerAmount),
    basicOrderType: Number(params.basicOrderType),
    startTime: toBigInt(params.startTime),
    endTime: toBigInt(params.endTime),
    zoneHash: params.zoneHash as `0x${string}`,
    salt: toBigInt(params.salt),
    offererConduitKey: params.offererConduitKey as `0x${string}`,
    fulfillerConduitKey: params.fulfillerConduitKey as `0x${string}`,
    totalOriginalAdditionalRecipients: toBigInt(params.totalOriginalAdditionalRecipients),
    additionalRecipients: (params.additionalRecipients ?? []).map((recipient) => ({
      amount: toBigInt(recipient.amount),
      recipient: getAddress(recipient.recipient),
    })),
    signature: (params.signature || "0x") as `0x${string}`,
  };
}

function buildOpenSeaFulfillmentData(inputData: unknown, fallbackRecipient: Address): `0x${string}` {
  const advancedInput = inputData as RawFulfillmentInput | undefined;
  if (advancedInput?.orders?.length) {
    const matchAdvancedOrdersArgs = buildMatchAdvancedOrdersArgs(advancedInput, fallbackRecipient);
    return encodeFunctionData({
      abi: MATCH_ADVANCED_ORDERS_ABI,
      functionName: "matchAdvancedOrders",
      args: matchAdvancedOrdersArgs,
    });
  }

  const basicOrderParameters = buildBasicOrderParameters(inputData as RawBasicOrderInput);
  return encodeFunctionData({
    abi: FULFILL_BASIC_ORDER_ABI,
    functionName: "fulfillBasicOrder_efficient_6GL6yc",
    args: [basicOrderParameters],
  });
}

async function publicRpcRequest<T>(method: string, params: unknown[]): Promise<T> {
  const response = await fetch(BASE_RPC_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: Date.now(),
      method,
      params,
    }),
  });

  if (!response.ok) {
    throw new Error(`Base RPC request failed with status ${response.status}.`);
  }

  const payload = (await response.json()) as {
    result?: T;
    error?: { message?: string };
  };
  if (payload.error) {
    throw new Error(payload.error.message || "Base RPC request failed.");
  }

  return payload.result as T;
}

type TokenApprovalRequirement = {
  tokenAddress: string;
  spender: string;
  amount: string;
  conduitKey?: string;
};

async function readTokenAllowance(
  provider: EthereumProvider,
  tokenAddress: string,
  owner: string,
  spender: string
): Promise<bigint> {
  const allowanceCallData = encodeFunctionData({
    abi: erc20Abi,
    functionName: "allowance",
    args: [getAddress(owner), getAddress(spender)],
  });

  try {
    const allowanceResult = (await provider.request({
      method: "eth_call",
      params: [
        {
          to: getAddress(tokenAddress),
          data: allowanceCallData,
        },
        "latest",
      ],
    })) as string;
    return BigInt(allowanceResult || "0x0");
  } catch (error) {
    if (isUnsupportedMethodError(error)) {
      const allowanceResult = await publicRpcRequest<string>("eth_call", [
        {
          to: getAddress(tokenAddress),
          data: allowanceCallData,
        },
        "latest",
      ]);
      return BigInt(allowanceResult || "0x0");
    }
    throw error;
  }
}

async function waitForTokenAllowance(
  provider: EthereumProvider,
  approval: TokenApprovalRequirement,
  owner: string,
  timeoutMs = 60000
): Promise<void> {
  const requiredAllowance = BigInt(approval.amount);
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    const currentAllowance = await readTokenAllowance(
      provider,
      approval.tokenAddress,
      owner,
      approval.spender
    );
    if (currentAllowance >= requiredAllowance) {
      return;
    }
    await new Promise(resolve => window.setTimeout(resolve, 1500));
  }

  throw new Error("USDC approval is still confirming. Please wait a few seconds and try again.");
}

async function ensureTokenApproval(
  provider: EthereumProvider,
  owner: string,
  approval: TokenApprovalRequirement
): Promise<void> {
  const requiredAllowance = BigInt(approval.amount);
  const currentAllowance = await readTokenAllowance(
    provider,
    approval.tokenAddress,
    owner,
    approval.spender
  );

  if (currentAllowance >= requiredAllowance) {
    return;
  }

  const approvalData = encodeFunctionData({
    abi: erc20Abi,
    functionName: "approve",
    args: [getAddress(approval.spender), requiredAllowance],
  });

  const approvalHash = (await provider.request({
    method: "eth_sendTransaction",
    params: [
      {
        from: getAddress(owner),
        to: getAddress(approval.tokenAddress),
        data: approvalData,
        value: "0x0",
      },
    ],
  })) as string;

  await waitForTransactionReceipt(provider, approvalHash);
  await waitForTokenAllowance(provider, approval, owner);
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

function normalizeTopReferrers(rows: unknown): TopReferrer[] {
  if (!Array.isArray(rows)) return [];

  return rows
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const row = item as { fid?: unknown; username?: unknown; pfpUrl?: unknown; referrals?: unknown };
      if (typeof row.fid !== "number" || !Number.isFinite(row.fid)) return null;
      if (typeof row.username !== "string" || row.username.trim().length === 0) return null;
      if (typeof row.pfpUrl !== "string" || row.pfpUrl.trim().length === 0) return null;
      if (typeof row.referrals !== "number" || !Number.isFinite(row.referrals)) return null;

      return {
        fid: row.fid,
        username: row.username,
        pfpUrl: row.pfpUrl,
        referrals: row.referrals,
      } satisfies TopReferrer;
    })
    .filter((item): item is TopReferrer => item !== null)
    .slice(0, 25);
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
  const empty: OutreachCandidate = { farcasterUsernames: [], xUsernames: [], tokenIds: [], recipients: [] };
  if (!value || typeof value !== "object") {
    return empty;
  }

  const raw = value as {
    farcasterUsernames?: unknown;
    xUsernames?: unknown;
    tokenIds?: unknown;
    recipients?: unknown;
  };
  const farcasterUsernames = Array.isArray(raw.farcasterUsernames)
    ? raw.farcasterUsernames
      .filter((item): item is string => typeof item === "string" && item.trim().length > 0)
      .map((item) => item.trim())
      .slice(0, 5)
    : [];
  const xUsernames = Array.isArray(raw.xUsernames)
    ? raw.xUsernames
      .filter((item): item is string => typeof item === "string" && item.trim().length > 0)
      .map((item) => item.trim())
      .slice(0, 5)
    : [];

  const tokenIds = Array.isArray(raw.tokenIds)
    ? raw.tokenIds
      .filter((item): item is number => typeof item === "number" && Number.isInteger(item) && item > 0)
      .slice(0, 5)
    : [];

  const recipients = Array.isArray(raw.recipients)
    ? raw.recipients
      .map((item) => {
        if (!item || typeof item !== "object") return null;
        const row = item as Record<string, unknown>;
        const tokenId = typeof row.tokenId === "number" && Number.isInteger(row.tokenId) && row.tokenId > 0 ? row.tokenId : null;
        const recipientFid = typeof row.fid === "number" && Number.isInteger(row.fid) && row.fid > 0 ? row.fid : null;
        const farcasterUsername = typeof row.farcasterUsername === "string" && row.farcasterUsername.trim().length > 0
          ? row.farcasterUsername.trim()
          : null;
        const xUsername = typeof row.xUsername === "string" && row.xUsername.trim().length > 0 ? row.xUsername.trim() : null;
        const mutualAffinityScore = typeof row.mutualAffinityScore === "number" && Number.isFinite(row.mutualAffinityScore)
          ? row.mutualAffinityScore
          : null;
        const source = row.source === "best_friend" ? "best_friend" : "fallback";
        if (!tokenId || !recipientFid || !farcasterUsername) return null;
        return {
          tokenId,
          fid: recipientFid,
          farcasterUsername,
          xUsername,
          mutualAffinityScore,
          source,
        } satisfies OutreachRecipient;
      })
      .filter((item): item is OutreachRecipient => item !== null)
      .slice(0, 25)
    : [];

  return { farcasterUsernames, xUsernames, tokenIds, recipients };
}

function buildCastVerificationUrl(hash: string, username: string): string {
  const cleanHash = hash.trim();
  const cleanUsername = username.trim();
  if (cleanUsername.length > 0) {
    return `https://farcaster.xyz/${cleanUsername}/${cleanHash}`;
  }
  return `https://farcaster.xyz/~/conversations/${cleanHash}`;
}

function toWebComposeUrl(rawUrl: string): string {
  const url = rawUrl.trim();
  if (!url.toLowerCase().startsWith("mailto:")) return url;

  try {
    const parsed = new URL(url);
    const to = parsed.pathname || "";
    const subject = parsed.searchParams.get("subject") ?? "";
    const body = parsed.searchParams.get("body") ?? "";
    const gmailParams = new URLSearchParams({
      view: "cm",
      fs: "1",
      to,
      su: subject,
      body,
    });
    return `https://mail.google.com/mail/?${gmailParams.toString()}`;
  } catch {
    return "https://mail.google.com/mail/u/0/#inbox?compose=new";
  }
}

function isMailtoUrl(rawUrl: string): boolean {
  return rawUrl.trim().toLowerCase().startsWith("mailto:");
}

function isLikelyDesktopClient(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent.toLowerCase();
  const mobileSignals = ["iphone", "ipad", "android", "mobile"];
  return !mobileSignals.some((signal) => ua.includes(signal));
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

async function openExternalUrlWithMailtoFallback(rawUrl: string): Promise<void> {
  const url = rawUrl.trim();
  if (!isMailtoUrl(url)) {
    await sdk.actions.openUrl(url);
    return;
  }

  if (isLikelyDesktopClient()) {
    await sdk.actions.openUrl(toWebComposeUrl(url));
    return;
  }

  try {
    // Prefer native/default email client routing first.
    await sdk.actions.openUrl(url);
  } catch {
    // Fallback for clients that do not support mailto through openUrl.
    await sdk.actions.openUrl(toWebComposeUrl(url));
  }
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
  const FARCASTER_MINIAPP_BASE_URL = "https://farcaster.xyz/miniapps/cSNbxgFkuFRi/10x-warplets-drop";
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
  const [waitlistVerificationPolling, setWaitlistVerificationPolling] = useState(false);
  const [hasFollowedX, setHasFollowedX] = useState(false);
  const [viewerUsername, setViewerUsername] = useState("");
  const [waitlistStatusMessage, setWaitlistStatusMessage] = useState("");
  const [showWaitlistModal, setShowWaitlistModal] = useState(false);
  const [showEmail10xModal, setShowEmail10xModal] = useState(false);
  const [emailFeedbackSubmitting, setEmailFeedbackSubmitting] = useState(false);
  const [copyToastVisible, setCopyToastVisible] = useState(false);
  const [recentBuys, setRecentBuys] = useState<RecentBuyer[]>([]);
  const [rewardedUsers, setRewardedUsers] = useState<RecentBuyer[]>([]);
  const [bestFriends, setBestFriends] = useState<BestFriend[]>([]);
  const [outreachCandidates, setOutreachCandidates] = useState<OutreachCandidate>({
    farcasterUsernames: [],
    xUsernames: [],
    tokenIds: [],
    recipients: [],
  });
  const [referralCount, setReferralCount] = useState(0);
  const [topReferrers, setTopReferrers] = useState<TopReferrer[]>([]);
  const [showUnlockRewardPage, setShowUnlockRewardPage] = useState(false);
  const [rewardActions, setRewardActions] = useState<RewardAction[]>([]);
  const [rewardActionsLoading, setRewardActionsLoading] = useState(false);
  const [didUnlockCelebrate, setDidUnlockCelebrate] = useState(false);
  const [pendingActionUntilMs, setPendingActionUntilMs] = useState<Record<string, number>>({});
  const [optimisticCompletedActions, setOptimisticCompletedActions] = useState<Record<string, boolean>>({});
  const [actionSessionToken, setActionSessionToken] = useState<string>("");
  const [pendingNotificationId, setPendingNotificationId] = useState<string | null>(null);
  const [notificationOpenSent, setNotificationOpenSent] = useState(false);

  const launchTopConfetti = () => {
    void hapticSuccess();
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

  const showActionError = (message: string) => {
    void hapticError();
    setActionError(message);
  };

  useEffect(() => {
    const loadRecentBuys = async () => {
      try {
        const res = await fetch(forceReferralTest ? "/api/warplet-status?referrals=1" : "/api/warplet-status");
        if (!res.ok) return;

        const data = (await res.json()) as RecentBuysResponse;
        const buyers = normalizeRecentBuys(data.buyers);
        const friends = normalizeBestFriends(data.bestFriends);
        setBestFriends(friends);
        setRecentBuys(rankBuyersWithBestFriends(buyers, friends));
        setRewardedUsers(normalizeRecentBuys(data.rewardedUsers));
        setOutreachCandidates(normalizeOutreachCandidates(data.outreachCandidates));
        setReferralCount(typeof data.referralCount === "number" ? data.referralCount : 0);
        const localTopReferrers = normalizeTopReferrers(data.topReferrers);
        setTopReferrers(localTopReferrers);
        if (forceReferralTest && localTopReferrers.length < 25) {
          try {
            const prodRes = await fetch("https://drop.10x.meme/api/warplet-status?referrals=1");
            if (prodRes.ok) {
              const prodData = (await prodRes.json()) as RecentBuysResponse;
              const prodTopReferrers = normalizeTopReferrers(prodData.topReferrers);
              if (prodTopReferrers.length > 0) {
                setTopReferrers(prodTopReferrers.slice(0, 25));
              }
            }
          } catch {
            // Keep local results when prod fallback is unavailable.
          }
        }
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
          body: JSON.stringify({ fid: context.user.fid, referrerFid: parsedReferralFid }),
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
        setReferralCount(typeof data.referralCount === "number" ? data.referralCount : 0);
        setTopReferrers(normalizeTopReferrers(data.topReferrers));

        try {
          const friendsRes = await fetch(
            `/api/warplet-status?fid=${context.user.fid}${forceReferralTest ? "&referrals=1" : ""}`
          );
          if (friendsRes.ok) {
            const friendsData = (await friendsRes.json()) as RecentBuysResponse;
            if (typeof friendsData.actionSessionToken === "string" && friendsData.actionSessionToken.length > 0) {
              setActionSessionToken(friendsData.actionSessionToken);
            }
            const friends = normalizeBestFriends(friendsData.bestFriends);
            setBestFriends(friends);
            setRecentBuys(rankBuyersWithBestFriends(buyers, friends));
            if (typeof friendsData.referralCount === "number") {
              setReferralCount(friendsData.referralCount);
            }
            const normalizedReferrers = normalizeTopReferrers(friendsData.topReferrers);
            if (normalizedReferrers.length > 0) {
              setTopReferrers(normalizedReferrers);
            }
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
        if (Number(data.completedActionsCount ?? 0) > 0) {
          setShowUnlockRewardPage(true);
        }

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
  const referralFidParam = searchParams.get("fid");
  const parsedReferralFid = referralFidParam && /^\d+$/.test(referralFidParam) ? Number(referralFidParam) : null;
  const rawMatchParam = typeof window !== "undefined" ? searchParams.get("match") : null;
  const normalizedMatchParam = rawMatchParam?.trim().toLowerCase() ?? null;
  const forceNoMatch = normalizedMatchParam === "0" || normalizedMatchParam === "false";
  const forceMatch = normalizedMatchParam === "1" || normalizedMatchParam === "true";
  const forceReferralTest = typeof window !== "undefined" && searchParams.get("referrals") === "1";
  const debugEnabled = typeof window !== "undefined" && searchParams.get("debug") === "1";
  const forceUnlock = typeof window !== "undefined" && searchParams.get("unlock") === "1";
  const forceActionsPage = typeof window !== "undefined" && searchParams.get("actions") === "1";
  const currentHost = typeof window !== "undefined" ? window.location.host : "";
  const showDebugChip = debugEnabled;
  const isMatched = forceMatch || (!forceNoMatch && Boolean(status?.matched));
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
  const effectiveMatchedTokenId =
    displayTokenId ?? (isMatched ? "1358" : null);
  const referralDropUrl = fid ? `https://drop.10x.meme/?fid=${fid}` : "https://drop.10x.meme/";
  const farcasterLaunchUrl = parsedReferralFid
    ? `${FARCASTER_MINIAPP_BASE_URL}?fid=${parsedReferralFid}`
    : FARCASTER_MINIAPP_BASE_URL;

  useEffect(() => {
    if (loading || error || !isMatched || didCelebrate || isMenuRoute) return;

    launchTopConfetti();
    setDidCelebrate(true);
  }, [loading, error, isMatched, didCelebrate, isMenuRoute]);

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
      ? `https://warplets.10x.meme/${effectiveMatchedTokenId}.avif`
      : "https://warplets.10x.meme/3081.png";
  const title = showOpenInFarcaster && !hasPurchased && !isMatched
    ? ""
    : hasPurchased
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
  const waitlistRewardAction = displayRewardActions.find((action) => action.slug === "drop-waitlist-email") ?? null;
  const waitlistActionCompleted = Boolean(waitlistRewardAction?.completed);
  const waitlistCompletedEmail = getEmailFromVerification(waitlistRewardAction?.verification ?? null);
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
  const yourWarpletTokenId = purchasedTokenId ?? (hasPurchased && typeof status?.rarityValue === "number" ? String(status.rarityValue) : null);
  const yourWarpletImageUrl = yourWarpletTokenId ? `https://warplets.10x.meme/${yourWarpletTokenId}.avif` : null;
  const yourWarpletBaseScanUrl = status?.buyTransactionId ? `https://basescan.org/tx/${status.buyTransactionId}` : null;
  const yourWarpletOpenSeaUrl = yourWarpletTokenId
    ? `https://opensea.io/item/base/${WARPLETS_COLLECTION_CONTRACT}/${yourWarpletTokenId}`
    : null;
  const castOutreachRecipients = outreachCandidates.recipients
    .filter((recipient) => recipient.farcasterUsername.trim().length > 0)
    .slice(0, 5);
  const tweetOutreachRecipients = outreachCandidates.recipients
    .filter((recipient) => recipient.xUsername && recipient.xUsername.trim().length > 0)
    .slice(0, 5);
  const castOutreach = castOutreachRecipients.map((recipient) => recipient.farcasterUsername).join(" ");
  const tweetOutreach = tweetOutreachRecipients.map((recipient) => recipient.xUsername).filter(Boolean).join(" ");
  const outreachOptOutText = "(note: max 1 mention/day, easy opt-out in app)";
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
      const params = new URLSearchParams({ appSlug: "drop" });
      if (actionSessionToken) {
        params.set("sessionToken", actionSessionToken);
      }
      if (typeof fid === "number" && Number.isFinite(fid) && fid > 0) {
        params.set("fid", String(fid));
      }
      const query = `?${params.toString()}`;
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
      showActionError(getErrorMessage(err));
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
    outreachTokenIds?: number[],
    outreachRecipients?: OutreachRecipient[]
  ) => {
    if (!fid) return;

    const refreshSessionToken = async (): Promise<string> => {
      const statusRes = await fetch("/api/warplet-status", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ fid, referrerFid: parsedReferralFid }),
      });
      if (!statusRes.ok) return "";
      const refreshed = (await statusRes.json()) as WarpletStatus;
      const token = typeof refreshed.actionSessionToken === "string" ? refreshed.actionSessionToken : "";
      if (token) setActionSessionToken(token);
      return token;
    };

    const submitCompletion = async (sessionToken?: string) => fetch("/api/actions-complete", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        fid,
        actionSlug,
        verification: verification ?? undefined,
        outreachTokenIds: outreachTokenIds && outreachTokenIds.length > 0 ? outreachTokenIds : undefined,
        outreachRecipients: outreachRecipients && outreachRecipients.length > 0 ? outreachRecipients : undefined,
        sessionToken: sessionToken || undefined,
      }),
    });

    let token = actionSessionToken || "";
    if (!token) {
      token = await refreshSessionToken();
    }

    let response = await submitCompletion(token || undefined);

    if (response.status === 401) {
      token = await refreshSessionToken();
      response = await submitCompletion(token || undefined);
    }

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
      body: JSON.stringify({ fid: currentFid, referrerFid: parsedReferralFid }),
    });
    if (!statusRes.ok) return;
    const nextStatus = (await statusRes.json()) as WarpletStatus;
    setStatus(nextStatus);
    setActionSessionToken(typeof nextStatus.actionSessionToken === "string" ? nextStatus.actionSessionToken : "");
    setOutreachCandidates(normalizeOutreachCandidates(nextStatus.outreachCandidates));
    setReferralCount(typeof nextStatus.referralCount === "number" ? nextStatus.referralCount : 0);
    setTopReferrers(normalizeTopReferrers(nextStatus.topReferrers));
    if (Number(nextStatus.completedActionsCount ?? 0) > 0) {
      setShowUnlockRewardPage(true);
    }

    if (forceReferralTest) {
      const testRes = await fetch("/api/warplet-status?referrals=1");
      if (testRes.ok) {
        const testData = (await testRes.json()) as RecentBuysResponse;
        const seeded = normalizeTopReferrers(testData.topReferrers);
        if (seeded.length > 0) {
          setTopReferrers(seeded);
        }
      }
    }
  };

  const showCopyToast = () => {
    setCopyToastVisible(true);
    window.setTimeout(() => setCopyToastVisible(false), 1800);
  };

  const setActionPendingThenComplete = (slug: string) => {
    const completeAtMs = Date.now() + 10000;
    setPendingActionUntilMs((prev) => ({ ...prev, [slug]: completeAtMs }));
    window.setTimeout(() => {
      setPendingActionUntilMs((prev) => ({ ...prev, [slug]: 0 }));
      setOptimisticCompletedActions((prev) => ({ ...prev, [slug]: true }));
    }, 10000);
  };

  const openWaitlistModal = (action: RewardAction) => {
    const completedEmail = getEmailFromVerification(action.verification);
    if (completedEmail) {
      setWaitlistEmail(completedEmail);
      setWaitlistSubmitted(true);
      setWaitlistStatusMessage("You are on the waitlist.");
    } else {
      setWaitlistSubmitted(false);
      setWaitlistStatusMessage("");
    }
    setShowWaitlistModal(true);
  };

  const runRewardAction = async (action: RewardAction) => {
    void hapticTap();
    if (!fid) return;
    if (isActionPending(action.slug)) return;

    setActionError("");
    const alreadyCompleted = isActionCompleted(action);
    if (!alreadyCompleted && action.slug !== "drop-email-10x") {
      setActionPendingThenComplete(action.slug);
    }

    try {
      if (action.slug === "drop-follow-fc-10xmeme") {
        if (!alreadyCompleted) {
          await completeRewardAction(action.slug, `opened:${new Date().toISOString()}`);
        }
        await sdk.actions.viewProfile({ fid: 1313340 });
      } else if (action.slug === "drop-follow-fc-10xchris") {
        if (!alreadyCompleted) {
          await completeRewardAction(action.slug, `opened:${new Date().toISOString()}`);
        }
        await sdk.actions.viewProfile({ fid: 1129138 });
      } else if (action.slug === "drop-join-fc-channel") {
        if (!alreadyCompleted) {
          await completeRewardAction(action.slug, `opened:${new Date().toISOString()}`);
        }
        await sdk.actions.openUrl("https://farcaster.xyz/~/channel/10xmeme");
      } else if (action.slug === "drop-email-10x") {
        setShowEmail10xModal(true);
      } else if (isAssumeSuccessActionSlug(action.slug)) {
        if (action.url) {
          await openExternalUrlWithMailtoFallback(action.url);
        }
        if (!alreadyCompleted) {
          await wait(10000);
          await completeRewardAction(action.slug, `opened:${new Date().toISOString()}`);
        }
      } else if (action.slug === "drop-cast") {
        const urgency = getUrgencyDetails(nowMs);
        const castRarityLine = formattedTokenId && topPercentLabel
          ? `My rarity #${formattedTokenId} of 10,000! 👀`
          : "My rarity is 10,000! 👀";
        const outreachLine = castOutreach.length > 0 ? `\n\n🏆 You're on the list ${castOutreach} ${outreachOptOutText}` : "";
        const raritySection = isMatched ? `\n\n${castRarityLine}\n\n...what's your rarity?` : "";
        const castResult = await sdk.actions.composeCast({
          text:
            `🟢 10X Warplets (Private 10K NFT Drop)\n\nPrice $${urgency.currentPrice} → $${urgency.nextPrice} in ${urgency.countdown}.\nSupply private → public every 10 days.\nAre you on the list? Don't miss out.${raritySection}${outreachLine}`,
          embeds: purchasedTokenId
            ? [referralDropUrl]
            : [referralDropUrl],
        });
        if (!alreadyCompleted) {
          if (castResult?.cast?.hash) {
            const verification = buildCastVerificationUrl(castResult.cast.hash, viewerUsername);
            await completeRewardAction(
              action.slug,
              verification,
              castOutreachRecipients.map((recipient) => recipient.tokenId),
              castOutreachRecipients
            );
          } else {
            // Rewards-page retry: treat composer dismiss as completion so rewards can unlock.
            await completeRewardAction(
              action.slug,
              `dismissed:${new Date().toISOString()}`,
              castOutreachRecipients.map((recipient) => recipient.tokenId),
              castOutreachRecipients,
            );
          }
        }
      } else if (action.slug === "drop-tweet") {
        const urgency = getUrgencyDetails(nowMs);
        const castRarityLine = formattedTokenId && topPercentLabel
          ? `My rarity #${formattedTokenId} of 10,000! 👀`
          : "My rarity is 10,000! 👀";
        const outreachLine = tweetOutreach.length > 0 ? `🏆 You're on the list ${tweetOutreach} ${outreachOptOutText}\n\n` : "";
        const raritySection = isMatched ? `${castRarityLine}\n\n...what's your rarity?\n\n` : "";
        const text = `🟢 10X Warplets (Private 10K NFT Drop)\n\nPrice $${urgency.currentPrice} → $${urgency.nextPrice} in ${urgency.countdown}.\nSupply private → public every 10 days.\nAre you on the list? Don't miss out.\n\n1️⃣ Join Farcaster: https://farcaster.xyz/~/code/RUZLHN\n2️⃣ Visit mini-app: ${referralDropUrl}\n\n${raritySection}${outreachLine}`;
        const intentUrl = `https://x.com/intent/post?${new URLSearchParams({
          text,
          url: "",
          hashtags: "10XWarplets",
          via: "10XMemeX",
        }).toString()}`;
        await sdk.actions.openUrl(intentUrl);
        if (!alreadyCompleted) {
          await wait(10000);
          await completeRewardAction(
            action.slug,
            intentUrl,
            tweetOutreachRecipients.map((recipient) => recipient.tokenId),
            tweetOutreachRecipients
          );
        }
      } else if (action.slug === "drop-waitlist-email") {
        // Waitlist action uses email submit flow below.
      } else if (action.url) {
        await openExternalUrlWithMailtoFallback(action.url);
      }

      fetchRewardActions(false).catch(() => {});
      refreshStatusForRewardPage(fid).catch(() => {});
    } catch (err) {
      console.error("Failed to run reward action:", err);
      showActionError(getErrorMessage(err));
    } finally {
    }
  };

  const handleEmailFeedbackDone = async () => {
    void hapticPrimaryTap();
    if (!fid || emailFeedbackSubmitting) return;

    setEmailFeedbackSubmitting(true);
    setActionError("");

    try {
      const emailAction = displayRewardActions.find((item) => item.slug === "drop-email-10x");
      const alreadyCompleted = Boolean(emailAction?.completed);

      if (!alreadyCompleted) {
        await completeRewardAction("drop-email-10x", `opened:${new Date().toISOString()}`);
      }

      setOptimisticCompletedActions((prev) => ({ ...prev, "drop-email-10x": true }));
      setShowEmail10xModal(false);
      await fetchRewardActions(false);
      await refreshStatusForRewardPage(fid);
    } catch (err) {
      showActionError(getErrorMessage(err));
    } finally {
      setEmailFeedbackSubmitting(false);
    }
  };

  const handleWaitlistRewardAction = async (action: RewardAction) => {
    void hapticPrimaryTap();
    if (!fid) {
      showActionError("Your Farcaster account is not ready yet.");
      return;
    }

    if (!waitlistEmail.trim()) {
      showActionError("Please enter a valid email.");
      return;
    }

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
          ? "Verification sent. Check your email to confirm your waitlist spot."
          : "Subscribed. Check your email to confirm your waitlist spot.");

        if (payload.verificationEmailSent) {
          setWaitlistVerificationPolling(true);
          try {
            for (let attempt = 0; attempt < 120; attempt += 1) {
              await wait(2500);
              const params = new URLSearchParams({ appSlug: "drop" });
              if (typeof fid === "number" && Number.isFinite(fid) && fid > 0) {
                params.set("fid", String(fid));
              }
              if (actionSessionToken) {
                params.set("sessionToken", actionSessionToken);
              }

              const actionRes = await fetch(`/api/actions?${params.toString()}`);
              if (!actionRes.ok) continue;
              const actionData = (await actionRes.json()) as { actions?: RewardAction[] };
              const waitlistAction = Array.isArray(actionData.actions)
                ? actionData.actions.find((item) => item.slug === "drop-waitlist-email")
                : null;
              if (waitlistAction?.completed) {
                const completedEmail = getEmailFromVerification(waitlistAction.verification);
                if (completedEmail) {
                  setWaitlistEmail(completedEmail);
                }
                setWaitlistStatusMessage("You are on the waitlist.");
                break;
              }
            }
          } finally {
            setWaitlistVerificationPolling(false);
          }
        }
      }

      await fetchRewardActions();
      await refreshStatusForRewardPage(fid);
    } catch (err) {
      showActionError(getErrorMessage(err));
    } finally {
      setWaitlistSubmitting(false);
    }
  };

  const handlePrimaryAction = async () => {
    void hapticStrongTap();
    if (hasPurchased && purchasedTokenId) {
      setActionError("");
      launchTopConfetti();

      try {
        const urgency = getUrgencyDetails(nowMs);
        const castRarityLine = formattedTokenId && topPercentLabel
          ? `My rarity #${formattedTokenId} of 10,000! 👀`
          : "My rarity is 10,000! 👀";
        const outreachLine = castOutreach.length > 0 ? `\n\n🏆 You're on the list ${castOutreach} ${outreachOptOutText}` : "";
        const castResult = await sdk.actions.composeCast({
          text:
            `🟢 10X Warplets (Private 10K NFT Drop)\n\nPrice $${urgency.currentPrice} → $${urgency.nextPrice} in ${urgency.countdown}.\nSupply private → public every 10 days.\nAre you on the list? Don't miss out.\n\n${castRarityLine}\n\n...what's your rarity?${outreachLine}`,
          embeds: [referralDropUrl],
        });

        if (castResult?.cast?.hash && fid) {
          const verification = buildCastVerificationUrl(castResult.cast.hash, viewerUsername);
          await completeRewardAction(
            "drop-cast",
            verification,
            castOutreachRecipients.map((recipient) => recipient.tokenId),
            castOutreachRecipients
          );
          await fetchRewardActions();
          await refreshStatusForRewardPage(fid);
        }
      } catch (err) {
        console.error("Failed to open cast composer:", err);
        const message = getErrorMessage(err).toLowerCase();
        const userRejected = message.includes("rejected by user");
        if (!userRejected) {
          showActionError(getErrorMessage(err));
        }
      } finally {
        setShowUnlockRewardPage(true);
      }

      return;
    }
    if (isMatched) {
      if (!fid) {
        showActionError("Your Farcaster account is not ready yet.");
        return;
      }

      setActionError("");
      setIsPurchasing(true);
      let purchaseHash: string | null = null;

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

        const fulfillmentData = buildOpenSeaFulfillmentData(quote.transaction.inputData, activeAccount);

        const approvals =
          Array.isArray(quote.approvals) && quote.approvals.length > 0
            ? quote.approvals
            : [quote.approval];
        for (const approval of approvals) {
          await ensureTokenApproval(provider, activeAccount, approval);
        }

        purchaseHash = (await provider.request({
          method: "eth_sendTransaction",
          params: [
            {
              from: activeAccount,
              to: quote.transaction.to,
              data: fulfillmentData,
              value: quote.transaction.value,
            },
          ],
        })) as string;

        await waitForTransactionReceipt(provider, purchaseHash);
        setPurchasedTokenId(quote.listing.tokenId);
        setStatus(prev => (prev ? {
          ...prev,
          buyInFarcasterWalletOn: new Date().toISOString(),
          buyTransactionId: purchaseHash,
          transactionError: null,
        } : prev));
        launchTopConfetti();

        try {
          await postTrackingUpdate("/api/warplet-purchase-complete", fid, { transactionId: purchaseHash });
        } catch (persistError) {
          console.error("Failed to persist purchase tracking state:", persistError);
          showActionError("Purchase succeeded, but persisting claim state failed. Please refresh in a moment.");
        }
      } catch (err) {
        console.error("Failed to complete Warplet purchase:", err);
        const transactionError = getErrorMessage(err);
        showActionError(transactionError);
        setStatus(prev => (prev ? { ...prev, transactionError, buyTransactionId: purchaseHash ?? prev.buyTransactionId } : prev));
        try {
          await postTrackingUpdate("/api/warplet-purchase-complete", fid, {
            transactionId: purchaseHash ?? undefined,
            transactionError,
          });
        } catch (persistError) {
          console.error("Failed to persist purchase error state:", persistError);
        }
      } finally {
        setIsPurchasing(false);
      }

      return;
    }

    setActionError("");

    try {
      const urgency = getUrgencyDetails(nowMs);
      const outreachLine = castOutreach.length > 0 ? `\n\n🏆 You're on the list ${castOutreach} ${outreachOptOutText}` : "";
      const castResult = await sdk.actions.composeCast({
        text:
          `🟢 10X Warplets (Private 10K NFT Drop)\n\nPrice $${urgency.currentPrice} → $${urgency.nextPrice} in ${urgency.countdown}.\nSupply private → public every 10 days.\nAre you on the list? Don't miss out.${outreachLine}`,
        embeds: [referralDropUrl],
      });

      if (castResult?.cast?.hash && fid) {
        const verification = buildCastVerificationUrl(castResult.cast.hash, viewerUsername);
        await completeRewardAction(
          "drop-cast",
          verification,
          castOutreachRecipients.map((recipient) => recipient.tokenId),
          castOutreachRecipients
        );
        await fetchRewardActions();
        await refreshStatusForRewardPage(fid);
      }
    } catch (err) {
      console.error("Failed to open cast composer:", err);
      const message = getErrorMessage(err).toLowerCase();
      const userRejected = message.includes("rejected by user");
      if (!userRejected) {
        showActionError(getErrorMessage(err));
      }
    } finally {
      setShowUnlockRewardPage(true);
    }
  };

  const handleOpenSeaAction = async () => {
    void hapticTap();
    setHasClickedOpenSea(true);
    await sdk.actions.openUrl("https://opensea.io/collection/10xwarplets/overview");
  };

  const handleSplashAction = async () => {
    void hapticTap();
    await sdk.actions.openUrl("https://10x.meme");
  };

  const handleConfirmAddAppPrompt = async () => {
    void hapticPrimaryTap();
    setShowAddAppPrompt(false);
    try {
      await sdk.actions.addMiniApp();
    } catch (err) {
      console.error("Failed to open add mini app prompt:", err);
      showActionError(getErrorMessage(err));
    }
  };

  const handleWaitlistSubmit = async (event: FormEvent<HTMLFormElement>) => {
    void hapticPrimaryTap();
    event.preventDefault();

    if (!waitlistEmail.trim()) {
      showActionError("Please enter a valid email.");
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
      showActionError(getErrorMessage(err));
    } finally {
      setWaitlistSubmitting(false);
    }
  };

  const handleFollowX = async () => {
    void hapticTap();
    await sdk.actions.openUrl("https://x.com/10XMemeX");
    setHasFollowedX(true);
  };

  const handleJoinTelegram = async () => {
    void hapticTap();
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
    if (!showUnlockRewardPage || !hasAnyUnlockedRewards || didUnlockCelebrate || isMenuRoute) return;
    launchTopConfetti();
    setDidUnlockCelebrate(true);
  }, [showUnlockRewardPage, hasAnyUnlockedRewards, didUnlockCelebrate, isMenuRoute]);

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
                href={farcasterLaunchUrl}
                onClick={() => {
                  void hapticPrimaryTap();
                }}
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
                      const actionBusy = !actionCompleted && actionPending;

                      return (
                    <div
                      key={action.id}
                      onClick={() => {
                        void hapticTap();
                        if (actionBusy) return;
                        if (action.slug === "drop-waitlist-email") {
                          openWaitlistModal(action);
                          return;
                        }
                        runRewardAction(action).catch(() => {});
                      }}
                      className={`px-2 py-3 text-left cursor-pointer ${index > 0 ? "border-t border-[#00FF00]/15" : ""}`}
                      role="button"
                      tabIndex={0}
                      onKeyDown={(event) => {
                        if (event.key !== "Enter" && event.key !== " ") return;
                        void hapticTap();
                        event.preventDefault();
                        if (actionBusy) return;
                        if (action.slug === "drop-waitlist-email") {
                          openWaitlistModal(action);
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
                            void hapticTap();
                            event.stopPropagation();
                            if (actionBusy) return;
                            if (action.slug === "drop-waitlist-email") {
                              openWaitlistModal(action);
                              return;
                            }
                            runRewardAction(action).catch(() => {});
                          }}
                          disabled={actionBusy}
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
                            actionBusy ? (
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
                                    void hapticTap();
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
                                    void hapticTap();
                                    const url = `https://warplets.10x.meme/${rewardTokenId}.${item.ext}`;
                                    sdk.actions.openUrl(url).catch(() => {});
                                  }}
                                  className="w-full rounded-none border-0 bg-[#00FF00] px-2 py-2 text-xs font-bold text-center transition-all duration-100 cursor-pointer"
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
                      <img
                        src="/i-cant-lose.webp"
                        alt="I can't lose"
                        className="w-full rounded-xl mb-3"
                        loading="lazy"
                      />
                      <Text className="mt-1 text-sm leading-relaxed" style={{ color: "#b7ffb7" }}>
                        Access the collections metadata spreadsheet.
                      </Text>
                      <Text className="mt-2 text-sm leading-relaxed" style={{ color: "#b7ffb7" }}>
                        Rarity isn’t visual. It’s earned.
                      </Text>
                      <Text className="mt-2 text-sm leading-relaxed" style={{ color: "#b7ffb7" }}>
                        Discover the onchain social, capital and conviction data used to calculate NFT rarity.
                      </Text>
                      <Text className="mt-2 text-sm leading-relaxed" style={{ color: "#b7ffb7" }}>
                        Filter, sort, and search with ease.
                      </Text>
                      <Text className="mt-2 text-md font-bold leading-relaxed" style={{ color: "#b7ffb7" }}>
                        Find your 💎 Warplets!
                      </Text>
                      <button
                        type="button"
                        className="mt-3 w-full rounded-[20px] border border-[#009900] bg-[#00FF00] px-5 py-3 text-md font-bold shadow-[3px_6px_0_#008000] transition-all duration-100 active:translate-x-[1px] active:translate-y-[3px] active:shadow-[1px_3px_0_#008000] cursor-pointer"
                        style={{ color: "rgb(0, 80, 0)" }}
                        onClick={() => {
                          void hapticTap();
                          sdk.actions.openUrl("https://link.10x.meme/csv").catch(() => {});
                        }}
                      >
                        📕 Get The Cheatsheet
                      </button>
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
                      <div className="overflow-hidden rounded-xl bg-black">
                        <iframe
                          src="https://www.youtube-nocookie.com/embed/6rrPP-QOF3k?rel=0&modestbranding=1&playsinline=1&iv_load_policy=3"
                          title="The Matrix red pill scene"
                          className="w-full aspect-video"
                          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; web-share"
                          referrerPolicy="strict-origin-when-cross-origin"
                          allowFullScreen
                        />
                      </div>
                      <Text className="mt-1 text-sm leading-relaxed" style={{ color: "#b7ffb7" }}>
                        The Matrix lore is in the 10X Warplets DNA.
                      </Text>
                      <Text className="mt-1 text-sm leading-relaxed" style={{ color: "#b7ffb7" }}>
                        You can choose between:
                      </Text>
                      <Text className="mt-1 text-sm leading-relaxed" style={{ color: "#b7ffb7" }}>
                        🔵 Blue pill - comforting illusions.
                      </Text>
                      <Text className="mt-1 text-sm leading-relaxed" style={{ color: "#b7ffb7" }}>
                        🔴 Red pill - painful reality.
                      </Text>
                      <Text className="mt-1 text-sm leading-relaxed" style={{ color: "#b7ffb7" }}>
                        Or, you can choose to Think 10X.
                      </Text>
                      <Text className="mt-1 text-sm leading-relaxed" style={{ color: "#b7ffb7" }}>
                        🟢 Take the green pill.
                      </Text>
                      <Text className="mt-2 text-sm leading-relaxed" style={{ color: "#b7ffb7" }}>
                        Choose agency.
                      </Text>
                      <Text className="mt-2 text-md font-bold leading-relaxed" style={{ color: "#b7ffb7" }}>
                        Build your future.
                      </Text>
                      <button
                        type="button"
                        className="mt-3 w-full max-w-full rounded-[20px] border border-[#009900] bg-[#00FF00] px-5 py-3 text-md font-bold shadow-[3px_6px_0_#008000] transition-all duration-100 active:translate-x-[1px] active:translate-y-[3px] active:shadow-[1px_3px_0_#008000] cursor-pointer"
                        style={{ color: "rgb(0, 80, 0)" }}
                        onClick={() => {
                          void hapticTap();
                          sdk.actions.openUrl("https://www.youtube.com/watch?v=kK0JtvYg5-s").catch(() => {});
                        }}
                      >
                        🐇 Follow The White Rabbit
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
                    {unlockedRewardCount >= 4 ? "🤣 Reward #4 The Matrix Memes" : "🤣 Reward #4"}
                  </Text>
                  <div className="rounded-2xl border border-[#00FF00]/35 bg-[#041204]/85 px-4 py-4 space-y-4">
                    {unlockedRewardCount >= 4 ? (
                    <div className="text-left">
                      <img
                        src="/matrix-payphones.jpg"
                        alt="Matrix payphones"
                        className="w-full rounded-xl mb-3"
                        loading="lazy"
                      />
                      <Text className="mt-1 text-sm leading-relaxed" style={{ color: "#b7ffb7" }}>
                        The Matrix... why so serious?
                      </Text>
                      <Text className="mt-1 text-sm leading-relaxed" style={{ color: "#b7ffb7" }}>
                        Don't worry we're not.
                      </Text>
                      <Text className="mt-1 text-sm leading-relaxed" style={{ color: "#b7ffb7" }}>
                        The Matrix is a meme.
                      </Text>
                      <Text className="mt-1 text-sm leading-relaxed" style={{ color: "#b7ffb7" }}>
                        Memes spread ideas.
                      </Text>
                      <Text className="mt-1 text-sm leading-relaxed" style={{ color: "#b7ffb7" }}>
                        But above all... memes should be fun!
                      </Text>
                      <Text className="mt-2 text-md font-bold leading-relaxed" style={{ color: "#b7ffb7" }}>
                        10X is the meme.
                      </Text>
                      <button
                        type="button"
                        className="mt-3 w-full rounded-[20px] border border-[#009900] bg-[#00FF00] px-5 py-3 text-md font-bold shadow-[3px_6px_0_#008000] transition-all duration-100 active:translate-x-[1px] active:translate-y-[3px] active:shadow-[1px_3px_0_#008000] cursor-pointer"
                        style={{ color: "rgb(0, 80, 0)" }}
                        onClick={() => {
                          void hapticTap();
                          sdk.actions.openUrl("https://www.youtube.com/watch?v=ug2aoVZYgaU&list=PLj-tHdTcFWloQkdL1Ps-JOSSPW-_VwQWx").catch(() => {});
                        }}
                      >
                        😹 Watch The Matrix Uploaded
                      </button>
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
                      <img
                        src="/1mwarplet-1-2500x2500.jpg"
                        alt="$1M Warplet"
                        className="w-full rounded-xl mb-3"
                        loading="lazy"
                      />
                      <Text className="mt-1 text-sm leading-relaxed" style={{ color: "#b7ffb7" }}>
                        The $1M Warplet is a 30-day Dutch Auction.
                      </Text>
                      <Text className="mt-1 text-sm leading-relaxed" style={{ color: "#b7ffb7" }}>
                        Price starts a $1,000,000 and ends at $100.
                      </Text>
                      <Text className="mt-1 text-sm leading-relaxed" style={{ color: "#b7ffb7" }}>
                        The price drops every 15 minutes.
                      </Text>
                      <Text className="mt-1 text-sm leading-relaxed" style={{ color: "#b7ffb7" }}>
                        50% of the sale funds Fuel For Builds.
                      </Text>
                      <Text className="mt-1 text-sm leading-relaxed" style={{ color: "#b7ffb7" }}>
                        Airdroping $USDC every month to entrants.
                      </Text>
                      <Text className="mt-1 text-sm leading-relaxed" style={{ color: "#b7ffb7" }}>
                        The actions you've completed today will award you BONUS entries towards winning prizes.
                      </Text>
                      <Text className="mt-1 text-sm leading-relaxed" style={{ color: "#b7ffb7" }}>
                        The mini app for entering is still being built.
                      </Text>
                      <Text className="mt-2 text-md font-bold leading-relaxed" style={{ color: "#b7ffb7" }}>
                        You are soooo early!
                      </Text>
                      <button
                        type="button"
                        className="mt-3 w-full rounded-[20px] border border-[#009900] bg-[#00FF00] px-5 py-3 text-md font-bold shadow-[3px_6px_0_#008000] transition-all duration-100 active:translate-x-[1px] active:translate-y-[3px] active:shadow-[1px_3px_0_#008000] cursor-pointer"
                        style={{ color: "rgb(0, 80, 0)" }}
                        onClick={() => {
                          void hapticTap();
                          sdk.actions.openUrl("https://link.10x.meme/1mwarplet").catch(() => {});
                        }}
                      >
                        🦄 Learn About $1M Warplet
                      </button>
                    </div>
                    ) : (
                      <Text className="text-sm font-semibold text-left" style={{ color: "#b7ffb7" }}>
                        {`🔒 ${actionsNeededForReward(5)} actions needed to unlock.`}
                      </Text>
                    )}
                  </div>
                </div>
              </div>

              <div className="space-y-3">
                <Text className="text-lg font-bold text-left" style={{ color: "#00FF00" }}>
                  📣 Earn Referral Points.
                </Text>
                <div className="rounded-2xl border border-[#00FF00]/35 bg-[#041204]/85 px-4 py-4 space-y-3">
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      readOnly
                      value={referralDropUrl}
                      className="h-11 w-full rounded-xl border border-[#00FF00] bg-black/70 px-3 text-[16px] text-white outline-none"
                    />
                    <button
                      type="button"
                      className="h-10 w-10 shrink-0 rounded-[10px] border border-[#009900] bg-[#00FF00] text-xl font-bold shadow-[2px_4px_0_#008000] transition-all duration-100 active:translate-x-[1px] active:translate-y-[2px] active:shadow-[1px_2px_0_#008000] cursor-pointer"
                      style={{ color: "rgb(0, 80, 0)" }}
                      onClick={() => {
                        void hapticTap();
                        if (navigator.clipboard?.writeText) {
                          navigator.clipboard.writeText(referralDropUrl).then(() => {
                            showCopyToast();
                          }).catch(() => {});
                        }
                      }}
                    >
                      📋
                    </button>
                  </div>
                  <Text className="text-sm leading-relaxed text-left" style={{ color: "#b7ffb7" }}>
                    Share your 10X Warplets referral link to earn referral points and street cred.
                  </Text>
                  <Text className="text-sm leading-relaxed text-left" style={{ color: "#b7ffb7" }}>
                    Help Farcaster and the Warplets universe grow!
                  </Text>
                  <Text className="text-sm font-bold text-left" style={{ color: "#00FF00" }}>
                    {`Your referrals: ${referralCount}`}
                  </Text>
                </div>
              </div>

              <div className="space-y-3">
                <Text className="text-lg font-bold text-left" style={{ color: "#00FF00" }}>
                  🏆 Top Referrers
                </Text>
                <div className="rounded-2xl overflow-hidden border border-[#00FF00]/35 bg-[#041204]/85 p-0">
                  <table className="w-full border-separate border-spacing-0 text-left">
                    <thead>
                      <tr>
                        <th className="border-b border-r border-[#00FF00]/25 px-2 py-2 text-xs text-center" style={{ color: "#00FF00" }}>Rank</th>
                        <th className="border-b border-r border-[#00FF00]/25 px-2 py-2 text-xs text-center" style={{ color: "#00FF00" }}>Referrals</th>
                        <th className="border-b border-[#00FF00]/25 px-2 py-2 text-xs" style={{ color: "#00FF00" }}>Username</th>
                      </tr>
                    </thead>
                    <tbody>
                      {topReferrers.slice(0, 25).map((referrer, index) => (
                        <tr key={referrer.fid}>
                          <td className="border-b border-r border-[#00FF00]/20 px-2 py-2 text-sm text-center" style={{ color: "#b7ffb7" }}>{index + 1}</td>
                          <td className="border-b border-r border-[#00FF00]/20 px-2 py-2 text-sm font-semibold text-center" style={{ color: "#b7ffb7" }}>
                            {referrer.referrals}
                          </td>
                          <td className="border-b border-[#00FF00]/20 px-2 py-2">
                            <button
                              type="button"
                              className="flex items-center gap-2 text-left cursor-pointer"
                              style={{ color: "#b7ffb7" }}
                              onClick={() => {
                                void hapticTap();
                                sdk.actions.viewProfile({ fid: referrer.fid }).catch(() => {});
                              }}
                            >
                              <img
                                src={referrer.pfpUrl}
                                alt={referrer.username}
                                className="h-8 w-8 rounded-full object-cover"
                                style={{ border: "2px solid #00FF00" }}
                                loading="lazy"
                              />
                              <span className="text-sm underline underline-offset-2">{referrer.username}</span>
                            </button>
                          </td>
                        </tr>
                      ))}
                      {topReferrers.length === 0 && (
                        <tr>
                          <td
                            className="px-2 py-3 text-sm text-center"
                            style={{ color: "#b7ffb7" }}
                            colSpan={3}
                          >
                            No referrers yet.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              {yourWarpletTokenId && yourWarpletImageUrl && yourWarpletOpenSeaUrl && (
                <div className="space-y-3">
                  <Text className="text-lg font-bold text-left" style={{ color: "#00FF00" }}>
                    🟢 Your 10X Warplet
                  </Text>
                  <div className="rounded-2xl border border-[#00FF00]/35 bg-[#041204]/85 px-4 py-4 space-y-4">
                    <img
                      src={yourWarpletImageUrl}
                      alt={`10X Warplet #${yourWarpletTokenId}`}
                      className="w-full rounded-xl bg-black object-cover"
                      loading="lazy"
                    />
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                      <button
                        type="button"
                        disabled={!yourWarpletBaseScanUrl}
                        onClick={() => {
                          void hapticTap();
                          if (yourWarpletBaseScanUrl) {
                            sdk.actions.openUrl(yourWarpletBaseScanUrl).catch(() => {});
                          }
                        }}
                        className="w-full rounded-xl border border-[#009900] bg-[#00FF00] px-4 py-3 text-sm font-bold shadow-[2px_4px_0_#008000] transition-all duration-100 active:translate-x-[1px] active:translate-y-[2px] active:shadow-[1px_2px_0_#008000] disabled:cursor-not-allowed disabled:opacity-45 cursor-pointer"
                        style={{ color: "rgb(0, 80, 0)" }}
                      >
                        View on BaseScan
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          void hapticTap();
                          sdk.actions.openUrl(yourWarpletOpenSeaUrl).catch(() => {});
                        }}
                        className="w-full rounded-xl border border-[#009900] bg-[#00FF00] px-4 py-3 text-sm font-bold shadow-[2px_4px_0_#008000] transition-all duration-100 active:translate-x-[1px] active:translate-y-[2px] active:shadow-[1px_2px_0_#008000] cursor-pointer"
                        style={{ color: "rgb(0, 80, 0)" }}
                      >
                        View on OpenSea
                      </button>
                    </div>
                  </div>
                </div>
              )}
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
              onClick={() => {
                void hapticTap();
                setShowWaitlistModal(false);
              }}
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
                    onClick={() => {
                      void hapticTap();
                      setShowWaitlistModal(false);
                    }}
                  >
                    X
                  </button>
                </div>

                <form
                  className="mt-4 space-y-3"
                  onSubmit={(event) => {
                    event.preventDefault();
                    if (!waitlistActionCompleted && waitlistRewardAction) {
                      handleWaitlistRewardAction(waitlistRewardAction).catch(() => {});
                    }
                  }}
                >
                  <input
                    type="email"
                    value={waitlistCompletedEmail || waitlistEmail}
                    onChange={(event) => setWaitlistEmail(event.target.value)}
                    placeholder="you@example.com"
                    autoComplete="email"
                    disabled={waitlistActionCompleted || waitlistSubmitted}
                    className="h-11 w-full rounded-xl border border-[#00FF00] bg-black/70 px-3 text-[16px] text-white outline-none"
                  />
                  {waitlistStatusMessage && (
                    <Text className="text-sm text-left" style={{ color: "#b7ffb7" }}>
                      {waitlistStatusMessage}
                    </Text>
                  )}
                  <button
                    type="submit"
                    disabled={waitlistActionCompleted || waitlistSubmitted || waitlistSubmitting || waitlistVerificationPolling}
                    className="w-full rounded-[14px] border border-[#009900] bg-[#00FF00] px-4 py-2.5 text-base font-bold shadow-[3px_6px_0_#008000] transition-all duration-100 active:translate-x-[1px] active:translate-y-[3px] active:shadow-[1px_3px_0_#008000] disabled:translate-x-0 disabled:translate-y-0 disabled:shadow-none disabled:bg-gray-700 disabled:border-gray-700 cursor-pointer"
                    style={{ color: waitlistActionCompleted || waitlistSubmitted || waitlistSubmitting || waitlistVerificationPolling ? "#fff" : "rgb(0, 80, 0)" }}
                  >
                    {waitlistSubmitting || waitlistVerificationPolling ? (
                      <span className="inline-block h-4 w-4 rounded-full border-2 border-[#FFF] border-r-transparent align-middle animate-spin" />
                    ) : waitlistActionCompleted || waitlistSubmitted ? "Joined Waitlist" : "Join Waitlist"}
                  </button>
                </form>
              </div>
            </div>
          )}

          {!loading && !error && !showOpenInFarcaster && showUnlockRewardPage && showEmail10xModal && (
            <div
              className="fixed inset-0 z-40 flex items-center justify-center px-4 bg-black/70 backdrop-blur-[2px]"
              onClick={() => {
                void hapticTap();
                setShowEmail10xModal(false);
              }}
            >
              <div
                className="w-full max-w-sm rounded-2xl border border-[#00FF00]/45 bg-[#041204] p-5 shadow-[0_0_40px_rgba(0,255,0,0.15)]"
                onClick={(event) => event.stopPropagation()}
              >
                <div className="flex items-start justify-between gap-3">
                  <Text className="text-xl font-bold text-left" style={{ color: "#00FF00" }}>
                    Email us your feedback
                  </Text>
                  <button
                    type="button"
                    aria-label="Close email popup"
                    className="text-[#b7ffb7] hover:text-white text-lg font-bold leading-none cursor-pointer"
                    onClick={() => {
                      void hapticTap();
                      setShowEmail10xModal(false);
                    }}
                  >
                    X
                  </button>
                </div>

                <div className="mt-4 space-y-3">
                  <Text className="text-sm text-left" style={{ color: "#b7ffb7" }}>
                    Help us make 10X better!
                  </Text>
                  <Text className="text-sm text-left" style={{ color: "#b7ffb7" }}>
                    What do you like?
                  </Text>
                  <Text className="text-sm text-left" style={{ color: "#b7ffb7" }}>
                    What do you not like?
                  </Text>
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      readOnly
                      value="10x@10x.meme"
                      className="h-11 w-full rounded-xl border border-[#00FF00] bg-black/70 px-3 text-[16px] text-white outline-none"
                    />
                    <button
                      type="button"
                      className="h-10 w-10 shrink-0 rounded-[10px] border border-[#009900] bg-[#00FF00] text-xl font-bold shadow-[2px_4px_0_#008000] transition-all duration-100 active:translate-x-[1px] active:translate-y-[2px] active:shadow-[1px_2px_0_#008000] cursor-pointer"
                      style={{ color: "rgb(0, 80, 0)" }}
                      onClick={() => {
                        void hapticTap();
                        if (navigator.clipboard?.writeText) {
                          navigator.clipboard.writeText("10x@10x.meme").then(() => {
                            showCopyToast();
                          }).catch(() => {});
                        }
                      }}
                    >
                      📋
                    </button>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      handleEmailFeedbackDone().catch(() => {});
                    }}
                    disabled={emailFeedbackSubmitting}
                    className="mt-1 w-full rounded-[14px] border border-[#009900] bg-[#00FF00] px-4 py-2.5 text-base font-bold shadow-[3px_6px_0_#008000] transition-all duration-100 active:translate-x-[1px] active:translate-y-[3px] active:shadow-[1px_3px_0_#008000] disabled:translate-x-0 disabled:translate-y-0 disabled:shadow-none disabled:bg-gray-700 disabled:border-gray-700 cursor-pointer"
                    style={{ color: emailFeedbackSubmitting ? "#fff" : "rgb(0, 80, 0)" }}
                  >
                    {emailFeedbackSubmitting ? (
                      <span className="inline-block h-4 w-4 rounded-full border-2 border-[#FFF] border-r-transparent align-middle animate-spin" />
                    ) : "I've sent feedback"}
                  </button>
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
                  className={`w-full mt-0 px-5 py-3 rounded-[20px] border border-[#009900] bg-[#00FF00] hover:bg-[#33ff33] font-bold text-base whitespace-nowrap transition-all duration-100 shadow-[3px_6px_0_#008000] active:translate-x-[1px] active:translate-y-[3px] active:shadow-[1px_3px_0_#008000] disabled:bg-gray-700 disabled:border-gray-700 disabled:shadow-none disabled:translate-x-0 disabled:translate-y-0 cursor-pointer ${shareButtonPulseClass}`}
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
                            void hapticTap();
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
                onClick={() => {
                  void hapticTap();
                  setActionError("");
                }}
              >
                ✕
              </button>
            </div>
          </div>
        </div>
      )}

      {copyToastVisible && (
        <div className="fixed bottom-6 left-1/2 z-30 -translate-x-1/2">
          <div className="rounded-xl border border-[#00FF00]/45 bg-black/90 px-4 py-2 shadow-lg backdrop-blur-sm">
            <Text className="text-sm font-semibold text-center" style={{ color: "#00FF00" }}>
              Link copied to clipboard
            </Text>
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
            {`forceNoMatch=${forceNoMatch} forceMatch=${forceMatch} computedMatched=${isMatched} debugParam=${debugEnabled}`}
          </Text>
          <Text className="text-[11px] leading-tight" style={{ color: "#67e8f9" }}>
            {`error=${error || "none"}`}
          </Text>
        </div>
      )}
    </MiniAppShell>
  );
}





