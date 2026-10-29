export interface WalletBrowserSignals {
  userAgent?: string;
  hasTrustWalletEthereum?: boolean;
  providerIsTrust?: boolean;
}

export function currentWalletBrowserSignals(): WalletBrowserSignals {
  if (typeof window === "undefined" || typeof navigator === "undefined") return {};
  const browserWindow = window as Window & {
    trustwallet?: { ethereum?: unknown };
    ethereum?: { isTrust?: boolean; isTrustWallet?: boolean };
  };
  return {
    userAgent: navigator.userAgent,
    hasTrustWalletEthereum: Boolean(browserWindow.trustwallet?.ethereum),
    providerIsTrust: browserWindow.ethereum?.isTrust === true || browserWindow.ethereum?.isTrustWallet === true,
  };
}

export function isLikelyTrustWalletBrowser(signals: WalletBrowserSignals): boolean {
  return /trust(?:wallet)?/i.test(signals.userAgent ?? "")
    || signals.hasTrustWalletEthereum === true
    || signals.providerIsTrust === true;
}

export function resolveFarcasterMobileHandoffUrl(
  relayUrl: string,
  signals: WalletBrowserSignals,
): string {
  const url = new URL(relayUrl);
  if (isLikelyTrustWalletBrowser(signals)) return url.href;

  // Base's iOS WebView needs a direct custom-scheme handoff. Farcaster's
  // HTTPS SIWF page otherwise remains inside Base instead of returning control
  // to the 10X app. Trust Wallet rejects this scheme, so it uses HTTPS above.
  const path = url.pathname.startsWith("/") ? url.pathname.slice(1) : url.pathname;
  return `farcaster://${path}${url.search}`;
}
