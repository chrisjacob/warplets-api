interface Env {
  WARPLETS: D1Database;
  ADMIN_NOTIFY_TEST_TOKEN?: string;
}

interface TokenRow {
  fid: number;
  notification_url: string;
  notification_token: string;
}

interface RequestBody {
  fid?: number;
  title?: string;
  body?: string;
  targetUrl?: string;
  notificationId?: string;
}

export const onRequestPost: PagesFunction<Env> = async (context) => {
  const configuredToken = context.env.ADMIN_NOTIFY_TEST_TOKEN;
  const suppliedToken = context.request.headers.get("x-admin-token");

  if (!configuredToken || suppliedToken !== configuredToken) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const json = (await context.request.json().catch(() => ({}))) as RequestBody;

  const stmt =
    typeof json.fid === "number"
      ? context.env.WARPLETS.prepare(
          `SELECT fid, notification_url, notification_token
           FROM miniapp_notification_tokens
           WHERE enabled = 1 AND fid = ?
           ORDER BY updated_at DESC
           LIMIT 1`
        ).bind(json.fid)
      : context.env.WARPLETS.prepare(
          `SELECT fid, notification_url, notification_token
           FROM miniapp_notification_tokens
           WHERE enabled = 1
           ORDER BY updated_at DESC
           LIMIT 1`
        );

  const row = (await stmt.first()) as TokenRow | null;

  if (!row) {
    return Response.json(
      {
        error: "No enabled notification token found",
        hint: "Open the Mini App and add/enable notifications, then retry.",
      },
      { status: 404 }
    );
  }

  const notificationId = json.notificationId ?? `test-${Date.now()}`;
  const title = (json.title ?? "10X Test").slice(0, 32);
  const body = (json.body ?? "Push notifications are working.").slice(0, 128);
  const targetUrl = json.targetUrl ?? `https://app.10x.meme/?notificationId=${notificationId}`;

  const upstreamBody = {
    notificationId,
    title,
    body,
    targetUrl,
    tokens: [row.notification_token],
  };

  const upstream = await fetch(row.notification_url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify(upstreamBody),
  });

  const upstreamText = await upstream.text();

  if (!upstream.ok) {
    return Response.json(
      {
        error: "Notification provider rejected request",
        upstreamStatus: upstream.status,
        upstreamBody: upstreamText,
      },
      { status: 502 }
    );
  }

  return Response.json({
    ok: true,
    sentToFid: row.fid,
    upstreamStatus: upstream.status,
    upstreamBody: upstreamText,
    usedNotificationUrl: row.notification_url,
  });
};
