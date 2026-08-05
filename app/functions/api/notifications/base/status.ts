import { getAppSession, type AppAuthEnv } from "../../../_lib/appAuth.js";
import { getBaseNotificationStatus, type BaseNotificationsEnv } from "../../../_lib/baseNotifications.js";
import { jsonSecure } from "../../../_lib/security.js";

interface Env extends AppAuthEnv, BaseNotificationsEnv {}
const CACHE_MS = 2 * 60 * 1000;

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const session = await getAppSession(context.request, context.env);
  if (!session?.walletAddress) return jsonSecure({ error: "verified wallet session required" }, { status: 401 });
  const cached = await context.env.WARPLETS.prepare(
    `SELECT app_pinned, notifications_enabled, checked_at
     FROM base_notification_status_cache WHERE wallet_address = ? LIMIT 1`,
  ).bind(session.walletAddress).first<{ app_pinned: number; notifications_enabled: number; checked_at: string }>();
  if (cached && Date.now() - Date.parse(cached.checked_at) < CACHE_MS) {
    return jsonSecure({ appPinned: cached.app_pinned === 1, notificationsEnabled: cached.notifications_enabled === 1, cached: true });
  }

  try {
    const status = await getBaseNotificationStatus(context.env, session.walletAddress);
    const now = new Date().toISOString();
    await context.env.WARPLETS.prepare(
      `INSERT INTO base_notification_status_cache (
         wallet_address, app_url, app_pinned, notifications_enabled, checked_at, response_json
       ) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(wallet_address) DO UPDATE SET
         app_url = excluded.app_url, app_pinned = excluded.app_pinned,
         notifications_enabled = excluded.notifications_enabled, checked_at = excluded.checked_at,
         response_json = excluded.response_json`,
    ).bind(session.walletAddress, context.env.BASE_APP_URL || "https://search.10x.meme", status.appPinned ? 1 : 0, status.notificationsEnabled ? 1 : 0, now, JSON.stringify(status)).run();
    return jsonSecure({ ...status, cached: false });
  } catch (error) {
    return jsonSecure({ error: error instanceof Error ? error.message : "Base notification status failed" }, { status: 503 });
  }
};
