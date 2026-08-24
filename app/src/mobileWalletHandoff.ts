import type { EthereumProvider } from "./walletTrade";
import { recordLocalOfferDiagnostic } from "./localOfferDiagnostics";

export type MobileWalletHandoff = {
  walletName: string;
  url: string;
};

function isIosSafari(userAgent: string): boolean {
  return /iP(?:hone|ad|od)/i.test(userAgent)
    && /Safari/i.test(userAgent)
    && !/(?:CriOS|FxiOS|EdgiOS|OPiOS)/i.test(userAgent);
}

export function buildWalletConnectRequestLink(redirect: string, sessionTopic: string): string {
  const base = redirect.trim();
  const uri = encodeURIComponent(`wc:${sessionTopic}@2`);
  if (/\/wc(?:\?|$)/i.test(base)) {
    return `${base}${base.includes("?") ? "&" : "?"}uri=${uri}`;
  }
  return `${base}${base.endsWith("/") ? "" : "/"}wc?uri=${uri}`;
}

export function getMobileWalletHandoff(
  provider: EthereumProvider,
  userAgent = typeof navigator === "undefined" ? "" : navigator.userAgent,
): MobileWalletHandoff | null {
  if (provider.connectorId !== "trustconnect-walletconnect" || !isIosSafari(userAgent)) return null;
  const peer = provider.walletConnectPeer;
  const walletName = peer?.name?.trim() || "wallet";
  const redirect = peer?.nativeRedirect?.trim() || peer?.universalRedirect?.trim();
  const sessionTopic = peer?.sessionTopic?.trim();
  if (!redirect || !sessionTopic) return null;
  return { walletName, url: buildWalletConnectRequestLink(redirect, sessionTopic) };
}

export function openMobileWalletHandoff(handoff: MobileWalletHandoff): void {
  recordLocalOfferDiagnostic("wallet.mobile_handoff_opened", { walletName: handoff.walletName });
  window.open(handoff.url, "_blank", "noreferrer noopener");
}

export function waitForForeground(timeoutMs = 120000): Promise<void> {
  if (typeof document === "undefined" || document.visibilityState === "visible") return Promise.resolve();
  recordLocalOfferDiagnostic("wallet.foreground_wait_started");
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      globalThis.clearTimeout(timeout);
      document.removeEventListener("visibilitychange", handleVisibility);
      if (error) reject(error);
      else {
        recordLocalOfferDiagnostic("wallet.foreground_wait_complete");
        resolve();
      }
    };
    const handleVisibility = () => {
      if (document.visibilityState === "visible") finish();
    };
    const timeout = globalThis.setTimeout(() => finish(new Error("Return to Safari to submit the signed offer.")), timeoutMs);
    document.addEventListener("visibilitychange", handleVisibility);
  });
}
