import { jsonSecure } from "../../_lib/security.js";

interface Env {
  WARPLETS: D1Database;
  RESEND_WEBHOOK_SECRET?: string;
}

type ResendWebhook = {
  type?: string;
  created_at?: string;
  data?: {
    email_id?: string;
    to?: string[];
    subject?: string;
    template_id?: string;
    click?: { link?: string };
  };
};

function decodeBase64(value: string): Uint8Array {
  const binary = atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function constantTimeEqual(left: Uint8Array, right: Uint8Array): boolean {
  let difference = left.length ^ right.length;
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    difference |= (left[index % Math.max(1, left.length)] ?? 0) ^ (right[index % Math.max(1, right.length)] ?? 0);
  }
  return difference === 0;
}

export async function verifySvix(request: Request, rawBody: string, secret: string): Promise<boolean> {
  const id = request.headers.get("svix-id")?.trim() ?? "";
  const timestamp = request.headers.get("svix-timestamp")?.trim() ?? "";
  const signatures = request.headers.get("svix-signature")?.trim() ?? "";
  const timestampSeconds = Number(timestamp);
  if (!id || !Number.isFinite(timestampSeconds) || !signatures) return false;
  if (Math.abs(Math.floor(Date.now() / 1_000) - timestampSeconds) > 5 * 60) return false;
  const encodedSecret = secret.startsWith("whsec_") ? secret.slice(6) : secret;
  let secretBytes: Uint8Array;
  try {
    secretBytes = decodeBase64(encodedSecret);
  } catch {
    return false;
  }
  const key = await crypto.subtle.importKey(
    "raw",
    secretBytes.buffer as ArrayBuffer,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const expected = new Uint8Array(await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(`${id}.${timestamp}.${rawBody}`),
  ));
  for (const signature of signatures.split(" ")) {
    const [version, encoded] = signature.split(",", 2);
    if (version !== "v1" || !encoded) continue;
    try {
      if (constantTimeEqual(expected, decodeBase64(encoded))) return true;
    } catch {
      // Try the next supplied v1 signature.
    }
  }
  return false;
}

const TRACKED_EVENTS = new Set([
  "email.sent",
  "email.delivered",
  "email.opened",
  "email.clicked",
  "email.delivery_delayed",
  "email.failed",
  "email.suppressed",
  "email.bounced",
  "email.complained",
]);

const INTERRUPTION_EVENTS = new Set([
  "email.failed",
  "email.suppressed",
  "email.bounced",
  "email.complained",
]);

export const onRequestPost: PagesFunction<Env> = async (context) => {
  const secret = context.env.RESEND_WEBHOOK_SECRET?.trim();
  if (!secret) return jsonSecure({ error: "Webhook is not configured" }, { status: 503 });
  const rawBody = await context.request.text();
  if (!(await verifySvix(context.request, rawBody, secret))) {
    return jsonSecure({ error: "Invalid webhook signature" }, { status: 401 });
  }

  let event: ResendWebhook;
  try {
    event = JSON.parse(rawBody) as ResendWebhook;
  } catch {
    return jsonSecure({ error: "Invalid JSON" }, { status: 400 });
  }
  const eventType = event.type?.trim() ?? "";
  if (!TRACKED_EVENTS.has(eventType)) return jsonSecure({ ok: true, ignored: true });

  const templateId = event.data?.template_id?.trim() ?? "";
  if (!templateId) return jsonSecure({ ok: true, ignored: true });
  const template = await context.env.WARPLETS.prepare(
    `SELECT version, step_index, template_id FROM email_onboarding_templates
     WHERE template_id = ? ORDER BY version DESC LIMIT 1`,
  ).bind(templateId).first<{ version: number; step_index: number; template_id: string }>();
  if (!template) return jsonSecure({ ok: true, ignored: true });

  const svixId = context.request.headers.get("svix-id")!.trim();
  const email = event.data?.to?.[0]?.trim().toLowerCase() ?? "";
  const emailId = event.data?.email_id?.trim() ?? "";
  const now = new Date().toISOString();
  const duplicate = await context.env.WARPLETS.prepare(
    "SELECT 1 AS found FROM email_onboarding_webhook_events WHERE svix_id = ? LIMIT 1",
  ).bind(svixId).first<{ found: number }>();
  if (duplicate) return jsonSecure({ ok: true, duplicate: true });

  const statements: D1PreparedStatement[] = [context.env.WARPLETS.prepare(
    `INSERT INTO email_onboarding_webhook_events (
       svix_id, email_id, email, template_id, step_index, event_type, link_url, occurred_at, received_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    svixId,
    emailId || null,
    email || null,
    template.template_id,
    template.step_index,
    eventType,
    eventType === "email.clicked" ? event.data?.click?.link?.slice(0, 1000) ?? null : null,
    event.created_at ?? null,
    now,
  )];

  if (email && eventType === "email.delivered") {
    const completed = template.step_index === 7;
    statements.push(context.env.WARPLETS.prepare(
      `UPDATE email_onboarding_state SET
         current_step = MAX(current_step, ?),
         status = CASE WHEN ? = 1 THEN 'completed' ELSE 'active' END,
         completed_at = CASE WHEN ? = 1 THEN COALESCE(completed_at, ?) ELSE completed_at END,
         interrupted_at = CASE WHEN ? = 1 THEN interrupted_at ELSE NULL END,
         last_error = NULL,
         updated_at = ?
       WHERE email = ? AND version = ?`,
    ).bind(
      template.step_index,
      completed ? 1 : 0,
      completed ? 1 : 0,
      now,
      completed ? 1 : 0,
      now,
      email,
      template.version,
    ));
  } else if (email && INTERRUPTION_EVENTS.has(eventType)) {
    const delivered = emailId
      ? await context.env.WARPLETS.prepare(
        `SELECT 1 AS found FROM email_onboarding_webhook_events
         WHERE email_id = ? AND event_type = 'email.delivered' LIMIT 1`,
      ).bind(emailId).first<{ found: number }>()
      : null;
    if (!delivered) {
      statements.push(context.env.WARPLETS.prepare(
        `UPDATE email_onboarding_state SET status = 'interrupted', interrupted_at = ?,
           last_error = ?, updated_at = ? WHERE email = ? AND status <> 'completed' AND current_step < ?`,
      ).bind(now, `${eventType} at step ${template.step_index + 1}`, now, email, template.step_index));
    }
  } else if (email && eventType === "email.sent") {
    statements.push(context.env.WARPLETS.prepare(
      `UPDATE email_onboarding_state SET status = CASE WHEN status = 'completed' THEN status ELSE 'active' END,
         started_at = COALESCE(started_at, ?), updated_at = ? WHERE email = ?`,
    ).bind(now, now, email));
  }

  try {
    // D1 batch is transactional: the replay marker and state transition either
    // both commit or neither does.
    await context.env.WARPLETS.batch(statements);
  } catch (error) {
    const raced = await context.env.WARPLETS.prepare(
      "SELECT 1 AS found FROM email_onboarding_webhook_events WHERE svix_id = ? LIMIT 1",
    ).bind(svixId).first<{ found: number }>();
    if (raced) return jsonSecure({ ok: true, duplicate: true });
    throw error;
  }

  return jsonSecure({ ok: true });
};
