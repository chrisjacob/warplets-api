/**
 * GET /api/security/alerts
 *
 * Basic threshold-based security alerts.
 * Auth: scoped admin key with `security:stats`.
 */

import { jsonSecure, requireAdminScope } from "../../_lib/security.js";
import { outboundFetch } from "../../_lib/outbound.js";

interface Env {
  WARPLETS: D1Database;
  WARPLETS_KV?: KVNamespace;
  ADMIN_NOTIFY_TEST_TOKEN?: string;
  ADMIN_API_KEYS_JSON?: string;
  ADMIN_ALLOW_LEGACY_TOKEN?: string;
  RESEND_API_KEY?: string;
  RESEND_FROM_EMAIL?: string;
  SECURITY_ALERT_EMAIL_TO?: string;
}

type CountRow = { count: number };
type AlertRow = {
  id: string;
  level: "high" | "medium" | "ok";
  active: boolean;
  value: number;
  threshold: number;
  description: string;
};

const THRESHOLDS = {
  authFailures24h: 30,
  rateLimitSignals24h: 100,
  webhookGuards24h: 50,
} as const;

const ALERT_EMAIL_TO_DEFAULT = "chris@10x.meme";
const ALERT_EMAIL_DEDUPE_TTL_SECONDS = 4 * 60 * 60;
const ALERT_EMAIL_KV_KEY = "security:alerts:last-fingerprint";

async function sha256Hex(input: string): Promise<string> {
  const payload = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", payload);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function buildAlertFingerprint(alerts: AlertRow[]): string {
  return JSON.stringify(
    alerts
      .filter((a) => a.active)
      .map((a) => ({ id: a.id, level: a.level, value: a.value, threshold: a.threshold }))
      .sort((a, b) => a.id.localeCompare(b.id))
  );
}

function buildAlertEmailHtml(alerts: AlertRow[], generatedAt: string): string {
  const activeRows = alerts.filter((a) => a.active);
  const rowsHtml = activeRows
    .map(
      (a) =>
        `<tr><td style="padding:8px;border:1px solid #ddd;">${a.description}</td><td style="padding:8px;border:1px solid #ddd;">${a.level.toUpperCase()}</td><td style="padding:8px;border:1px solid #ddd;">${a.value} / ${a.threshold}</td></tr>`
    )
    .join("");

  return `
  <div style="font-family:Arial,sans-serif;max-width:700px;margin:0 auto;padding:20px;color:#111;">
    <h2 style="margin:0 0 14px;">10X Security Alert</h2>
    <p style="margin:0 0 12px;">Generated at: ${generatedAt}</p>
    <table style="border-collapse:collapse;width:100%;margin-top:10px;">
      <thead>
        <tr>
          <th style="padding:8px;border:1px solid #ddd;text-align:left;">Alert</th>
          <th style="padding:8px;border:1px solid #ddd;text-align:left;">Level</th>
          <th style="padding:8px;border:1px solid #ddd;text-align:left;">Value</th>
        </tr>
      </thead>
      <tbody>${rowsHtml}</tbody>
    </table>
  </div>`;
}

async function maybeSendAlertEmail(env: Env, alerts: AlertRow[], generatedAt: string): Promise<void> {
  const activeAlerts = alerts.filter((a) => a.active);
  if (activeAlerts.length === 0) return;

  const resendApiKey = env.RESEND_API_KEY?.trim();
  if (!resendApiKey) return;

  const fingerprint = await sha256Hex(buildAlertFingerprint(alerts));
  const previousFingerprint = await env.WARPLETS_KV?.get(ALERT_EMAIL_KV_KEY);
  if (previousFingerprint && previousFingerprint === fingerprint) {
    return;
  }

  const toEmail = env.SECURITY_ALERT_EMAIL_TO?.trim() || ALERT_EMAIL_TO_DEFAULT;
  const fromEmail = env.RESEND_FROM_EMAIL?.trim() || "10X Alerts <10x@10x.meme>";

  const subject =
    activeAlerts.length === 1
      ? `[10X Security] 1 active alert`
      : `[10X Security] ${activeAlerts.length} active alerts`;

  try {
    const response = await outboundFetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        Authorization: `Bearer ${resendApiKey}`,
      },
      body: JSON.stringify({
        from: fromEmail,
        to: [toEmail],
        subject,
        html: buildAlertEmailHtml(alerts, generatedAt),
      }),
    });

    if (!response.ok) return;
    await env.WARPLETS_KV?.put(ALERT_EMAIL_KV_KEY, fingerprint, {
      expirationTtl: ALERT_EMAIL_DEDUPE_TTL_SECONDS,
    });
  } catch {
    // Best effort; never break alerts endpoint response path.
  }
}

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

  const alerts: AlertRow[] = [
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

  const generatedAt = new Date().toISOString();
  await maybeSendAlertEmail(context.env, alerts, generatedAt);

  return jsonSecure({
    generatedAt,
    alerts,
  });
};
