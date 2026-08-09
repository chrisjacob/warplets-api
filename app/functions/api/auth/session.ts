import { getAppSession, getRawSessionToken, sessionCookie, type AppAuthEnv } from "../../_lib/appAuth.js";
import { createActionSessionToken, jsonSecure } from "../../_lib/security.js";

interface Env extends AppAuthEnv { ACTION_SESSION_SECRET?: string }

function profileString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized && normalized.toLowerCase() !== "undefined" && normalized.toLowerCase() !== "null"
    ? normalized
    : null;
}

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const session = await getAppSession(context.request, context.env);
  const token = session ? getRawSessionToken(context.request) : null;
  const profile = session?.farcasterFid
    ? await context.env.WARPLETS.prepare(
      "SELECT username, display_name, pfp_url FROM warplets_users WHERE fid = ? LIMIT 1",
    ).bind(session.farcasterFid).first<{ username: string | null; display_name: string | null; pfp_url: string | null }>().catch(() => null)
    : null;
  const actionSessionToken = session?.farcasterFid && context.env.ACTION_SESSION_SECRET
    ? await createActionSessionToken(context.env.ACTION_SESSION_SECRET, session.farcasterFid, 3600)
    : null;
  return jsonSecure({
    authenticated: Boolean(session),
    farcasterFid: session?.farcasterFid ?? null,
    farcasterProfile: session?.farcasterFid ? {
      fid: session.farcasterFid,
      username: profileString(profile?.username),
      displayName: profileString(profile?.display_name),
      pfpUrl: profileString(profile?.pfp_url),
    } : null,
    walletAddress: session?.walletAddress ?? null,
    expiresAt: session?.expiresAt ?? null,
    actionSessionToken,
  }, token && session ? { headers: { "set-cookie": sessionCookie(context.request, token, session.expiresAt) } } : undefined);
};
