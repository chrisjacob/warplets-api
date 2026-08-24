import { getAppSession, type AppAuthEnv } from "../../../_lib/appAuth.js";
import { oauthStateHash, verifyTelegramIdToken } from "../../../_lib/externalOAuth.js";
import { jsonSecure } from "../../../_lib/security.js";

interface Env extends AppAuthEnv { TELEGRAM_OIDC_CLIENT_ID?: string; TELEGRAM_OIDC_CLIENT_SECRET?: string; TELEGRAM_OIDC_CALLBACK_URL?: string }
interface Challenge { app_session_hash: string; provider_user_id: string; bot_challenge_hash: string; pkce_verifier: string; nonce: string; return_path: string }

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const url = new URL(request.url);
  const state = url.searchParams.get("state") ?? "";
  const code = url.searchParams.get("code") ?? "";
  const session = await getAppSession(request, env, { touch: false });
  if (!session || !state || !code) return jsonSecure({ error: "Telegram OIDC callback is invalid or expired" }, { status: 401 });
  const stateHash = await oauthStateHash(state);
  const challenge = await env.WARPLETS.prepare(
    `SELECT app_session_hash, provider_user_id, bot_challenge_hash, pkce_verifier, nonce, return_path
       FROM external_auth_challenges WHERE state_hash = ? AND provider = 'telegram'
       AND consumed_at IS NULL AND expires_at > ? LIMIT 1`,
  ).bind(stateHash, new Date().toISOString()).first<Challenge>();
  if (!challenge || challenge.app_session_hash !== session.sessionHash) return jsonSecure({ error: "Telegram OIDC state validation failed" }, { status: 401 });
  await env.WARPLETS.prepare("UPDATE external_auth_challenges SET consumed_at = ? WHERE state_hash = ? AND consumed_at IS NULL")
    .bind(new Date().toISOString(), stateHash).run();
  const clientId = env.TELEGRAM_OIDC_CLIENT_ID?.trim() ?? "";
  const clientSecret = env.TELEGRAM_OIDC_CLIENT_SECRET?.trim() ?? "";
  if (!clientId || !clientSecret) return jsonSecure({ error: "Telegram OIDC is not configured" }, { status: 503 });
  const callback = env.TELEGRAM_OIDC_CALLBACK_URL?.trim() || `${url.origin}/api/auth/telegram/callback`;
  const tokenResponse = await fetch("https://oauth.telegram.org/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", authorization: `Basic ${btoa(`${clientId}:${clientSecret}`)}` },
    body: new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: callback, client_id: clientId, code_verifier: challenge.pkce_verifier }),
  });
  const token = await tokenResponse.json().catch(() => null) as { id_token?: string } | null;
  if (!tokenResponse.ok || !token?.id_token) return jsonSecure({ error: "Telegram token exchange failed" }, { status: 502 });
  const claims = await verifyTelegramIdToken(token.id_token, { clientId, nonce: challenge.nonce }).catch((error) => ({ error }));
  if ("error" in claims) return jsonSecure({ error: claims.error instanceof Error ? claims.error.message : "Telegram ID token verification failed" }, { status: 401 });
  if (String(claims.sub ?? "") !== challenge.provider_user_id) return jsonSecure({ error: "Telegram account does not match the bot link" }, { status: 403 });
  await env.WARPLETS.prepare("UPDATE bot_link_challenges SET platform_auth_verified_at = ? WHERE challenge_hash = ? AND consumed_at IS NULL")
    .bind(new Date().toISOString(), challenge.bot_challenge_hash).run();
  const destination = new URL(challenge.return_path, url.origin);
  destination.searchParams.set("platformVerified", "1");
  return Response.redirect(destination.toString(), 302);
};
