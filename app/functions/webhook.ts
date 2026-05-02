/**
 * POST /webhook
 *
 * Receives signed JSON Farcaster Signature (JFS) events from Farcaster clients.
 * Handles: miniapp_added, miniapp_removed, notifications_enabled, notifications_disabled
 *
 * Stores/invalidates notification tokens in D1 so the app can push notifications later.
 * See: https://docs.neynar.com/miniapps/specification#adding-mini-apps
 */

interface Env {
  WARPLETS: D1Database;
  WARPLETS_KV: KVNamespace;
}

interface JFSBody {
  header: string;
  payload: string;
  signature: string;
}

interface JFSHeader {
  fid: number;
  type: "custody" | "auth";
  key: string;
}

interface NotificationDetails {
  url: string;
  token: string;
}

interface WebhookPayload {
  event:
    | "miniapp_added"
    | "miniapp_removed"
    | "notifications_enabled"
    | "notifications_disabled";
  notificationDetails?: NotificationDetails;
}

function base64urlDecode(str: string): string {
  // Convert base64url to standard base64
  const base64 = str.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), "=");
  return atob(padded);
}

export const onRequestPost: PagesFunction<Env> = async (context) => {
  try {
    const body = (await context.request.json()) as JFSBody;

    if (!body.header || !body.payload || !body.signature) {
      return new Response("Invalid JFS body", { status: 400 });
    }

    let header: JFSHeader;
    let payload: WebhookPayload;

    try {
      header = JSON.parse(base64urlDecode(body.header));
      payload = JSON.parse(base64urlDecode(body.payload));
    } catch {
      return new Response("Failed to decode JFS fields", { status: 400 });
    }

    const fid = header?.fid;
    if (!fid || typeof fid !== "number") {
      return new Response("Missing fid in header", { status: 400 });
    }

    const { event, notificationDetails } = payload;

    switch (event) {
      case "miniapp_added":
      case "notifications_enabled": {
        if (notificationDetails?.token && notificationDetails?.url) {
          await context.env.WARPLETS.prepare(
            `INSERT INTO miniapp_notification_tokens (fid, notification_url, notification_token, enabled)
             VALUES (?, ?, ?, 1)
             ON CONFLICT(fid) DO UPDATE SET
               notification_url = excluded.notification_url,
               notification_token = excluded.notification_token,
               enabled = 1,
               updated_at = datetime('now')`
          )
            .bind(fid, notificationDetails.url, notificationDetails.token)
            .run();
        }
        break;
      }

      case "miniapp_removed":
      case "notifications_disabled": {
        await context.env.WARPLETS.prepare(
          `UPDATE miniapp_notification_tokens
           SET enabled = 0, updated_at = datetime('now')
           WHERE fid = ?`
        )
          .bind(fid)
          .run();
        break;
      }

      default:
        // Unknown event — ignore gracefully
        break;
    }

    return new Response(null, { status: 200 });
  } catch (err) {
    console.error("Webhook error:", err);
    return new Response("Internal server error", { status: 500 });
  }
};
