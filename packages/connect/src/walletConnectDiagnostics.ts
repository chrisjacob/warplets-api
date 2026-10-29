export interface WalletConnectDiagnosticEntry {
  at: string;
  event: string;
  details?: Record<string, unknown>;
}

const STORAGE_KEY = "warplets_walletconnect_diagnostics_v1";
const CHANGE_EVENT = "warplets:walletconnect-diagnostics";
export const TRUSTCONNECT_DISCONNECT_REQUEST_EVENT = "warplets:trustconnect-disconnect-request";
export const TRUSTCONNECT_DISCONNECT_COMPLETE_EVENT = "warplets:trustconnect-disconnect-complete";
const MAX_ENTRIES = 100;

export function readWalletConnectDiagnostics(): WalletConnectDiagnosticEntry[] {
  if (!import.meta.env.DEV || typeof window === "undefined") return [];
  try {
    const parsed = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "[]") as unknown;
    return Array.isArray(parsed) ? parsed.slice(-MAX_ENTRIES) as WalletConnectDiagnosticEntry[] : [];
  } catch {
    return [];
  }
}

export function appendWalletConnectDiagnostic(event: string, details?: Record<string, unknown>): void {
  if (!import.meta.env.DEV || typeof window === "undefined") return;
  const next = [...readWalletConnectDiagnostics(), {
    at: new Date().toISOString(),
    event,
    ...(details ? { details } : {}),
  }].slice(-MAX_ENTRIES);
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    window.dispatchEvent(new CustomEvent(CHANGE_EVENT));
  } catch {
    // Diagnostics must never interfere with wallet connection.
  }
}

export function clearWalletConnectDiagnostics(): void {
  if (!import.meta.env.DEV || typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(STORAGE_KEY);
    window.dispatchEvent(new CustomEvent(CHANGE_EVENT));
  } catch {
    // Optional local diagnostics only.
  }
}

export function subscribeWalletConnectDiagnostics(listener: () => void): () => void {
  if (!import.meta.env.DEV || typeof window === "undefined") return () => undefined;
  window.addEventListener(CHANGE_EVENT, listener);
  window.addEventListener("storage", listener);
  return () => {
    window.removeEventListener(CHANGE_EVENT, listener);
    window.removeEventListener("storage", listener);
  };
}

export function requestTrustConnectSessionDisconnect(timeoutMs = 5000): Promise<"complete" | "timeout"> {
  if (typeof window === "undefined") return Promise.resolve("complete");
  return new Promise((resolve) => {
    let settled = false;
    const finish = (result: "complete" | "timeout") => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeout);
      window.removeEventListener(TRUSTCONNECT_DISCONNECT_COMPLETE_EVENT, handleComplete);
      appendWalletConnectDiagnostic(`trustconnect.disconnect_${result}`);
      resolve(result);
    };
    const handleComplete = () => finish("complete");
    const timeout = window.setTimeout(() => finish("timeout"), timeoutMs);
    window.addEventListener(TRUSTCONNECT_DISCONNECT_COMPLETE_EVENT, handleComplete, { once: true });
    appendWalletConnectDiagnostic("ui.trustconnect_disconnect_dispatched");
    window.dispatchEvent(new CustomEvent(TRUSTCONNECT_DISCONNECT_REQUEST_EVENT));
  });
}
