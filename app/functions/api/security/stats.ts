/**
 * GET /api/security/stats
 *
 * Admin security telemetry endpoint.
 * Auth: scoped admin key with `security:stats`.
 */

import { jsonSecure, requireAdminScope } from "../../_lib/security.js";

interface Env {
  WARPLETS: D1Database;
  WARPLETS_KV?: KVNamespace;
  ADMIN_API_KEYS_JSON?: string;
}

type CountRow = { count: number };
type OutcomeRow = { outcome: string; count: number };
type RouteRow = { route: string | null; count: number };
type IpRow = { ip_address: string | null; count: number };
type EventRow = { event_type: string; count: number };

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const auth = await requireAdminScope(context, { scope: "security:stats" });
  if (!auth.ok) return auth.response;

  const [last24h, last7d, authFailures, rateLike, topRoutes, topIps, topEvents] = await Promise.all([
    context.env.WARPLETS.prepare(
      `SELECT COUNT(*) AS count
       FROM security_audit_events
       WHERE created_on >= datetime('now', '-24 hours')`
    ).first<CountRow>(),

    context.env.WARPLETS.prepare(
      `SELECT COUNT(*) AS count
       FROM security_audit_events
       WHERE created_on >= datetime('now', '-7 days')`
    ).first<CountRow>(),

    context.env.WARPLETS.prepare(
      `SELECT outcome, COUNT(*) AS count
       FROM security_audit_events
       WHERE event_type = 'admin_auth'
         AND outcome IN ('missing_token', 'invalid_token')
         AND created_on >= datetime('now', '-24 hours')
       GROUP BY outcome
       ORDER BY count DESC`
    ).all<OutcomeRow>(),

    context.env.WARPLETS.prepare(
      `SELECT outcome, COUNT(*) AS count
       FROM security_audit_events
       WHERE outcome LIKE '%rate%'
          OR event_type LIKE '%rate%'
         AND created_on >= datetime('now', '-24 hours')
       GROUP BY outcome
       ORDER BY count DESC`
    ).all<OutcomeRow>(),

    context.env.WARPLETS.prepare(
      `SELECT route, COUNT(*) AS count
       FROM security_audit_events
       WHERE created_on >= datetime('now', '-24 hours')
       GROUP BY route
       ORDER BY count DESC
       LIMIT 10`
    ).all<RouteRow>(),

    context.env.WARPLETS.prepare(
      `SELECT ip_address, COUNT(*) AS count
       FROM security_audit_events
       WHERE ip_address IS NOT NULL
         AND created_on >= datetime('now', '-24 hours')
       GROUP BY ip_address
       ORDER BY count DESC
       LIMIT 10`
    ).all<IpRow>(),

    context.env.WARPLETS.prepare(
      `SELECT event_type, COUNT(*) AS count
       FROM security_audit_events
       WHERE created_on >= datetime('now', '-24 hours')
       GROUP BY event_type
       ORDER BY count DESC
       LIMIT 20`
    ).all<EventRow>(),
  ]);

  return jsonSecure({
    windows: {
      last24h: Number(last24h?.count ?? 0),
      last7d: Number(last7d?.count ?? 0),
    },
    authFailures24h: authFailures.results ?? [],
    rateSignals24h: rateLike.results ?? [],
    topRoutes24h: topRoutes.results ?? [],
    topIps24h: topIps.results ?? [],
    topEvents24h: topEvents.results ?? [],
  });
};

