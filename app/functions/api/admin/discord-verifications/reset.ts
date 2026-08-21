import type { DiscordVerificationAdmin } from "../../../../../bots/src/discordVerificationAdmin.js";
import {
  getClientIp,
  jsonSecure,
  logSecurityEvent,
  parseObjectPayload,
  rateLimit,
  readJsonBodyWithLimit,
  requireAdminScope,
  sha256Hex,
  type SecurityEnv,
} from "../../../_lib/security.js";

interface Env extends SecurityEnv {
  CHANNEL_BOTS_ADMIN?: Service<typeof DiscordVerificationAdmin>;
}

interface ResetPayload {
  discordUserId?: unknown;
  email?: unknown;
}

export const onRequestPost: PagesFunction<Env> = async (context) => {
  const auth = await requireAdminScope(context, { scope: "discord-verification:reset" });
  if (!auth.ok) return auth.response;
  if (!context.env.CHANNEL_BOTS_ADMIN) {
    return jsonSecure({ error: "Discord verification admin service is not configured" }, { status: 503 });
  }
  const ip = getClientIp(context.request);
  const limit = await rateLimit(context.env.WARPLETS_KV, "discord-verification-reset", `${auth.keyId}:${ip}`, 10, 3600);
  if (!limit.allowed) {
    const response = jsonSecure({ error: "Too many reset attempts" }, { status: 429 });
    response.headers.set("retry-after", String(limit.retryAfterSeconds));
    return response;
  }
  const parsed = await readJsonBodyWithLimit<unknown>(context.request, 2_048);
  if (!parsed.ok) return parsed.response;
  const object = parseObjectPayload<ResetPayload>(parsed.value, ["discordUserId", "email"]);
  if (!object.ok) return object.response;
  const discordUserId = typeof object.payload.discordUserId === "string" ? object.payload.discordUserId.trim() : "";
  const email = typeof object.payload.email === "string" ? object.payload.email.trim().toLowerCase() : "";
  if (!/^\d{15,22}$/.test(discordUserId) || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 320) {
    return jsonSecure({ error: "Invalid Discord user ID or email address" }, { status: 400 });
  }
  const emailHash = await sha256Hex(email);
  try {
    const result = await context.env.CHANNEL_BOTS_ADMIN.resetDiscordVerification(discordUserId, email);
    await logSecurityEvent(context.env.WARPLETS, { logSalt: context.env.SECURITY_LOG_SALT }, {
      eventType: "discord_verification_reset",
      outcome: result.localAction,
      actorType: "admin_key",
      actorId: auth.keyId,
      ipAddress: ip,
      route: new URL(context.request.url).pathname,
      details: `discord_user_id=${discordUserId};email_sha256=${emailHash}`,
    });
    return jsonSecure(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Discord verification reset failed";
    await logSecurityEvent(context.env.WARPLETS, { logSalt: context.env.SECURITY_LOG_SALT }, {
      eventType: "discord_verification_reset",
      outcome: "failed",
      actorType: "admin_key",
      actorId: auth.keyId,
      ipAddress: ip,
      route: new URL(context.request.url).pathname,
      details: `discord_user_id=${discordUserId};email_sha256=${emailHash};error=${message}`,
    });
    console.error("Discord verification reset failed", error);
    return jsonSecure({ error: message }, { status: 409 });
  }
};
