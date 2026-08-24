export interface EmailOnboardingEnv {
  WARPLETS: D1Database;
  RESEND_API_KEY?: string;
  RESEND_ONBOARDING_ENABLED?: string;
  RESEND_ONBOARDING_AUTOMATION_ID?: string;
}

type OnboardingStateRow = {
  email: string;
  status: "queued" | "dispatching" | "active" | "interrupted" | "uncertain" | "completed";
  current_step: number;
  automation_run_id: string | null;
  started_at: string | null;
};

type OnboardingOutboxRow = {
  email: string;
  start_step: number;
  attempts: number;
  dispatch_started_at: string | null;
};

const ONBOARDING_EVENT = "10x.onboarding.start.v1";
const ONBOARDING_VERSION = 1;

function errorText(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).slice(0, 500);
}

export function emailOnboardingEnabled(env: EmailOnboardingEnv): boolean {
  return env.RESEND_ONBOARDING_ENABLED?.trim().toLowerCase() === "true";
}

export function nextEmailOnboardingStep(currentStep: number): number | null {
  return currentStep >= 7 ? null : Math.max(0, Math.min(7, Math.trunc(currentStep) + 1));
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function backoffIso(attempts: number): string {
  const seconds = Math.min(6 * 60 * 60, 60 * (2 ** Math.min(attempts, 8)));
  return new Date(Date.now() + seconds * 1_000).toISOString();
}

/**
 * Registers only confirmations that occur after migration 0062. Existing contacts
 * are intentionally not backfilled. Active/completed sequences remain no-ops.
 */
export async function enqueueEmailOnboarding(input: {
  env: EmailOnboardingEnv;
  email: string;
  source: string;
  claimId: string;
  resubscribe: boolean;
}): Promise<void> {
  const email = normalizeEmail(input.email);
  const existing = await input.env.WARPLETS.prepare(
    `SELECT email, status, current_step, automation_run_id, started_at
     FROM email_onboarding_state WHERE email = ? LIMIT 1`,
  ).bind(email).first<OnboardingStateRow>();
  const now = new Date().toISOString();

  if (!existing) {
    await input.env.WARPLETS.batch([
      input.env.WARPLETS.prepare(
        `INSERT INTO email_onboarding_state (
           email, version, status, current_step, source, claim_id, created_at, updated_at
         ) VALUES (?, ?, 'queued', -1, ?, ?, ?, ?)`,
      ).bind(email, ONBOARDING_VERSION, input.source, input.claimId, now, now),
      input.env.WARPLETS.prepare(
        `INSERT INTO email_onboarding_outbox (
           email, start_step, attempts, next_attempt_at, created_at, updated_at
         ) VALUES (?, 0, 0, ?, ?, ?)`,
      ).bind(email, now, now, now),
    ]);
    return;
  }

  // The caller invokes this only when Resend reports the contact as active. A
  // fresh trusted confirmation therefore resumes an interrupted sequence even
  // for Discord, while a globally unsubscribed contact never reaches this path.
  if (existing.status !== "interrupted" || existing.current_step >= 7) return;
  const nextStep = nextEmailOnboardingStep(existing.current_step);
  if (nextStep === null) return;
  await input.env.WARPLETS.batch([
    input.env.WARPLETS.prepare(
      `UPDATE email_onboarding_state
       SET status = 'queued', source = ?, claim_id = ?, interrupted_at = NULL,
           last_error = NULL, updated_at = ? WHERE email = ? AND status = 'interrupted'`,
    ).bind(input.source, input.claimId, now, email),
    input.env.WARPLETS.prepare(
      `INSERT INTO email_onboarding_outbox (
         email, start_step, attempts, next_attempt_at, dispatch_started_at, last_error, created_at, updated_at
       ) VALUES (?, ?, 0, ?, NULL, NULL, ?, ?)
       ON CONFLICT(email) DO UPDATE SET start_step = excluded.start_step, attempts = 0,
         next_attempt_at = excluded.next_attempt_at, dispatch_started_at = NULL,
         last_error = NULL, updated_at = excluded.updated_at`,
    ).bind(email, nextStep, now, now, now),
  ]);
}

async function dispatchOnboardingEvent(env: EmailOnboardingEnv, row: OnboardingOutboxRow): Promise<void> {
  const apiKey = env.RESEND_API_KEY?.trim();
  if (!apiKey) throw new Error("RESEND_API_KEY is not configured");
  const now = new Date().toISOString();
  const [claimed] = await env.WARPLETS.batch([
    env.WARPLETS.prepare(
      `UPDATE email_onboarding_state SET status = 'dispatching', updated_at = ?
       WHERE email = ? AND status IN ('queued', 'interrupted')`,
    ).bind(now, row.email),
    env.WARPLETS.prepare(
      `UPDATE email_onboarding_outbox SET dispatch_started_at = ?, updated_at = ? WHERE email = ?`,
    ).bind(now, now, row.email),
  ]);
  if (Number(claimed.meta.changes ?? 0) !== 1) return;

  let response: Response;
  try {
    response = await fetch("https://api.resend.com/events/send", {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
        "user-agent": "10x-email-onboarding/1.0",
      },
      body: JSON.stringify({
        event: ONBOARDING_EVENT,
        email: row.email,
        payload: {
          start_step: row.start_step,
          onboarding_version: ONBOARDING_VERSION,
        },
      }),
    });
  } catch (error) {
    // Resend Events does not support idempotency keys. A network failure after
    // acceptance is ambiguous, so reconciliation must decide before any retry.
    const detail = errorText(error);
    await env.WARPLETS.batch([
      env.WARPLETS.prepare(
        `UPDATE email_onboarding_state SET status = 'uncertain', last_error = ?, updated_at = ? WHERE email = ?`,
      ).bind(detail, now, row.email),
      env.WARPLETS.prepare(
        `UPDATE email_onboarding_outbox SET last_error = ?, updated_at = ? WHERE email = ?`,
      ).bind(detail, now, row.email),
    ]);
    return;
  }

  if (!response.ok) {
    const detail = `Resend onboarding event failed (${response.status}): ${(await response.text()).slice(0, 300)}`;
    const attempts = row.attempts + 1;
    const retryAfterSeconds = Number(response.headers.get("retry-after"));
    const nextAttemptAt = response.status === 429 && Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0
      ? new Date(Date.now() + retryAfterSeconds * 1_000).toISOString()
      : backoffIso(attempts);
    await env.WARPLETS.batch([
      env.WARPLETS.prepare(
        `UPDATE email_onboarding_state SET status = 'queued', last_error = ?, updated_at = ? WHERE email = ?`,
      ).bind(detail, now, row.email),
      env.WARPLETS.prepare(
        `UPDATE email_onboarding_outbox SET attempts = ?, next_attempt_at = ?,
           dispatch_started_at = NULL, last_error = ?, updated_at = ? WHERE email = ?`,
      ).bind(attempts, nextAttemptAt, detail, now, row.email),
    ]);
    return;
  }

  await env.WARPLETS.batch([
    env.WARPLETS.prepare(
      `UPDATE email_onboarding_state SET
         status = CASE WHEN status IN ('completed', 'interrupted') THEN status ELSE 'active' END,
         started_at = COALESCE(started_at, ?),
         last_error = CASE WHEN status = 'interrupted' THEN last_error ELSE NULL END,
         updated_at = ? WHERE email = ?`,
    ).bind(now, now, row.email),
    env.WARPLETS.prepare("DELETE FROM email_onboarding_outbox WHERE email = ?").bind(row.email),
  ]);
}

export async function processEmailOnboardingOutbox(env: EmailOnboardingEnv, limit = 20): Promise<void> {
  if (!emailOnboardingEnabled(env)) return;
  const apiKey = env.RESEND_API_KEY?.trim();
  const automationId = env.RESEND_ONBOARDING_AUTOMATION_ID?.trim();
  if (!apiKey || !automationId) {
    console.error("Resend onboarding is enabled but its API key or Automation ID is missing");
    return;
  }
  const result = await env.WARPLETS.prepare(
    `SELECT o.email, o.start_step, o.attempts, o.dispatch_started_at
     FROM email_onboarding_outbox o
     JOIN email_onboarding_state s ON s.email = o.email
     WHERE o.next_attempt_at <= ? AND s.status IN ('queued', 'interrupted')
     ORDER BY o.next_attempt_at ASC LIMIT ?`,
  ).bind(new Date().toISOString(), Math.max(1, Math.min(100, limit))).all<OnboardingOutboxRow>();
  for (const row of result.results ?? []) await dispatchOnboardingEvent(env, row);
}

function findString(value: unknown, keys: Set<string>): string | null {
  if (!value || typeof value !== "object") return null;
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (keys.has(key) && typeof child === "string" && child.trim()) return child.trim();
    const nested = findString(child, keys);
    if (nested) return nested;
  }
  return null;
}

/** Reconciles only ambiguous sends; it never retries one merely because it is old. */
export async function reconcileUncertainEmailOnboarding(env: EmailOnboardingEnv): Promise<void> {
  if (!emailOnboardingEnabled(env)) return;
  const apiKey = env.RESEND_API_KEY?.trim();
  const automationId = env.RESEND_ONBOARDING_AUTOMATION_ID?.trim();
  if (!apiKey || !automationId) return;
  const staleDispatchBefore = new Date(Date.now() - 10 * 60 * 1_000).toISOString();
  await env.WARPLETS.prepare(
    `UPDATE email_onboarding_state SET status = 'uncertain',
       last_error = 'Dispatch was interrupted before its outcome was recorded', updated_at = ?
     WHERE status = 'dispatching' AND email IN (
       SELECT email FROM email_onboarding_outbox WHERE dispatch_started_at <= ?
     )`,
  ).bind(new Date().toISOString(), staleDispatchBefore).run();
  const response = await fetch(`https://api.resend.com/automations/${encodeURIComponent(automationId)}/runs?limit=50`, {
    headers: { authorization: `Bearer ${apiKey}`, "user-agent": "10x-email-onboarding/1.0" },
  });
  if (!response.ok) {
    const detail = `Resend run reconciliation failed (${response.status})`;
    await env.WARPLETS.prepare(
      "UPDATE email_onboarding_reconcile_state SET last_error = ?, updated_at = ? WHERE id = 1",
    ).bind(detail, new Date().toISOString()).run();
    return;
  }
  const payload = await response.json().catch(() => ({})) as { data?: Array<Record<string, unknown>>; has_more?: boolean };
  const runs = Array.isArray(payload.data) ? payload.data : [];
  const now = new Date().toISOString();
  const uncertainRows = await env.WARPLETS.prepare(
    `SELECT s.email, o.attempts, o.dispatch_started_at
     FROM email_onboarding_state s JOIN email_onboarding_outbox o ON o.email = s.email
     WHERE s.status = 'uncertain' ORDER BY o.updated_at ASC LIMIT 20`,
  ).all<{ email: string; attempts: number; dispatch_started_at: string | null }>();
  const reconciledEmails = new Set<string>();
  const existingRows = await env.WARPLETS.prepare(
    "SELECT automation_run_id, status FROM email_onboarding_runs",
  ).all<{ automation_run_id: string; status: string }>();
  const existing = new Map((existingRows.results ?? []).map((row) => [row.automation_run_id, row.status]));
  let inspected = 0;
  for (const summary of runs) {
    const runId = typeof summary.id === "string" ? summary.id : "";
    const summaryStatus = String(summary.status ?? "running");
    if (!runId || (existing.get(runId) === summaryStatus && summaryStatus !== "running")) continue;
    if (inspected >= 20) break;
    inspected += 1;
    const detailResponse = await fetch(
      `https://api.resend.com/automations/${encodeURIComponent(automationId)}/runs/${encodeURIComponent(runId)}`,
      { headers: { authorization: `Bearer ${apiKey}`, "user-agent": "10x-email-onboarding/1.0" } },
    );
    if (!detailResponse.ok) continue;
    const detail = await detailResponse.json().catch(() => null);
    const email = findString(detail, new Set(["email", "to"]))?.toLowerCase() ?? null;
    if (email) reconciledEmails.add(email);
    const error = findString(detail, new Set(["error", "message"]))?.slice(0, 500) ?? null;
    const startStepRow = email
      ? await env.WARPLETS.prepare("SELECT start_step FROM email_onboarding_outbox WHERE email = ? LIMIT 1")
        .bind(email).first<{ start_step: number }>()
      : null;
    await env.WARPLETS.batch([
      env.WARPLETS.prepare(
        `INSERT INTO email_onboarding_runs (
           automation_run_id, email, status, start_step, last_checked_at, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(automation_run_id) DO UPDATE SET status = excluded.status,
           email = COALESCE(excluded.email, email_onboarding_runs.email),
           last_error = excluded.last_error, last_checked_at = excluded.last_checked_at,
           updated_at = excluded.updated_at`,
      ).bind(runId, email, summaryStatus, startStepRow?.start_step ?? null, now, now, now),
      ...(email ? [env.WARPLETS.prepare(
        `UPDATE email_onboarding_runs SET last_error = ? WHERE automation_run_id = ?`,
      ).bind(error, runId)] : []),
      ...(email ? [env.WARPLETS.prepare(
        `UPDATE email_onboarding_state SET
           status = CASE
             WHEN status IN ('completed', 'interrupted') THEN status
             WHEN ? IN ('failed', 'cancelled', 'skipped') THEN 'interrupted'
             ELSE 'active'
           END,
           automation_run_id = ?,
           started_at = COALESCE(started_at, ?),
           interrupted_at = CASE WHEN ? IN ('failed', 'cancelled', 'skipped') THEN ? ELSE interrupted_at END,
           last_error = CASE WHEN ? IN ('failed', 'cancelled', 'skipped') THEN COALESCE(?, ?) ELSE NULL END,
           updated_at = ? WHERE email = ?`,
      ).bind(
        summaryStatus,
        runId,
        now,
        summaryStatus,
        now,
        summaryStatus,
        error,
        `Automation run ${summaryStatus}`,
        now,
        email,
      )] : []),
      ...(email ? [env.WARPLETS.prepare("DELETE FROM email_onboarding_outbox WHERE email = ?").bind(email)] : []),
    ]);
  }
  // Only retry an ambiguous request after a complete, bounded run listing has
  // proved that Resend did not create it. Large/partial listings remain
  // uncertain rather than risking a duplicate sequence.
  if (payload.has_more === false && runs.length <= 20) {
    for (const pending of uncertainRows.results ?? []) {
      if (reconciledEmails.has(pending.email)) continue;
      const startedAt = pending.dispatch_started_at ? Date.parse(pending.dispatch_started_at) : Number.NaN;
      if (!Number.isFinite(startedAt) || Date.now() - startedAt < 10 * 60 * 1_000) continue;
      const attempts = pending.attempts + 1;
      const detail = "Reconciliation found no Resend Automation run; dispatch will retry";
      await env.WARPLETS.batch([
        env.WARPLETS.prepare(
          `UPDATE email_onboarding_state SET status = 'queued', last_error = ?, updated_at = ? WHERE email = ? AND status = 'uncertain'`,
        ).bind(detail, now, pending.email),
        env.WARPLETS.prepare(
          `UPDATE email_onboarding_outbox SET attempts = ?, next_attempt_at = ?, dispatch_started_at = NULL,
             last_error = ?, updated_at = ? WHERE email = ?`,
        ).bind(attempts, backoffIso(attempts), detail, now, pending.email),
      ]);
    }
  }
  await env.WARPLETS.prepare(
    "UPDATE email_onboarding_reconcile_state SET last_checked_at = ?, last_error = NULL, updated_at = ? WHERE id = 1",
  ).bind(now, now).run();
}
