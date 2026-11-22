import {getAddress, type Address} from "viem";
export const BASE_CHAIN_ID_HEX="0x2105";
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

export const walletReviewRequestListeners = new Set<(request: WalletReviewRequest) => void>();

export function subscribeToWalletReviewRequests(listener: (request: WalletReviewRequest) => void): () => void {
  walletReviewRequestListeners.add(listener);
  return () => walletReviewRequestListeners.delete(listener);
}

export function notifyWalletReviewRequest(
  provider: EthereumProvider,
  kind: WalletReviewRequest["kind"],
  phase: WalletReviewRequest["phase"],
): void {
  walletReviewRequestListeners.forEach((listener) => listener({ provider, kind, phase }));
}

export const BASE_CHAIN_CONFIG = {
  chainId: BASE_CHAIN_ID_HEX,
  chainName: "Base",
  nativeCurrency: {
    name: "Ether",
    symbol: "ETH",
    decimals: 18,
  },
  rpcUrls: ["https://mainnet.base.org"],
  blockExplorerUrls: ["https://basescan.org"],
};

export function asObject(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : undefined;
}

export function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

export function withWalletTimeout<T>(promise: Promise<T>, label: string, timeoutMs = 25000): Promise<T> {
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

export function waitForWalletPrompt<T>(promise: Promise<T>, label = "Wallet request", timeoutMs = 120000): Promise<T> {
  return withWalletTimeout(promise, label, timeoutMs);
}

export function requestWithWalletReview<T>(
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

export function normalizeAccountList(raw: unknown): Address[] {
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

export async function signMessage(provider: EthereumProvider, account: string, message: string): Promise<string> {
  const signature = await requestWithWalletReview(provider, "signature", () => provider.request({
    method: "personal_sign",
    params: [message, account],
  }));
  if (typeof signature !== "string") throw new Error("Wallet did not return a signature");
  return signature;
}

