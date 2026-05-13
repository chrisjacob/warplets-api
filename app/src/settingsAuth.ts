import sdk from "@farcaster/miniapp-sdk";
import { createLightClient } from "@farcaster/quick-auth/light";

const QUICK_AUTH_TIMEOUT_MS = 12000;

let settingsQuickAuthToken: string | null = null;
let settingsQuickAuthPromise: Promise<string> | null = null;

export function isLikelyDesktop(): boolean {
  if (typeof window === "undefined") return false;
  const ua = window.navigator.userAgent.toLowerCase();
  const mobileLike = /iphone|ipad|ipod|android|mobile/.test(ua);
  return !mobileLike && window.matchMedia("(pointer: fine)").matches;
}

async function withTimeout<T>(promise: Promise<T>, message: string, timeoutMs = QUICK_AUTH_TIMEOUT_MS): Promise<T> {
  let timeoutId: number | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timeoutId = window.setTimeout(() => reject(new Error(message)), timeoutMs);
  });

  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timeoutId !== undefined) window.clearTimeout(timeoutId);
  }
}

async function getSettingsQuickAuthToken(): Promise<string> {
  if (settingsQuickAuthToken) return settingsQuickAuthToken;
  if (!settingsQuickAuthPromise) {
    settingsQuickAuthPromise = (async () => {
      const client = createLightClient();
      const { nonce } = await withTimeout(
        client.generateNonce(),
        "Farcaster verification did not start. Please close and reopen the Mini App, then try again."
      );
      const signInResult = await withTimeout(
        sdk.actions.signIn({ nonce, acceptAuthAddress: false }),
        "Farcaster verification did not finish. Please close and reopen the Mini App, then try again."
      );
      const verifyResult = await withTimeout(
        client.verifySiwf({
          domain: window.location.hostname,
          message: signInResult.message,
          signature: signInResult.signature,
        }),
        "Farcaster verification could not be confirmed. Please close and reopen the Mini App, then try again."
      );
      settingsQuickAuthToken = verifyResult.token;
      return verifyResult.token;
    })().finally(() => {
      settingsQuickAuthPromise = null;
    });
  }
  return settingsQuickAuthPromise;
}

export async function settingsAuthFetch(path: string, init?: RequestInit): Promise<Response> {
  const token = await getSettingsQuickAuthToken();
  const headers = new Headers(init?.headers);
  headers.set("authorization", `Bearer ${token}`);
  return fetch(path, {
    ...init,
    headers,
  });
}
