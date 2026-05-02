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

type ContractOrder = {
  parameters: {
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
  signature: `0x${string}`;
};

type MatchOrdersFulfillment = {
  offerComponents: Array<{ orderIndex: bigint; itemIndex: bigint }>;
  considerationComponents: Array<{ orderIndex: bigint; itemIndex: bigint }>;
};

const MATCH_ORDERS_ABI = [
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

function toBigInt(value: string | number | bigint | undefined, fallback = 0n): bigint {
  if (typeof value === "bigint") return value;
  if (typeof value === "number") return BigInt(value);
  if (typeof value === "string" && value.length > 0) return BigInt(value);
  return fallback;
}

function randomSalt(): bigint {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  const hex = Array.from(bytes, b => b.toString(16).padStart(2, "0")).join("");
  return BigInt(`0x${hex}`);
}

function isCurrencyItemType(itemType: number): boolean {
  return itemType === 0 || itemType === 1;
}

function rawToContractOrder(params: RawOrderParameters, signature: string): ContractOrder {
  return {
    parameters: {
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
    },
    signature: (signature || "0x") as `0x${string}`,
  };
}

function buildCounterOrder(order: ContractOrder, buyerAddress: Address): ContractOrder {
  const buyer = buyerAddress.toLowerCase();
  const paymentItems = order.parameters.consideration.filter(
    item => item.recipient.toLowerCase() !== buyer
  );
  const totalStart = paymentItems.reduce((s, item) => s + item.startAmount, 0n);
  const totalEnd = paymentItems.reduce((s, item) => s + item.endAmount, 0n);

  return {
    parameters: {
      offerer: buyerAddress,
      zone: order.parameters.zone,
      offer:
        paymentItems.length > 0
          ? [{
              itemType: paymentItems[0].itemType,
              token: paymentItems[0].token,
              identifierOrCriteria: paymentItems[0].identifierOrCriteria,
              startAmount: totalStart,
              endAmount: totalEnd,
            }]
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
}

function buildFulfillments(order: ContractOrder): MatchOrdersFulfillment[] {
  const nftFulfillments: MatchOrdersFulfillment[] = [];
  order.parameters.offer.forEach((offerItem, offerIdx) => {
    const considerationIdx = order.parameters.consideration.findIndex(
      c =>
        c.itemType === offerItem.itemType &&
        c.token.toLowerCase() === offerItem.token.toLowerCase() &&
        c.identifierOrCriteria === offerItem.identifierOrCriteria
    );
    if (considerationIdx === -1) throw new Error("Could not match NFT offer item to consideration");
    nftFulfillments.push({
      offerComponents: [{ orderIndex: 0n, itemIndex: BigInt(offerIdx) }],
      considerationComponents: [{ orderIndex: 0n, itemIndex: BigInt(considerationIdx) }],
    });
  });

  const currencyFulfillments: MatchOrdersFulfillment[] = [];
  order.parameters.consideration.forEach((item, idx) => {
    if (!isCurrencyItemType(item.itemType)) return;
    currencyFulfillments.push({
      offerComponents: [{ orderIndex: 1n, itemIndex: 0n }],
      considerationComponents: [{ orderIndex: 0n, itemIndex: BigInt(idx) }],
    });
  });

  return [...nftFulfillments, ...currencyFulfillments];
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

async function ensureChain(provider: EthereumProvider, chainIdHex: string): Promise<void> {
  const currentChainId = (await provider.request({ method: "eth_chainId" })) as string;
  if (currentChainId?.toLowerCase() === chainIdHex.toLowerCase()) {
    return;
  }

  try {
    await provider.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: chainIdHex }],
    });
  } catch (error) {
    const rpcError = error as RpcError;
    if (rpcError.code !== 4902) {
      throw error;
    }

    await provider.request({
      method: "wallet_addEthereumChain",
      params: [BASE_CHAIN_CONFIG],
    });
  }
}

async function waitForTransactionReceipt(
  provider: EthereumProvider,
  hash: string,
  timeoutMs = 120000
): Promise<void> {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    const receipt = (await provider.request({
      method: "eth_getTransactionReceipt",
      params: [hash],
    })) as { status?: string } | null;

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
  const [fid, setFid] = useState<number | null>(null);
  const [status, setStatus] = useState<WarpletStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>("");
  const [actionError, setActionError] = useState<string>("");
  const [didCelebrate, setDidCelebrate] = useState(false);
  const [isPurchasing, setIsPurchasing] = useState(false);

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
      try {
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
      } catch (err) {
        console.error("Failed to get user context:", err);
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setLoading(false);
      }
      // Hide the splash screen once the app is ready
      sdk.actions.ready();
    };
    init();
  }, []);

  const forceNoMatch =
    typeof window !== "undefined" &&
    new URLSearchParams(window.location.search).get("match") === "false";
  const isMatched = !forceNoMatch && Boolean(status?.matched && typeof status.rarityValue === "number");

  useEffect(() => {
    if (loading || error || !isMatched || didCelebrate) return;

    launchTopConfetti();
    setDidCelebrate(true);
  }, [loading, error, isMatched, didCelebrate]);

  const imageUrl = isMatched
    ? `https://warplets.10x.meme/${status?.rarityValue}.avif`
    : "https://warplets.10x.meme/3081.png";
  const title = isMatched
    ? "Congratulations! You're on the list..."
    : "Oh Snap... You're not on the list.";
  const badgeLabel = isMatched
    ? "🔓 Private 10K NFT Drop"
    : "🔒 Private 10K NFT Drop";
  const buttonLabel = isMatched
    ? isPurchasing
      ? "Processing in Wallet..."
      : "Buy in Farcaster Wallet"
    : "Visit OpenSea to find out why...";

  const handlePrimaryAction = async () => {
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

        if (!quote.listing.protocolData?.parameters) {
          throw new Error("The listing is missing Seaport order data.");
        }

        const provider = (await sdk.wallet.getEthereumProvider()) as EthereumProvider | null;
        if (!provider) {
          throw new Error("Farcaster Wallet is unavailable in this client.");
        }

        const accounts = (await provider.request({ method: "eth_requestAccounts" })) as string[];
        const activeAccount = getAddress(accounts?.[0] ?? "");

        if (activeAccount.toLowerCase() !== quote.buyerAddress.toLowerCase()) {
          throw new Error("Switch Farcaster Wallet to your primary Farcaster address before buying this Warplet.");
        }

        await ensureChain(provider, quote.transaction.chainIdHex || BASE_CHAIN_CONFIG.chainId);

        // Encode matchOrders calldata client-side (viem is bundled by Vite, not the Pages Function)
        const order = rawToContractOrder(quote.listing.protocolData.parameters, quote.listing.protocolData.signature ?? "0x");
        const counterOrder = buildCounterOrder(order, activeAccount);
        const fulfillments = buildFulfillments(order);
        const matchOrdersData = encodeFunctionData({
          abi: MATCH_ORDERS_ABI,
          functionName: "matchOrders",
          args: [[order, counterOrder], fulfillments],
        });

        const allowanceCallData = encodeFunctionData({
          abi: erc20Abi,
          functionName: "allowance",
          args: [activeAccount, getAddress(quote.approval.spender)],
        });

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

        const currentAllowance = BigInt(allowanceResult || "0x0");
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
        launchTopConfetti();
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

      <div className="relative z-10 w-full h-[80px] bg-black flex items-start justify-between">
        <button
          type="button"
          aria-label="Open 10X website"
          onClick={handleSplashAction}
          className="h-full cursor-pointer"
        >
          <img
            src="/splash.png"
            alt="10X Warplets"
            className="h-full w-auto object-contain pl-[15px]"
            loading="eager"
          />
        </button>
        <button
          type="button"
          aria-label="Open 10X Warplets on OpenSea"
          onClick={handleOpenSeaAction}
          className="pl-5 pr-4 py-5 flex items-start cursor-pointer"
        >
          <img
            src="/opensea.png"
            alt="OpenSea"
            className="w-[40px] h-[40px]"
            loading="eager"
          />
        </button>
      </div>

      <div className="relative z-10 w-full max-w-md text-center space-y-2 px-4 pt-2">
        <div className="relative px-4 pt-2 pb-4 text-center">
          <Text className="text-5xl font-bold leading-tight" style={{ color: "#00FF00" }}>10X Warplets</Text>
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

        {!loading && !error && (
          <div className="space-y-0">
            <div className="px-4 pb-5 pt-0 space-y-3">
              <Text className="text-lg font-semibold" style={{ color: "#00FF00" }}>
                {title}
              </Text>
              <img
                src={imageUrl}
                alt="Loading..."
                className="w-full rounded-[20px] p-[2px] bg-[#00FF00]/20 border border-[#00FF00]/45"
                loading="eager"
              />
            </div>
            <div className="px-4">
              <button
                onClick={handlePrimaryAction}
                disabled={isPurchasing}
                className="w-full mt-0 px-5 py-3 rounded-[20px] border border-[#009900] bg-[#00FF00] hover:bg-[#33ff33] font-bold text-lg transition-all duration-100 shadow-[3px_6px_0_#008000] active:translate-x-[1px] active:translate-y-[3px] active:shadow-[1px_3px_0_#008000] disabled:bg-gray-700 disabled:border-gray-700 disabled:shadow-none disabled:translate-x-0 disabled:translate-y-0 cursor-pointer"
                style={{ color: "rgb(0, 80, 0)" }}
              >
                {buttonLabel}
              </button>
              {actionError && (
                <Text className="pt-3 text-sm text-red-400">{actionError}</Text>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
