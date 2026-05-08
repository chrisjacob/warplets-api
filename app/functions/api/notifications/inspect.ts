/**
 * GET /api/notifications/inspect
 *
 * Admin endpoint to inspect live notification table state.
 * Returns tokens, recent webhook events, and recent dispatch attempts.
 * Requires x-admin-token header.
 */

interface Env {
  WARPLETS: D1Database;
  WARPLETS_KV: KVNamespace;
  ADMIN_NOTIFY_TEST_TOKEN?: string;
  ADMIN_API_KEYS_JSON?: string;
}
import { jsonSecure, requireAdminScope } from "../../_lib/security.js";

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const auth = await requireAdminScope(context, { scope: "notify:inspect" });
  if (!auth.ok) {
    return auth.response;
  }

  const [tokens, webhookEvents, dispatches, attempts] = await Promise.all([
    context.env.WARPLETS.prepare(
      `SELECT id, fid, app_fid, app_slug, notification_url, notification_token, enabled, created_at, updated_at
       FROM miniapp_notification_tokens
       ORDER BY updated_at DESC
       LIMIT 50`
    ).all(),

    context.env.WARPLETS.prepare(
      `SELECT id, fid, app_fid, event, created_at
       FROM notification_webhook_events
       ORDER BY created_at DESC
       LIMIT 20`
    ).all(),

    context.env.WARPLETS.prepare(
      `SELECT id, fid, app_slug, notification_id, title, status, attempt_count, created_at, updated_at
       FROM notification_dispatches
       ORDER BY created_at DESC
       LIMIT 20`
    ).all(),

    context.env.WARPLETS.prepare(
      `SELECT a.id, a.fid, a.result, a.response_status, a.error_message, a.created_at
       FROM notification_attempts a
       ORDER BY a.created_at DESC
       LIMIT 20`
    ).all(),
  ]);

  return jsonSecure({
    tokens: {
      total: tokens.results.length,
      enabled: tokens.results.filter((r: any) => r.enabled === 1).length,
      rows: tokens.results,
    },
    webhookEvents: {
      total: webhookEvents.results.length,
      rows: webhookEvents.results,
    },
    dispatches: {
      total: dispatches.results.length,
      rows: dispatches.results,
    },
    attempts: {
      total: attempts.results.length,
      rows: attempts.results,
    },
  });
};
