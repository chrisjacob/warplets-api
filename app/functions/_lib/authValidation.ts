import { jsonSecure, sha256Hex } from "./security.js";
import { WARPLETS_APP_HOSTS } from "../../shared/warpletsApp.js";

export const BASE_MAINNET_CHAIN_ID = 8453;
export const BASE_SEPOLIA_CHAIN_ID = 84532;
export const AUTH_NONCE_TTL_MS = 5 * 60 * 1000;
const LOCAL_HTTPS_TUNNEL_HOSTS = new Set([
  "app-local.10x.meme",
  "drop-local.10x.meme",
  "million-local.10x.meme",
  ...WARPLETS_APP_HOSTS.filter((hostname) => hostname.includes("-local.")),
]);

export function isLocalHttpsTunnelHostname(hostname: string): boolean {
  return LOCAL_HTTPS_TUNNEL_HOSTS.has(hostname.toLowerCase());
}

export function normalizeAuthWallet(value: unknown): `0x${string}` | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  return /^0x[a-f0-9]{40}$/.test(normalized) ? (normalized as `0x${string}`) : null;
}

export function isAllowedAuthChain(chainId: number, request: Request): boolean {
  if (chainId === BASE_MAINNET_CHAIN_ID) return true;
  const hostname = new URL(request.url).hostname;
  return chainId === BASE_SEPOLIA_CHAIN_ID && (hostname === "localhost" || hostname === "127.0.0.1" || hostname === WARPLETS_APP_HOSTS[0]);
}

export function requireSameOrigin(request: Request): Response | null {
  const origin = request.headers.get("origin");
  if (!origin) return null;
  return origin === new URL(request.url).origin
    ? null
    : jsonSecure({ error: "origin does not match this application" }, { status: 403 });
}

/**
 * Return the browser-visible URL when the local HTTPS tunnel terminates TLS
 * before the Pages dev Worker. The forwarded origin is accepted only when its
 * host exactly matches the Worker-facing request host.
 */
export function getAuthRequestUrl(request: Request): URL {
  const requestUrl = new URL(request.url);
  if (isLocalHttpsTunnelHostname(requestUrl.hostname)) {
    return new URL(`https://${requestUrl.host}${requestUrl.pathname}${requestUrl.search}`);
  }
  const forwardedOrigin = request.headers.get("x-10x-public-origin")?.trim();
  if (!forwardedOrigin || requestUrl.protocol === "https:") return requestUrl;
  try {
    const forwardedUrl = new URL(forwardedOrigin);
    if (forwardedUrl.protocol === "https:" && forwardedUrl.host === requestUrl.host) {
      return new URL(`${forwardedUrl.origin}${requestUrl.pathname}${requestUrl.search}`);
    }
  } catch {
    // Ignore an invalid or untrusted forwarded origin.
  }
  return requestUrl;
}

export function createAuthNonce(): string {
  const alphabet = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join("");
}

export function hashAuthNonce(nonce: string): Promise<string> {
  return sha256Hex(`app-auth-nonce:v1:${nonce}`);
}

export function isUsableStoredNonce(row: { consumed_at: string | null; expires_at: string }, now = Date.now()): boolean {
  const expiresAt = Date.parse(row.expires_at);
  return row.consumed_at == null && Number.isFinite(expiresAt) && now < expiresAt;
}
