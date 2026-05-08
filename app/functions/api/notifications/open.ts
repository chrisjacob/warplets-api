/**
 * POST /api/notifications/open
 *
 * Records that a user opened the Mini App via a notification.
 * Called fire-and-forget from App.tsx when `sdk.context.location.type === "notification"`.
 *
 * Body: { notificationId: string; fid?: number }
 * No auth required — source is trusted miniapp context.
 */

import { normalizeAppSlug, resolveAppSlugFromUrl } from "../../_lib/appSlug.js";
import {
  getClientIp,
  jsonSecure,
  logSecurityEvent,
  rateLimit,
  readJsonBodyWithLimit,
  verifyActionSessionToken,
} from "../../_lib/security.js";

interface Env {
  WARPLETS: D1Database;
  WARPLETS_KV?: KVNamespace;
  SECURITY_LOG_SALT?: string;
  ACTION_SESSION_SECRET?: string;
  ALLOW_INSECURE_ACTION_FID_FALLBACK?: string;
}

interface RequestBody {
  notificationId?: unknown;
  fid?: unknown;
  appSlug?: unknown;
  sessionToken?: unknown;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function hasOnlyAllowedKeys(value: Record<string, unknown>, allowedKeys: string[]): boolean {
  return Object.keys(value).every((key) => allowedKeys.includes(key));
}

export const onRequestPost: PagesFunction<Env> = async (context) => {
  const ip = getClientIp(context.request);
  const ipRate = await rateLimit(context.env.WARPLETS_KV, "notification-open-ip", ip, 90, 60);
  if (!ipRate.allowed) {
    await logSecurityEvent(context.env.WARPLETS, { logSalt: context.env.SECURITY_LOG_SALT }, {
      eventType: "rate_limit",
      outcome: "notification_open_rate_limited",
      actorType: "ip",
      ipAddress: ip,
      route: new URL(context.request.url).pathname,
    });
    const response = jsonSecure({ error: "Rate limit exceeded" }, { status: 429 });
    response.headers.set("retry-after", String(ipRate.retryAfterSeconds));
    return response;
  }

  const parsed = await readJsonBodyWithLimit<unknown>(context.request, 4 * 1024);
  if (!parsed.ok) {
    return parsed.response;
  }
  if (!isPlainObject(parsed.value)) {
    return jsonSecure({ error: "Invalid JSON payload" }, { status: 400 });
  }
  if (!hasOnlyAllowedKeys(parsed.value, ["notificationId", "fid", "appSlug", "sessionToken"])) {
    return jsonSecure({ error: "Unexpected fields in payload" }, { status: 400 });
  }
  const body = parsed.value as RequestBody;

  const notificationId = typeof body.notificationId === "string" ? body.notificationId.trim() : null;
  if (!notificationId) {
    return jsonSecure({ error: "notificationId is required" }, { status: 400 });
  }

  const requestUrl = new URL(context.request.url);
  const allowInsecureFallback =
    context.env.ALLOW_INSECURE_ACTION_FID_FALLBACK === "1" &&
    (
      requestUrl.hostname.includes("-local.") ||
      requestUrl.hostname.includes("-dev.") ||
      requestUrl.hostname.endsWith(".pages.dev")
    );
  const sessionToken = typeof body.sessionToken === "string" && body.sessionToken.trim().length > 0
    ? body.sessionToken.trim()
    : null;
  const session = await verifyActionSessionToken(context.env.ACTION_SESSION_SECRET, sessionToken);
  const bodyFid = typeof body.fid === "number" && Number.isInteger(body.fid) && body.fid > 0 ? body.fid : null;
  const fid = session.valid ? session.fid : (allowInsecureFallback ? bodyFid : null);
  if (!session.valid && bodyFid && !allowInsecureFallback) {
    await logSecurityEvent(context.env.WARPLETS, { logSalt: context.env.SECURITY_LOG_SALT }, {
      eventType: "notification_open_auth",
      outcome: session.reason,
      actorType: "ip",
      ipAddress: ip,
      route: requestUrl.pathname,
      details: "fid_rejected_without_valid_session",
    });
  }
  const appSlug = normalizeAppSlug(body.appSlug, resolveAppSlugFromUrl(new URL(context.request.url)));

  const idempotencyKey = `${notificationId}:${fid ?? "anon"}:${appSlug ?? "app"}`;
  const openKeyRate = await rateLimit(context.env.WARPLETS_KV, "notification-open-idempotency", idempotencyKey, 1, 600);
  if (!openKeyRate.allowed) {
    return jsonSecure({ ok: true, deduplicated: true });
  }

  await context.env.WARPLETS.prepare(
    `INSERT INTO notification_opens (notification_id, fid, app_slug) VALUES (?, ?, ?)`
  )
    .bind(notificationId, fid, appSlug)
    .run();

  return jsonSecure({ ok: true });
};
