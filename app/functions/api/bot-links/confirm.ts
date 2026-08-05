import { getAppSession, type AppAuthEnv } from "../../_lib/appAuth.js";
import { jsonSecure, sha256Hex } from "../../_lib/security.js";

interface Env extends AppAuthEnv {}

interface ChallengeRow {
  provider: "telegram" | "discord";
  provider_user_id: string;
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) return jsonSecure({ error: "cross-origin request rejected" }, { status: 403 });
  const session = await getAppSession(request, env);
  if (!session?.walletAddress) return jsonSecure({ error: "verified wallet session required" }, { status: 401 });
  const body = await request.json<{ challenge?: string; confirm?: boolean }>().catch(
    (): { challenge?: string; confirm?: boolean } => ({}),
  );
  if (body.confirm !== true || !body.challenge || body.challenge.length > 256) {
    return jsonSecure({ error: "explicit confirmation and challenge are required" }, { status: 400 });
  }
  const challengeHash = await sha256Hex(body.challenge);
  const challenge = await env.WARPLETS.prepare(
    `SELECT provider, provider_user_id FROM bot_link_challenges
      WHERE challenge_hash = ? AND consumed_at IS NULL AND expires_at > ?
        AND platform_auth_verified_at IS NOT NULL LIMIT 1`,
  ).bind(challengeHash, new Date().toISOString()).first<ChallengeRow>();
  if (!challenge) return jsonSecure({ error: "link challenge is invalid or expired" }, { status: 410 });
  const timestamp = new Date().toISOString();
  const consumed = await env.WARPLETS.prepare(
    "UPDATE bot_link_challenges SET consumed_at = ?, wallet_address = ? WHERE challenge_hash = ? AND consumed_at IS NULL",
  ).bind(timestamp, session.walletAddress, challengeHash).run();
  if (!consumed.meta.changes) return jsonSecure({ error: "link challenge was already used" }, { status: 409 });
  await env.WARPLETS.prepare(
    `INSERT INTO external_identity_links (
       provider, provider_user_id, wallet_address, farcaster_fid, verified_at,
       verification_method, app_session_hash
     ) VALUES (?, ?, ?, ?, ?, 'bot-deep-link+siwe', ?)
     ON CONFLICT(provider, provider_user_id) DO UPDATE SET
       wallet_address = excluded.wallet_address, farcaster_fid = excluded.farcaster_fid,
       verified_at = excluded.verified_at, verification_method = excluded.verification_method,
       app_session_hash = excluded.app_session_hash`,
  ).bind(
    challenge.provider,
    challenge.provider_user_id,
    session.walletAddress,
    session.farcasterFid,
    timestamp,
    session.sessionHash,
  ).run();
  return jsonSecure({ ok: true, provider: challenge.provider });
};
