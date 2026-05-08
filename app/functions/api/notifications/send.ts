/**
 * POST /api/notifications/send
 *
 * Admin endpoint to dispatch notifications to one or more FIDs.
 * Requires x-admin-token header matching ADMIN_NOTIFY_TEST_TOKEN secret.
 *
 * Request body:
 *   fids?:           number[]  — specific FIDs to target (omit for all enabled)
 *   title:           string    — max 32 chars
 *   body:            string    — max 128 chars
 *   targetUrl?:      string    — defaults to https://app.10x.meme
 *   notificationId?: string    — max 128 chars, auto-generated if omitted
 *
 * Response body:
 *   { total, results: { fid, state }[] }
 */

import { dispatchNotification } from "../../_lib/dispatch.js";
import {
  getDefaultLaunchUrl,
  normalizeNotificationAudienceSlug,
  normalizeAppSlug,
  type AppSlug,
} from "../../_lib/appSlug.js";
import {
  getClientIp,
  jsonSecure,
  logSecurityEvent,
  rateLimit,
  readJsonBody,
  requireAdminScope,
} from "../../_lib/security.js";

interface Env {
  WARPLETS: D1Database;
  WARPLETS_KV: KVNamespace;
  ADMIN_NOTIFY_TEST_TOKEN?: string;
  ADMIN_API_KEYS_JSON?: string;
}

interface RequestBody {
  fids?: number[];
  title: string;
  body: string;
  targetUrl?: string;
  notificationId?: string;
  appSlug?: string;
}

interface TokenRow {
  fid: number;
  app_slug: string;
  notification_url: string;
  notification_token: string;
}

function withQueryParam(url: string, key: string, value: string): string {
  const parsed = new URL(url);
  parsed.searchParams.set(key, value);
  return parsed.toString();
}

function buildNotificationId(appSlug: string, rawNotificationId?: string): string {
  const base = (rawNotificationId ?? `campaign-${Date.now()}`).slice(0, 120);
  return `${appSlug}:${base}`.slice(0, 128);
}

export const onRequestPost: PagesFunction<Env> = async (context) => {
  const auth = await requireAdminScope(context, { scope: "notify:send" });
  if (!auth.ok) {
    return auth.response;
  }

  const ip = getClientIp(context.request);
  const adminRate = await rateLimit(context.env.WARPLETS_KV, "admin-send", auth.keyId, 12, 60);
  if (!adminRate.allowed) {
    const response = jsonSecure({ error: "Rate limit exceeded" }, { status: 429 });
    response.headers.set("retry-after", String(adminRate.retryAfterSeconds));
    return response;
  }

  const ipRate = await rateLimit(context.env.WARPLETS_KV, "admin-send-ip", ip, 25, 60);
  if (!ipRate.allowed) {
    const response = jsonSecure({ error: "Rate limit exceeded" }, { status: 429 });
    response.headers.set("retry-after", String(ipRate.retryAfterSeconds));
    return response;
  }

  const parsedBody = await readJsonBody<RequestBody>(context.request);
  if (!parsedBody.ok) {
    return parsedBody.response;
  }
  const json = parsedBody.value;

  if (!json.title || !json.body) {
    return jsonSecure({ error: "title and body are required" }, { status: 400 });
  }

  const title = json.title.slice(0, 32);
  const body = json.body.slice(0, 128);
  const audienceSlug = normalizeNotificationAudienceSlug(json.appSlug, "app");
  const notificationId = buildNotificationId(audienceSlug, json.notificationId);
  const targetBase = json.targetUrl ?? getDefaultLaunchUrl(audienceSlug === "all" ? "app" : audienceSlug);
  const targetUrl = withQueryParam(targetBase, "notificationId", notificationId);

  if (!targetUrl.startsWith("https://")) {
    return jsonSecure({ error: "targetUrl must be https" }, { status: 400 });
  }

  // Hard cap: max 100 FIDs per request (Farcaster tokens-per-request limit)
  if (Array.isArray(json.fids) && json.fids.length > 100) {
    return jsonSecure({ error: "fids array exceeds max of 100" }, { status: 400 });
  }

  // Resolve target tokens from D1
  let rows: TokenRow[];
  if (audienceSlug === "all") {
    if (Array.isArray(json.fids) && json.fids.length > 0) {
      const placeholders = json.fids.map(() => "?").join(", ");
      const result = await context.env.WARPLETS.prepare(
        `WITH ranked AS (
           SELECT
             fid,
             app_slug,
             notification_url,
             notification_token,
             updated_at,
             ROW_NUMBER() OVER (
               PARTITION BY fid
               ORDER BY
                 CASE WHEN app_slug = 'app' THEN 0 ELSE 1 END,
                 updated_at DESC
             ) AS rn
           FROM miniapp_notification_tokens
           WHERE enabled = 1 AND fid IN (${placeholders})
         )
         SELECT fid, app_slug, notification_url, notification_token
         FROM ranked
         WHERE rn = 1
         ORDER BY updated_at DESC`
      )
        .bind(...json.fids)
        .all<TokenRow>();
      rows = result.results;
    } else {
      const result = await context.env.WARPLETS.prepare(
        `WITH ranked AS (
           SELECT
             fid,
             app_slug,
             notification_url,
             notification_token,
             updated_at,
             ROW_NUMBER() OVER (
               PARTITION BY fid
               ORDER BY
                 CASE WHEN app_slug = 'app' THEN 0 ELSE 1 END,
                 updated_at DESC
             ) AS rn
           FROM miniapp_notification_tokens
           WHERE enabled = 1
         )
         SELECT fid, app_slug, notification_url, notification_token
         FROM ranked
         WHERE rn = 1
         ORDER BY updated_at DESC`
      ).all<TokenRow>();
      rows = result.results;
    }
  } else {
    if (Array.isArray(json.fids) && json.fids.length > 0) {
      const placeholders = json.fids.map(() => "?").join(", ");
      const result = await context.env.WARPLETS.prepare(
        `SELECT fid, app_slug, notification_url, notification_token
         FROM miniapp_notification_tokens
         WHERE enabled = 1 AND app_slug = ? AND fid IN (${placeholders})
         ORDER BY updated_at DESC`
      )
        .bind(audienceSlug, ...json.fids)
        .all<TokenRow>();
      rows = result.results;
    } else {
      const result = await context.env.WARPLETS.prepare(
        `SELECT fid, app_slug, notification_url, notification_token
         FROM miniapp_notification_tokens
         WHERE enabled = 1 AND app_slug = ?
         ORDER BY updated_at DESC`
      )
        .bind(audienceSlug)
        .all<TokenRow>();
      rows = result.results;
    }
  }

  if (rows.length === 0) {
    return jsonSecure({ total: 0, results: [], message: "No enabled tokens found" });
  }

  // Dispatch to each FID sequentially (could be batched for scale, fine for now)
  const results: { fid: number; state: string }[] = [];

  for (const row of rows) {
    const rowAppSlug: AppSlug = audienceSlug === "all"
      ? normalizeAppSlug(row.app_slug, "app")
      : audienceSlug;

    const result = await dispatchNotification(context.env.WARPLETS, {
      fid: row.fid,
      appSlug: rowAppSlug,
      notificationUrl: row.notification_url,
      notificationToken: row.notification_token,
      notificationId,
      title,
      body,
      targetUrl,
    });

    results.push({ fid: row.fid, state: result.state });
  }

  const summary = results.reduce<Record<string, number>>((acc, r) => {
    acc[r.state] = (acc[r.state] ?? 0) + 1;
    return acc;
  }, {});

  await logSecurityEvent(context.env.WARPLETS, {
    eventType: "notification_send",
    outcome: "ok",
    actorType: "admin_key",
    actorId: auth.keyId,
    ipAddress: ip,
    route: new URL(context.request.url).pathname,
    details: JSON.stringify({
      audienceSlug,
      totalRows: rows.length,
      notificationId,
    }),
  });

  return jsonSecure({
    total: rows.length,
    notificationId,
    summary,
    results,
  });
};
