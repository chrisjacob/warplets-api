import { getAppSession, getRawSessionToken, sessionCookie, type AppAuthEnv } from "../../_lib/appAuth.js";
import { jsonSecure } from "../../_lib/security.js";

export const onRequestGet: PagesFunction<AppAuthEnv> = async (context) => {
  const session = await getAppSession(context.request, context.env);
  const token = session ? getRawSessionToken(context.request) : null;
  return jsonSecure({
    authenticated: Boolean(session),
    farcasterFid: session?.farcasterFid ?? null,
    walletAddress: session?.walletAddress ?? null,
    expiresAt: session?.expiresAt ?? null,
  }, token && session ? { headers: { "set-cookie": sessionCookie(context.request, token, session.expiresAt) } } : undefined);
};
