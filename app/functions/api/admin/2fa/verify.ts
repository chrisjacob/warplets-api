import {
  createAdminSessionToken,
  getClientIp,
  jsonSecure,
  logSecurityEvent,
  rateLimit,
  readJsonBodyWithLimit,
  requireAdminScope,
  sha256Hex,
} from "../../../_lib/security.js";

interface Env {
  WARPLETS?: D1Database;
  WARPLETS_KV?: KVNamespace;
  ADMIN_API_KEYS_JSON?: string;
  ACTION_SESSION_SECRET?: string;
  SECURITY_LOG_SALT?: string;
}

type VerifyBody = {
  nonce?: unknown;
  code?: unknown;
};

const ADMIN_SESSION_TTL_SECONDS = 1800;

function cleanCode(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const code = value.replace(/\D/g, "");
  return /^\d{6}$/.test(code) ? code : null;
}

export const onRequestPost: PagesFunction<Env> = async (context) => {
  const auth = await requireAdminScope(context, { scope: "notify:inspect", require2fa: false });
  if (!auth.ok) return auth.response;

  if (!context.env.WARPLETS_KV) {
    return jsonSecure({ error: "2FA storage is not configured" }, { status: 503 });
  }

  const parsed = await readJsonBodyWithLimit<VerifyBody>(context.request, 1024);
  if (!parsed.ok) return parsed.response;

  const nonce = typeof parsed.value.nonce === "string" ? parsed.value.nonce.trim() : "";
  const code = cleanCode(parsed.value.code);
  if (!nonce || !code) {
    return jsonSecure({ error: "Invalid code" }, { status: 400 });
  }

  const ip = getClientIp(context.request);
  const rate = await rateLimit(context.env.WARPLETS_KV, "admin-2fa-verify", `${auth.keyId}:${ip}:${nonce}`, 6, 600);
  if (!rate.allowed) {
    const response = jsonSecure({ error: "Too many code attempts" }, { status: 429 });
    response.headers.set("retry-after", String(rate.retryAfterSeconds));
    return response;
  }

  const record = await context.env.WARPLETS_KV.get(`admin-2fa:${nonce}`, "json") as {
    keyId?: unknown;
    codeHash?: unknown;
    expiresAt?: unknown;
  } | null;

  if (
    !record ||
    record.keyId !== auth.keyId ||
    typeof record.codeHash !== "string" ||
    typeof record.expiresAt !== "number" ||
    record.expiresAt < Date.now()
  ) {
    return jsonSecure({ error: "Invalid or expired code" }, { status: 401 });
  }

  const codeHash = await sha256Hex(`admin-2fa:v1:${nonce}:${code}`);
  if (codeHash !== record.codeHash) {
    await logSecurityEvent(context.env.WARPLETS, { logSalt: context.env.SECURITY_LOG_SALT }, {
      eventType: "admin_2fa",
      outcome: "invalid_code",
      actorType: "admin_key",
      actorId: auth.keyId,
      ipAddress: ip,
      route: new URL(context.request.url).pathname,
    });
    return jsonSecure({ error: "Invalid or expired code" }, { status: 401 });
  }

  await context.env.WARPLETS_KV.delete(`admin-2fa:${nonce}`);
  const sessionToken = await createAdminSessionToken(
    context.env.ACTION_SESSION_SECRET,
    auth.keyId,
    ADMIN_SESSION_TTL_SECONDS
  );
  if (!sessionToken) {
    return jsonSecure({ error: "Admin session signing is not configured" }, { status: 503 });
  }

  await logSecurityEvent(context.env.WARPLETS, { logSalt: context.env.SECURITY_LOG_SALT }, {
    eventType: "admin_2fa",
    outcome: "verified",
    actorType: "admin_key",
    actorId: auth.keyId,
    ipAddress: ip,
    route: new URL(context.request.url).pathname,
  });

  return jsonSecure({
    ok: true,
    sessionToken,
    expiresInSeconds: ADMIN_SESSION_TTL_SECONDS,
  });
};
