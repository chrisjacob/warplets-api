/**
 * GET /api/notifications/stats
 *
 * Returns per-notification aggregates: dispatches, deliveries, opens.
 * Auth: x-admin-token header.
 */

interface Env {
  WARPLETS: D1Database;
  ADMIN_NOTIFY_TEST_TOKEN?: string;
}

interface StatsRow {
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
  const configuredToken = context.env.ADMIN_NOTIFY_TEST_TOKEN;
  const suppliedToken = context.request.headers.get("x-admin-token");

  if (!configuredToken || suppliedToken !== configuredToken) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { results } = await context.env.WARPLETS.prepare(
    `SELECT
       d.notification_id,
       MAX(d.title)       AS title,
       MAX(d.body)        AS body,
       COUNT(DISTINCT d.id)                                          AS dispatches,
       SUM(CASE WHEN d.status = 'delivered' THEN 1 ELSE 0 END)      AS delivered,
       COUNT(DISTINCT o.id)                                          AS opens,
       MIN(d.created_at)  AS first_sent,
       MAX(d.created_at)  AS last_sent
     FROM notification_dispatches d
     LEFT JOIN notification_opens  o ON o.notification_id = d.notification_id
     GROUP BY d.notification_id
     ORDER BY last_sent DESC
     LIMIT 50`
  ).all<StatsRow>();

  const rows = results.map((r) => ({
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

  return Response.json({ total: rows.length, rows });
};
