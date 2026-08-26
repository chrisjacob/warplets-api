/**
 * POST /api/notifications/send
 *
 * Admin endpoint to dispatch notifications to one or more FIDs.
 * Requires x-admin-token header matching a scoped admin key in ADMIN_API_KEYS_JSON.
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

import { dispatchNotificationBatch } from "../../_lib/dispatch.js";
import {
  resolveBaseNotificationConfig,
  sendBaseNotificationCampaign,
  type BaseNotificationsEnv,
} from "../../_lib/baseNotifications.js";
import {
  sendWebPushNotification,
  type WebPushEnv,
  type WebPushSubscriptionRow,
} from "../../_lib/webPush.js";
import {
  getDefaultLaunchUrl,
  normalizeNotificationAudienceSlug,
  normalizeAppSlug,
  resolveAppSlugFromUrl,
  type AppSlug,
} from "../../_lib/appSlug.js";
import { buildClickTrackingUrl } from "../../_lib/notificationTracking.js";
import {
  getClientIp,
  jsonSecure,
  logSecurityEvent,
  rateLimit,
  readJsonBodyWithLimit,
  requireAdminScope,
} from "../../_lib/security.js";
import { WARPLETS_APP_SLUG } from "../../../shared/warpletsApp.js";

interface Env extends BaseNotificationsEnv, WebPushEnv {
  WARPLETS: D1Database;
  WARPLETS_KV: KVNamespace;
  ADMIN_API_KEYS_JSON?: string;
  SECURITY_LOG_SALT?: string;
  BASE_NOTIFICATIONS_API_KEY?: string;
  BASE_NOTIFICATIONS_ENABLED?: string;
  BASE_APP_URL?: string;
  VAPID_PUBLIC_KEY?: string;
  VAPID_PRIVATE_KEY?: string;
  VAPID_SUBJECT?: string;
}

interface RequestBody {
  fids?: number[];
  title: string;
  body: string;
  targetUrl?: string;
  notificationId?: string;
  appSlug?: string;
  sendMode?: "all" | "batch" | "fids";
  channels?: Array<"farcaster" | "base" | "web-push">;
  wallets?: string[];
}

interface TokenRow {
  fid: number;
  app_slug: string;
  notification_url: string;
  notification_token: string;
}

interface DispatchStatusRow {
  fid: number;
  status: string;
}

interface TokenInspectRow {
  fid: number;
  app_slug: string;
  enabled: number;
  updated_at: string;
}

interface AttemptInspectRow {
  fid: number;
  result: string;
  response_status: number | null;
  error_message: string | null;
  created_at: string;
}

const BATCH_LIMIT = 100;

async function resolveWebPushRows(
  db: D1Database,
  audienceSlug: string,
  fids?: number[],
): Promise<WebPushSubscriptionRow[]> {
  const filters = [
    "enabled = 1",
    `EXISTS (
       SELECT 1 FROM json_each(web_push_subscriptions.topics_json)
        WHERE json_each.value = 'announcements'
     )`,
  ];
  const bindings: Array<string | number> = [];
  if (audienceSlug !== "all") {
    filters.push("app_slug = ?");
    bindings.push(audienceSlug);
  }
  if (fids?.length) {
    filters.push(`farcaster_fid IN (${fids.map(() => "?").join(", ")})`);
    bindings.push(...fids);
  }
  const result = await db.prepare(
    `SELECT endpoint_hash, endpoint, p256dh, auth, app_slug, farcaster_fid, wallet_address
       FROM web_push_subscriptions
      WHERE ${filters.join(" AND ")}
      ORDER BY updated_at DESC`,
  ).bind(...bindings).all<WebPushSubscriptionRow>();
  return result.results ?? [];
}

async function resolveDeliveredWebPushRecipients(db: D1Database, campaignId: string): Promise<Set<string>> {
  const result = await db.prepare(
    `SELECT recipient_key
       FROM notification_channel_deliveries
      WHERE campaign_id = ? AND channel = 'web-push' AND status = 'delivered'`,
  ).bind(campaignId).all<{ recipient_key: string }>();
  return new Set((result.results ?? []).map((row) => row.recipient_key));
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function hasOnlyAllowedKeys(value: Record<string, unknown>, allowedKeys: string[]): boolean {
  return Object.keys(value).every((key) => allowedKeys.includes(key));
}

function withQueryParam(url: string, key: string, value: string): string {
  const parsed = new URL(url);
  parsed.searchParams.set(key, value);
  return parsed.toString();
}

function buildNotificationId(appSlug: string, rawNotificationId?: string): string {
  const raw = rawNotificationId?.trim();
  if (raw?.startsWith(`${appSlug}:`)) return raw.slice(0, 128);
  const base = (raw ?? `campaign-${Date.now()}`).slice(0, 120);
  return `${appSlug}:${base}`.slice(0, 128);
}

async function resolveTokenRows(
  db: D1Database,
  audienceSlug: string,
  fids?: number[]
): Promise<TokenRow[]> {
  if (audienceSlug === "all") {
    if (Array.isArray(fids) && fids.length > 0) {
      const placeholders = fids.map(() => "?").join(", ");
      const result = await db.prepare(
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
        .bind(...fids)
        .all<TokenRow>();
      return result.results;
    }

    const result = await db.prepare(
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
    return result.results;
  }

  if (Array.isArray(fids) && fids.length > 0) {
    const placeholders = fids.map(() => "?").join(", ");
    const result = await db.prepare(
      `SELECT fid, app_slug, notification_url, notification_token
       FROM miniapp_notification_tokens
       WHERE enabled = 1 AND app_slug = ? AND fid IN (${placeholders})
       ORDER BY updated_at DESC`
    )
      .bind(audienceSlug, ...fids)
      .all<TokenRow>();
    return result.results;
  }

  const result = await db.prepare(
    `SELECT fid, app_slug, notification_url, notification_token
     FROM miniapp_notification_tokens
     WHERE enabled = 1 AND app_slug = ?
     ORDER BY updated_at DESC`
  )
    .bind(audienceSlug)
    .all<TokenRow>();
  return result.results;
}

async function getDispatchStatuses(db: D1Database, notificationId: string): Promise<DispatchStatusRow[]> {
  const result = await db.prepare(
    `SELECT fid, status
     FROM notification_dispatches
     WHERE notification_id = ?`
  )
    .bind(notificationId)
    .all<DispatchStatusRow>();
  return result.results;
}

async function inspectRequestedFids(
  db: D1Database,
  fids: number[] | undefined,
  eligibleRows: TokenRow[],
  notificationId: string
) {
  if (!fids?.length) return undefined;

  const placeholders = fids.map(() => "?").join(", ");
  const [tokens, dispatches, attempts] = await Promise.all([
    db.prepare(
      `SELECT fid, app_slug, enabled, updated_at
       FROM miniapp_notification_tokens
       WHERE fid IN (${placeholders})
       ORDER BY fid, app_slug`
    )
      .bind(...fids)
      .all<TokenInspectRow>(),
    db.prepare(
      `SELECT fid, status
       FROM notification_dispatches
       WHERE notification_id = ? AND fid IN (${placeholders})`
    )
      .bind(notificationId, ...fids)
      .all<DispatchStatusRow>(),
    db.prepare(
      `SELECT a.fid, a.result, a.response_status, a.error_message, a.created_at
       FROM notification_attempts a
       INNER JOIN notification_dispatches d ON d.id = a.dispatch_id
       WHERE d.notification_id = ? AND a.fid IN (${placeholders})
       ORDER BY a.created_at DESC`
    )
      .bind(notificationId, ...fids)
      .all<AttemptInspectRow>(),
  ]);

  const eligibleFids = new Set(eligibleRows.map((row) => row.fid));
  const dispatchByFid = new Map(dispatches.results.map((row) => [row.fid, row]));
  const latestAttemptByFid = new Map<number, AttemptInspectRow>();
  for (const row of attempts.results) {
    if (!latestAttemptByFid.has(row.fid)) latestAttemptByFid.set(row.fid, row);
  }

  return fids.map((fid) => {
    const tokenRows = tokens.results.filter((row) => row.fid === fid);
    const latestAttempt = latestAttemptByFid.get(fid);
    return {
      fid,
      eligible: eligibleFids.has(fid),
      tokens: tokenRows.map((row) => ({
        appSlug: row.app_slug,
        enabled: row.enabled === 1,
        updatedAt: row.updated_at,
      })),
      dispatchStatus: dispatchByFid.get(fid)?.status ?? null,
      latestAttempt: latestAttempt
        ? {
            result: latestAttempt.result,
            responseStatus: latestAttempt.response_status,
            errorMessage: latestAttempt.error_message,
            createdAt: latestAttempt.created_at,
          }
        : null,
    };
  });
}

function buildProgress(rows: TokenRow[], dispatchRows: DispatchStatusRow[]) {
  const activeFids = new Set(rows.map((row) => row.fid));
  const counts: Record<string, number> = {};
  let alreadyDispatched = 0;

  for (const row of dispatchRows) {
    if (!activeFids.has(row.fid)) continue;
    alreadyDispatched += 1;
    counts[row.status] = (counts[row.status] ?? 0) + 1;
  }

  return {
    audience: rows.length,
    alreadyDispatched,
    unsent: Math.max(0, rows.length - alreadyDispatched),
    delivered: counts.delivered ?? 0,
    invalid: counts.invalid ?? 0,
    failed: counts.failed ?? 0,
    rateLimited: counts.rate_limited ?? 0,
    pending: counts.pending ?? 0,
  };
}

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

function parseFids(raw: string | null): number[] | undefined {
  if (!raw?.trim()) return undefined;
  const fids = raw
    .split(",")
    .map((item) => Number.parseInt(item.trim(), 10))
    .filter((fid) => Number.isFinite(fid) && fid > 0);
  return fids.length > 0 ? Array.from(new Set(fids)) : undefined;
}

async function resolveBaseWallets(db: D1Database, fids?: number[], wallets?: string[]): Promise<string[] | undefined> {
  const explicit = Array.isArray(wallets)
    ? wallets.map((wallet) => wallet.trim().toLowerCase()).filter((wallet) => /^0x[a-f0-9]{40}$/.test(wallet))
    : [];
  if (explicit.length > 0) return [...new Set(explicit)];
  if (!fids?.length) return undefined;
  const placeholders = fids.map(() => "?").join(", ");
  const result = await db.prepare(
    `SELECT lower(wallet_address) AS wallet FROM app_identity_links WHERE farcaster_fid IN (${placeholders})
     UNION
     SELECT lower(wallet) AS wallet FROM wallet_farcaster_links WHERE fid IN (${placeholders})`,
  ).bind(...fids, ...fids).all<{ wallet: string }>();
  return [...new Set(result.results.map((row) => row.wallet).filter((wallet) => /^0x[a-f0-9]{40}$/.test(wallet)))];
}

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const auth = await requireAdminScope(context, { scope: "notify:stats" });
  if (!auth.ok) {
    return auth.response;
  }

  const url = new URL(context.request.url);
  const audienceSlug = normalizeNotificationAudienceSlug(url.searchParams.get("appSlug"), "app");
  const rawNotificationId = url.searchParams.get("notificationId")?.trim();
  if (!rawNotificationId) {
    return jsonSecure({ error: "notificationId is required" }, { status: 400 });
  }

  const notificationId = buildNotificationId(audienceSlug, rawNotificationId);
  const requestedFids = parseFids(url.searchParams.get("fids"));
  const rows = await resolveTokenRows(context.env.WARPLETS, audienceSlug, requestedFids);
  const dispatchRows = await getDispatchStatuses(context.env.WARPLETS, notificationId);

  return jsonSecure({
    notificationId,
    progress: buildProgress(rows, dispatchRows),
    fidDetails: await inspectRequestedFids(context.env.WARPLETS, requestedFids, rows, notificationId),
  });
};

export const onRequestPost: PagesFunction<Env> = async (context) => {
  const auth = await requireAdminScope(context, { scope: "notify:send" });
  if (!auth.ok) {
    return auth.response;
  }

  const ip = getClientIp(context.request);
  const adminRate = await rateLimit(context.env.WARPLETS_KV, "admin-send", auth.keyId, 12, 60);
  if (!adminRate.allowed) {
    await logSecurityEvent(context.env.WARPLETS, { logSalt: context.env.SECURITY_LOG_SALT }, {
      eventType: "rate_limit",
      outcome: "admin_send_key_rate_limited",
      actorType: "admin_key",
      actorId: auth.keyId,
      ipAddress: ip,
      route: new URL(context.request.url).pathname,
    });
    const response = jsonSecure({ error: "Rate limit exceeded" }, { status: 429 });
    response.headers.set("retry-after", String(adminRate.retryAfterSeconds));
    return response;
  }

  const ipRate = await rateLimit(context.env.WARPLETS_KV, "admin-send-ip", ip, 25, 60);
  if (!ipRate.allowed) {
    await logSecurityEvent(context.env.WARPLETS, { logSalt: context.env.SECURITY_LOG_SALT }, {
      eventType: "rate_limit",
      outcome: "admin_send_ip_rate_limited",
      actorType: "ip",
      ipAddress: ip,
      route: new URL(context.request.url).pathname,
    });
    const response = jsonSecure({ error: "Rate limit exceeded" }, { status: 429 });
    response.headers.set("retry-after", String(ipRate.retryAfterSeconds));
    return response;
  }

  const parsedBody = await readJsonBodyWithLimit<unknown>(context.request, 16 * 1024);
  if (!parsedBody.ok) {
    return parsedBody.response;
  }
  if (!isPlainObject(parsedBody.value)) {
    return jsonSecure({ error: "Invalid JSON payload" }, { status: 400 });
  }
  if (!hasOnlyAllowedKeys(parsedBody.value, ["fids", "title", "body", "targetUrl", "notificationId", "appSlug", "sendMode", "channels", "wallets"])) {
    return jsonSecure({ error: "Unexpected fields in payload" }, { status: 400 });
  }
  const json = parsedBody.value as unknown as RequestBody;

  if (!json.title || !json.body) {
    return jsonSecure({ error: "title and body are required" }, { status: 400 });
  }
  if (json.fids !== undefined && !Array.isArray(json.fids)) {
    return jsonSecure({ error: "fids must be an array" }, { status: 400 });
  }
  if (json.channels !== undefined && (!Array.isArray(json.channels) || json.channels.some((channel) => channel !== "farcaster" && channel !== "base" && channel !== "web-push"))) {
    return jsonSecure({ error: "channels must contain farcaster, base, and/or web-push" }, { status: 400 });
  }
  const channels = [...new Set(json.channels?.length ? json.channels : ["farcaster"])] as Array<"farcaster" | "base" | "web-push">;
  const wantFarcaster = channels.includes("farcaster");
  const wantBase = channels.includes("base");
  const wantWebPush = channels.includes("web-push");

  const requestedFids = Array.isArray(json.fids)
    ? Array.from(new Set(json.fids.filter((fid) => Number.isInteger(fid) && fid > 0)))
    : undefined;
  if (json.sendMode === "fids" && (!requestedFids || requestedFids.length === 0)) {
    return jsonSecure({ error: "FID list mode requires at least one valid FID" }, { status: 400 });
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

  const hasFidList = Boolean(requestedFids?.length);
  const sendMode = hasFidList ? "fids" : json.sendMode === "batch" ? "batch" : "all";
  const rows = wantFarcaster ? await resolveTokenRows(context.env.WARPLETS, audienceSlug, requestedFids) : [];
  const webPushRows = wantWebPush ? await resolveWebPushRows(context.env.WARPLETS, audienceSlug, requestedFids) : [];
  const trackingAppSlug = audienceSlug === "all"
    ? resolveAppSlugFromUrl(new URL(targetUrl))
    : audienceSlug;
  const farcasterTargetUrl = buildClickTrackingUrl({
    notificationId,
    targetUrl,
    trackingBaseUrl: getDefaultLaunchUrl(trackingAppSlug),
    appSlug: trackingAppSlug,
    ...(requestedFids?.length === 1 ? { fid: requestedFids[0] } : {}),
  });

  if (rows.length === 0 && webPushRows.length === 0 && !wantBase) {
    return jsonSecure({ total: 0, results: [], message: "No enabled tokens found" });
  }

  const beforeDispatchRows = await getDispatchStatuses(context.env.WARPLETS, notificationId);
  const beforeProgress = buildProgress(rows, beforeDispatchRows);
  const alreadyDispatchedFids = new Set(beforeDispatchRows.map((row) => row.fid));
  const pendingRows = rows.filter((row) => !alreadyDispatchedFids.has(row.fid));
  const selectedRows = sendMode === "batch" ? pendingRows.slice(0, BATCH_LIMIT) : pendingRows;

  const deliveredWebPushRecipients = wantWebPush
    ? await resolveDeliveredWebPushRecipients(context.env.WARPLETS, notificationId)
    : new Set<string>();
  const pendingWebPushRows = webPushRows.filter((row) => !deliveredWebPushRecipients.has(row.endpoint_hash));
  const selectedWebPushRows = sendMode === "batch" ? pendingWebPushRows.slice(0, BATCH_LIMIT) : pendingWebPushRows;

  if (selectedRows.length === 0 && selectedWebPushRows.length === 0 && !wantBase) {
    return jsonSecure({
      total: 0,
      notificationId,
      sendMode,
      summary: { skipped_existing: rows.length },
      progress: beforeProgress,
      results: [],
      message: "No unsent enabled tokens remain for this notificationId",
    });
  }

  const rowsByUrl = selectedRows.reduce<Record<string, TokenRow[]>>((acc, row) => {
    (acc[row.notification_url] ??= []).push(row);
    return acc;
  }, {});

  const results: Array<{ channel: "farcaster" | "base" | "web-push"; fid?: number; wallet?: string; state: string; error?: unknown }> = [];

  for (const [notificationUrl, urlRows] of Object.entries(rowsByUrl)) {
    for (const batchRows of chunk(urlRows, BATCH_LIMIT)) {
      const batchResults = await dispatchNotificationBatch(context.env.WARPLETS, {
        notificationUrl,
        notificationId,
        title,
        body,
        targetUrl: farcasterTargetUrl,
        tokens: batchRows.map((row) => ({
          fid: row.fid,
          appSlug: audienceSlug === "all"
            ? normalizeAppSlug(row.app_slug, "app")
            : audienceSlug as AppSlug,
          notificationToken: row.notification_token,
        })),
      });
      results.push(...batchResults.map((result) => ({ channel: "farcaster" as const, ...result })));
    }
  }

  for (const webPushBatch of chunk(selectedWebPushRows, 20)) {
    const batchResults = await Promise.all(webPushBatch.map((subscription) => sendWebPushNotification(
      context.env,
      subscription,
      {
        campaignId: notificationId,
        appSlug: audienceSlug === "all" ? subscription.app_slug : audienceSlug as AppSlug,
        title,
        body,
        targetUrl,
      },
    )));
    results.push(...batchResults);
  }

  if (wantBase) {
    const target = new URL(targetBase);
    const baseAppSlug = audienceSlug === "all" ? WARPLETS_APP_SLUG : audienceSlug;
    const appOrigin = new URL(resolveBaseNotificationConfig(context.env, baseAppSlug).appUrl).origin;
    const targetPath = target.origin === appOrigin ? `${target.pathname}${target.search}` : "/";
    const baseWallets = await resolveBaseWallets(context.env.WARPLETS, requestedFids, json.wallets);
    const baseResults = await sendBaseNotificationCampaign(context.env, {
      campaignId: notificationId,
      appSlug: baseAppSlug,
      wallets: baseWallets,
      title,
      message: body,
      targetPath,
    });
    results.push(...baseResults.map((result) => ({
      channel: "base" as const,
      wallet: result.wallet,
      state: result.state,
      error: result.error,
    })));
  }

  const summary = results.reduce<Record<string, number>>((acc, r) => {
    acc[r.state] = (acc[r.state] ?? 0) + 1;
    return acc;
  }, {});

  const afterDispatchRows = await getDispatchStatuses(context.env.WARPLETS, notificationId);
  const afterProgress = buildProgress(rows, afterDispatchRows);

  await logSecurityEvent(context.env.WARPLETS, { logSalt: context.env.SECURITY_LOG_SALT }, {
    eventType: "notification_send",
    outcome: "ok",
    actorType: "admin_key",
    actorId: auth.keyId,
    ipAddress: ip,
    route: new URL(context.request.url).pathname,
    details: JSON.stringify({
      audienceSlug,
      totalRows: rows.length,
      selectedRows: selectedRows.length,
      selectedWebPushRows: selectedWebPushRows.length,
      channels,
      sendMode,
      notificationId,
    }),
  });

  return jsonSecure({
    total: results.length,
    channels,
    notificationId,
    sendMode,
    progress: afterProgress,
    beforeProgress,
    fidDetails: await inspectRequestedFids(context.env.WARPLETS, requestedFids, rows, notificationId),
    summary,
    results,
  });
};

