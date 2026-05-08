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
import { getClientIp, jsonSecure, logSecurityEvent, rateLimit, readJsonBodyWithLimit } from "../../_lib/security.js";

interface Env {
  WARPLETS: D1Database;
  WARPLETS_KV?: KVNamespace;
}

interface RequestBody {
  notificationId?: unknown;
  fid?: unknown;
  appSlug?: unknown;
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
    await logSecurityEvent(context.env.WARPLETS, {
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
  if (!hasOnlyAllowedKeys(parsed.value, ["notificationId", "fid", "appSlug"])) {
    return jsonSecure({ error: "Unexpected fields in payload" }, { status: 400 });
  }
  const body = parsed.value as RequestBody;

  const notificationId = typeof body.notificationId === "string" ? body.notificationId.trim() : null;
  if (!notificationId) {
    return jsonSecure({ error: "notificationId is required" }, { status: 400 });
  }

  const fid = typeof body.fid === "number" ? body.fid : null;
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
