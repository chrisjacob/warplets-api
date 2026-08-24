import { jsonSecure, requireAdminScope, type SecurityEnv } from "../../../_lib/security.js";

interface Env extends SecurityEnv {
  WARPLETS: D1Database;
}

type CountRow = { status: string; count: number };
type StepRow = { current_step: number; count: number };
type FunnelRow = { step_index: number; event_type: string; count: number };

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const auth = await requireAdminScope(context, { scope: "email:onboarding" });
  if (!auth.ok) return auth.response;

  const [statusRows, stepRows, funnelRows, failures, configRows, reconciliation] = await Promise.all([
    context.env.WARPLETS.prepare(
      "SELECT status, COUNT(*) AS count FROM email_onboarding_state GROUP BY status",
    ).all<CountRow>(),
    context.env.WARPLETS.prepare(
      `SELECT current_step, COUNT(*) AS count FROM email_onboarding_state
       WHERE status IN ('active', 'interrupted', 'uncertain', 'completed') GROUP BY current_step ORDER BY current_step`,
    ).all<StepRow>(),
    context.env.WARPLETS.prepare(
      `SELECT step_index, event_type, COUNT(DISTINCT COALESCE(email_id, email)) AS count
       FROM email_onboarding_webhook_events
       WHERE step_index IS NOT NULL GROUP BY step_index, event_type ORDER BY step_index, event_type`,
    ).all<FunnelRow>(),
    context.env.WARPLETS.prepare(
      `SELECT email, status, current_step, last_error, interrupted_at, updated_at
       FROM email_onboarding_state
       WHERE status IN ('interrupted', 'uncertain')
       ORDER BY updated_at DESC LIMIT 50`,
    ).all(),
    context.env.WARPLETS.prepare(
      "SELECT key, value, updated_at FROM email_onboarding_config ORDER BY key",
    ).all(),
    context.env.WARPLETS.prepare(
      "SELECT last_checked_at, last_error, updated_at FROM email_onboarding_reconcile_state WHERE id = 1",
    ).first(),
  ]);

  const statuses = Object.fromEntries((statusRows.results ?? []).map((row) => [row.status, Number(row.count)]));
  const enrolled = Object.values(statuses).reduce((sum, count) => sum + Number(count), 0);
  const completed = Number(statuses.completed ?? 0);
  const stepMetrics = Array.from({ length: 8 }, (_, stepIndex) => {
    const events = Object.fromEntries(
      (funnelRows.results ?? [])
        .filter((row) => row.step_index === stepIndex)
        .map((row) => [row.event_type.replace(/^email\./, ""), Number(row.count)]),
    );
    const sent = Number(events.sent ?? 0);
    const withRate = (name: string) => ({
      count: Number(events[name] ?? 0),
      rate: sent > 0 ? Number(((Number(events[name] ?? 0) / sent) * 100).toFixed(2)) : 0,
    });
    return {
      step: stepIndex + 1,
      sent,
      delivered: withRate("delivered"),
      opened: withRate("opened"),
      clicked: withRate("clicked"),
      bounced: withRate("bounced"),
      suppressed: withRate("suppressed"),
      complained: withRate("complained"),
    };
  });

  return jsonSecure({
    summary: {
      enrolled,
      queued: Number(statuses.queued ?? 0) + Number(statuses.dispatching ?? 0),
      active: Number(statuses.active ?? 0),
      completed,
      interrupted: Number(statuses.interrupted ?? 0),
      uncertain: Number(statuses.uncertain ?? 0),
      completionRate: enrolled > 0 ? Number(((completed / enrolled) * 100).toFixed(2)) : 0,
    },
    currentSteps: stepRows.results ?? [],
    steps: stepMetrics,
    failures: failures.results ?? [],
    config: configRows.results ?? [],
    reconciliation,
  });
};
