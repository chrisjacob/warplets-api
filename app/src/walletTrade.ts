import { encodeFunctionData, erc20Abi, erc721Abi, getAddress, serializeTypedData, type Address } from "viem";

export type EthereumProvider = {
  request(args: { method: string; params?: unknown[] }): Promise<unknown>;
};

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
    const timeoutId = window.setTimeout(() => {
      reject(new Error(`${label} did not open or respond. Farcaster Web wallet may not support this action in this browser.`));
    }, timeoutMs);
    promise.then(
      (value) => {
        window.clearTimeout(timeoutId);
        resolve(value);
      },
      (error) => {
        window.clearTimeout(timeoutId);
        reject(error);
      },
    );
  });
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

function normalizeAccountList(raw: unknown): Address[] {
  const accounts = Array.isArray(raw) ? raw : [];
  return accounts
    .filter((account): account is string => typeof account === "string" && /^0x[0-9a-fA-F]{40}$/.test(account))
    .map((account) => getAddress(account));
}

export async function getWalletAccounts(provider: EthereumProvider, preferredAccount?: string | null): Promise<Address[]> {
  const existing = await withWalletTimeout(
    provider.request({ method: "eth_accounts" }),
    "Wallet account lookup",
    2500,
  ).then(normalizeAccountList).catch(() => []);
  if (existing.length > 0) return existing;
  if (preferredAccount && /^0x[0-9a-fA-F]{40}$/.test(preferredAccount)) {
    return [getAddress(preferredAccount)];
  }

  const raw = await withWalletTimeout(
    provider.request({ method: "eth_requestAccounts" }),
    "Wallet account confirmation",
    25000,
  );
  return normalizeAccountList(raw);
}

export async function ensureBaseChain(
  provider: EthereumProvider,
  chainIdHex = BASE_CHAIN_CONFIG.chainId,
  options: { allowSkipSwitch?: boolean } = {},
): Promise<void> {
  const currentChainId = await withWalletTimeout(
    provider.request({ method: "eth_chainId" }),
    "Wallet chain lookup",
    2500,
  ).then((value) => (typeof value === "string" ? value.toLowerCase() : null)).catch(() => null);
  if (currentChainId === chainIdHex.toLowerCase()) return;
  if (options.allowSkipSwitch) return;

  try {
    await withWalletTimeout(provider.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: chainIdHex }],
    }), "Switch to Base network", 25000);
  } catch (error) {
    const maybe = asObject(error);
    if (maybe?.code === 4902 || String(maybe?.message ?? "").includes("Unrecognized chain")) {
      await withWalletTimeout(provider.request({
        method: "wallet_addEthereumChain",
        params: [BASE_CHAIN_CONFIG],
      }), "Add Base network", 25000);
      await withWalletTimeout(provider.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: chainIdHex }],
      }), "Switch to Base network", 25000);
      return;
    }
    throw error;
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

async function readAllowance(tokenAddress: string, owner: string, spender: string): Promise<bigint> {
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
  const current = await readAllowance(approval.tokenAddress, owner, approval.spender);
  if (current >= required) return null;
  const data = encodeFunctionData({
    abi: erc20Abi,
    functionName: "approve",
    args: [getAddress(approval.spender), required],
  });
  const hash = await withWalletTimeout(provider.request({
    method: "eth_sendTransaction",
    params: [{
      from: owner,
      to: getAddress(approval.tokenAddress),
      value: "0x0",
      data,
    }],
  }), "Token approval confirmation", 30000);
  if (typeof hash !== "string") throw new Error("Wallet did not return an approval transaction hash");
  await waitForTransactionReceipt(hash);
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
  const hash = await withWalletTimeout(provider.request({
    method: "eth_sendTransaction",
    params: [{
      from: owner,
      to: getAddress(approval.tokenAddress),
      value: "0x0",
      data,
    }],
  }), "NFT approval confirmation", 30000);
  if (typeof hash !== "string") throw new Error("Wallet did not return an NFT approval transaction hash");
  await waitForTransactionReceipt(hash);
  return hash;
}

export function extractFulfillmentTransaction(payload: unknown): PreparedTransaction | null {
  const root = asObject(payload);
  const fulfillment = asObject(root?.fulfillment_data) ?? root;
  const tx = asObject(fulfillment?.transaction) ?? asObject(root?.transaction);
  if (!tx) return null;
  return {
    to: asString(tx.to),
    value: asString(tx.value) ?? 0,
    data: asString(tx.data) ?? asString(tx.input) ?? asString(asObject(tx.input_data)?.data),
    inputData: tx.input_data,
  };
}

export async function sendPreparedTransaction(
  provider: EthereumProvider,
  account: string,
  tx: PreparedTransaction,
): Promise<string> {
  const to = asString(tx.to);
  const data = asString(tx.data) ?? asString(tx.input);
  if (!to || !data) throw new Error("Prepared OpenSea transaction is missing calldata");
  const hash = await withWalletTimeout(provider.request({
    method: "eth_sendTransaction",
    params: [{
      from: account,
      to: getAddress(to),
      value: toHexQuantity(tx.value),
      data,
    }],
  }), "Transaction confirmation", 30000);
  if (typeof hash !== "string") throw new Error("Wallet did not return a transaction hash");
  await waitForTransactionReceipt(hash);
  return hash;
}

export function buildSeaportCancelTransaction(protocolAddress: string, orderParameters: SeaportCancelOrderParameters): PreparedTransaction {
  return {
    to: getAddress(protocolAddress),
    value: "0",
    data: encodeFunctionData({
      abi: seaportCancelAbi,
      functionName: "cancel",
      args: [[normalizeSeaportCancelOrder(orderParameters)]],
    }),
  };
}

export async function signTypedData(provider: EthereumProvider, account: string, typedData: unknown): Promise<string> {
  const normalizedTypedData = normalizeTypedDataForWallet(typedData);
  if (!normalizedTypedData) throw new Error("OpenSea signature action returned invalid typed data");
  const accountAddress = getAddress(account);
  const userAgent = typeof navigator === "undefined" ? "" : navigator.userAgent.toLowerCase();
  const preferObjectPayload = userAgent.includes("firefox");
  const serializedTypedData = serializeTypedData(normalizedTypedData as Parameters<typeof serializeTypedData>[0]);
  const firstPayload = preferObjectPayload ? normalizedTypedData : serializedTypedData;
  const fallbackPayload = preferObjectPayload ? serializedTypedData : normalizedTypedData;

  const requestSignature = (payload: unknown) => withWalletTimeout(provider.request({
    method: "eth_signTypedData_v4",
    params: [accountAddress, payload],
  }), "Signature confirmation", 30000);

  let signature: unknown;
  try {
    signature = await requestSignature(firstPayload);
  } catch (error) {
    if (isUserRejected(error) || isWalletTimeoutError(error)) throw error;
    signature = await requestSignature(fallbackPayload);
  }
  if (typeof signature !== "string") throw new Error("Wallet did not return a signature");
  return signature;
}

export async function signMessage(provider: EthereumProvider, account: string, message: string): Promise<string> {
  const signature = await withWalletTimeout(provider.request({
    method: "personal_sign",
    params: [message, getAddress(account)],
  }), "Signature confirmation", 30000);
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
