import { createEmailIdentityClaim, type EmailIdentityEnv } from "../../_lib/emailIdentityClaims.js";
import { RESEND_DROP_SEGMENT_ID } from "../../_lib/resendIdentity.js";
import {
  getClientIp,
  jsonSecure,
  rateLimit,
  readJsonBodyWithLimit,
  verifyActionSessionToken,
} from "../../_lib/security.js";

interface Env extends EmailIdentityEnv {
  WARPLETS_KV?: KVNamespace;
  ACTION_SESSION_SECRET?: string;
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ALLOWED_ORIGINS = new Set([
  "https://10x.meme",
  "https://www.10x.meme",
  "https://app.10x.meme",
  "https://drop.10x.meme",
  "https://drop-dev.10x.meme",
  "https://web-dev.10x.meme",
]);

function corsHeaders(request: Request): Headers {
  const headers = new Headers();
  const origin = request.headers.get("origin") ?? "";
  if (ALLOWED_ORIGINS.has(origin)) headers.set("access-control-allow-origin", origin);
  headers.set("access-control-allow-methods", "POST,OPTIONS");
  headers.set("access-control-allow-headers", "content-type");
  headers.set("vary", "Origin");
  return headers;
}

export const onRequestOptions: PagesFunction<Env> = async ({ request }) =>
  new Response(null, { status: 204, headers: corsHeaders(request) });

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const headers = corsHeaders(request);
  const parsed = await readJsonBodyWithLimit<unknown>(request, 8 * 1024);
  if (!parsed.ok) return parsed.response;
  if (!parsed.value || typeof parsed.value !== "object" || Array.isArray(parsed.value)) {
    return jsonSecure({ error: "A valid email is required." }, { status: 400, headers });
  }
  const body = parsed.value as Record<string, unknown>;
  const allowedKeys = new Set(["email", "fid", "username", "tokenId", "matched", "sessionToken"]);
  if (Object.keys(body).some((key) => !allowedKeys.has(key))) {
    return jsonSecure({ error: "Unexpected fields in request." }, { status: 400, headers });
  }
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  if (!email || email.length > 254 || !EMAIL_PATTERN.test(email)) {
    return jsonSecure({ error: "A valid email is required." }, { status: 400, headers });
  }

  const sessionToken = typeof body.sessionToken === "string" ? body.sessionToken.trim() : null;
  const session = await verifyActionSessionToken(env.ACTION_SESSION_SECRET, sessionToken);
  const fid = session.valid ? session.fid : null;
  const profile = fid
    ? await env.WARPLETS.prepare("SELECT username FROM warplets_users WHERE fid = ? LIMIT 1")
      .bind(fid).first<{ username: string | null }>().catch(() => null)
    : null;
  const [ipRate, emailRate, identityRate] = await Promise.all([
    rateLimit(env.WARPLETS_KV, "drop-email-claim-ip", getClientIp(request), 10, 60 * 60),
    rateLimit(env.WARPLETS_KV, "drop-email-claim-email", email, 3, 60 * 60),
    fid
      ? rateLimit(env.WARPLETS_KV, "drop-email-claim-fid", String(fid), 6, 60 * 60)
      : Promise.resolve({ allowed: true, remaining: 1, retryAfterSeconds: 0 }),
  ]);
  const denied = [ipRate, emailRate, identityRate].find((result) => !result.allowed);
  if (denied) {
    const response = jsonSecure({ error: "Please wait before trying again." }, { status: 429, headers });
    response.headers.set("retry-after", String(denied.retryAfterSeconds));
    return response;
  }

  try {
    await createEmailIdentityClaim({
      env,
      requestUrl: request.url,
      email,
      source: "drop",
      segmentId: RESEND_DROP_SEGMENT_ID,
      identity: {
        farcasterFid: fid,
        farcasterUsername: profile?.username ?? null,
      },
      dropRewardEligible: Boolean(fid),
    });
  } catch (error) {
    console.error("Drop confirmation request failed", error);
    return jsonSecure(
      { error: "We could not send the confirmation email. Please try again." },
      { status: 503, headers },
    );
  }

  return jsonSecure({
    success: true,
    alreadyVerified: false,
    verificationEmailSent: true,
    pendingConfirmation: true,
  }, { status: 202, headers });
};
