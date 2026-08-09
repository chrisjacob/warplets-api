import { createClient } from "@farcaster/quick-auth";
import { createAppClient, viemConnector } from "@farcaster/auth-client";
import { createOrMergeAppSession, type AppAuthEnv } from "../../../_lib/appAuth.js";
import { hashAuthNonce, isUsableStoredNonce, requireSameOrigin } from "../../../_lib/authValidation.js";
import { createActionSessionToken, jsonSecure, parseObjectPayload, readJsonBodyWithLimit } from "../../../_lib/security.js";

interface Env extends AppAuthEnv { ACTION_SESSION_SECRET?: string; NEYNAR_API_KEY?: string }
interface SiwfPayload { nonce?: unknown; message?: unknown; signature?: unknown; fid?: unknown }
interface NonceRow { domain: string; uri: string; expires_at: string; consumed_at: string | null }
interface FarcasterProfile {
  username: string | null;
  displayName: string | null;
  pfpUrl: string | null;
}

function profileString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized && normalized.toLowerCase() !== "undefined" && normalized.toLowerCase() !== "null"
    ? normalized
    : null;
}

async function loadFarcasterProfile(env: Env, fid: number): Promise<FarcasterProfile> {
  const cached = await env.WARPLETS.prepare(
    "SELECT username, display_name, pfp_url FROM warplets_users WHERE fid = ? LIMIT 1",
  ).bind(fid).first<{ username: string | null; display_name: string | null; pfp_url: string | null }>().catch(() => null);
  const cachedProfile = {
    username: profileString(cached?.username),
    displayName: profileString(cached?.display_name),
    pfpUrl: profileString(cached?.pfp_url),
  };
  if (cachedProfile.username && cachedProfile.displayName && cachedProfile.pfpUrl) return cachedProfile;
  if (!env.NEYNAR_API_KEY?.trim()) return cachedProfile;
  try {
    const response = await fetch(`https://api.neynar.com/v2/farcaster/user/bulk?fids=${fid}`, {
      headers: { accept: "application/json", "x-api-key": env.NEYNAR_API_KEY.trim() },
    });
    if (!response.ok) return cachedProfile;
    const payload = await response.json() as { users?: unknown };
    const user = Array.isArray(payload.users) && payload.users[0] && typeof payload.users[0] === "object"
      ? payload.users[0] as Record<string, unknown>
      : null;
    return {
      username: profileString(user?.username) ?? cachedProfile.username,
      displayName: profileString(user?.display_name) ?? cachedProfile.displayName,
      pfpUrl: profileString(user?.pfp_url) ?? cachedProfile.pfpUrl,
    };
  } catch {
    return cachedProfile;
  }
}

export const onRequestPost: PagesFunction<Env> = async (context) => {
  const originError = requireSameOrigin(context.request);
  if (originError) return originError;
  const authorization = context.request.headers.get("authorization") ?? "";
  const bearer = authorization.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
  let fid: number | null = null;

  if (bearer) {
    try {
      const payload = await createClient().verifyJwt({ token: bearer, domain: new URL(context.request.url).host });
      fid = Number(payload.sub);
    } catch {
      return jsonSecure({ error: "Farcaster Quick Auth token is invalid" }, { status: 401 });
    }
  } else {
    const parsed = await readJsonBodyWithLimit<unknown>(context.request, 16 * 1024);
    if (!parsed.ok) return parsed.response;
    const payload = parseObjectPayload<SiwfPayload>(parsed.value, ["nonce", "message", "signature", "fid"]);
    if (!payload.ok) return payload.response;
    const nonce = typeof payload.payload.nonce === "string" ? payload.payload.nonce.trim() : "";
    const message = typeof payload.payload.message === "string" ? payload.payload.message : "";
    const signature = typeof payload.payload.signature === "string" ? payload.payload.signature : "";
    const suppliedFid = payload.payload.fid == null ? null : Number(payload.payload.fid);
    if (!nonce || !message || !/^0x[a-f0-9]+$/i.test(signature) || (suppliedFid != null && (!Number.isInteger(suppliedFid) || suppliedFid <= 0))) {
      return jsonSecure({ error: "Farcaster sign-in proof is incomplete" }, { status: 400 });
    }
    const nonceHash = await hashAuthNonce(nonce);
    const row = await context.env.WARPLETS.prepare(
      "SELECT domain, uri, expires_at, consumed_at FROM farcaster_auth_nonces WHERE nonce_hash = ? LIMIT 1",
    ).bind(nonceHash).first<NonceRow>();
    const requestUrl = new URL(context.request.url);
    if (!row || !isUsableStoredNonce(row) || row.domain !== requestUrl.host) {
      return jsonSecure({ error: "Farcaster sign-in challenge is expired, consumed, or does not match" }, { status: 401 });
    }
    let verification: Awaited<ReturnType<ReturnType<typeof createAppClient>["verifySignInMessage"]>>;
    try {
      verification = await createAppClient({ ethereum: viemConnector() }).verifySignInMessage({
        nonce,
        domain: row.domain,
        message,
        signature: signature as `0x${string}`,
      });
    } catch {
      return jsonSecure({ error: "Farcaster signature could not be verified" }, { status: 401 });
    }
    let signedUri: string | null = null;
    try {
      signedUri = new URL(String(verification.data.uri)).href;
    } catch {
      signedUri = null;
    }
    if (!verification.success || !Number.isInteger(Number(verification.fid)) || Number(verification.fid) <= 0) {
      return jsonSecure({ error: "Farcaster signed identity is invalid" }, { status: 401 });
    }
    if (suppliedFid != null && suppliedFid !== Number(verification.fid)) {
      return jsonSecure({ error: "Farcaster signed identity did not match the requested account" }, { status: 401 });
    }
    if (!signedUri || signedUri !== new URL(row.uri).href) {
      return jsonSecure({ error: "Farcaster sign-in URL did not match this application" }, { status: 401 });
    }
    const consumed = await context.env.WARPLETS.prepare(
      "UPDATE farcaster_auth_nonces SET consumed_at = ? WHERE nonce_hash = ? AND consumed_at IS NULL",
    ).bind(new Date().toISOString(), nonceHash).run();
    if ((consumed.meta.changes ?? 0) !== 1) {
      return jsonSecure({ error: "Farcaster sign-in challenge has already been used" }, { status: 409 });
    }
    fid = Number(verification.fid);
  }

  if (!Number.isInteger(fid) || Number(fid) <= 0) {
    return jsonSecure({ error: "Farcaster identity is invalid" }, { status: 401 });
  }
  const { session, cookie } = await createOrMergeAppSession(context.request, context.env, {
    farcasterFid: Number(fid),
    farcasterSignerUuid: null,
  });
  const actionSessionToken = context.env.ACTION_SESSION_SECRET
    ? await createActionSessionToken(context.env.ACTION_SESSION_SECRET, Number(fid), 3600)
    : null;
  const profile = await loadFarcasterProfile(context.env, Number(fid));
  return jsonSecure(
    {
      farcasterFid: session.farcasterFid,
      username: profile.username,
      displayName: profile.displayName,
      pfpUrl: profile.pfpUrl,
      walletAddress: session.walletAddress,
      expiresAt: session.expiresAt,
      actionSessionToken,
    },
    { headers: { "set-cookie": cookie } },
  );
};
