import { resolveAppSlugFromUrl } from "../../_lib/appSlug.js";
import { jsonSecure, readJsonBodyWithLimit } from "../../_lib/security.js";

interface Env {
  WARPLETS: D1Database;
}

interface OpenBody {
  notificationId?: unknown;
  recipientKey?: unknown;
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const parsed = await readJsonBodyWithLimit<OpenBody>(request, 2 * 1024);
  if (!parsed.ok) return parsed.response;
  const notificationId = typeof parsed.value.notificationId === "string" ? parsed.value.notificationId.trim() : "";
  const recipientKey = typeof parsed.value.recipientKey === "string" ? parsed.value.recipientKey.trim().toLowerCase() : "";
  if (!notificationId || notificationId.length > 128 || !/^[a-f0-9]{64}$/.test(recipientKey)) {
    return jsonSecure({ error: "Invalid Web Push open event" }, { status: 400 });
  }
  const appSlug = resolveAppSlugFromUrl(new URL(request.url));
  const now = new Date().toISOString();
  await env.WARPLETS.prepare(
    `UPDATE notification_channel_deliveries
        SET opened_at = COALESCE(opened_at, ?), updated_at = ?
      WHERE campaign_id = ? AND app_slug = ? AND channel = 'web-push'
        AND recipient_key = ? AND status = 'delivered'`,
  ).bind(now, now, notificationId, appSlug, recipientKey).run();
  return jsonSecure({ ok: true });
};
