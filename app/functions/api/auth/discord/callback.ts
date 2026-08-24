import { getAppSession, type AppAuthEnv } from "../../../_lib/appAuth.js";
import { oauthStateHash } from "../../../_lib/externalOAuth.js";
import { jsonSecure } from "../../../_lib/security.js";

interface Env extends AppAuthEnv { DISCORD_CLIENT_ID?: string; DISCORD_CLIENT_SECRET?: string; DISCORD_OAUTH_CALLBACK_URL?: string }
interface Challenge { app_session_hash: string; provider_user_id: string; bot_challenge_hash: string; return_path: string }

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const url = new URL(request.url);
  const state = url.searchParams.get("state") ?? "";
  const code = url.searchParams.get("code") ?? "";
  const session = await getAppSession(request, env, { touch: false });
  if (!session || !state || !code) return jsonSecure({ error: "Discord OAuth callback is invalid or expired" }, { status: 401 });
  const stateHash = await oauthStateHash(state);
  const challenge = await env.WARPLETS.prepare(
    `SELECT app_session_hash, provider_user_id, bot_challenge_hash, return_path
       FROM external_auth_challenges WHERE state_hash = ? AND provider = 'discord'
       AND consumed_at IS NULL AND expires_at > ? LIMIT 1`,
  ).bind(stateHash, new Date().toISOString()).first<Challenge>();
  if (!challenge || challenge.app_session_hash !== session.sessionHash) return jsonSecure({ error: "Discord OAuth state validation failed" }, { status: 401 });
  await env.WARPLETS.prepare("UPDATE external_auth_challenges SET consumed_at = ? WHERE state_hash = ? AND consumed_at IS NULL")
    .bind(new Date().toISOString(), stateHash).run();
  const clientId = env.DISCORD_CLIENT_ID?.trim() ?? "";
  const secret = env.DISCORD_CLIENT_SECRET?.trim() ?? "";
  if (!clientId || !secret) return jsonSecure({ error: "Discord OAuth is not configured" }, { status: 503 });
  const callback = env.DISCORD_OAUTH_CALLBACK_URL?.trim() || `${url.origin}/api/auth/discord/callback`;
  const tokenResponse = await fetch("https://discord.com/api/v10/oauth2/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: clientId, client_secret: secret, grant_type: "authorization_code", code, redirect_uri: callback }),
  });
  const token = await tokenResponse.json().catch(() => null) as { access_token?: string } | null;
  if (!tokenResponse.ok || !token?.access_token) return jsonSecure({ error: "Discord token exchange failed" }, { status: 502 });
  const userResponse = await fetch("https://discord.com/api/v10/users/@me", { headers: { authorization: `Bearer ${token.access_token}` } });
  const user = await userResponse.json().catch(() => null) as { id?: string } | null;
  if (!userResponse.ok || user?.id !== challenge.provider_user_id) return jsonSecure({ error: "Discord account does not match the bot link" }, { status: 403 });
  await env.WARPLETS.prepare("UPDATE bot_link_challenges SET platform_auth_verified_at = ? WHERE challenge_hash = ? AND consumed_at IS NULL")
    .bind(new Date().toISOString(), challenge.bot_challenge_hash).run();
  const destination = new URL(challenge.return_path, url.origin);
  destination.searchParams.set("platformVerified", "1");
  return Response.redirect(destination.toString(), 302);
};
