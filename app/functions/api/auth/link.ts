import { getAppSession, type AppAuthEnv } from "../../_lib/appAuth.js";
import { requireSameOrigin } from "../../_lib/authValidation.js";
import { jsonSecure, parseObjectPayload, readJsonBodyWithLimit } from "../../_lib/security.js";

interface LinkPayload { confirm?: unknown }

export const onRequestPost: PagesFunction<AppAuthEnv> = async (context) => {
  const originError = requireSameOrigin(context.request);
  if (originError) return originError;
  const session = await getAppSession(context.request, context.env);
  if (!session?.farcasterFid || !session.walletAddress) {
    return jsonSecure({ error: "Both a verified Farcaster identity and verified wallet are required" }, { status: 401 });
  }
  const parsed = await readJsonBodyWithLimit<unknown>(context.request, 8 * 1024);
  if (!parsed.ok) return parsed.response;
  const payload = parseObjectPayload<LinkPayload>(parsed.value, ["confirm"]);
  if (!payload.ok) return payload.response;

  const knownMatch = await context.env.WARPLETS.prepare(
    `SELECT 1 AS matched FROM wallet_farcaster_links
     WHERE fid = ? AND lower(wallet) = ? LIMIT 1`,
  ).bind(session.farcasterFid, session.walletAddress).first<{ matched: number }>();
  if (!knownMatch && payload.payload.confirm !== true) {
    return jsonSecure({ confirmationRequired: true }, { status: 409 });
  }

  const now = new Date().toISOString();
  await context.env.WARPLETS.prepare(
    `INSERT INTO app_identity_links (farcaster_fid, wallet_address, verified_at, verification_method)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(farcaster_fid, wallet_address) DO UPDATE SET
       verified_at = excluded.verified_at,
       verification_method = excluded.verification_method`,
  ).bind(session.farcasterFid, session.walletAddress, now, knownMatch ? "farcaster_verified_address" : "explicit_confirmation").run();
  return jsonSecure({ linked: true, farcasterFid: session.farcasterFid, walletAddress: session.walletAddress });
};
