import { outboundFetch } from "../../../_lib/outbound.js";
import {
  getClientIp,
  jsonSecure,
  logSecurityEvent,
  maskEmailAddress,
  rateLimit,
  requireAdminScope,
  sha256Hex,
} from "../../../_lib/security.js";

interface Env {
  WARPLETS?: D1Database;
  WARPLETS_KV?: KVNamespace;
  ADMIN_API_KEYS_JSON?: string;
  ACTION_SESSION_SECRET?: string;
  SECURITY_LOG_SALT?: string;
  RESEND_API_KEY?: string;
  RESEND_FROM_EMAIL?: string;
  ADMIN_2FA_EMAIL?: string;
}

const ADMIN_2FA_TTL_SECONDS = 600;

function getAdminEmail(env: Env): string {
  return env.ADMIN_2FA_EMAIL?.trim() || "chris@10x.meme";
}

function createCode(): string {
  const bytes = new Uint8Array(4);
  crypto.getRandomValues(bytes);
  const value = ((bytes[0] << 24) | (bytes[1] << 16) | (bytes[2] << 8) | bytes[3]) >>> 0;
  return String(value % 1000000).padStart(6, "0");
}

export const onRequestPost: PagesFunction<Env> = async (context) => {
  const auth = await requireAdminScope(context, { scope: "notify:inspect", require2fa: false });
  if (!auth.ok) return auth.response;

  const ip = getClientIp(context.request);
  const rate = await rateLimit(context.env.WARPLETS_KV, "admin-2fa-request", `${auth.keyId}:${ip}`, 5, 600);
  if (!rate.allowed) {
    const response = jsonSecure({ error: "Too many code requests" }, { status: 429 });
    response.headers.set("retry-after", String(rate.retryAfterSeconds));
    return response;
  }

  const resendApiKey = context.env.RESEND_API_KEY?.trim();
  if (!resendApiKey) {
    return jsonSecure({ error: "Email provider is not configured" }, { status: 503 });
  }
  if (!context.env.WARPLETS_KV) {
    return jsonSecure({ error: "2FA storage is not configured" }, { status: 503 });
  }

  const email = getAdminEmail(context.env);
  const code = createCode();
  const nonce = crypto.randomUUID();
  const codeHash = await sha256Hex(`admin-2fa:v1:${nonce}:${code}`);
  await context.env.WARPLETS_KV.put(
    `admin-2fa:${nonce}`,
    JSON.stringify({
      keyId: auth.keyId,
      codeHash,
      expiresAt: Date.now() + ADMIN_2FA_TTL_SECONDS * 1000,
    }),
    { expirationTtl: ADMIN_2FA_TTL_SECONDS }
  );

  const fromEmail = context.env.RESEND_FROM_EMAIL?.trim() || "10X Admin <10x@10x.meme>";
  const response = await outboundFetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      Authorization: `Bearer ${resendApiKey}`,
    },
    body: JSON.stringify({
      from: fromEmail,
      to: [email],
      subject: "Your 10X admin login code",
      html: `<p>Your 10X admin login code is:</p><p style="font-size:24px;font-weight:700;letter-spacing:4px">${code}</p><p>This code expires in 10 minutes.</p>`,
    }),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    await logSecurityEvent(context.env.WARPLETS, { logSalt: context.env.SECURITY_LOG_SALT }, {
      eventType: "admin_2fa",
      outcome: "send_failed",
      actorType: "admin_key",
      actorId: auth.keyId,
      ipAddress: ip,
      route: new URL(context.request.url).pathname,
      details: text || response.statusText,
    });
    return jsonSecure({ error: "Failed to send login code" }, { status: 502 });
  }

  await logSecurityEvent(context.env.WARPLETS, { logSalt: context.env.SECURITY_LOG_SALT }, {
    eventType: "admin_2fa",
    outcome: "code_sent",
    actorType: "admin_key",
    actorId: auth.keyId,
    ipAddress: ip,
    route: new URL(context.request.url).pathname,
  });

  return jsonSecure({
    ok: true,
    nonce,
    email: maskEmailAddress(email),
    expiresInSeconds: ADMIN_2FA_TTL_SECONDS,
  });
};
