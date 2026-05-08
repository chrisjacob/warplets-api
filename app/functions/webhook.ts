/**
 * POST /webhook and /webhook/:appSlug
 *
 * Receives Farcaster Mini App webhook events, verifies the JFS signature
 * using @farcaster/miniapp-node (via Neynar hub), persists token lifecycle
 * changes to D1, and logs every raw event for audit and replay.
 *
 * Handles: miniapp_added, miniapp_removed, notifications_enabled, notifications_disabled
 */

import {
  ParseWebhookEvent,
  parseWebhookEvent,
  createVerifyAppKeyWithHub,
} from "@farcaster/miniapp-node";
import { AppSlug, normalizeAppSlug, resolveAppSlugFromAppFid } from "./_lib/appSlug.js";
import { jsonSecure } from "./_lib/security.js";

interface NotificationDetails { token: string; url: string; }

export interface Env {
  WARPLETS: D1Database;
  WARPLETS_KV?: KVNamespace;
  NEYNAR_API_KEY: string;
  APP_APP_FID?: string;
  DROP_APP_FID?: string;
  FIND_APP_FID?: string;
  MILLION_APP_FID?: string;
}

const WEBHOOK_MAX_AGE_MS = 10 * 60 * 1000;
const WEBHOOK_DEDUPE_TTL_SECONDS = 10 * 60;

function parseOptionalInt(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function resolveAppSlugFromWebhookPath(url: URL): AppSlug | null {
  const segments = url.pathname
    .split("/")
    .filter(Boolean)
    .map((segment) => segment.toLowerCase());

  if (segments.length < 2 || segments[0] !== "webhook") {
    return null;
  }

  const rawSlug = segments[1];
  if (!["app", "drop", "find", "million"].includes(rawSlug)) {
    return null;
  }

  return normalizeAppSlug(rawSlug);
}

function asObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asIsoString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function extractWebhookTimestamp(payload: unknown): string | null {
  const root = asObject(payload);
  if (!root) return null;

  const direct = asIsoString(root.timestamp)
    ?? asIsoString(root.createdAt)
    ?? asIsoString(root.created_at)
    ?? asIsoString(root.eventTimestamp);
  if (direct) return direct;

  const data = asObject(root.data);
  if (!data) return null;
  return asIsoString(data.timestamp)
    ?? asIsoString(data.createdAt)
    ?? asIsoString(data.created_at);
}

function isTimestampFresh(timestampIso: string): boolean {
  const timestampMs = Date.parse(timestampIso);
  if (!Number.isFinite(timestampMs)) return true; // do not block if format is unknown
  return Math.abs(Date.now() - timestampMs) <= WEBHOOK_MAX_AGE_MS;
}

async function sha256Hex(input: string): Promise<string> {
  const payload = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", payload);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function isDuplicateWebhookEvent(kv: KVNamespace | undefined, requestJson: unknown): Promise<boolean> {
  if (!kv) return false;
  const payload = JSON.stringify(requestJson);
  const hash = await sha256Hex(payload);
  const key = `webhook:event:v1:${hash}`;
  const existing = await kv.get(key);
  if (existing) return true;
  await kv.put(key, "1", { expirationTtl: WEBHOOK_DEDUPE_TTL_SECONDS });
  return false;
}

export async function handleWebhookRequest(
  context: Parameters<PagesFunction<Env>>[0],
  appSlugFromPath?: AppSlug
): Promise<Response> {
  const { env } = context;
  const requestUrl = new URL(context.request.url);

  // Build a per-request Neynar verifier using the runtime secret (not process.env).
  const verifyAppKey = createVerifyAppKeyWithHub("https://hub-api.neynar.com", {
    headers: { "x-api-key": env.NEYNAR_API_KEY },
  });

  let requestJson: unknown;
  try {
    requestJson = await context.request.json();
  } catch {
    return jsonSecure({ success: false, error: "Invalid JSON body" }, { status: 400 });
  }

  const eventTimestamp = extractWebhookTimestamp(requestJson);
  if (eventTimestamp && !isTimestampFresh(eventTimestamp)) {
    return jsonSecure({ success: true, ignored: true, reason: "stale_event" });
  }

  if (await isDuplicateWebhookEvent(env.WARPLETS_KV, requestJson)) {
    return jsonSecure({ success: true, ignored: true, reason: "duplicate_event" });
  }

  let data: Awaited<ReturnType<typeof parseWebhookEvent>>;
  try {
    data = await parseWebhookEvent(requestJson, verifyAppKey);
  } catch (e: unknown) {
    const error = e as ParseWebhookEvent.ErrorType;
    switch (error.name) {
      case "VerifyJsonFarcasterSignature.InvalidDataError":
      case "VerifyJsonFarcasterSignature.InvalidEventDataError":
        return jsonSecure({ success: false, error: error.message }, { status: 400 });
      case "VerifyJsonFarcasterSignature.InvalidAppKeyError":
        return jsonSecure({ success: false, error: error.message }, { status: 401 });
      case "VerifyJsonFarcasterSignature.VerifyAppKeyError":
        return jsonSecure({ success: false, error: error.message }, { status: 500 });
      default:
        return jsonSecure({ success: false, error: String(e) }, { status: 500 });
    }
  }

  const { fid, appFid, event } = data;
  const pathScopedAppSlug = appSlugFromPath ?? resolveAppSlugFromWebhookPath(requestUrl);
  const appSlug = pathScopedAppSlug ?? resolveAppSlugFromAppFid(appFid, {
    app: parseOptionalInt(env.APP_APP_FID),
    drop: parseOptionalInt(env.DROP_APP_FID),
    find: parseOptionalInt(env.FIND_APP_FID),
    million: parseOptionalInt(env.MILLION_APP_FID),
  });

  // Log raw event to D1 for audit/replay (fire-and-forget, don't block response)
  const logEvent = env.WARPLETS.prepare(
    `INSERT INTO notification_webhook_events (fid, app_fid, app_slug, event, raw_payload)
     VALUES (?, ?, ?, ?, ?)`
  )
    .bind(fid, appFid ?? null, appSlug, event.event, JSON.stringify(requestJson))
    .run()
    .catch((err) => console.error("Failed to log webhook event:", err));

  // Strict isolation: ignore token lifecycle events when app_fid can't be mapped.
  const isTokenLifecycleEvent =
    event.event === "miniapp_added" ||
    event.event === "notifications_enabled" ||
    event.event === "miniapp_removed" ||
    event.event === "notifications_disabled";

  if (isTokenLifecycleEvent && !appSlug) {
    await logEvent;
    console.error("Ignoring webhook token lifecycle event with unknown app identity", {
      fid,
      appFid,
      event: event.event,
      path: requestUrl.pathname,
    });
    return Response.json({ success: true, ignored: true, reason: "unknown_app_fid" });
  }

  switch (event.event) {
    case "miniapp_added":
    case "notifications_enabled": {
      const details = (event as { notificationDetails?: NotificationDetails }).notificationDetails;
      if (details?.token && details?.url) {
        await env.WARPLETS.prepare(
          `INSERT INTO miniapp_notification_tokens (fid, app_fid, app_slug, notification_url, notification_token, enabled)
           VALUES (?, ?, ?, ?, ?, 1)
           ON CONFLICT(fid, app_slug) DO UPDATE SET
             app_fid = excluded.app_fid,
             notification_url = excluded.notification_url,
             notification_token = excluded.notification_token,
             enabled = 1,
             updated_at = datetime('now')`
        )
          .bind(fid, appFid ?? null, appSlug, details.url, details.token)
          .run();
      }
      break;
    }

    case "miniapp_removed":
    case "notifications_disabled": {
      await env.WARPLETS.prepare(
        `UPDATE miniapp_notification_tokens
         SET enabled = 0, updated_at = datetime('now')
         WHERE fid = ? AND app_slug = ?`
      )
        .bind(fid, appSlug)
        .run();
      break;
    }

    default:
      break;
  }

  // Await the log write last so it doesn't delay the 200 response
  await logEvent;

  return jsonSecure({ success: true });
};

export const onRequestPost: PagesFunction<Env> = async (context) => {
  return handleWebhookRequest(context);
};
