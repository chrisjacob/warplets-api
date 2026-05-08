/**
 * POST /api/security/retention-run
 *
 * Performs security-audit data retention cleanup.
 * Auth: scoped admin key with `security:stats`.
 */

import { getClientIp, jsonSecure, logSecurityEvent, requireAdminScope } from "../../_lib/security.js";

interface Env {
  WARPLETS: D1Database;
  WARPLETS_KV?: KVNamespace;
  ADMIN_NOTIFY_TEST_TOKEN?: string;
  ADMIN_API_KEYS_JSON?: string;
  ADMIN_ALLOW_LEGACY_TOKEN?: string;
  SECURITY_LOG_SALT?: string;
}

type CountRow = { count: number };

const RETENTION_DAYS = 30;

export const onRequestPost: PagesFunction<Env> = async (context) => {
  const auth = await requireAdminScope(context, { scope: "security:stats" });
  if (!auth.ok) return auth.response;

  const route = new URL(context.request.url).pathname;
  const ip = getClientIp(context.request);
  const before = await context.env.WARPLETS.prepare("SELECT COUNT(*) AS count FROM security_audit_events").first<CountRow>();

  await context.env.WARPLETS.prepare(
    `DELETE FROM security_audit_events
     WHERE created_on < datetime('now', ?)`
  )
    .bind(`-${RETENTION_DAYS} days`)
    .run();

  const after = await context.env.WARPLETS.prepare("SELECT COUNT(*) AS count FROM security_audit_events").first<CountRow>();
  const beforeCount = Number(before?.count ?? 0);
  const afterCount = Number(after?.count ?? 0);
  const deleted = Math.max(0, beforeCount - afterCount);

  await logSecurityEvent(context.env.WARPLETS, { logSalt: context.env.SECURITY_LOG_SALT }, {
    eventType: "security_retention",
    outcome: "ok",
    actorType: "admin_key",
    actorId: auth.keyId,
    ipAddress: ip,
    route,
    details: JSON.stringify({ retentionDays: RETENTION_DAYS, deleted }),
  });

  return jsonSecure({
    ok: true,
    retentionDays: RETENTION_DAYS,
    before: beforeCount,
    after: afterCount,
    deleted,
  });
};

