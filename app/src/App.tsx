import { useEffect, useState } from "react";
import sdk from "@farcaster/miniapp-sdk";
import confetti from "canvas-confetti";
import { Text } from "@neynar/ui/typography";
import { encodeFunctionData, erc20Abi, getAddress, type Address } from "viem";

type WarpletStatus = {
  fid: number;
  exists: boolean;
  matched: boolean;
  rarityValue: number | null;
  buyTransactionOn: string | null;
  sharedOn: string | null;
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

export default function App() {
  const FARCASTER_MINIAPP_URL = "https://farcaster.xyz/miniapps/uR3Rzs-k6AnV/10x";
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

        // If launched from a notification, record the open for analytics
        const loc = context.location as { type?: string; notification?: { notificationId?: string } } | undefined;
        if (loc?.type === "notification" && loc.notification?.notificationId) {
          fetch("/api/notifications/open", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              notificationId: loc.notification.notificationId,
              fid: context.user.fid,
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

  const forceNoMatch =
    typeof window !== "undefined" &&
    new URLSearchParams(window.location.search).get("match") === "false";
  const debugEnabled =
    typeof window !== "undefined" &&
    new URLSearchParams(window.location.search).get("debug") === "1";
  const currentHost = typeof window !== "undefined" ? window.location.host : "";
  const showDebugChip = debugEnabled;
  const isMatched = !forceNoMatch && Boolean(status?.matched && typeof status.rarityValue === "number");
  const hasPurchased = Boolean(purchasedTokenId);
  const displayTokenId = purchasedTokenId ?? (typeof status?.rarityValue === "number" ? String(status.rarityValue) : null);
  const formattedTokenId =
    displayTokenId && Number.isFinite(Number(displayTokenId))
      ? Number(displayTokenId).toLocaleString("en-US")
      : displayTokenId;

  useEffect(() => {
    if (loading || error || !isMatched || didCelebrate) return;

    launchTopConfetti();
    setDidCelebrate(true);
  }, [loading, error, isMatched, didCelebrate]);

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
    ? "Share your 10X Warplet!"
    : isMatched
      ? isPurchasing
        ? "Processing in Wallet..."
        : "Buy in Farcaster Wallet"
      : "Visit OpenSea to find out why...";
  const shareButtonPulseClass = hasPurchased && !hasShared ? "share-cta-pulse-x" : "";

  const handlePrimaryAction = async () => {
    if (hasPurchased && purchasedTokenId) {
      setActionError("");
      launchTopConfetti();

      try {
        const castResult = await sdk.actions.composeCast({
          text:
            `🎉 Claimed my 10X Warplet!\n\n10X Rarity #${Number(purchasedTokenId).toLocaleString("en-US")} of 10,000.\n\nPrice increases every 10 days.\n\nSupply decreases every 10 days.\n\n💚 Don't miss out...`,
          embeds: ["https://app.10x.meme", `https://warplets.10x.meme/${purchasedTokenId}.gif`],
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

    await sdk.actions.openUrl("https://opensea.io/collection/10xwarplets/overview");
  };

  const handleOpenSeaAction = async () => {
    await sdk.actions.openUrl("https://opensea.io/collection/10xwarplets/overview");
  };

  const handleSplashAction = async () => {
    await sdk.actions.openUrl("https://10x.meme");
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
      <img
        src="/bg2.gif"
        alt=""
        aria-hidden="true"
        className="absolute inset-0 w-full h-full object-cover opacity-25 pointer-events-none select-none"
      />

      <div className="relative z-10 w-full h-[60px] bg-black flex items-start justify-between">
        <button
          type="button"
          aria-label="Open 10X website"
          onClick={handleSplashAction}
          className="h-[60px] w-[76px] pl-4 cursor-pointer"
        >
          <img
            src="/splash.png"
            alt="10X Warplets"
            className="h-[60px] w-[60px] object-contain"
            loading="eager"
          />
        </button>
        <button
          type="button"
          aria-label="Open 10X Warplets on OpenSea"
          onClick={handleOpenSeaAction}
          className="pt-[15px] pr-[18px] pb-[15px] pl-[15px] flex items-start cursor-pointer"
        >
          <img
            src="/opensea.png"
            alt="OpenSea"
            className="w-[30px] h-[30px]"
            loading="eager"
          />
        </button>
      </div>

      <div className="relative z-10 w-full max-w-md text-center space-y-2 px-4 pt-2">
        <div className="relative px-4 text-center mb-4">
          <Text className="text-[2.7rem] font-bold leading-tight" style={{ color: "#00FF00" }}>10X Warplets</Text>
          <Text
            className="inline-flex mt-3 px-3 py-1 text-sm font-semibold leading-tight border border-[#00FF00]/70 rounded-full"
            style={{ color: "#00FF00", backgroundColor: "rgba(0, 255, 0, 0.12)" }}
          >
            {badgeLabel}
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
              <Text className="text-lg font-semibold" style={{ color: "#00FF00" }}>
                {title}
              </Text>
              <div className="w-full rounded-[20px] p-[2px] bg-[#00FF00]/20 border border-[#00FF00]/45">
                <img
                  src={imageUrl}
                  alt="Loading..."
                  className="w-full rounded-[18px]"
                  loading="eager"
                />
                {isMatched && displayTokenId && (
                  <Text className="py-2 text-base font-bold" style={{ color: "#00FF00" }}>
                    {`10X Rarity #${formattedTokenId} of 10,000`}
                  </Text>
                )}
              </div>
            </div>
            <div className="px-4">
              <button
                onClick={handlePrimaryAction}
                disabled={isPurchasing}
                className={`w-full mt-0 px-5 py-3 rounded-[20px] border border-[#009900] bg-[#00FF00] hover:bg-[#33ff33] font-bold text-lg transition-all duration-100 shadow-[3px_6px_0_#008000] active:translate-x-[1px] active:translate-y-[3px] active:shadow-[1px_3px_0_#008000] disabled:bg-gray-700 disabled:border-gray-700 disabled:shadow-none disabled:translate-x-0 disabled:translate-y-0 cursor-pointer ${shareButtonPulseClass}`}
                style={{ color: isPurchasing ? "#ffffff" : "rgb(0, 80, 0)" }}
              >
                {buttonLabel}
              </button>
            </div>
          </div>
        )}
      </div>

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
