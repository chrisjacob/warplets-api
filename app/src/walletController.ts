import { useSyncExternalStore } from "react";
import { authenticateBaseWallet, authenticateWallet, loadAppSession, logoutAppPrincipal } from "./appSession";
import { trackAppEvent } from "./analytics";
import {
  ensureBaseChain,
  getWalletAccounts,
  preferBaseChainBeforeConnect,
  type EthereumProvider,
} from "./walletTrade";
import { appendWalletConnectDiagnostic, requestTrustConnectSessionDisconnect } from "./walletConnectDiagnostics";
import { getRuntimeAppIconPath, getRuntimeAppName } from "./brandAssets";
import { isLikelyBaseAppBrowser } from "./pwa";

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
  isCoinbaseWallet?: boolean;
  providers?: ObservableProvider[];
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
let baseAccountConnectionPromise: Promise<WalletSession> | null = null;
let baseAppAutoLoginStarted = false;
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
  alreadyAuthenticated = false,
): Promise<WalletSession> {
  provider.connectorId = connectorId;
  emit({ connecting: connectorId, error: null });
  appendWalletConnectDiagnostic("wallet.activate_started", { connectorId, hasProvidedAddress: Boolean(providedAddress), alreadyAuthenticated });
  trackAppEvent("connector_selected", { connector: connectorId });
  try {
    if (connectorId === "legacy-injected" && !providedAddress) {
      await preferBaseChainBeforeConnect(provider);
    }
    const accounts = providedAddress
      ? [normalizeAddress(providedAddress)].filter((value): value is `0x${string}` => Boolean(value))
      : await getWalletAccounts(provider);
    const address = normalizeAddress(accounts[0]);
    if (!address) throw new Error("No wallet account was returned");
    appendWalletConnectDiagnostic("wallet.accounts_ready", { connectorId, address });
    await ensureBaseChain(provider);
    appendWalletConnectDiagnostic("wallet.base_chain_ready", { connectorId });
    const chainId = await readChainId(provider);
    appendWalletConnectDiagnostic("wallet.chain_ready", { connectorId, chainId });
    // Farcaster Quick Auth verifies the Mini App user. The embedded SDK wallet
    // is connected only as the transaction signer; asking it for the web SIWE
    // `personal_sign` challenge is unsupported by some Farcaster clients and
    // may be presented as a transaction that would fail.
    if (connectorId !== "farcaster" && !alreadyAuthenticated) {
      appendWalletConnectDiagnostic("wallet.authentication_started", { connectorId, address, chainId });
      await authenticateWallet(provider, address, chainId);
      appendWalletConnectDiagnostic("wallet.authentication_complete", { connectorId, address, chainId });
    }
    const session = { connectorId, address, chainId, provider } satisfies WalletSession;
    bindProviderEvents(provider);
    try { window.localStorage.setItem(LAST_CONNECTOR_KEY, connectorId); } catch { /* optional */ }
    emit({ session, connecting: null, error: null });
    appendWalletConnectDiagnostic("wallet.activate_complete", { connectorId, address, chainId });
    trackAppEvent("connect_succeeded", { connector: connectorId });
    return session;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Wallet connection failed";
    emit({ connecting: null, error: message });
    appendWalletConnectDiagnostic("wallet.activate_failed", { connectorId, message });
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
  provider.connectorId = "farcaster";
  const rawAccounts = await provider.request({ method: "eth_accounts" }).catch(() => []);
  const address = normalizeAddress(Array.isArray(rawAccounts) ? rawAccounts[0] : null);
  if (!address) return null;
  const appSession = await loadAppSession().catch(() => null);
  if (!appSession?.farcasterFid) return null;
  const chainId = await readChainId(provider);
  const session = { connectorId: "farcaster", address, chainId, provider } satisfies WalletSession;
  bindProviderEvents(provider);
  emit({ session, connecting: null, error: null });
  return session;
}

async function connectBaseAccountInternal(): Promise<WalletSession> {
  if (import.meta.env.VITE_BASE_ACCOUNT_ENABLED !== "true") throw new Error("Base Account is not enabled");
  const provider = await createBaseAccountProvider();
  emit({ connecting: "base-account", error: null });
  const address = await authenticateBaseWallet(provider, 8453).catch((error) => {
    const message = error instanceof Error ? error.message : "Base wallet connection failed";
    emit({ connecting: null, error: message });
    throw error;
  });
  return activate("base-account", provider, address, true);
}

export function connectBaseAccount(): Promise<WalletSession> {
  if (state.session?.connectorId === "base-account") return Promise.resolve(state.session);
  if (baseAccountConnectionPromise) return baseAccountConnectionPromise;
  baseAccountConnectionPromise = connectBaseAccountInternal().finally(() => {
    baseAccountConnectionPromise = null;
  });
  return baseAccountConnectionPromise;
}

/**
 * Base App is now a standard web runtime with an injected Base wallet. Ask it
 * for the signed-in account as soon as the page starts, without making app
 * readiness wait for the user-facing login sheet.
 */
export function requestBaseAppWalletLogin(): Promise<WalletSession | null> {
  if (
    baseAppAutoLoginStarted ||
    !isLikelyBaseAppBrowser() ||
    import.meta.env.VITE_WEB_WALLET_ENABLED !== "true" ||
    import.meta.env.VITE_BASE_ACCOUNT_ENABLED !== "true"
  ) {
    return Promise.resolve(state.session);
  }
  baseAppAutoLoginStarted = true;
  return connectBaseAccount();
}

function injectedBaseAppProvider(): ObservableProvider | null {
  if (!isLikelyBaseAppBrowser() || typeof window === "undefined") return null;
  const injected = (window as Window & { ethereum?: ObservableProvider }).ethereum;
  if (!injected?.request) return null;
  const candidates = Array.isArray(injected.providers) ? injected.providers : [];
  const provider = candidates.find((candidate) => candidate?.isCoinbaseWallet === true) ?? injected;
  provider.isBaseAccount = true;
  provider.connectorId = "base-account";
  return provider;
}

async function createBaseAccountProvider(): Promise<ObservableProvider> {
  const injected = injectedBaseAppProvider();
  if (injected) return injected;
  const { createBaseAccountSDK } = await import("@base-org/account");
  const provider = createBaseAccountSDK({
    appName: getRuntimeAppName(),
    appLogoUrl: `${window.location.origin}${getRuntimeAppIconPath()}`,
    appChainIds: [8453],
    preference: { telemetry: false },
    // Marketplace actions must remain explicit, user-confirmed transactions.
    // Base Account otherwise defaults sub-account funding to spend permissions,
    // which can inject an unrelated, open-ended USDC withdrawal authorization.
    subAccounts: {
      creation: "manual",
      defaultAccount: "universal",
      funding: "manual",
    },
  }).getProvider() as unknown as ObservableProvider;
  // The SDK exposes an EIP-1193 provider without a stable runtime brand. Mark
  // it locally so signing can use Base Account's documented payload format.
  provider.isBaseAccount = true;
  provider.connectorId = "base-account";
  return provider;
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
  provider.connectorId = connector;
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
  // A WalletConnect session already proves that the wallet approved this
  // client connection. On iOS, requesting SIWE immediately afterwards creates
  // a second personal_sign request while Safari is backgrounded, leaving the
  // UI permanently "Connecting". Keep backend authentication separate from
  // the client-side signing session used for marketplace transactions.
  return activate(connectorId, provider, address, connectorId === "trustconnect-walletconnect");
}

export async function restoreTrustConnectWallet(
  connectorId: Extract<WalletConnectorId, "trustconnect-injected" | "trustconnect-walletconnect">,
  provider: ObservableProvider,
  rawAddress: string,
): Promise<WalletSession | null> {
  const address = normalizeAddress(rawAddress);
  if (!address) return null;
  const appSession = await loadAppSession().catch(() => null);
  // WalletConnect approval is sufficient to restore the client-side signing
  // provider after iOS Safari reloads. Backend-authenticated wallet identity
  // remains absent until an explicit SIWE flow succeeds.
  if (connectorId !== "trustconnect-walletconnect" && appSession?.walletAddress?.toLowerCase() !== address) return null;
  const chainId = await readChainId(provider);
  provider.connectorId = connectorId;
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

export function clearWalletConnectionError(): void {
  if (!state.connecting && !state.error) return;
  emit({ connecting: null, error: null });
}

export async function disconnectWallet(): Promise<void> {
  const connectorId = state.session?.connectorId ?? null;
  appendWalletConnectDiagnostic("wallet.disconnect_started", { connectorId });
  if (connectorId?.startsWith("trustconnect-")) {
    const result = await requestTrustConnectSessionDisconnect();
    appendWalletConnectDiagnostic("wallet.trustconnect_disconnect_result", { connectorId, result });
    if (result === "timeout") {
      throw new Error("WalletConnect did not end its active session. Please try disconnecting again.");
    }
  }
  cleanupProviderListeners?.();
  cleanupProviderListeners = null;
  await logoutAppPrincipal("wallet").catch(() => undefined);
  try { window.localStorage.removeItem(LAST_CONNECTOR_KEY); } catch { /* optional */ }
  emit({ session: null, connecting: null, error: null });
  appendWalletConnectDiagnostic("wallet.disconnect_complete", { connectorId });
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
