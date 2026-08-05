import { createOrMergeAppSession, type AppAuthEnv } from "../../../_lib/appAuth.js";
import { jsonSecure, sha256Hex } from "../../../_lib/security.js";

interface Env extends AppAuthEnv {
  X_CLIENT_ID?: string;
  X_OAUTH_CALLBACK_URL?: string;
}

function randomBase64Url(bytes = 32): string {
  const value = crypto.getRandomValues(new Uint8Array(bytes));
  let binary = "";
  for (const byte of value) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function safeReturnPath(value: string | null): string {
  if (!value || !value.startsWith("/") || value.startsWith("//")) return "/";
  return value.slice(0, 500);
}

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const clientId = env.X_CLIENT_ID?.trim();
  if (!clientId) return jsonSecure({ error: "X authentication is not configured" }, { status: 503 });
  const appSession = await createOrMergeAppSession(request, env, {});
  const state = randomBase64Url();
  const verifier = randomBase64Url(48);
  const nonce = randomBase64Url();
  const challengeBytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  let challengeBinary = "";
  for (const byte of new Uint8Array(challengeBytes)) challengeBinary += String.fromCharCode(byte);
  const challenge = btoa(challengeBinary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const requestUrl = new URL(request.url);
  const callbackUrl = env.X_OAUTH_CALLBACK_URL?.trim() || `${requestUrl.origin}/api/auth/x/callback`;
  const createdAt = new Date();
  await env.WARPLETS.prepare(
    `INSERT INTO external_auth_challenges (
       state_hash, provider, app_session_hash, pkce_verifier, nonce,
       return_path, created_at, expires_at
     ) VALUES (?, 'x', ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      await sha256Hex(state),
      appSession.session.sessionHash,
      verifier,
      nonce,
      safeReturnPath(requestUrl.searchParams.get("returnTo")),
      createdAt.toISOString(),
      new Date(createdAt.getTime() + 5 * 60 * 1000).toISOString(),
    )
    .run();
  const authorize = new URL("https://x.com/i/oauth2/authorize");
  authorize.searchParams.set("response_type", "code");
  authorize.searchParams.set("client_id", clientId);
  authorize.searchParams.set("redirect_uri", callbackUrl);
  authorize.searchParams.set("scope", "users.read tweet.read");
  authorize.searchParams.set("state", state);
  authorize.searchParams.set("code_challenge", challenge);
  authorize.searchParams.set("code_challenge_method", "S256");
  return new Response(null, {
    status: 302,
    headers: { location: authorize.toString(), "set-cookie": appSession.cookie, "cache-control": "no-store" },
  });
};
