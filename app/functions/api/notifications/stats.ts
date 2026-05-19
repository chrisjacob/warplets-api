/**
 * GET /api/notifications/stats
 *
 * Returns per-notification aggregates: dispatches, deliveries, opens.
 * Auth: x-admin-token header.
 */

interface Env {
  WARPLETS: D1Database;
  ADMIN_API_KEYS_JSON?: string;
  WARPLETS_KV?: KVNamespace;
}
import { jsonSecure, requireAdminScope } from "../../_lib/security.js";

interface StatsRow {
  app_slug: string;
  notification_id: string;
  title: string;
  body: string;
  dispatches: number;
  delivered: number;
  opens: number;
  first_sent: string;
  last_sent: string;
}

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const auth = await requireAdminScope(context, { scope: "notify:stats" });
  if (!auth.ok) {
    return auth.response;
  }

  const { results } = await context.env.WARPLETS.prepare(
    `WITH dispatch_stats AS (
       SELECT
         COALESCE(app_slug, 'drop') AS app_slug,
         notification_id,
         MAX(title) AS title,
         MAX(body) AS body,
         COUNT(*) AS dispatches,
         SUM(CASE WHEN status = 'delivered' THEN 1 ELSE 0 END) AS delivered,
         MIN(created_at) AS first_sent,
         MAX(created_at) AS last_sent
       FROM notification_dispatches
       GROUP BY COALESCE(app_slug, 'drop'), notification_id
     ),
     open_stats AS (
       SELECT
         COALESCE(app_slug, 'drop') AS app_slug,
         notification_id,
         COUNT(DISTINCT id) AS opens
       FROM notification_opens
       GROUP BY COALESCE(app_slug, 'drop'), notification_id
     )
     SELECT
       d.app_slug,
       d.notification_id,
       d.title,
       d.body,
       d.dispatches,
       d.delivered,
       COALESCE(o.opens, 0) AS opens,
       d.first_sent,
       d.last_sent
     FROM dispatch_stats d
     LEFT JOIN open_stats o
       ON o.notification_id = d.notification_id
      AND o.app_slug = d.app_slug
     ORDER BY d.last_sent DESC
     LIMIT 50`
  ).all<StatsRow>();

  const rows = results.map((r) => ({
    appSlug: r.app_slug,
    notificationId: r.notification_id,
    title: r.title,
    body: r.body,
    dispatches: r.dispatches,
    delivered: r.delivered,
    opens: r.opens,
    openRate: r.delivered > 0 ? +(r.opens / r.delivered).toFixed(4) : null,
    firstSent: r.first_sent,
    lastSent: r.last_sent,
  }));

  return jsonSecure({ total: rows.length, rows });
};

