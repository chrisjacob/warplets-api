import { createOrMergeAppSession, type AppAuthEnv } from "../../../_lib/appAuth.js";
import { oauthStateHash, randomBase64Url } from "../../../_lib/externalOAuth.js";
import { jsonSecure, sha256Hex } from "../../../_lib/security.js";

interface Env extends AppAuthEnv { DISCORD_CLIENT_ID?: string; DISCORD_OAUTH_CALLBACK_URL?: string }

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const clientId = env.DISCORD_CLIENT_ID?.trim();
  if (!clientId) return jsonSecure({ error: "Discord OAuth is not configured" }, { status: 503 });
  const url = new URL(request.url);
  const challenge = url.searchParams.get("challenge") ?? "";
  const challengeHash = await sha256Hex(challenge);
  const botLink = challenge ? await env.WARPLETS.prepare(
    `SELECT provider_user_id FROM bot_link_challenges
      WHERE challenge_hash = ? AND provider = 'discord' AND consumed_at IS NULL AND expires_at > ? LIMIT 1`,
  ).bind(challengeHash, new Date().toISOString()).first<{ provider_user_id: string }>() : null;
  if (!botLink) return jsonSecure({ error: "Discord link challenge is invalid or expired" }, { status: 410 });
  const session = await createOrMergeAppSession(request, env, {});
  const state = randomBase64Url();
  const nonce = randomBase64Url();
  const callback = env.DISCORD_OAUTH_CALLBACK_URL?.trim() || `${url.origin}/api/auth/discord/callback`;
  const timestamp = new Date();
  await env.WARPLETS.prepare(
    `INSERT INTO external_auth_challenges (
       state_hash, provider, app_session_hash, provider_user_id, bot_challenge_hash,
       nonce, return_path, created_at, expires_at
     ) VALUES (?, 'discord', ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    await oauthStateHash(state), session.session.sessionHash, botLink.provider_user_id, challengeHash,
    nonce, `/link-bot?provider=discord&challenge=${encodeURIComponent(challenge)}`,
    timestamp.toISOString(), new Date(timestamp.getTime() + 5 * 60 * 1000).toISOString(),
  ).run();
  const authorize = new URL("https://discord.com/oauth2/authorize");
  authorize.searchParams.set("client_id", clientId);
  authorize.searchParams.set("redirect_uri", callback);
  authorize.searchParams.set("response_type", "code");
  authorize.searchParams.set("scope", "identify");
  authorize.searchParams.set("state", state);
  return new Response(null, { status: 302, headers: { location: authorize.toString(), "set-cookie": session.cookie, "cache-control": "no-store" } });
};
