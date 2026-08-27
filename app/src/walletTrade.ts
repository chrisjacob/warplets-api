import { encodeFunctionData, erc20Abi, erc721Abi, getAddress, recoverTypedDataAddress, serializeTypedData, type Address } from "viem";
import { appendBuilderCode, builderCodeSuffix } from "./builderCode";
import { trackAppEvent } from "./analytics";
import { recordLocalOfferDiagnostic } from "./localOfferDiagnostics";

export type EthereumProvider = {
  request(args: { method: string; params?: readonly unknown[] | object }): Promise<unknown>;
  isBaseAccount?: boolean;
  connectorId?: string;
  walletConnectPeer?: {
    name?: string;
    sessionTopic?: string;
    nativeRedirect?: string;
    universalRedirect?: string;
  };
};

export type WalletReviewRequest = {
  provider: EthereumProvider;
  kind: "transaction" | "signature" | "network";
  phase: "started" | "settled";
};

const walletReviewRequestListeners = new Set<(request: WalletReviewRequest) => void>();

export function subscribeToWalletReviewRequests(listener: (request: WalletReviewRequest) => void): () => void {
  walletReviewRequestListeners.add(listener);
  return () => walletReviewRequestListeners.delete(listener);
}

function notifyWalletReviewRequest(
  provider: EthereumProvider,
  kind: WalletReviewRequest["kind"],
  phase: WalletReviewRequest["phase"],
): void {
  walletReviewRequestListeners.forEach((listener) => listener({ provider, kind, phase }));
}

export type TokenApprovalRequirement = {
  tokenAddress: string;
  spender: string;
  amount: string;
};

export type NftApprovalRequirement = {
  tokenAddress: string;
  spender: string;
};

export type PreparedTransaction = {
  chainIdHex?: string | null;
  to?: string | null;
  value?: string | number | null;
  data?: string | null;
  input?: string | null;
  inputData?: unknown;
};

export type AtomicBatchReceipt = {
  transactionHash: string;
  logs: Array<{ address?: unknown; topics?: unknown; data?: unknown }>;
};

export type SeaportCancelOrderParameters = {
  offerer?: unknown;
  zone?: unknown;
  offer?: unknown;
  consideration?: unknown;
  orderType?: unknown;
  startTime?: unknown;
  endTime?: unknown;
  zoneHash?: unknown;
  salt?: unknown;
  conduitKey?: unknown;
  counter?: unknown;
};

type SeaportOrderParameters = {
  offerer?: unknown;
  zone?: unknown;
  offer?: unknown;
  consideration?: unknown;
  orderType?: unknown;
  startTime?: unknown;
  endTime?: unknown;
  zoneHash?: unknown;
  salt?: unknown;
  conduitKey?: unknown;
  totalOriginalConsiderationItems?: unknown;
};

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
const BASE_RPC_URL = BASE_CHAIN_CONFIG.rpcUrls[0];
const seaportCancelAbi = [{
  type: "function",
  name: "cancel",
  stateMutability: "nonpayable",
  inputs: [{
    name: "orders",
    type: "tuple[]",
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
      { name: "counter", type: "uint256" },
    ],
  }],
  outputs: [{ name: "cancelled", type: "bool" }],
}] as const;

const seaportFulfillmentAbi = [
  {
    type: "function",
    name: "fulfillAvailableAdvancedOrders",
    stateMutability: "payable",
    inputs: [
      { name: "advancedOrders", type: "tuple[]", components: [
        { name: "parameters", type: "tuple", components: [
          { name: "offerer", type: "address" },
          { name: "zone", type: "address" },
          { name: "offer", type: "tuple[]", components: [
            { name: "itemType", type: "uint8" }, { name: "token", type: "address" },
            { name: "identifierOrCriteria", type: "uint256" }, { name: "startAmount", type: "uint256" }, { name: "endAmount", type: "uint256" },
          ] },
          { name: "consideration", type: "tuple[]", components: [
            { name: "itemType", type: "uint8" }, { name: "token", type: "address" },
            { name: "identifierOrCriteria", type: "uint256" }, { name: "startAmount", type: "uint256" }, { name: "endAmount", type: "uint256" },
            { name: "recipient", type: "address" },
          ] },
          { name: "orderType", type: "uint8" }, { name: "startTime", type: "uint256" }, { name: "endTime", type: "uint256" },
          { name: "zoneHash", type: "bytes32" }, { name: "salt", type: "uint256" }, { name: "conduitKey", type: "bytes32" },
          { name: "totalOriginalConsiderationItems", type: "uint256" },
        ] },
        { name: "numerator", type: "uint120" }, { name: "denominator", type: "uint120" },
        { name: "signature", type: "bytes" }, { name: "extraData", type: "bytes" },
      ] },
      { name: "criteriaResolvers", type: "tuple[]", components: [
        { name: "orderIndex", type: "uint256" }, { name: "side", type: "uint8" }, { name: "index", type: "uint256" },
        { name: "identifier", type: "uint256" }, { name: "criteriaProof", type: "bytes32[]" },
      ] },
      { name: "offerFulfillments", type: "tuple[][]", components: [
        { name: "orderIndex", type: "uint256" }, { name: "itemIndex", type: "uint256" },
      ] },
      { name: "considerationFulfillments", type: "tuple[][]", components: [
        { name: "orderIndex", type: "uint256" }, { name: "itemIndex", type: "uint256" },
      ] },
      { name: "fulfillerConduitKey", type: "bytes32" },
      { name: "recipient", type: "address" },
      { name: "maximumFulfilled", type: "uint256" },
    ],
    outputs: [
      { name: "availableOrders", type: "bool[]" },
      { name: "executions", type: "tuple[]", components: [
        { name: "item", type: "tuple", components: [
          { name: "itemType", type: "uint8" }, { name: "token", type: "address" },
          { name: "identifier", type: "uint256" }, { name: "amount", type: "uint256" }, { name: "recipient", type: "address" },
        ] },
        { name: "offerer", type: "address" }, { name: "conduitKey", type: "bytes32" },
      ] },
    ],
  },
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
              { name: "offer", type: "tuple[]", components: [
                { name: "itemType", type: "uint8" },
                { name: "token", type: "address" },
                { name: "identifierOrCriteria", type: "uint256" },
                { name: "startAmount", type: "uint256" },
                { name: "endAmount", type: "uint256" },
              ] },
              { name: "consideration", type: "tuple[]", components: [
                { name: "itemType", type: "uint8" },
                { name: "token", type: "address" },
                { name: "identifierOrCriteria", type: "uint256" },
                { name: "startAmount", type: "uint256" },
                { name: "endAmount", type: "uint256" },
                { name: "recipient", type: "address" },
              ] },
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
      { name: "criteriaResolvers", type: "tuple[]", components: [
        { name: "orderIndex", type: "uint256" },
        { name: "side", type: "uint8" },
        { name: "index", type: "uint256" },
        { name: "identifier", type: "uint256" },
        { name: "criteriaProof", type: "bytes32[]" },
      ] },
      { name: "fulfillments", type: "tuple[]", components: [
        { name: "offerComponents", type: "tuple[]", components: [
          { name: "orderIndex", type: "uint256" },
          { name: "itemIndex", type: "uint256" },
        ] },
        { name: "considerationComponents", type: "tuple[]", components: [
          { name: "orderIndex", type: "uint256" },
          { name: "itemIndex", type: "uint256" },
        ] },
      ] },
      { name: "recipient", type: "address" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "fulfillBasicOrder_efficient_6GL6yc",
    stateMutability: "payable",
    inputs: [{
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
        { name: "additionalRecipients", type: "tuple[]", components: [
          { name: "amount", type: "uint256" },
          { name: "recipient", type: "address" },
        ] },
        { name: "signature", type: "bytes" },
      ],
    }],
    outputs: [{ name: "fulfilled", type: "bool" }],
  },
  {
    type: "function",
    name: "fulfillOrder",
    stateMutability: "payable",
    inputs: [
      { name: "order", type: "tuple", components: [
        { name: "parameters", type: "tuple", components: [
          { name: "offerer", type: "address" },
          { name: "zone", type: "address" },
          { name: "offer", type: "tuple[]", components: [
            { name: "itemType", type: "uint8" },
            { name: "token", type: "address" },
            { name: "identifierOrCriteria", type: "uint256" },
            { name: "startAmount", type: "uint256" },
            { name: "endAmount", type: "uint256" },
          ] },
          { name: "consideration", type: "tuple[]", components: [
            { name: "itemType", type: "uint8" },
            { name: "token", type: "address" },
            { name: "identifierOrCriteria", type: "uint256" },
            { name: "startAmount", type: "uint256" },
            { name: "endAmount", type: "uint256" },
            { name: "recipient", type: "address" },
          ] },
          { name: "orderType", type: "uint8" },
          { name: "startTime", type: "uint256" },
          { name: "endTime", type: "uint256" },
          { name: "zoneHash", type: "bytes32" },
          { name: "salt", type: "uint256" },
          { name: "conduitKey", type: "bytes32" },
          { name: "totalOriginalConsiderationItems", type: "uint256" },
        ] },
        { name: "signature", type: "bytes" },
      ] },
      { name: "fulfillerConduitKey", type: "bytes32" },
    ],
    outputs: [{ name: "fulfilled", type: "bool" }],
  },
  {
    type: "function",
    name: "fulfillAdvancedOrder",
    stateMutability: "payable",
    inputs: [
      { name: "advancedOrder", type: "tuple", components: [
        { name: "parameters", type: "tuple", components: [
          { name: "offerer", type: "address" },
          { name: "zone", type: "address" },
          { name: "offer", type: "tuple[]", components: [
            { name: "itemType", type: "uint8" },
            { name: "token", type: "address" },
            { name: "identifierOrCriteria", type: "uint256" },
            { name: "startAmount", type: "uint256" },
            { name: "endAmount", type: "uint256" },
          ] },
          { name: "consideration", type: "tuple[]", components: [
            { name: "itemType", type: "uint8" },
            { name: "token", type: "address" },
            { name: "identifierOrCriteria", type: "uint256" },
            { name: "startAmount", type: "uint256" },
            { name: "endAmount", type: "uint256" },
            { name: "recipient", type: "address" },
          ] },
          { name: "orderType", type: "uint8" },
          { name: "startTime", type: "uint256" },
          { name: "endTime", type: "uint256" },
          { name: "zoneHash", type: "bytes32" },
          { name: "salt", type: "uint256" },
          { name: "conduitKey", type: "bytes32" },
          { name: "totalOriginalConsiderationItems", type: "uint256" },
        ] },
        { name: "numerator", type: "uint120" },
        { name: "denominator", type: "uint120" },
        { name: "signature", type: "bytes" },
        { name: "extraData", type: "bytes" },
      ] },
      { name: "criteriaResolvers", type: "tuple[]", components: [
        { name: "orderIndex", type: "uint256" },
        { name: "side", type: "uint8" },
        { name: "index", type: "uint256" },
        { name: "identifier", type: "uint256" },
        { name: "criteriaProof", type: "bytes32[]" },
      ] },
      { name: "fulfillerConduitKey", type: "bytes32" },
      { name: "recipient", type: "address" },
    ],
    outputs: [{ name: "fulfilled", type: "bool" }],
  },
] as const;

function asObject(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : undefined;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function unwrapOrderValue(value: unknown): unknown {
  const maybe = asObject(value);
  return maybe && "value" in maybe ? maybe.value : value;
}

function toOrderBigInt(value: unknown): bigint {
  const raw = unwrapOrderValue(value);
  if (typeof raw === "bigint") return raw;
  if (typeof raw === "number" && Number.isFinite(raw)) return BigInt(raw);
  if (typeof raw === "string" && raw.trim()) return BigInt(raw.trim());
  return 0n;
}

function toOrderNumber(value: unknown): number {
  const raw = unwrapOrderValue(value);
  if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  if (typeof raw === "string" && raw.trim()) return Number(raw);
  return 0;
}

function toOrderAddress(value: unknown): Address {
  const raw = unwrapOrderValue(value);
  return getAddress(typeof raw === "string" ? raw : "0x0000000000000000000000000000000000000000");
}

function toOrderBytes32(value: unknown): `0x${string}` {
  const raw = unwrapOrderValue(value);
  if (typeof raw === "string" && /^0x[0-9a-fA-F]{64}$/.test(raw)) return raw as `0x${string}`;
  return "0x0000000000000000000000000000000000000000000000000000000000000000";
}

function normalizeOfferItem(value: unknown) {
  const item = asObject(value) ?? {};
  return {
    itemType: toOrderNumber(item.itemType),
    token: toOrderAddress(item.token),
    identifierOrCriteria: toOrderBigInt(item.identifierOrCriteria),
    startAmount: toOrderBigInt(item.startAmount),
    endAmount: toOrderBigInt(item.endAmount),
  };
}

function normalizeConsiderationItem(value: unknown) {
  const item = asObject(value) ?? {};
  return {
    ...normalizeOfferItem(item),
    recipient: toOrderAddress(item.recipient),
  };
}

function normalizeOrderParameters(value: unknown) {
  const parameters = asObject(value) as SeaportOrderParameters | undefined;
  if (!parameters) throw new Error("OpenSea fulfillment payload is missing order parameters");
  return {
    offerer: toOrderAddress(parameters.offerer),
    zone: toOrderAddress(parameters.zone),
    offer: asArray(parameters.offer).map(normalizeOfferItem),
    consideration: asArray(parameters.consideration).map(normalizeConsiderationItem),
    orderType: toOrderNumber(parameters.orderType),
    startTime: toOrderBigInt(parameters.startTime),
    endTime: toOrderBigInt(parameters.endTime),
    zoneHash: toOrderBytes32(parameters.zoneHash),
    salt: toOrderBigInt(parameters.salt),
    conduitKey: toOrderBytes32(parameters.conduitKey),
    totalOriginalConsiderationItems: toOrderBigInt(parameters.totalOriginalConsiderationItems),
  };
}

function normalizeOrder(value: unknown) {
  const order = asObject(value);
  if (!order) throw new Error("OpenSea fulfillment payload is missing order");
  return {
    parameters: normalizeOrderParameters(order.parameters),
    signature: (asString(order.signature) ?? "0x") as `0x${string}`,
  };
}

function normalizeAdvancedOrder(value: unknown) {
  const order = asObject(value);
  if (!order) throw new Error("OpenSea fulfillment payload is missing advanced order");
  return {
    parameters: normalizeOrderParameters(order.parameters),
    numerator: toOrderBigInt(order.numerator ?? 1),
    denominator: toOrderBigInt(order.denominator ?? 1),
    signature: (asString(order.signature) ?? "0x") as `0x${string}`,
    extraData: (asString(order.extraData) ?? "0x") as `0x${string}`,
  };
}

function normalizeCriteriaResolver(value: unknown) {
  const resolver = asObject(value) ?? {};
  return {
    orderIndex: toOrderBigInt(resolver.orderIndex),
    side: toOrderNumber(resolver.side),
    index: toOrderBigInt(resolver.index),
    identifier: toOrderBigInt(resolver.identifier),
    criteriaProof: asArray(resolver.criteriaProof).map((item) => toOrderBytes32(item)),
  };
}

function normalizeFulfillmentComponent(component: unknown) {
  const item = asObject(component) ?? {};
  return {
    orderIndex: toOrderBigInt(item.orderIndex),
    itemIndex: toOrderBigInt(item.itemIndex),
  };
}

function normalizeFulfillment(value: unknown) {
  const fulfillment = asObject(value) ?? {};
  return {
    offerComponents: asArray(fulfillment.offerComponents).map(normalizeFulfillmentComponent),
    considerationComponents: asArray(fulfillment.considerationComponents).map(normalizeFulfillmentComponent),
  };
}

function normalizeBasicOrderParameters(value: unknown) {
  const input = asObject(value);
  const parameters = asObject(input?.parameters) ?? input;
  if (!parameters || !asString(parameters.considerationToken)) {
    throw new Error("OpenSea fulfillment payload is missing basic order parameters");
  }
  return {
    considerationToken: toOrderAddress(parameters.considerationToken),
    considerationIdentifier: toOrderBigInt(parameters.considerationIdentifier),
    considerationAmount: toOrderBigInt(parameters.considerationAmount),
    offerer: toOrderAddress(parameters.offerer),
    zone: toOrderAddress(parameters.zone),
    offerToken: toOrderAddress(parameters.offerToken),
    offerIdentifier: toOrderBigInt(parameters.offerIdentifier),
    offerAmount: toOrderBigInt(parameters.offerAmount),
    basicOrderType: toOrderNumber(parameters.basicOrderType),
    startTime: toOrderBigInt(parameters.startTime),
    endTime: toOrderBigInt(parameters.endTime),
    zoneHash: toOrderBytes32(parameters.zoneHash),
    salt: toOrderBigInt(parameters.salt),
    offererConduitKey: toOrderBytes32(parameters.offererConduitKey),
    fulfillerConduitKey: toOrderBytes32(parameters.fulfillerConduitKey),
    totalOriginalAdditionalRecipients: toOrderBigInt(parameters.totalOriginalAdditionalRecipients),
    additionalRecipients: asArray(parameters.additionalRecipients).map((recipient) => {
      const item = asObject(recipient) ?? {};
      return {
        amount: toOrderBigInt(item.amount),
        recipient: toOrderAddress(item.recipient),
      };
    }),
    signature: (asString(parameters.signature) ?? "0x") as `0x${string}`,
  };
}

function buildOpenSeaFulfillmentData(inputData: unknown, fallbackRecipient: string): `0x${string}` {
  const input = asObject(inputData);
  if (!input) throw new Error("OpenSea fulfillment payload is missing input data");

  if (asArray(input.availableAdvancedOrders).length > 0) {
    return encodeFunctionData({
      abi: seaportFulfillmentAbi,
      functionName: "fulfillAvailableAdvancedOrders",
      args: [
        asArray(input.availableAdvancedOrders).map(normalizeAdvancedOrder),
        asArray(input.criteriaResolvers).map(normalizeCriteriaResolver),
        asArray(input.offerFulfillments).map((group) => asArray(group).map(normalizeFulfillmentComponent)),
        asArray(input.considerationFulfillments).map((group) => asArray(group).map(normalizeFulfillmentComponent)),
        toOrderBytes32(input.fulfillerConduitKey),
        getAddress(asString(input.recipient) ?? fallbackRecipient),
        BigInt(asArray(input.availableAdvancedOrders).length),
      ],
    });
  }

  if (asArray(input.orders).length > 0) {
    return encodeFunctionData({
      abi: seaportFulfillmentAbi,
      functionName: "matchAdvancedOrders",
      args: [
        asArray(input.orders).map(normalizeAdvancedOrder),
        asArray(input.criteriaResolvers).map(normalizeCriteriaResolver),
        asArray(input.fulfillments).map(normalizeFulfillment),
        getAddress(asString(input.recipient) ?? fallbackRecipient),
      ],
    });
  }

  const order = asObject(input.order);
  const advancedOrder = asObject(input.advancedOrder);
  if (order?.parameters) {
    return encodeFunctionData({
      abi: seaportFulfillmentAbi,
      functionName: "fulfillOrder",
      args: [
        normalizeOrder(order),
        toOrderBytes32(input.fulfillerConduitKey ?? input.conduitKey),
      ],
    });
  }
  if (advancedOrder?.parameters) {
    return encodeFunctionData({
      abi: seaportFulfillmentAbi,
      functionName: "fulfillAdvancedOrder",
      args: [
        normalizeAdvancedOrder(advancedOrder),
        asArray(input.criteriaResolvers).map(normalizeCriteriaResolver),
        toOrderBytes32(input.fulfillerConduitKey ?? input.conduitKey),
        getAddress(asString(input.recipient) ?? fallbackRecipient),
      ],
    });
  }

  return encodeFunctionData({
    abi: seaportFulfillmentAbi,
    functionName: "fulfillBasicOrder_efficient_6GL6yc",
    args: [normalizeBasicOrderParameters(input)],
  });
}

function normalizeSeaportCancelOrder(parameters: SeaportCancelOrderParameters) {
  return {
    offerer: toOrderAddress(parameters.offerer),
    zone: toOrderAddress(parameters.zone),
    offer: asArray(parameters.offer).map(normalizeOfferItem),
    consideration: asArray(parameters.consideration).map(normalizeConsiderationItem),
    orderType: toOrderNumber(parameters.orderType),
    startTime: toOrderBigInt(parameters.startTime),
    endTime: toOrderBigInt(parameters.endTime),
    zoneHash: toOrderBytes32(parameters.zoneHash),
    salt: toOrderBigInt(parameters.salt),
    conduitKey: toOrderBytes32(parameters.conduitKey),
    counter: toOrderBigInt(parameters.counter),
  };
}

function withWalletTimeout<T>(promise: Promise<T>, label: string, timeoutMs = 25000): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timeoutId = globalThis.setTimeout(() => {
      reject(new Error(`${label} did not open or respond. Return to your wallet and try again.`));
    }, timeoutMs);
    promise.then(
      (value) => {
        globalThis.clearTimeout(timeoutId);
        resolve(value);
      },
      (error) => {
        globalThis.clearTimeout(timeoutId);
        reject(error);
      },
    );
  });
}

function waitForWalletPrompt<T>(promise: Promise<T>, label = "Wallet request", timeoutMs = 120000): Promise<T> {
  return withWalletTimeout(promise, label, timeoutMs);
}

function requestWithWalletReview<T>(
  provider: EthereumProvider,
  kind: WalletReviewRequest["kind"],
  request: () => Promise<T>,
  label = "Wallet request",
  timeoutMs = 120000,
): Promise<T> {
  notifyWalletReviewRequest(provider, kind, "started");
  try {
    return waitForWalletPrompt(request(), label, timeoutMs)
      .finally(() => notifyWalletReviewRequest(provider, kind, "settled"));
  } catch (error) {
    notifyWalletReviewRequest(provider, kind, "settled");
    return Promise.reject(error);
  }
}

function toHexQuantity(value: string | number | bigint | null | undefined): `0x${string}` {
  if (typeof value === "string" && value.startsWith("0x")) return value as `0x${string}`;
  if (typeof value === "string" && value) return `0x${BigInt(value).toString(16)}`;
  if (typeof value === "number") return `0x${BigInt(value).toString(16)}`;
  if (typeof value === "bigint") return `0x${value.toString(16)}`;
  return "0x0";
}

export function getWalletErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  const maybe = asObject(error);
  const message = asString(maybe?.message) ?? asString(maybe?.shortMessage);
  return message ?? String(error);
}

export function getWalletErrorCode(error: unknown): string | null {
  const maybe = asObject(error);
  const code = maybe?.code;
  return code == null ? null : String(code);
}

export function isUserRejected(error: unknown): boolean {
  const message = getWalletErrorMessage(error).toLowerCase();
  const code = getWalletErrorCode(error);
  return code === "4001" || message.includes("rejected") || message.includes("denied") || message.includes("cancelled") || message.includes("canceled");
}

function isWalletTimeoutError(error: unknown): boolean {
  return getWalletErrorMessage(error).toLowerCase().includes("did not open or respond");
}

export function isOpaqueWalletConnectNullError(error: unknown): boolean {
  const message = getWalletErrorMessage(error).toLowerCase();
  return message.includes("null is not an object") && message.includes(".message");
}

function isTypedDataFormatError(error: unknown): boolean {
  const code = getWalletErrorCode(error);
  const message = getWalletErrorMessage(error).toLowerCase();
  return code === "-32602"
    || message.includes("invalid param")
    || message.includes("invalid typed data")
    || message.includes("expected object")
    || message.includes("expected string");
}

function normalizeTypedDataForWallet(typedData: unknown): Record<string, unknown> | null {
  const root = asObject(typedData);
  const domain = asObject(root?.domain);
  const types = asObject(root?.types);
  if (!root || !domain || !types) return null;
  if (types.EIP712Domain) return root;

  const domainTypes: Array<{ name: string; type: string }> = [];
  if (domain.name != null) domainTypes.push({ name: "name", type: "string" });
  if (domain.version != null) domainTypes.push({ name: "version", type: "string" });
  if (domain.chainId != null) domainTypes.push({ name: "chainId", type: "uint256" });
  if (domain.verifyingContract != null) domainTypes.push({ name: "verifyingContract", type: "address" });
  if (domain.salt != null) domainTypes.push({ name: "salt", type: "bytes32" });

  return {
    ...root,
    types: {
      EIP712Domain: domainTypes,
      ...types,
    },
  };
}

type TypedDataField = { name: string; type: string };

function isTypedDataInteger(type: string): boolean {
  return /^(?:u?int)(?:8|16|24|32|40|48|56|64|72|80|88|96|104|112|120|128|136|144|152|160|168|176|184|192|200|208|216|224|232|240|248|256)?$/.test(type);
}

function decimalIntegerToHex(value: unknown): unknown {
  if (typeof value !== "string" || !/^-?\d+$/.test(value)) return value;
  const integer = BigInt(value);
  return integer < 0n ? value : `0x${integer.toString(16)}`;
}

function normalizeTypedDataValueIntegers(
  value: unknown,
  type: string,
  types: Record<string, unknown>,
): unknown {
  const arrayMatch = /^(.*)\[(?:\d*)\]$/.exec(type);
  if (arrayMatch) {
    return Array.isArray(value)
      ? value.map((item) => normalizeTypedDataValueIntegers(item, arrayMatch[1], types))
      : value;
  }
  if (isTypedDataInteger(type)) return decimalIntegerToHex(value);
  const fields = types[type];
  const record = asObject(value);
  if (!Array.isArray(fields) || !record) return value;
  return Object.fromEntries(Object.entries(record).map(([name, item]) => {
    const field = fields.find((candidate) => {
      const typedField = asObject(candidate);
      return asString(typedField?.name) === name && typeof typedField?.type === "string";
    });
    const typedField = asObject(field) as TypedDataField | null;
    return [name, typedField
      ? normalizeTypedDataValueIntegers(item, typedField.type, types)
      : item];
  }));
}

/**
 * Base Account displays EIP-712 data in a separate wallet surface. Preserve
 * large uint256 values (notably OpenSea trait Merkle roots) as exact hex
 * quantities so that surface never coerces a 77-digit decimal through a JS
 * number. Hex and decimal encode the same EIP-712 integer and therefore produce
 * the same Seaport order hash.
 */
export function normalizeBaseAccountTypedData(typedData: Record<string, unknown>): Record<string, unknown> {
  const types = asObject(typedData.types);
  const primaryType = asString(typedData.primaryType);
  if (!types || !primaryType) return typedData;
  return {
    ...typedData,
    message: normalizeTypedDataValueIntegers(typedData.message, primaryType, types),
  };
}

function normalizeAccountList(raw: unknown): Address[] {
  const accounts = Array.isArray(raw) ? raw : [];
  return accounts
    .filter((account): account is string => typeof account === "string" && /^0x[0-9a-fA-F]{40}$/.test(account))
    .map((account) => getAddress(account));
}

export async function getWalletAccounts(provider: EthereumProvider, _preferredAccount?: string | null): Promise<Address[]> {
  const existing = await withWalletTimeout(
    provider.request({ method: "eth_accounts" }),
    "Wallet account lookup",
    2500,
  ).then(normalizeAccountList).catch(() => []);
  if (existing.length > 0) return existing;
  const raw = await waitForWalletPrompt(provider.request({ method: "eth_requestAccounts" }));
  return normalizeAccountList(raw);
}

export async function sendAttributedTransaction(
  provider: EthereumProvider,
  transaction: Record<string, unknown>,
  transactionType = "marketplace",
): Promise<string> {
  const attributed = { ...transaction, data: appendBuilderCode(asString(transaction.data) ?? "0x") };
  trackAppEvent("transaction_prepared", { transactionType });
  try {
    trackAppEvent("transaction_wallet_prompted", { transactionType });
    const hash = await requestWithWalletReview(
      provider,
      "transaction",
      () => provider.request({ method: "eth_sendTransaction", params: [attributed] }),
    );
    if (typeof hash !== "string") throw new Error("Wallet did not return a transaction hash");
    trackAppEvent("transaction_submitted", { transactionType });
    return hash;
  } catch (error) {
    trackAppEvent("transaction_failed", {
      transactionType,
      result: error instanceof Error ? error.message.slice(0, 100) : "unknown",
    });
    throw error;
  }
}

export async function ensureBaseChain(
  provider: EthereumProvider,
  chainIdHex = BASE_CHAIN_CONFIG.chainId,
  options: { allowSkipSwitch?: boolean; confirmTimeoutMs?: number } = {},
): Promise<void> {
  const normalizedTargetChainId = chainIdHex.toLowerCase();
  const readProviderChainId = () => withWalletTimeout(
    provider.request({ method: "eth_chainId" }),
    "Wallet chain lookup",
    2500,
  ).then((value) => {
    if (typeof value === "string") return value.toLowerCase();
    if (typeof value === "number" && Number.isInteger(value)) return `0x${value.toString(16)}`;
    return null;
  }).catch(() => null);
  const confirmTargetChain = async () => {
    const timeoutMs = options.confirmTimeoutMs ?? 10000;
    if (timeoutMs <= 0) return;
    const deadline = Date.now() + timeoutMs;
    do {
      if (await readProviderChainId() === normalizedTargetChainId) return;
      await new Promise((resolve) => globalThis.setTimeout(resolve, 150));
    } while (Date.now() < deadline);
    throw new Error("Base Mainnet is required. Trust Wallet did not finish switching networks.");
  };
  const currentChainId = await readProviderChainId();
  if (currentChainId === normalizedTargetChainId) return;
  if (options.allowSkipSwitch) return;

  try {
    await requestWithWalletReview(provider, "network", () => provider.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: chainIdHex }],
    }));
  } catch (error) {
    const maybe = asObject(error);
    if (maybe?.code === 4902 || String(maybe?.message ?? "").includes("Unrecognized chain")) {
      await requestWithWalletReview(provider, "network", () => provider.request({
        method: "wallet_addEthereumChain",
        params: [BASE_CHAIN_CONFIG],
      }));
      await requestWithWalletReview(provider, "network", () => provider.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: chainIdHex }],
      }));
      await confirmTargetChain();
      return;
    }
    throw error;
  }
  await confirmTargetChain();
}

/**
 * Give injected wallets a chance to select Base before they present their
 * account-connection UI. Some wallets (including Trust Wallet's dapp browser)
 * otherwise default that first prompt to Ethereum Mainnet.
 *
 * Wallets that require account authorization before allowing a chain switch
 * may reject this preliminary request. In that case activation continues and
 * `ensureBaseChain` runs again after account access has been granted. An
 * explicit user rejection is still respected and stops the connection flow.
 */
export async function preferBaseChainBeforeConnect(provider: EthereumProvider): Promise<void> {
  try {
    // This is only a preference before authorization. Some injected wallets do
    // not expose the updated chain until account access has been granted, so
    // activation performs the authoritative, confirmed switch afterwards.
    await ensureBaseChain(provider, BASE_CHAIN_CONFIG.chainId, { confirmTimeoutMs: 0 });
  } catch (error) {
    if (isUserRejected(error)) throw error;
  }
}

async function publicRpcRequest(method: string, params: unknown[]): Promise<unknown> {
  const response = await fetch(BASE_RPC_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: Date.now(), method, params }),
  });
  const payload = (await response.json()) as Record<string, unknown>;
  if (!response.ok || payload.error) throw new Error(`Base RPC ${method} failed`);
  return payload.result;
}

export async function waitForTransactionReceipt(hash: string, timeoutMs = 90000): Promise<Record<string, unknown>> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const receipt = asObject(await publicRpcRequest("eth_getTransactionReceipt", [hash]));
    if (receipt) {
      if (receipt.status === "0x0") throw new Error("Transaction reverted");
      return receipt;
    }
    await new Promise((resolve) => window.setTimeout(resolve, 2000));
  }
  throw new Error("Timed out waiting for transaction confirmation");
}

export async function readNativeBalance(owner: string): Promise<bigint> {
  const result = asString(await publicRpcRequest("eth_getBalance", [getAddress(owner), "latest"]));
  return result ? BigInt(result) : 0n;
}

export async function readErc20Balance(tokenAddress: string, owner: string): Promise<bigint> {
  const data = encodeFunctionData({
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [getAddress(owner)],
  });
  const result = asString(await publicRpcRequest("eth_call", [{ to: getAddress(tokenAddress), data }, "latest"]));
  return result ? BigInt(result) : 0n;
}

export async function wrapEthToWeth(
  provider: EthereumProvider,
  owner: string,
  wethAddress: string,
  amount: bigint,
): Promise<string> {
  if (amount <= 0n) throw new Error("Wrap amount must be greater than zero");
  const hash = await sendAttributedTransaction(provider, {
      from: getAddress(owner),
      to: getAddress(wethAddress),
      value: toHexQuantity(amount),
      data: "0xd0e30db0",
    }, "wrap_weth");
  await waitForTransactionReceipt(hash);
  trackAppEvent("transaction_confirmed", { transactionType: "wrap_weth" });
  return hash;
}

export async function readErc20Allowance(tokenAddress: string, owner: string, spender: string): Promise<bigint> {
  const data = encodeFunctionData({
    abi: erc20Abi,
    functionName: "allowance",
    args: [getAddress(owner), getAddress(spender)],
  });
  const result = asString(await publicRpcRequest("eth_call", [{ to: tokenAddress, data }, "latest"]));
  return result ? BigInt(result) : 0n;
}

export async function ensureErc20Approval(
  provider: EthereumProvider,
  owner: string,
  approval: TokenApprovalRequirement,
): Promise<string | null> {
  const required = BigInt(approval.amount);
  if (required <= 0n) return null;
  const current = await readErc20Allowance(approval.tokenAddress, owner, approval.spender);
  recordLocalOfferDiagnostic("weth.allowance.checked", {
    connector: provider.connectorId ?? (provider.isBaseAccount ? "base-account" : "unknown"),
    owner,
    tokenAddress: approval.tokenAddress,
    spender: approval.spender,
    required: required.toString(),
    current: current.toString(),
    approvalRequired: current < required,
  });
  if (current >= required) return null;
  const data = encodeFunctionData({
    abi: erc20Abi,
    functionName: "approve",
    args: [getAddress(approval.spender), required],
  });
  let hash: string;
  try {
    hash = await sendAttributedTransaction(provider, {
        from: owner,
        to: getAddress(approval.tokenAddress),
        value: "0x0",
        data,
      }, "erc20_approval");
  } catch (error) {
    const canRecoverOpaqueWalletConnectResult = provider.connectorId === "trustconnect-walletconnect"
      && isOpaqueWalletConnectNullError(error)
      && !isUserRejected(error);
    if (!canRecoverOpaqueWalletConnectResult) throw error;

    recordLocalOfferDiagnostic("weth.approval.walletconnect_result_missing", { error });
    const deadline = Date.now() + 30000;
    do {
      const recoveredAllowance = await readErc20Allowance(approval.tokenAddress, owner, approval.spender).catch(() => 0n);
      if (recoveredAllowance >= required) {
        recordLocalOfferDiagnostic("weth.approval.recovered", {
          approvedAmount: recoveredAllowance.toString(),
        });
        trackAppEvent("transaction_confirmed", { transactionType: "erc20_approval", result: "recovered_from_allowance" });
        return null;
      }
      await new Promise((resolve) => globalThis.setTimeout(resolve, 1000));
    } while (Date.now() < deadline);
    throw new Error("Trust Wallet did not return the WETH approval result. Check the transaction in Trust Wallet, then try again.");
  }
  await waitForTransactionReceipt(hash);
  recordLocalOfferDiagnostic("weth.approval.confirmed", { transactionHash: hash, approvedAmount: required.toString() });
  trackAppEvent("transaction_confirmed", { transactionType: "erc20_approval" });
  return hash;
}

async function readIsApprovedForAll(tokenAddress: string, owner: string, operator: string): Promise<boolean> {
  const data = encodeFunctionData({
    abi: erc721Abi,
    functionName: "isApprovedForAll",
    args: [getAddress(owner), getAddress(operator)],
  });
  const result = asString(await publicRpcRequest("eth_call", [{ to: tokenAddress, data }, "latest"]));
  return Boolean(result && BigInt(result) === 1n);
}

export async function ensureErc721ApprovalForAll(
  provider: EthereumProvider,
  owner: string,
  approval: NftApprovalRequirement,
): Promise<string | null> {
  if (await readIsApprovedForAll(approval.tokenAddress, owner, approval.spender)) return null;
  const data = encodeFunctionData({
    abi: erc721Abi,
    functionName: "setApprovalForAll",
    args: [getAddress(approval.spender), true],
  });
  const hash = await sendAttributedTransaction(provider, {
      from: owner,
      to: getAddress(approval.tokenAddress),
      value: "0x0",
      data,
    }, "erc721_approval");
  await waitForTransactionReceipt(hash);
  trackAppEvent("transaction_confirmed", { transactionType: "erc721_approval" });
  return hash;
}

function normalizePreparedTransaction(value: unknown): PreparedTransaction | null {
  const tx = asObject(value);
  if (!tx) return null;
  const inputData = asObject(tx.input_data) ?? asObject(tx.inputData);
  const to =
    asString(tx.to) ??
    asString(tx.target) ??
    asString(tx.contract) ??
    asString(tx.address) ??
    asString(tx.destination);
  const data =
    asString(tx.data) ??
    asString(tx.input) ??
    asString(tx.calldata) ??
    asString(tx.callData) ??
    asString(tx.inputData) ??
    asString(inputData?.data) ??
    asString(inputData?.calldata) ??
    asString(inputData?.callData);
  const rawInputData = tx.input_data ?? tx.inputData;
  if (!to || (!data && !rawInputData)) return null;
  return {
    to,
    value:
      asString(tx.value) ??
      asString(tx.nativeValue) ??
      asString(tx.ethValue) ??
      asString(tx.amount) ??
      0,
    data,
    inputData: rawInputData,
  };
}

function findPreparedTransaction(value: unknown, depth = 0): PreparedTransaction | null {
  if (depth > 6) return null;
  const direct = normalizePreparedTransaction(value);
  if (direct) return direct;

  const obj = asObject(value);
  if (obj) {
    const candidates = [
      obj.transaction,
      obj.tx,
      obj.call,
      obj.calls,
      obj.transactionAction,
      asObject(obj.transactionAction)?.transaction,
      asObject(obj.transactionAction)?.call,
      obj.fulfillment_data,
      obj.fulfillmentData,
      obj.fulfillment,
      obj.actions,
      obj.steps,
      asObject(obj.actions)?.steps,
      asObject(obj.response)?.actions,
      asObject(obj.response)?.steps,
    ];
    for (const candidate of candidates) {
      const found = findPreparedTransaction(candidate, depth + 1);
      if (found) return found;
    }
  }

  for (const item of asArray(value)) {
    const found = findPreparedTransaction(item, depth + 1);
    if (found) return found;
  }
  return null;
}

export function extractFulfillmentTransaction(payload: unknown): PreparedTransaction | null {
  return findPreparedTransaction(payload);
}

export function combinePreparedOpenSeaTransactions(transactions: PreparedTransaction[]): PreparedTransaction {
  if (transactions.length === 0) throw new Error("No OpenSea transactions to combine");
  const target = asString(transactions[0]?.to);
  if (!target) throw new Error("OpenSea transaction is missing a target");
  const combinedOrders: unknown[] = [];
  const combinedCriteriaResolvers: unknown[] = [];
  const combinedFulfillments: unknown[] = [];
  let totalValue = 0n;
  let recipient: string | undefined;
  const firstInput = asObject(transactions[0]?.inputData);

  if (asObject(firstInput?.advancedOrder)) {
    const advancedOrders: unknown[] = [];
    const criteriaResolvers: unknown[] = [];
    const offerFulfillments: unknown[][] = [];
    const considerationFulfillments: unknown[][] = [];
    let fulfillerConduitKey: unknown;
    for (const [orderIndex, transaction] of transactions.entries()) {
      if (asString(transaction.to)?.toLowerCase() !== target.toLowerCase()) {
        throw new Error("Selected listings use incompatible OpenSea protocols");
      }
      const input = asObject(transaction.inputData);
      const advancedOrder = asObject(input?.advancedOrder);
      if (!input || !advancedOrder) throw new Error("Selected listings use incompatible OpenSea fulfillment types");
      advancedOrders.push(advancedOrder);
      criteriaResolvers.push(...asArray(input.criteriaResolvers).map((value) => ({
        ...(asObject(value) ?? {}),
        orderIndex,
      })));
      const parameters = asObject(advancedOrder.parameters);
      asArray(parameters?.offer).forEach((_, itemIndex) => offerFulfillments.push([{ orderIndex, itemIndex }]));
      asArray(parameters?.consideration).forEach((_, itemIndex) => considerationFulfillments.push([{ orderIndex, itemIndex }]));
      recipient ??= asString(input.recipient);
      const conduitKey = input.fulfillerConduitKey;
      if (fulfillerConduitKey != null && String(conduitKey).toLowerCase() !== String(fulfillerConduitKey).toLowerCase()) {
        throw new Error("Selected listings use incompatible OpenSea conduits");
      }
      fulfillerConduitKey ??= conduitKey;
      totalValue += BigInt(toHexQuantity(transaction.value));
    }
    return {
      to: target,
      value: `0x${totalValue.toString(16)}`,
      inputData: {
        availableAdvancedOrders: advancedOrders,
        criteriaResolvers,
        offerFulfillments,
        considerationFulfillments,
        fulfillerConduitKey,
        recipient,
      },
    };
  }

  for (const transaction of transactions) {
    if (asString(transaction.to)?.toLowerCase() !== target.toLowerCase()) {
      throw new Error("Selected listings use incompatible OpenSea protocols");
    }
    const input = asObject(transaction.inputData);
    const orders = asArray(input?.orders);
    if (!input || orders.length === 0) {
      throw new Error("OpenSea did not return a bulk-compatible fulfillment");
    }
    const orderOffset = combinedOrders.length;
    combinedOrders.push(...orders);
    combinedCriteriaResolvers.push(...asArray(input.criteriaResolvers).map((value) => {
      const resolver = { ...(asObject(value) ?? {}) };
      resolver.orderIndex = Number(resolver.orderIndex ?? 0) + orderOffset;
      return resolver;
    }));
    combinedFulfillments.push(...asArray(input.fulfillments).map((value) => {
      const fulfillment = asObject(value) ?? {};
      const offsetComponents = (components: unknown) => asArray(components).map((componentValue) => {
        const component = { ...(asObject(componentValue) ?? {}) };
        component.orderIndex = Number(component.orderIndex ?? 0) + orderOffset;
        return component;
      });
      return {
        ...fulfillment,
        offerComponents: offsetComponents(fulfillment.offerComponents),
        considerationComponents: offsetComponents(fulfillment.considerationComponents),
      };
    }));
    recipient ??= asString(input.recipient);
    totalValue += BigInt(toHexQuantity(transaction.value));
  }

  return {
    to: target,
    value: `0x${totalValue.toString(16)}`,
    inputData: {
      orders: combinedOrders,
      criteriaResolvers: combinedCriteriaResolvers,
      fulfillments: combinedFulfillments,
      recipient,
    },
  };
}

function getPreparedTransactionCall(tx: PreparedTransaction, account: string, attributed = true) {
  const to = asString(tx.to);
  const data = asString(tx.data) ?? asString(tx.input) ?? (tx.inputData ? buildOpenSeaFulfillmentData(tx.inputData, account) : undefined);
  if (!to || !data) throw new Error("Prepared OpenSea transaction is missing calldata");
  return {
    to: getAddress(to),
    value: toHexQuantity(tx.value),
    data: attributed ? appendBuilderCode(data) : data,
  };
}

export async function supportsAtomicBatchTransactions(
  provider: EthereumProvider,
  account: string,
  chainIdHex = BASE_CHAIN_CONFIG.chainId,
): Promise<boolean> {
  const normalizedAccount = getAddress(account);
  const normalizedChainId = `0x${BigInt(chainIdHex).toString(16)}`;
  try {
    const capabilities = await provider.request({
      method: "wallet_getCapabilities",
      params: [normalizedAccount, [normalizedChainId]],
    });
    const chainCapabilities = asObject(asObject(capabilities)?.[normalizedChainId])
      ?? asObject(asObject(capabilities)?.[normalizedChainId.toLowerCase()]);
    const atomicStatus = asString(asObject(chainCapabilities?.atomic)?.status)?.toLowerCase();
    return atomicStatus === "supported" || atomicStatus === "ready";
  } catch {
    return false;
  }
}

export async function sendPreparedTransactionsAtomic(
  provider: EthereumProvider,
  account: string,
  transactions: PreparedTransaction[],
  chainIdHex = BASE_CHAIN_CONFIG.chainId,
  timeoutMs = 120000,
): Promise<AtomicBatchReceipt> {
  if (transactions.length < 2) throw new Error("Atomic bulk buy requires at least two transactions");
  const normalizedAccount = getAddress(account);
  const normalizedChainId = `0x${BigInt(chainIdHex).toString(16)}`;

  const calls = transactions.map((transaction) => getPreparedTransactionCall(transaction, normalizedAccount, false));
  const dataSuffix = builderCodeSuffix();
  trackAppEvent("transaction_prepared", { transactionType: "atomic_marketplace_batch" });
  trackAppEvent("transaction_wallet_prompted", { transactionType: "atomic_marketplace_batch" });
  const sent = await requestWithWalletReview(provider, "transaction", () => provider.request({
    method: "wallet_sendCalls",
    params: [{
      version: "2.0.0",
      from: normalizedAccount,
      chainId: normalizedChainId,
      atomicRequired: true,
      calls,
      ...(dataSuffix ? { capabilities: { dataSuffix: { value: dataSuffix, optional: true } } } : {}),
    }],
  }));
  const batchId = asString(sent) ?? asString(asObject(sent)?.id);
  if (!batchId) throw new Error("Wallet did not return an atomic batch identifier");
  trackAppEvent("transaction_submitted", { transactionType: "atomic_marketplace_batch" });

  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const status = asObject(await provider.request({ method: "wallet_getCallsStatus", params: [batchId] }));
    const statusCode = typeof status?.status === "number" ? status.status : Number(status?.status);
    const statusLabel = asString(status?.status)?.toLowerCase();
    if (statusCode === 200 || statusLabel === "confirmed") {
      if (status?.atomic !== true) throw new Error("Wallet did not execute the bulk purchase atomically");
      const receipts = asArray(status.receipts).map(asObject).filter((receipt): receipt is Record<string, unknown> => Boolean(receipt));
      if (receipts.length === 0) throw new Error("Wallet confirmed the batch without a transaction receipt");
      if (receipts.some((receipt) => asString(receipt.status)?.toLowerCase() !== "0x1")) {
        throw new Error("Atomic bulk purchase reverted");
      }
      const transactionHash = receipts.map((receipt) => asString(receipt.transactionHash)).find(Boolean);
      if (!transactionHash) throw new Error("Atomic bulk purchase receipt is missing its transaction hash");
      trackAppEvent("transaction_confirmed", { transactionType: "atomic_marketplace_batch" });
      return {
        transactionHash,
        logs: receipts.flatMap((receipt) => asArray(receipt.logs).map((log) => asObject(log) ?? {})),
      };
    }
    if ((Number.isFinite(statusCode) && statusCode >= 400) || statusLabel === "failed") {
      throw new Error("Atomic bulk purchase failed");
    }
    await new Promise((resolve) => window.setTimeout(resolve, 1500));
  }
  throw new Error("Timed out waiting for atomic bulk purchase confirmation");
}

export async function sendPreparedTransaction(
  provider: EthereumProvider,
  account: string,
  tx: PreparedTransaction,
): Promise<string> {
  const call = getPreparedTransactionCall(tx, account);
  const hash = await sendAttributedTransaction(provider, { from: account, ...call }, "prepared_marketplace");
  await waitForTransactionReceipt(hash);
  trackAppEvent("transaction_confirmed", { transactionType: "prepared_marketplace" });
  return hash;
}

export function buildSeaportCancelTransaction(
  protocolAddress: string,
  orderParameters: SeaportCancelOrderParameters | SeaportCancelOrderParameters[],
): PreparedTransaction {
  const orders = Array.isArray(orderParameters) ? orderParameters : [orderParameters];
  return {
    to: getAddress(protocolAddress),
    value: "0",
    data: encodeFunctionData({
      abi: seaportCancelAbi,
      functionName: "cancel",
      args: [orders.map((order) => normalizeSeaportCancelOrder(order))],
    }),
  };
}

export async function signTypedData(provider: EthereumProvider, account: string, typedData: unknown): Promise<string> {
  const normalizedTypedData = normalizeTypedDataForWallet(typedData);
  if (!normalizedTypedData) throw new Error("OpenSea signature action returned invalid typed data");
  const accountAddress = getAddress(account);
  // Keep the integer strings returned by OpenSea intact. EIP-712 accepts exact
  // decimal strings for uint values, and Base Account's own typed-data helpers
  // use that representation. Converting Seaport's large trait criteria and
  // salt to hex preserves the hash, but Base's signing surface can reject the
  // otherwise-valid order while preparing its confirmation UI.
  const walletTypedData = normalizedTypedData;
  const serializedTypedData = serializeTypedData(walletTypedData as Parameters<typeof serializeTypedData>[0]);
  const diagnosticRoot = asObject(walletTypedData);
  const userAgent = typeof navigator === "undefined" ? "" : navigator.userAgent.toLowerCase();
  const useStructuredPayload = provider.isBaseAccount === true
    || provider.connectorId === "base-account"
    || userAgent.includes("firefox");
  const primaryPayloadLabel = useStructuredPayload ? "structured" : "serialized";
  const fallbackPayloadLabel = useStructuredPayload ? "serialized" : "structured";
  recordLocalOfferDiagnostic("wallet.signature.prepared", {
    connector: provider.connectorId ?? (provider.isBaseAccount ? "base-account" : "unknown"),
    account: accountAddress,
    route: `eth_signTypedData_v4 (${primaryPayloadLabel} first), with ${fallbackPayloadLabel} compatibility fallback`,
    primaryType: asString(diagnosticRoot?.primaryType),
    domain: diagnosticRoot?.domain,
    message: diagnosticRoot?.message,
    typeNames: Object.keys(asObject(diagnosticRoot?.types) ?? {}),
  });
  // Preserve the pre-Base-experiment route for Farcaster and injected wallets:
  // their EIP-1193 providers historically receive eth_signTypedData_v4 as JSON.
  // Base Account and Firefox expect the structured object, so keep that
  // representation isolated instead of changing every wallet.
  const firstPayload = useStructuredPayload ? walletTypedData : serializedTypedData;
  const fallbackPayload = useStructuredPayload ? serializedTypedData : walletTypedData;

  const requestTypedSignature = (payload: unknown) => {
    return requestWithWalletReview(provider, "signature", () => provider.request({
      method: "eth_signTypedData_v4",
      params: [accountAddress, payload],
    }),
    "Wallet signature request",
    );
  };

  let signature: unknown;
  trackAppEvent("transaction_prepared", { transactionType: "seaport_order_signature" });
  try {
    trackAppEvent("transaction_wallet_prompted", { transactionType: "seaport_order_signature" });
    recordLocalOfferDiagnostic("wallet.signature.requested", {
      method: "eth_signTypedData_v4",
      account: accountAddress,
      payload: primaryPayloadLabel,
    });
    signature = await requestTypedSignature(firstPayload);
  } catch (error) {
    recordLocalOfferDiagnostic("wallet.signature.failed", { error, connector: provider.connectorId ?? (provider.isBaseAccount ? "base-account" : "unknown") });
    if (isUserRejected(error) || isWalletTimeoutError(error) || !isTypedDataFormatError(error)) {
      trackAppEvent("transaction_failed", { transactionType: "seaport_order_signature", result: getWalletErrorMessage(error).slice(0, 100) });
      throw error;
    }
    recordLocalOfferDiagnostic("wallet.signature.fallback", {
      method: "eth_signTypedData_v4",
      payload: fallbackPayloadLabel,
    });
    signature = await requestTypedSignature(fallbackPayload);
  }
  if (typeof signature !== "string") throw new Error("Wallet did not return a signature");
  try {
    const recoveredAddress = await recoverTypedDataAddress({
      ...walletTypedData,
      signature,
    } as Parameters<typeof recoverTypedDataAddress>[0]);
    const signatureMatches = recoveredAddress.toLowerCase() === accountAddress.toLowerCase();
    recordLocalOfferDiagnostic("wallet.signature.verified", {
      account: accountAddress,
      recoveredAddress,
      signatureMatches,
    });
    if (!signatureMatches && provider.connectorId !== "base-account" && provider.isBaseAccount !== true) {
      throw new Error("Wallet signature does not match the connected account");
    }
  } catch (error) {
    recordLocalOfferDiagnostic("wallet.signature.verification_failed", {
      account: accountAddress,
      error,
    });
    if (error instanceof Error && error.message === "Wallet signature does not match the connected account") throw error;
  }
  recordLocalOfferDiagnostic("wallet.signature.complete", { signatureLength: signature.length });
  trackAppEvent("transaction_confirmed", { transactionType: "seaport_order_signature" });
  return signature;
}

export async function signMessage(provider: EthereumProvider, account: string, message: string): Promise<string> {
  const signature = await requestWithWalletReview(provider, "signature", () => provider.request({
    method: "personal_sign",
    params: [message, getAddress(account)],
  }));
  if (typeof signature !== "string") throw new Error("Wallet did not return a signature");
  return signature;
}

export async function executeOpenSeaActions(
  provider: EthereumProvider,
  account: string,
  payload: unknown,
): Promise<{ signature: string | null; payload: unknown }> {
  const root = asObject(payload);
  const actions = [
    ...asArray(root?.actions),
    ...asArray(root?.steps),
    ...asArray(asObject(root?.actions)?.steps),
    ...asArray(asObject(root?.response)?.actions),
    ...asArray(asObject(root?.response)?.steps),
  ];
  let signature: string | null = null;
  let signedPayload: unknown = payload;

  for (const action of actions) {
    const item = asObject(action);
    if (!item) continue;
    const createListingAction = asObject(item.createListingsAction);
    const createOfferAction = asObject(item.createOfferAction) ?? asObject(item.createCriteriaOfferAction);
    const transactionAction = asObject(item.transactionAction);
    const type = asString(item.type)?.toLowerCase() ?? asString(transactionAction?.type)?.toLowerCase() ?? "";
    if (type.includes("transaction") || transactionAction) {
      const transaction =
        asObject(transactionAction?.transaction) ??
        asObject(item.transaction) ??
        asObject(item.payload) ??
        item;
      await sendPreparedTransaction(provider, account, {
        to: asString(transaction.to),
        value: asString(transaction.value) ?? 0,
        data: asString(transaction.data) ?? asString(transaction.input),
      });
    }
    const signatureRequest =
      asObject(createListingAction?.signatureRequest) ??
      asObject(createOfferAction?.signatureRequest) ??
      asObject(item.signatureRequest);
    if (type.includes("signature") || signatureRequest) {
      const signatureMessage = signatureRequest?.message;
      const typedData =
        (typeof signatureMessage === "string" ? asObject(JSON.parse(signatureMessage)) : asObject(signatureMessage)) ??
        asObject(item.typedData) ??
        asObject(item.typed_data) ??
        asObject(item.payload) ??
        asObject(item.message);
      if (!typedData) throw new Error("OpenSea signature action is missing typed data");
      signature = await signTypedData(provider, account, typedData);
      const domain = asObject(typedData.domain);
      signedPayload = {
        parameters: typedData.message,
        protocol_address: asString(domain?.verifyingContract),
        signature,
      };
    }
  }

  if (actions.length === 0) {
    throw new Error("OpenSea did not return any wallet actions");
  }
  if (!signature) {
    throw new Error("OpenSea did not return a signature action");
  }

  return { signature, payload: signedPayload };
}
