import { getAppSession, type AppAuthEnv } from "../../_lib/appAuth.js";
import {
  createEmailIdentityClaim,
  emailAudienceMutationsEnabled,
  type EmailIdentityEnv,
} from "../../_lib/emailIdentityClaims.js";
import { RESEND_10X_SEGMENT_ID } from "../../_lib/resendIdentity.js";
import {
  getClientIp,
  jsonSecure,
  rateLimit,
  readJsonBodyWithLimit,
  verifyActionSessionToken,
} from "../../_lib/security.js";

interface Env extends AppAuthEnv, EmailIdentityEnv {
  WARPLETS_KV?: KVNamespace;
  ACTION_SESSION_SECRET?: string;
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ALLOWED_ORIGINS = new Set([
  "https://10x.meme",
  "https://www.10x.meme",
  "https://app.10x.meme",
  "https://warplet.10x.meme",
  "https://web-dev.10x.meme",
  "https://app-dev.10x.meme",
  "https://warplet-dev.10x.meme",
]);

function corsHeaders(request: Request): Headers {
  const headers = new Headers();
  const origin = request.headers.get("origin") ?? "";
  if (ALLOWED_ORIGINS.has(origin)) headers.set("access-control-allow-origin", origin);
  headers.set("access-control-allow-methods", "POST,OPTIONS");
  headers.set("access-control-allow-headers", "authorization,content-type");
  headers.set("vary", "Origin");
  return headers;
}

function limited(headers: Headers, retryAfterSeconds: number): Response {
  const response = jsonSecure(
    { error: "Please wait before trying again." },
    { status: 429, headers },
  );
  response.headers.set("retry-after", String(retryAfterSeconds));
  return response;
}

export const onRequestOptions: PagesFunction<Env> = async ({ request }) =>
  new Response(null, { status: 204, headers: corsHeaders(request) });

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const headers = corsHeaders(request);
  const parsed = await readJsonBodyWithLimit<unknown>(request, 4 * 1024);
  if (!parsed.ok) return parsed.response;
  if (!parsed.value || typeof parsed.value !== "object" || Array.isArray(parsed.value)) {
    return jsonSecure({ error: "A valid email is required." }, { status: 400, headers });
  }
  const body = parsed.value as Record<string, unknown>;
  if (Object.keys(body).some((key) => key !== "email")) {
    return jsonSecure({ error: "Unexpected fields in request." }, { status: 400, headers });
  }
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  if (!email || email.length > 254 || !EMAIL_PATTERN.test(email)) {
    return jsonSecure({ error: "A valid email is required." }, { status: 400, headers });
  }
  if (!emailAudienceMutationsEnabled(env)) {
    return jsonSecure(
      { error: "Email signup is disabled in this development environment." },
      { status: 503, headers },
    );
  }

  const authorization = request.headers.get("authorization") ?? "";
  const bearer = authorization.match(/^Bearer\s+(.+)$/i)?.[1]?.trim() ?? null;
  const tokenSession = await verifyActionSessionToken(env.ACTION_SESSION_SECRET, bearer);
  if (bearer && !tokenSession.valid) {
    return jsonSecure({ error: "Your Farcaster session expired. Reopen the app and try again." }, { status: 401, headers });
  }

  const cookieSession = await getAppSession(request, env, { touch: false }).catch(() => null);
  const farcasterFid = tokenSession.valid ? tokenSession.fid : cookieSession?.farcasterFid ?? null;
  const walletAddress = cookieSession && (
    farcasterFid == null || cookieSession.farcasterFid === farcasterFid
  ) ? cookieSession.walletAddress : null;
  const ip = getClientIp(request);
  const [ipRate, emailRate, sessionRate] = await Promise.all([
    rateLimit(env.WARPLETS_KV, "email-claim-ip", ip, 10, 60 * 60),
    rateLimit(env.WARPLETS_KV, "email-claim-email", email, 3, 60 * 60),
    cookieSession
      ? rateLimit(env.WARPLETS_KV, "email-claim-session", cookieSession.sessionHash, 6, 60 * 60)
      : farcasterFid
        ? rateLimit(env.WARPLETS_KV, "email-claim-fid", String(farcasterFid), 6, 60 * 60)
      : Promise.resolve({ allowed: true, remaining: 1, retryAfterSeconds: 0 }),
  ]);
  const denied = [ipRate, emailRate, sessionRate].find((result) => !result.allowed);
  if (denied) return limited(headers, denied.retryAfterSeconds);

  const profile = farcasterFid
    ? await env.WARPLETS.prepare(
      "SELECT username FROM warplets_users WHERE fid = ? LIMIT 1",
    ).bind(farcasterFid).first<{ username: string | null }>().catch(() => null)
    : null;

  try {
    await createEmailIdentityClaim({
      env,
      requestUrl: request.url,
      email,
      source: "10x",
      segmentId: RESEND_10X_SEGMENT_ID,
      identity: {
        farcasterFid,
        farcasterUsername: profile?.username ?? null,
        wallet: walletAddress,
      },
      dropRewardEligible: false,
    });
  } catch (error) {
    console.error("10X confirmation request failed", error);
    return jsonSecure(
      { error: "We could not send the confirmation email. Please try again." },
      { status: 503, headers },
    );
  }

  return jsonSecure({
    success: true,
    pendingConfirmation: true,
    message: "Check your inbox to confirm your subscription.",
  }, { status: 202, headers });
};
