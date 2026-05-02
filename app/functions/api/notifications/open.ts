/**
 * POST /api/notifications/open
 *
 * Records that a user opened the Mini App via a notification.
 * Called fire-and-forget from App.tsx when `sdk.context.location.type === "notification"`.
 *
 * Body: { notificationId: string; fid?: number }
 * No auth required — source is trusted miniapp context.
 */

interface Env {
  WARPLETS: D1Database;
}

interface RequestBody {
  notificationId?: unknown;
  fid?: unknown;
}

export const onRequestPost: PagesFunction<Env> = async (context) => {
  let body: RequestBody = {};
  try {
    body = (await context.request.json()) as RequestBody;
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const notificationId = typeof body.notificationId === "string" ? body.notificationId.trim() : null;
  if (!notificationId) {
    return Response.json({ error: "notificationId is required" }, { status: 400 });
  }

  const fid = typeof body.fid === "number" ? body.fid : null;

  await context.env.WARPLETS.prepare(
    `INSERT INTO notification_opens (notification_id, fid) VALUES (?, ?)`
  )
    .bind(notificationId, fid)
    .run();

  return Response.json({ ok: true });
};
