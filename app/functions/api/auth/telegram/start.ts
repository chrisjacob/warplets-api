import { createOrMergeAppSession, type AppAuthEnv } from "../../../_lib/appAuth.js";
import { oauthStateHash, pkceChallenge, randomBase64Url } from "../../../_lib/externalOAuth.js";
import { jsonSecure, sha256Hex } from "../../../_lib/security.js";

interface Env extends AppAuthEnv { TELEGRAM_OIDC_CLIENT_ID?: string; TELEGRAM_OIDC_CALLBACK_URL?: string }

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const clientId = env.TELEGRAM_OIDC_CLIENT_ID?.trim();
  if (!clientId) return jsonSecure({ error: "Telegram OIDC is not configured" }, { status: 503 });
  const url = new URL(request.url);
  const challenge = url.searchParams.get("challenge") ?? "";
  if (!challenge || challenge.length > 256) return jsonSecure({ error: "bot challenge is required" }, { status: 400 });
  const challengeHash = await sha256Hex(challenge);
  const botLink = await env.WARPLETS.prepare(
    `SELECT provider_user_id FROM bot_link_challenges
      WHERE challenge_hash = ? AND provider = 'telegram' AND consumed_at IS NULL AND expires_at > ? LIMIT 1`,
  ).bind(challengeHash, new Date().toISOString()).first<{ provider_user_id: string }>();
  if (!botLink) return jsonSecure({ error: "Telegram link challenge is invalid or expired" }, { status: 410 });
  const session = await createOrMergeAppSession(request, env, {});
  const state = randomBase64Url();
  const verifier = randomBase64Url(48);
  const nonce = randomBase64Url();
  const callback = env.TELEGRAM_OIDC_CALLBACK_URL?.trim() || `${url.origin}/api/auth/telegram/callback`;
  const timestamp = new Date();
  await env.WARPLETS.prepare(
    `INSERT INTO external_auth_challenges (
       state_hash, provider, app_session_hash, provider_user_id, bot_challenge_hash,
       pkce_verifier, nonce, return_path, created_at, expires_at
     ) VALUES (?, 'telegram', ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    await oauthStateHash(state), session.session.sessionHash, botLink.provider_user_id, challengeHash,
    verifier, nonce, `/link-bot?provider=telegram&challenge=${encodeURIComponent(challenge)}`,
    timestamp.toISOString(), new Date(timestamp.getTime() + 5 * 60 * 1000).toISOString(),
  ).run();
  const authorize = new URL("https://oauth.telegram.org/auth");
  authorize.searchParams.set("client_id", clientId);
  authorize.searchParams.set("redirect_uri", callback);
  authorize.searchParams.set("response_type", "code");
  authorize.searchParams.set("scope", "openid profile");
  authorize.searchParams.set("state", state);
  authorize.searchParams.set("nonce", nonce);
  authorize.searchParams.set("code_challenge", await pkceChallenge(verifier));
  authorize.searchParams.set("code_challenge_method", "S256");
  return new Response(null, { status: 302, headers: { location: authorize.toString(), "set-cookie": session.cookie, "cache-control": "no-store" } });
};
