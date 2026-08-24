import { jsonSecure, requireAdminScope } from "../../_lib/security.js";
import { processNotificationQueue } from "../../_lib/warpletNotifications.js";
import { WARPLETS_APP_SLUG } from "../../../shared/warpletsApp.js";

interface Env {
  WARPLETS: D1Database;
  WARPLETS_KV: KVNamespace;
  ADMIN_API_KEYS_JSON?: string;
}

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const auth = await requireAdminScope(context, { scope: "notify:inspect" });
  if (!auth.ok) return auth.response;

  const [summary, queue, events, jobs] = await Promise.all([
    context.env.WARPLETS.prepare(
      `SELECT status, category, COUNT(*) AS count
       FROM notification_queue
       WHERE app_slug = '${WARPLETS_APP_SLUG}'
       GROUP BY status, category
       ORDER BY status, category`,
    ).all(),
    context.env.WARPLETS.prepare(
      `SELECT id, category, priority, fid, event_id, title, body, status,
              attempt_count, next_attempt_at, last_error, created_at, updated_at, sent_at
       FROM notification_queue
       WHERE app_slug = '${WARPLETS_APP_SLUG}'
       ORDER BY created_at DESC
       LIMIT 100`,
    ).all(),
    context.env.WARPLETS.prepare(
      `SELECT id, event_key, event_type, token_id, actor_fid, actor_username,
              owner_fid, counterparty_fid, amount_eth, order_hash, transaction_hash,
              source, occurred_at, queued_at, created_at
       FROM warplet_activity_events
       ORDER BY occurred_at DESC
       LIMIT 100`,
    ).all(),
    context.env.WARPLETS.prepare(
      `SELECT job_key, value, updated_at
       FROM notification_job_state
       ORDER BY updated_at DESC
       LIMIT 50`,
    ).all(),
  ]);

  return jsonSecure({
    summary: summary.results,
    queue: queue.results,
    events: events.results,
    jobs: jobs.results,
  });
};

export const onRequestPost: PagesFunction<Env> = async (context) => {
  const auth = await requireAdminScope(context, { scope: "notify:send" });
  if (!auth.ok) return auth.response;

  const url = new URL(context.request.url);
  const action = url.searchParams.get("action");

  if (action === "retry-failed") {
    const result = await context.env.WARPLETS.prepare(
      `UPDATE notification_queue
       SET status = 'retry', next_attempt_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
       WHERE app_slug = '${WARPLETS_APP_SLUG}' AND status IN ('failed', 'rate_limited')`,
    ).run();
    return jsonSecure({ ok: true, action, changes: result.meta.changes });
  }

  const limit = Math.min(100, Math.max(1, Number(url.searchParams.get("limit") || 100)));
  const result = await processNotificationQueue(context.env, limit);
  return jsonSecure({ ok: true, action: "process", result });
};
