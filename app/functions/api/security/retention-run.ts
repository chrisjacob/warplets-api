/**
 * POST /api/security/retention-run
 *
 * Performs security-audit data retention cleanup.
 * Auth: scoped admin key with `security:stats`.
 */

import {
  getClientIp,
  jsonSecure,
  logSecurityEvent,
  parseObjectPayload,
  rateLimit,
  readJsonBodyWithLimit,
  requireAdminScope,
} from "../../_lib/security.js";

interface Env {
  WARPLETS: D1Database;
  WARPLETS_KV?: KVNamespace;
  ADMIN_NOTIFY_TEST_TOKEN?: string;
  ADMIN_API_KEYS_JSON?: string;
  ADMIN_ALLOW_LEGACY_TOKEN?: string;
  SECURITY_LOG_SALT?: string;
}

type CountRow = { count: number };

interface RetentionBody {
  days?: unknown;
  dryRun?: unknown;
}

const DEFAULT_RETENTION_DAYS = 30;
const MIN_RETENTION_DAYS = 7;
const MAX_RETENTION_DAYS = 180;

export const onRequestPost: PagesFunction<Env> = async (context) => {
  const auth = await requireAdminScope(context, { scope: "security:manage" });
  if (!auth.ok) return auth.response;

  const route = new URL(context.request.url).pathname;
  const ip = getClientIp(context.request);
  const adminRate = await rateLimit(context.env.WARPLETS_KV, "security-retention-admin", auth.keyId, 6, 3600);
  if (!adminRate.allowed) {
    const response = jsonSecure({ error: "Rate limit exceeded" }, { status: 429 });
    response.headers.set("retry-after", String(adminRate.retryAfterSeconds));
    return response;
  }

  const parsed = await readJsonBodyWithLimit<unknown>(context.request, 2 * 1024);
  if (!parsed.ok) return parsed.response;
  const objectPayload = parseObjectPayload<RetentionBody>(parsed.value, ["days", "dryRun"]);
  if (!objectPayload.ok) return objectPayload.response;
  const payload = objectPayload.payload;

  const requestedDays =
    typeof payload.days === "number" && Number.isInteger(payload.days)
      ? payload.days
      : DEFAULT_RETENTION_DAYS;
  const retentionDays = Math.min(MAX_RETENTION_DAYS, Math.max(MIN_RETENTION_DAYS, requestedDays));
  const dryRun = payload.dryRun === true;

  const before = await context.env.WARPLETS.prepare("SELECT COUNT(*) AS count FROM security_audit_events").first<CountRow>();

  if (!dryRun) {
    await context.env.WARPLETS.prepare(
      `DELETE FROM security_audit_events
       WHERE created_on < datetime('now', ?)`
    )
      .bind(`-${retentionDays} days`)
      .run();
  }

  const after = await context.env.WARPLETS.prepare("SELECT COUNT(*) AS count FROM security_audit_events").first<CountRow>();
  const beforeCount = Number(before?.count ?? 0);
  const afterCount = dryRun
    ? Number(
      (
        await context.env.WARPLETS.prepare(
          `SELECT COUNT(*) AS count
           FROM security_audit_events
           WHERE created_on >= datetime('now', ?)`
        )
          .bind(`-${retentionDays} days`)
          .first<CountRow>()
      )?.count ?? 0
    )
    : Number(after?.count ?? 0);
  const deleted = Math.max(0, beforeCount - afterCount);

  await logSecurityEvent(context.env.WARPLETS, { logSalt: context.env.SECURITY_LOG_SALT }, {
    eventType: "security_retention",
    outcome: "ok",
    actorType: "admin_key",
    actorId: auth.keyId,
    ipAddress: ip,
    route,
    details: JSON.stringify({ retentionDays, deleted, dryRun }),
  });

  return jsonSecure({
    ok: true,
    dryRun,
    retentionDays,
    before: beforeCount,
    after: afterCount,
    deleted,
  });
};
