/**
 * POST /webhook
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

interface NotificationDetails { token: string; url: string; }

interface Env {
  WARPLETS: D1Database;
  NEYNAR_API_KEY: string;
}

export const onRequestPost: PagesFunction<Env> = async (context) => {
  const { env } = context;

  // Build a per-request Neynar verifier using the runtime secret (not process.env).
  const verifyAppKey = createVerifyAppKeyWithHub("https://hub-api.neynar.com", {
    headers: { "x-api-key": env.NEYNAR_API_KEY },
  });

  let requestJson: unknown;
  try {
    requestJson = await context.request.json();
  } catch {
    return Response.json({ success: false, error: "Invalid JSON body" }, { status: 400 });
  }

  let data: Awaited<ReturnType<typeof parseWebhookEvent>>;
  try {
    data = await parseWebhookEvent(requestJson, verifyAppKey);
  } catch (e: unknown) {
    const error = e as ParseWebhookEvent.ErrorType;
    switch (error.name) {
      case "VerifyJsonFarcasterSignature.InvalidDataError":
      case "VerifyJsonFarcasterSignature.InvalidEventDataError":
        return Response.json({ success: false, error: error.message }, { status: 400 });
      case "VerifyJsonFarcasterSignature.InvalidAppKeyError":
        return Response.json({ success: false, error: error.message }, { status: 401 });
      case "VerifyJsonFarcasterSignature.VerifyAppKeyError":
        return Response.json({ success: false, error: error.message }, { status: 500 });
      default:
        return Response.json({ success: false, error: String(e) }, { status: 500 });
    }
  }

  const { fid, appFid, event } = data;

  // Log raw event to D1 for audit/replay (fire-and-forget, don't block response)
  const logEvent = env.WARPLETS.prepare(
    `INSERT INTO notification_webhook_events (fid, app_fid, event, raw_payload)
     VALUES (?, ?, ?, ?)`
  )
    .bind(fid, appFid ?? null, event.event, JSON.stringify(requestJson))
    .run()
    .catch((err) => console.error("Failed to log webhook event:", err));

  switch (event.event) {
    case "miniapp_added":
    case "notifications_enabled": {
      const details = (event as { notificationDetails?: NotificationDetails }).notificationDetails;
      if (details?.token && details?.url) {
        await env.WARPLETS.prepare(
          `INSERT INTO miniapp_notification_tokens (fid, notification_url, notification_token, enabled)
           VALUES (?, ?, ?, 1)
           ON CONFLICT(fid) DO UPDATE SET
             notification_url = excluded.notification_url,
             notification_token = excluded.notification_token,
             enabled = 1,
             updated_at = datetime('now')`
        )
          .bind(fid, details.url, details.token)
          .run();
      }
      break;
    }

    case "miniapp_removed":
    case "notifications_disabled": {
      await env.WARPLETS.prepare(
        `UPDATE miniapp_notification_tokens
         SET enabled = 0, updated_at = datetime('now')
         WHERE fid = ?`
      )
        .bind(fid)
        .run();
      break;
    }

    default:
      break;
  }

  // Await the log write last so it doesn't delay the 200 response
  await logEvent;

  return Response.json({ success: true });
};
