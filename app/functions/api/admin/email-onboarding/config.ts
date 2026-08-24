import { jsonSecure, requireAdminScope, type SecurityEnv } from "../../../_lib/security.js";

interface Env extends SecurityEnv {
  WARPLETS: D1Database;
}

type TemplateInput = {
  stepIndex?: unknown;
  stepKey?: unknown;
  templateId?: unknown;
  subject?: unknown;
  publishedAt?: unknown;
};

export const onRequestPost: PagesFunction<Env> = async (context) => {
  const auth = await requireAdminScope(context, { scope: "email:onboarding" });
  if (!auth.ok) return auth.response;
  const body = await context.request.json().catch(() => null) as {
    version?: unknown;
    automationId?: unknown;
    eventName?: unknown;
    webhookId?: unknown;
    templates?: TemplateInput[];
  } | null;
  const version = Number(body?.version ?? 1);
  const automationId = typeof body?.automationId === "string" ? body.automationId.trim() : "";
  const eventName = typeof body?.eventName === "string" ? body.eventName.trim() : "";
  const webhookId = typeof body?.webhookId === "string" ? body.webhookId.trim() : "";
  const templates = Array.isArray(body?.templates) ? body.templates : [];
  if (version !== 1 || !automationId || eventName !== "10x.onboarding.start.v1" || templates.length !== 8) {
    return jsonSecure({ error: "Invalid onboarding configuration" }, { status: 400 });
  }
  const normalized = templates.map((template) => ({
    stepIndex: Number(template.stepIndex),
    stepKey: typeof template.stepKey === "string" ? template.stepKey.trim() : "",
    templateId: typeof template.templateId === "string" ? template.templateId.trim() : "",
    subject: typeof template.subject === "string" ? template.subject.trim() : "",
    publishedAt: typeof template.publishedAt === "string" ? template.publishedAt.trim() : null,
  }));
  if (normalized.some((template, index) => (
    template.stepIndex !== index || !template.stepKey || !template.templateId || !template.subject
  ))) {
    return jsonSecure({ error: "Templates must contain ordered steps 0 through 7" }, { status: 400 });
  }
  const now = new Date().toISOString();
  const statements: D1PreparedStatement[] = [
    context.env.WARPLETS.prepare(
      `INSERT INTO email_onboarding_config (key, value, updated_at) VALUES ('automation_id', ?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    ).bind(automationId, now),
    context.env.WARPLETS.prepare(
      `INSERT INTO email_onboarding_config (key, value, updated_at) VALUES ('event_name', ?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    ).bind(eventName, now),
  ];
  if (webhookId) {
    statements.push(context.env.WARPLETS.prepare(
      `INSERT INTO email_onboarding_config (key, value, updated_at) VALUES ('webhook_id', ?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    ).bind(webhookId, now));
  }
  for (const template of normalized) {
    statements.push(context.env.WARPLETS.prepare(
      `INSERT INTO email_onboarding_templates (
         version, step_index, step_key, template_id, subject, published_at, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(version, step_index) DO UPDATE SET step_key = excluded.step_key,
         template_id = excluded.template_id, subject = excluded.subject,
         published_at = excluded.published_at, updated_at = excluded.updated_at`,
    ).bind(
      version,
      template.stepIndex,
      template.stepKey,
      template.templateId,
      template.subject,
      template.publishedAt,
      now,
      now,
    ));
  }
  await context.env.WARPLETS.batch(statements);
  return jsonSecure({ ok: true, version, automationId, webhookId: webhookId || null });
};
