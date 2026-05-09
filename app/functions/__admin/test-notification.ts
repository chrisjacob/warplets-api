import { dispatchNotification } from "../_lib/dispatch.js";
import { jsonSecure, requireAdminScope } from "../_lib/security.js";

interface Env {
  WARPLETS: D1Database;
  ADMIN_API_KEYS_JSON?: string;
  WARPLETS_KV?: KVNamespace;
}

interface RequestBody {
  fid?: number;
  appSlug?: string;
  title?: string;
  body?: string;
  targetUrl?: string;
  notificationId?: string;
}

interface TokenRow {
  fid: number;
  notification_url: string;
  notification_token: string;
}

export const onRequestPost: PagesFunction<Env> = async (context) => {
  const auth = await requireAdminScope(context, { scope: "notify:send" });
  if (!auth.ok) {
    return auth.response;
  }

  const json = (await context.request.json().catch(() => ({}))) as RequestBody;

  // Resolve token from D1
  let notificationUrl: string;
  let notificationToken: string;
  let resolvedFid: number;

  if (typeof json.fid === "number") {
    const row = (await context.env.WARPLETS.prepare(
      `SELECT fid, notification_url, notification_token
       FROM miniapp_notification_tokens
       WHERE enabled = 1 AND fid = ?
       ORDER BY updated_at DESC LIMIT 1`
    )
      .bind(json.fid)
      .first()) as TokenRow | null;

    if (!row) {
      return jsonSecure(
        { error: "No enabled notification token found for this FID" },
        { status: 404 }
      );
    }
    notificationUrl = row.notification_url;
    notificationToken = row.notification_token;
    resolvedFid = row.fid;
  } else {
    // No FID specified — grab latest enabled from D1
    const row = (await context.env.WARPLETS.prepare(
      `SELECT fid, notification_url, notification_token
       FROM miniapp_notification_tokens
       WHERE enabled = 1
       ORDER BY updated_at DESC LIMIT 1`
    ).first()) as TokenRow | null;

    if (!row) {
      return jsonSecure(
        {
          error: "No enabled notification token found",
          hint: "Open the Mini App and add/enable notifications, then retry.",
        },
        { status: 404 }
      );
    }
    notificationUrl = row.notification_url;
    notificationToken = row.notification_token;
    resolvedFid = row.fid;
  }

  const notificationId = json.notificationId ?? `test-${Date.now()}`;
  const appSlug = typeof json.appSlug === "string" ? json.appSlug : "app";
  const title = (json.title ?? "10X Test").slice(0, 32);
  const body = (json.body ?? "Push notifications are working.").slice(0, 128);
  const targetUrl = json.targetUrl ?? `https://app.10x.meme/?notificationId=${notificationId}`;

  const result = await dispatchNotification(context.env.WARPLETS, {
    fid: resolvedFid,
    appSlug,
    notificationUrl,
    notificationToken,
    notificationId,
    title,
    body,
    targetUrl,
  });

  if (result.state === "validation_error") {
    return jsonSecure({ error: result.message }, { status: 400 });
  }

  return jsonSecure({
    ok: result.state === "success",
    state: result.state,
    sentToFid: resolvedFid,
    ...(result.state === "failed" ? { error: String(result.error) } : {}),
  });
};

