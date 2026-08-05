import { useSyncExternalStore } from "react";
import { authenticateWallet, loadAppSession, logoutAppPrincipal } from "./appSession";
import { trackAppEvent } from "./analytics";
import { ensureBaseChain, getWalletAccounts, type EthereumProvider } from "./walletTrade";

export type WalletConnectorId =
  | "farcaster"
  | "base-account"
  | "trustconnect-injected"
  | "trustconnect-walletconnect"
  | "legacy-injected";

export interface WalletSession {
  connectorId: WalletConnectorId;
  address: `0x${string}`;
  chainId: number;
  provider: EthereumProvider;
}

interface ObservableProvider extends EthereumProvider {
  on?: (event: string, listener: (...args: unknown[]) => void) => void;
  removeListener?: (event: string, listener: (...args: unknown[]) => void) => void;
}

interface WalletControllerState {
  session: WalletSession | null;
  connecting: WalletConnectorId | null;
  error: string | null;
}

let state: WalletControllerState = { session: null, connecting: null, error: null };
const listeners = new Set<() => void>();
let farcasterProviderFactory: (() => Promise<EthereumProvider>) | null = null;
let cleanupProviderListeners: (() => void) | null = null;
const LAST_CONNECTOR_KEY = "warplets_wallet_connector";

function emit(next: Partial<WalletControllerState>): void {
  state = { ...state, ...next };
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function snapshot(): WalletControllerState {
  return state;
}

function normalizeAddress(value: unknown): `0x${string}` | null {
  if (typeof value !== "string") return null;
  const normalized = value.toLowerCase();
  return /^0x[a-f0-9]{40}$/.test(normalized) ? normalized as `0x${string}` : null;
}

async function readChainId(provider: EthereumProvider): Promise<number> {
  const raw = await provider.request({ method: "eth_chainId" });
  const chainId = typeof raw === "string" ? Number.parseInt(raw, 16) : Number(raw);
  if (!Number.isInteger(chainId)) throw new Error("Wallet returned an invalid chain ID");
  return chainId;
}

function bindProviderEvents(provider: ObservableProvider): void {
  cleanupProviderListeners?.();
  if (!provider.on) return;
  const handleAccountsChanged = async (raw: unknown) => {
    const accounts = Array.isArray(raw) ? raw : [];
    const next = normalizeAddress(accounts[0]);
    if (!state.session || next === state.session.address) return;
    emit({ session: null, error: next ? "Wallet account changed. Connect the new account to continue." : null });
    await logoutAppPrincipal("wallet").catch(() => undefined);
  };
  const handleChainChanged = (raw: unknown) => {
    if (!state.session) return;
    const chainId = typeof raw === "string" ? Number.parseInt(raw, 16) : Number(raw);
    if (Number.isInteger(chainId)) emit({ session: { ...state.session, chainId } });
  };
  const handleDisconnect = async () => {
    emit({ session: null, error: null });
    await logoutAppPrincipal("wallet").catch(() => undefined);
  };
  provider.on("accountsChanged", handleAccountsChanged);
  provider.on("chainChanged", handleChainChanged);
  provider.on("disconnect", handleDisconnect);
  cleanupProviderListeners = () => {
    provider.removeListener?.("accountsChanged", handleAccountsChanged);
    provider.removeListener?.("chainChanged", handleChainChanged);
    provider.removeListener?.("disconnect", handleDisconnect);
  };
}

async function activate(
  connectorId: WalletConnectorId,
  provider: ObservableProvider,
  providedAddress?: string | null,
): Promise<WalletSession> {
  emit({ connecting: connectorId, error: null });
  trackAppEvent("connector_selected", { connector: connectorId });
  try {
    const accounts = providedAddress
      ? [normalizeAddress(providedAddress)].filter((value): value is `0x${string}` => Boolean(value))
      : await getWalletAccounts(provider);
    const address = normalizeAddress(accounts[0]);
    if (!address) throw new Error("No wallet account was returned");
    await ensureBaseChain(provider);
    const chainId = await readChainId(provider);
    await authenticateWallet(provider, address, chainId);
    const session = { connectorId, address, chainId, provider } satisfies WalletSession;
    bindProviderEvents(provider);
    try { window.localStorage.setItem(LAST_CONNECTOR_KEY, connectorId); } catch { /* optional */ }
    emit({ session, connecting: null, error: null });
    trackAppEvent("connect_succeeded", { connector: connectorId });
    return session;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Wallet connection failed";
    emit({ connecting: null, error: message });
    const rejected = /reject|denied|cancel/i.test(message);
    trackAppEvent(rejected ? "connect_rejected" : "connect_failed", { connector: connectorId, result: message.slice(0, 100) });
    throw error;
  }
}

export function configureFarcasterWallet(factory: (() => Promise<EthereumProvider>) | null): void {
  farcasterProviderFactory = factory;
}

export async function connectFarcasterWallet(): Promise<WalletSession> {
  if (!farcasterProviderFactory) throw new Error("Farcaster wallet is not available in this context");
  return activate("farcaster", await farcasterProviderFactory());
}

export async function restoreFarcasterWallet(): Promise<WalletSession | null> {
  if (!farcasterProviderFactory || state.session) return state.session;
  const provider = await farcasterProviderFactory() as ObservableProvider;
  const rawAccounts = await provider.request({ method: "eth_accounts" }).catch(() => []);
  const address = normalizeAddress(Array.isArray(rawAccounts) ? rawAccounts[0] : null);
  if (!address) return null;
  const appSession = await loadAppSession().catch(() => null);
  if (appSession?.walletAddress?.toLowerCase() !== address) return null;
  const chainId = await readChainId(provider);
  const session = { connectorId: "farcaster", address, chainId, provider } satisfies WalletSession;
  bindProviderEvents(provider);
  emit({ session, connecting: null, error: null });
  return session;
}

export async function connectBaseAccount(): Promise<WalletSession> {
  if (import.meta.env.VITE_BASE_ACCOUNT_ENABLED !== "true") throw new Error("Base Account is not enabled");
  return activate("base-account", await createBaseAccountProvider());
}

async function createBaseAccountProvider(): Promise<ObservableProvider> {
  const { createBaseAccountSDK } = await import("@base-org/account");
  return createBaseAccountSDK({
    appName: "10X Warplets",
    appLogoUrl: `${window.location.origin}/icons/search-1024.png`,
    appChainIds: [8453],
    preference: { telemetry: false },
  }).getProvider() as unknown as ObservableProvider;
}

export async function restoreWebWallet(): Promise<WalletSession | null> {
  if (import.meta.env.VITE_WEB_WALLET_ENABLED !== "true" || state.session) return state.session;
  let connector = "";
  try { connector = window.localStorage.getItem(LAST_CONNECTOR_KEY) ?? ""; } catch { return null; }
  let provider: ObservableProvider | null = null;
  if (connector === "base-account" && import.meta.env.VITE_BASE_ACCOUNT_ENABLED === "true") {
    provider = await createBaseAccountProvider();
  } else if (connector === "legacy-injected") {
    provider = (window as Window & { ethereum?: ObservableProvider }).ethereum ?? null;
  }
  if (!provider) return null;
  const rawAccounts = await provider.request({ method: "eth_accounts" }).catch(() => []);
  const address = normalizeAddress(Array.isArray(rawAccounts) ? rawAccounts[0] : null);
  if (!address) return null;
  const appSession = await loadAppSession().catch(() => null);
  if (appSession?.walletAddress?.toLowerCase() !== address) return null;
  const chainId = await readChainId(provider);
  const session = { connectorId: connector as WalletConnectorId, address, chainId, provider };
  bindProviderEvents(provider);
  emit({ session, connecting: null, error: null });
  return session;
}

export async function connectLegacyInjectedWallet(): Promise<WalletSession> {
  const provider = (window as Window & { ethereum?: ObservableProvider }).ethereum;
  if (!provider) throw new Error("No browser wallet was detected");
  return activate("legacy-injected", provider);
}

export function activateTrustConnectWallet(
  connectorId: Extract<WalletConnectorId, "trustconnect-injected" | "trustconnect-walletconnect">,
  provider: ObservableProvider,
  address: string,
): Promise<WalletSession> {
  return activate(connectorId, provider, address);
}

export async function restoreTrustConnectWallet(
  connectorId: Extract<WalletConnectorId, "trustconnect-injected" | "trustconnect-walletconnect">,
  provider: ObservableProvider,
  rawAddress: string,
): Promise<WalletSession | null> {
  const address = normalizeAddress(rawAddress);
  if (!address) return null;
  const appSession = await loadAppSession().catch(() => null);
  if (appSession?.walletAddress?.toLowerCase() !== address) return null;
  const chainId = await readChainId(provider);
  const session = { connectorId, address, chainId, provider } satisfies WalletSession;
  bindProviderEvents(provider);
  emit({ session, connecting: null, error: null });
  return session;
}

export function lastWalletConnectorId(): WalletConnectorId | null {
  try {
    const value = window.localStorage.getItem(LAST_CONNECTOR_KEY);
    return value === "farcaster" || value === "base-account" || value === "trustconnect-injected" || value === "trustconnect-walletconnect" || value === "legacy-injected"
      ? value
      : null;
  } catch {
    return null;
  }
}

export async function disconnectWallet(): Promise<void> {
  cleanupProviderListeners?.();
  cleanupProviderListeners = null;
  await logoutAppPrincipal("wallet").catch(() => undefined);
  try { window.localStorage.removeItem(LAST_CONNECTOR_KEY); } catch { /* optional */ }
  emit({ session: null, connecting: null, error: null });
}

export async function getConnectedProviderAndAccount(): Promise<{ provider: EthereumProvider; account: string }> {
  if (!state.session) throw new Error("Connect a wallet to continue");
  const accounts = await getWalletAccounts(state.session.provider);
  const account = normalizeAddress(accounts[0]);
  if (!account || account !== state.session.address) {
    await disconnectWallet();
    throw new Error("Wallet account changed. Connect again to continue.");
  }
  await ensureBaseChain(state.session.provider);
  return { provider: state.session.provider, account };
}

export function currentWalletSession(): WalletSession | null {
  return state.session;
}

export function requestWebWalletConnection(): void {
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent("warplets:connect-wallet"));
}

export function useWalletController(): WalletControllerState {
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}
