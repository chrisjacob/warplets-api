const STORAGE_KEY = "warplets:pending-farcaster-sign-in";

export interface PendingFarcasterSignIn {
  channelToken: string;
  nonce: string;
  uri: string;
  expiresAt: number;
}

export function readPendingFarcasterSignIn(): PendingFarcasterSignIn | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const value = JSON.parse(raw) as Partial<PendingFarcasterSignIn>;
    if (typeof value.channelToken !== "string" || typeof value.nonce !== "string" || typeof value.uri !== "string"
      || typeof value.expiresAt !== "number" || value.expiresAt <= Date.now()) {
      window.localStorage.removeItem(STORAGE_KEY);
      return null;
    }
    return value as PendingFarcasterSignIn;
  } catch { return null; }
}

export function writePendingFarcasterSignIn(value: PendingFarcasterSignIn): void {
  try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(value)); } catch { /* best effort */ }
}

export function clearPendingFarcasterSignIn(): void {
  try { window.localStorage.removeItem(STORAGE_KEY); } catch { /* best effort */ }
}

export function hasPendingFarcasterSignIn(): boolean {
  return readPendingFarcasterSignIn() !== null;
}
