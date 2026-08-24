import { getAppSession, type AppAuthEnv } from "../../_lib/appAuth.js";
import { readEmailSocialProof } from "../../_lib/emailSocialProof.js";
import { jsonSecure, verifyActionSessionToken } from "../../_lib/security.js";

interface Env extends AppAuthEnv {
  ACTION_SESSION_SECRET?: string;
}

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const authorization = context.request.headers.get("authorization") ?? "";
  const bearer = authorization.match(/^Bearer\s+(.+)$/i)?.[1]?.trim() ?? null;
  const tokenSession = await verifyActionSessionToken(context.env.ACTION_SESSION_SECRET, bearer);
  if (bearer && !tokenSession.valid) {
    return jsonSecure({ error: "Your Farcaster session expired." }, { status: 401 });
  }

  const cookieSession = tokenSession.valid
    ? null
    : await getAppSession(context.request, context.env, { touch: false }).catch(() => null);
  const viewerFid = tokenSession.valid ? tokenSession.fid : cookieSession?.farcasterFid ?? -1;
  const socialProof = await readEmailSocialProof(context.env.WARPLETS, viewerFid, 15);
  return jsonSecure(socialProof, {
    headers: { "cache-control": viewerFid > 0 ? "private, max-age=60" : "public, max-age=300" },
  });
};
