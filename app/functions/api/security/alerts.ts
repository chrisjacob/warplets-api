/**
 * GET /api/security/alerts
 *
 * Basic threshold-based security alerts.
 * Auth: scoped admin key with `security:stats`.
 */

import { jsonSecure, requireAdminScope } from "../../_lib/security.js";

interface Env {
  WARPLETS: D1Database;
  WARPLETS_KV?: KVNamespace;
  ADMIN_NOTIFY_TEST_TOKEN?: string;
  ADMIN_API_KEYS_JSON?: string;
  ADMIN_ALLOW_LEGACY_TOKEN?: string;
}

type CountRow = { count: number };

const THRESHOLDS = {
  authFailures24h: 30,
  rateLimitSignals24h: 100,
  webhookGuards24h: 50,
} as const;

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const auth = await requireAdminScope(context, { scope: "security:stats" });
  if (!auth.ok) return auth.response;

  const [authFailures, rateSignals, webhookGuards] = await Promise.all([
    context.env.WARPLETS.prepare(
      `SELECT COUNT(*) AS count
       FROM security_audit_events
       WHERE event_type = 'admin_auth'
         AND outcome IN ('missing_token', 'invalid_token')
         AND created_on >= datetime('now', '-24 hours')`
    ).first<CountRow>(),
    context.env.WARPLETS.prepare(
      `SELECT COUNT(*) AS count
       FROM security_audit_events
       WHERE (
          outcome LIKE '%rate%'
          OR event_type = 'rate_limit'
       )
         AND created_on >= datetime('now', '-24 hours')`
    ).first<CountRow>(),
    context.env.WARPLETS.prepare(
      `SELECT COUNT(*) AS count
       FROM security_audit_events
       WHERE event_type = 'webhook_guard'
         AND created_on >= datetime('now', '-24 hours')`
    ).first<CountRow>(),
  ]);

  const authFailures24h = Number(authFailures?.count ?? 0);
  const rateLimitSignals24h = Number(rateSignals?.count ?? 0);
  const webhookGuards24h = Number(webhookGuards?.count ?? 0);

  const alerts = [
    {
      id: "auth_failures_spike",
      level: authFailures24h >= THRESHOLDS.authFailures24h ? "high" : "ok",
      active: authFailures24h >= THRESHOLDS.authFailures24h,
      value: authFailures24h,
      threshold: THRESHOLDS.authFailures24h,
      description: "Admin auth failures (24h)",
    },
    {
      id: "rate_limit_spike",
      level: rateLimitSignals24h >= THRESHOLDS.rateLimitSignals24h ? "medium" : "ok",
      active: rateLimitSignals24h >= THRESHOLDS.rateLimitSignals24h,
      value: rateLimitSignals24h,
      threshold: THRESHOLDS.rateLimitSignals24h,
      description: "Rate-limit signals (24h)",
    },
    {
      id: "webhook_guard_spike",
      level: webhookGuards24h >= THRESHOLDS.webhookGuards24h ? "medium" : "ok",
      active: webhookGuards24h >= THRESHOLDS.webhookGuards24h,
      value: webhookGuards24h,
      threshold: THRESHOLDS.webhookGuards24h,
      description: "Webhook guard events (24h)",
    },
  ];

  return jsonSecure({
    generatedAt: new Date().toISOString(),
    alerts,
  });
};
