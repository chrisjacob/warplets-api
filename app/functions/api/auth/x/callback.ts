import { getAppSession, type AppAuthEnv } from "../../../_lib/appAuth.js";
import { jsonSecure, sha256Hex } from "../../../_lib/security.js";

interface Env extends AppAuthEnv {
  X_CLIENT_ID?: string;
  X_CLIENT_SECRET?: string;
  X_OAUTH_CALLBACK_URL?: string;
}

interface ChallengeRow {
  app_session_hash: string;
  pkce_verifier: string;
  nonce: string;
  return_path: string;
}

interface XUserResponse {
  data?: { id?: string; name?: string; username?: string; profile_image_url?: string; verified?: boolean };
}

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const url = new URL(request.url);
  const state = url.searchParams.get("state") ?? "";
  const code = url.searchParams.get("code") ?? "";
  if (!state || !code || state.length > 256 || code.length > 1024) {
    return jsonSecure({ error: "Invalid X OAuth callback" }, { status: 400 });
  }
  const session = await getAppSession(request, env, { touch: false });
  if (!session) return jsonSecure({ error: "The X sign-in session expired" }, { status: 401 });
  const challenge = await env.WARPLETS.prepare(
    `SELECT app_session_hash, pkce_verifier, nonce, return_path
       FROM external_auth_challenges
      WHERE state_hash = ? AND provider = 'x' AND consumed_at IS NULL AND expires_at > ?
      LIMIT 1`,
  )
    .bind(await sha256Hex(state), new Date().toISOString())
    .first<ChallengeRow>();
  if (!challenge || challenge.app_session_hash !== session.sessionHash) {
    return jsonSecure({ error: "X OAuth state validation failed" }, { status: 401 });
  }
  await env.WARPLETS.prepare(
    "UPDATE external_auth_challenges SET consumed_at = ? WHERE state_hash = ? AND consumed_at IS NULL",
  ).bind(new Date().toISOString(), await sha256Hex(state)).run();

  const clientId = env.X_CLIENT_ID?.trim() ?? "";
  const callbackUrl = env.X_OAUTH_CALLBACK_URL?.trim() || `${url.origin}/api/auth/x/callback`;
  const tokenHeaders = new Headers({ "content-type": "application/x-www-form-urlencoded" });
  if (env.X_CLIENT_SECRET?.trim()) {
    tokenHeaders.set("authorization", `Basic ${btoa(`${clientId}:${env.X_CLIENT_SECRET.trim()}`)}`);
  }
  const tokenResponse = await fetch("https://api.x.com/2/oauth2/token", {
    method: "POST",
    headers: tokenHeaders,
    body: new URLSearchParams({
      code,
      grant_type: "authorization_code",
      client_id: clientId,
      redirect_uri: callbackUrl,
      code_verifier: challenge.pkce_verifier,
    }),
  });
  const token = await tokenResponse.json().catch(() => null) as { access_token?: string; error_description?: string } | null;
  if (!tokenResponse.ok || !token?.access_token) {
    return jsonSecure({ error: token?.error_description || "X token exchange failed" }, { status: 502 });
  }
  const profileResponse = await fetch("https://api.x.com/2/users/me?user.fields=id,name,username,profile_image_url,verified", {
    headers: { authorization: `Bearer ${token.access_token}`, accept: "application/json" },
  });
  const profile = await profileResponse.json().catch(() => null) as XUserResponse | null;
  const xUser = profile?.data;
  if (!profileResponse.ok || !xUser?.id) return jsonSecure({ error: "X profile verification failed" }, { status: 502 });
  const timestamp = new Date().toISOString();
  await env.WARPLETS.prepare(
    `INSERT INTO external_identity_links (
       provider, provider_user_id, wallet_address, farcaster_fid, display_name,
       verified_at, verification_method, metadata_json, app_session_hash
     ) VALUES ('x', ?, ?, ?, ?, ?, 'oauth2-pkce', ?, ?)
     ON CONFLICT(provider, provider_user_id) DO UPDATE SET
       wallet_address = excluded.wallet_address, farcaster_fid = excluded.farcaster_fid,
       display_name = excluded.display_name, verified_at = excluded.verified_at,
       verification_method = excluded.verification_method,
       metadata_json = excluded.metadata_json, app_session_hash = excluded.app_session_hash`,
  )
    .bind(
      xUser.id,
      session.walletAddress,
      session.farcasterFid,
      xUser.name ?? xUser.username ?? null,
      timestamp,
      JSON.stringify({ username: xUser.username ?? null, profileImageUrl: xUser.profile_image_url ?? null, verified: xUser.verified === true }),
      session.sessionHash,
    )
    .run();
  const destination = new URL(challenge.return_path || "/", url.origin);
  destination.searchParams.set("xIdentity", "connected");
  return Response.redirect(destination.toString(), 302);
};
