import { sha256Hex } from "./security.js";

export function randomBase64Url(bytes = 32): string {
  const value = crypto.getRandomValues(new Uint8Array(bytes));
  let binary = "";
  for (const byte of value) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export async function pkceChallenge(verifier: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)));
  let binary = "";
  for (const byte of digest) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function decodeJwtPart(value: string): Record<string, unknown> {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  return JSON.parse(atob(normalized + "=".repeat((4 - normalized.length % 4) % 4))) as Record<string, unknown>;
}

export async function verifyTelegramIdToken(
  token: string,
  options: { clientId: string; nonce: string },
): Promise<Record<string, unknown>> {
  const parts = token.split(".");
  if (parts.length !== 3) throw new Error("Telegram returned an invalid ID token");
  const header = decodeJwtPart(parts[0]);
  const claims = decodeJwtPart(parts[1]);
  if (header.alg !== "RS256" || typeof header.kid !== "string") throw new Error("Telegram ID token algorithm is not accepted");
  const jwksResponse = await fetch("https://oauth.telegram.org/.well-known/jwks.json", { headers: { accept: "application/json" } });
  const jwks = await jwksResponse.json() as { keys?: Array<JsonWebKey & { kid?: string; kty?: string }> };
  const jwk = jwks.keys?.find((candidate) => candidate.kid === header.kid && candidate.kty === "RSA");
  if (!jwk) throw new Error("Telegram signing key is unavailable");
  const key = await crypto.subtle.importKey("jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
  const signatureValue = parts[2].replace(/-/g, "+").replace(/_/g, "/");
  const signature = Uint8Array.from(atob(signatureValue + "=".repeat((4 - signatureValue.length % 4) % 4)), (character) => character.charCodeAt(0));
  const verified = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, signature, new TextEncoder().encode(`${parts[0]}.${parts[1]}`));
  if (!verified) throw new Error("Telegram ID token signature is invalid");
  const audiences = Array.isArray(claims.aud) ? claims.aud.map(String) : [String(claims.aud ?? "")];
  if (claims.iss !== "https://oauth.telegram.org" || !audiences.includes(options.clientId)) throw new Error("Telegram ID token audience is invalid");
  if (Number(claims.exp) * 1000 <= Date.now() || Number(claims.iat) * 1000 > Date.now() + 60_000) throw new Error("Telegram ID token is expired or not yet valid");
  if (claims.nonce !== options.nonce) throw new Error("Telegram ID token nonce is invalid");
  return claims;
}

export async function oauthStateHash(state: string): Promise<string> {
  return sha256Hex(state);
}
