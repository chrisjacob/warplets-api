import { getAppSession, getRawSessionToken, sessionCookie, type AppAuthEnv } from "../../_lib/appAuth.js";
import { jsonSecure } from "../../_lib/security.js";

export const onRequestGet: PagesFunction<AppAuthEnv> = async (context) => {
  const session = await getAppSession(context.request, context.env);
  const token = session ? getRawSessionToken(context.request) : null;
  const profile = session?.farcasterFid
    ? await context.env.WARPLETS.prepare(
      "SELECT username, display_name, pfp_url FROM warplets_users WHERE fid = ? LIMIT 1",
    ).bind(session.farcasterFid).first<{ username: string | null; display_name: string | null; pfp_url: string | null }>().catch(() => null)
    : null;
  return jsonSecure({
    authenticated: Boolean(session),
    farcasterFid: session?.farcasterFid ?? null,
    farcasterProfile: session?.farcasterFid ? {
      fid: session.farcasterFid,
      username: profile?.username ?? null,
      displayName: profile?.display_name ?? null,
      pfpUrl: profile?.pfp_url ?? null,
    } : null,
    walletAddress: session?.walletAddress ?? null,
    expiresAt: session?.expiresAt ?? null,
  }, token && session ? { headers: { "set-cookie": sessionCookie(context.request, token, session.expiresAt) } } : undefined);
};
