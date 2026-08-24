import { getAppSession, type AppAuthEnv } from "../../_lib/appAuth.js";
import { requireSameOrigin } from "../../_lib/authValidation.js";
import { jsonSecure, parseObjectPayload, readJsonBodyWithLimit } from "../../_lib/security.js";

interface LinkPayload { confirm?: unknown; automatic?: unknown }

export const onRequestPost: PagesFunction<AppAuthEnv> = async (context) => {
  const originError = requireSameOrigin(context.request);
  if (originError) return originError;
  const session = await getAppSession(context.request, context.env);
  if (!session?.farcasterFid || !session.walletAddress) {
    return jsonSecure({ error: "Both a verified Farcaster identity and verified wallet are required" }, { status: 401 });
  }
  const parsed = await readJsonBodyWithLimit<unknown>(context.request, 8 * 1024);
  if (!parsed.ok) return parsed.response;
  const payload = parseObjectPayload<LinkPayload>(parsed.value, ["confirm", "automatic"]);
  if (!payload.ok) return payload.response;
  if (payload.payload.automatic != null && typeof payload.payload.automatic !== "boolean") {
    return jsonSecure({ error: "automatic must be a boolean" }, { status: 400 });
  }

  const automatic = payload.payload.automatic === true;
  if (automatic) {
    const preference = await context.env.WARPLETS.prepare(
      `SELECT auto_link_enabled AS enabled
       FROM app_identity_link_preferences
       WHERE farcaster_fid = ? AND lower(wallet_address) = ? LIMIT 1`,
    ).bind(session.farcasterFid, session.walletAddress.toLowerCase()).first<{ enabled: number }>();
    if (preference?.enabled === 0) {
      return jsonSecure({
        linked: false,
        automaticLinkSuppressed: true,
        farcasterFid: session.farcasterFid,
        walletAddress: session.walletAddress,
      });
    }
  }

  const knownMatch = await context.env.WARPLETS.prepare(
    `SELECT 1 AS matched FROM wallet_farcaster_links
     WHERE fid = ? AND lower(wallet) = ? LIMIT 1`,
  ).bind(session.farcasterFid, session.walletAddress).first<{ matched: number }>();
  if (!knownMatch && payload.payload.confirm !== true) {
    return jsonSecure({ confirmationRequired: true }, { status: 409 });
  }

  const now = new Date().toISOString();
  const linkStatement = context.env.WARPLETS.prepare(
    `INSERT INTO app_identity_links (farcaster_fid, wallet_address, verified_at, verification_method)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(farcaster_fid, wallet_address) DO UPDATE SET
       verified_at = excluded.verified_at,
       verification_method = excluded.verification_method`,
  ).bind(
    session.farcasterFid,
    session.walletAddress,
    now,
    knownMatch
      ? "farcaster_verified_address"
      : automatic
        ? "verified_principals_auto_link"
        : "manual_link",
  );
  if (automatic) {
    await linkStatement.run();
  } else {
    await context.env.WARPLETS.batch([
      linkStatement,
      context.env.WARPLETS.prepare(
        `INSERT INTO app_identity_link_preferences (farcaster_fid, wallet_address, auto_link_enabled, updated_at)
         VALUES (?, ?, 1, ?)
         ON CONFLICT(farcaster_fid, wallet_address) DO UPDATE SET
           auto_link_enabled = 1,
           updated_at = excluded.updated_at`,
      ).bind(session.farcasterFid, session.walletAddress.toLowerCase(), now),
    ]);
  }
  return jsonSecure({ linked: true, farcasterFid: session.farcasterFid, walletAddress: session.walletAddress });
};

export const onRequestDelete: PagesFunction<AppAuthEnv> = async (context) => {
  const originError = requireSameOrigin(context.request);
  if (originError) return originError;
  const session = await getAppSession(context.request, context.env);
  if (!session?.farcasterFid || !session.walletAddress) {
    return jsonSecure({ error: "Both a verified Farcaster identity and verified wallet are required" }, { status: 401 });
  }

  const now = new Date().toISOString();
  await context.env.WARPLETS.batch([
    context.env.WARPLETS.prepare(
      `DELETE FROM app_identity_links
       WHERE farcaster_fid = ? AND lower(wallet_address) = ?`,
    ).bind(session.farcasterFid, session.walletAddress.toLowerCase()),
    context.env.WARPLETS.prepare(
      `INSERT INTO app_identity_link_preferences (farcaster_fid, wallet_address, auto_link_enabled, updated_at)
       VALUES (?, ?, 0, ?)
       ON CONFLICT(farcaster_fid, wallet_address) DO UPDATE SET
         auto_link_enabled = 0,
         updated_at = excluded.updated_at`,
    ).bind(session.farcasterFid, session.walletAddress.toLowerCase(), now),
  ]);

  return jsonSecure({ linked: false, farcasterFid: session.farcasterFid, walletAddress: session.walletAddress });
};
