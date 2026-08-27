import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { PERKS_DEFINITIONS, type PerksSubpage } from "../app/src/perksMockData";
import { PERKS_SHARE_CONTENT } from "../app/src/perksShareContent";

const API = "https://api.resend.com";
const EVENT_NAME = "10x.onboarding.start.v1";
const VERSION = 1;
const apply = process.argv.includes("--apply");
const testDelays = process.argv.includes("--test-delays");
const skipRegister = process.argv.includes("--skip-register");
const apiKey = process.env.RESEND_API_KEY?.trim() ?? "";
const from = process.env.RESEND_FROM_EMAIL?.trim() || "10X <10x@10x.meme>";
const webhookOrigin = (process.env.ONBOARDING_WEBHOOK_ORIGIN?.trim() || "https://app.10x.meme").replace(/\/$/, "");
const adminOrigin = (process.env.ONBOARDING_ADMIN_ORIGIN?.trim() || webhookOrigin).replace(/\/$/, "");
const adminToken = process.env.ADMIN_API_TOKEN?.trim() ?? "";
const adminSession = process.env.ADMIN_SESSION_TOKEN?.trim() ?? "";
const EMAIL_ASSET_ORIGIN = "https://app.10x.meme";

type TemplateSpec = { stepKey: string; alias: string; subject: string; html: string; text: string };
type ApiObject = Record<string, unknown>;

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[character]!);
}

function absoluteAsset(path: string): string {
  return new URL(path, EMAIL_ASSET_ORIGIN).toString();
}

function preheader(text: string): string {
  return `<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent">${escapeHtml(text)}</div>`;
}

function button(label: string, href: string): string {
  return `<a href="${escapeHtml(href)}" style="display:inline-block;background:#00ff00;color:#003300;border:1px solid #00c900;border-radius:8px;padding:10px 15px;font-size:14px;font-weight:800;text-decoration:none">${escapeHtml(label)}</a>`;
}

function imageButtonCard(label: string, href: string, imageUrl: string): string {
  return `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="width:100%;border:1px solid #00a52a;border-radius:10px;overflow:hidden;background:#001b08">
    <tr><td><a href="${escapeHtml(href)}" style="display:block;text-decoration:none"><img src="${escapeHtml(imageUrl)}" width="452" alt="${escapeHtml(label)}" style="display:block;width:100%;height:auto;border:0"></a></td></tr>
    <tr><td style="background:#00ff00;text-align:center"><a href="${escapeHtml(href)}" style="display:block;color:#003300;padding:10px 8px;font-size:14px;font-weight:800;text-decoration:none">${escapeHtml(label)}</a></td></tr>
  </table>`;
}

function postscript(): string {
  return `<div style="margin-top:26px;color:#c9e8c9;font-size:13px;line-height:1.55">
    <p style="margin:0 0 10px">p.s. &quot;You&#39;re Just One Trade Away...&quot; <span style="white-space:nowrap">—&nbsp;<a href="https://x.com/10XChrisX" style="color:#00ff00">10XChris.eth</a></span></p>
    <p style="margin:0">p.p.s. Holding <a href="https://warplet.10x.meme" style="color:#00ff00">10X Warplets</a> NFTs with higher Levels will boost your airdrops and perks.</p>
  </div>`;
}

function postscriptText(): string {
  return `\n\np.s. "You're Just One Trade Away..." — 10XChris.eth: https://x.com/10XChrisX\np.p.s. Holding 10X Warplets (https://warplet.10x.meme) NFTs with higher Levels will boost your airdrops and perks.`;
}

function footer(): string {
  return `<div style="border-top:1px solid #174117;margin-top:30px;padding-top:20px;text-align:center;color:#8db58d;font-size:12px;line-height:1.7">
    <div>© 2026 Code Hunt Pty. Ltd. All rights reserved.</div>
    <div><a href="https://10x.meme/terms" style="color:#00ff00">Terms of Service</a> ｜ <a href="https://10x.meme/privacy" style="color:#00ff00">Privacy Policy</a></div>
    <div><a href="{{{RESEND_UNSUBSCRIBE_URL}}}" style="color:#00ff00">Unsubscribe</a></div>
  </div>`;
}

function layout(preview: string, content: string): string {
  return `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="dark"><style>
    @media only screen and (max-width:520px){.shell{width:100%!important}.pad{padding:20px 14px!important}.link-card{width:33.333%!important}.link-img{height:auto!important;width:100%!important}}
  </style></head><body style="margin:0;background:#001400;color:#e7ffe7;font-family:Arial,Helvetica,sans-serif">${preheader(preview)}
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#001400"><tr><td align="center" style="padding:20px 8px">
      <table role="presentation" class="shell" width="500" cellspacing="0" cellpadding="0" style="width:500px;max-width:100%;background:#000;border:1px solid #005a19;border-radius:14px"><tr><td class="pad" style="padding:24px">
        ${content}${postscript()}${footer()}
      </td></tr></table>
    </td></tr></table></body></html>`;
}

function legalText(): string {
  return `\n\n© 2026 Code Hunt Pty. Ltd. All rights reserved.\nTerms of Service: https://10x.meme/terms ｜ Privacy Policy: https://10x.meme/privacy\nUnsubscribe: {{{RESEND_UNSUBSCRIBE_URL}}}`;
}

function welcomeTemplate(): TemplateSpec {
  const preview = "You're now part of the 10X community—building a connected ecosystem across Memes, RWAs, NFTs, AI, Attention, and Alpha.";
  const links = [
    ["1️⃣ $10X Waitlist: 10X.MEME", "https://10x.meme"],
    ["2️⃣ NFT: 10X Warplets", "https://warplet.10x.meme"],
    ["3️⃣ Discord: The 10X Network", "https://discord.gg/X7QrXueZkn"],
  ] as const;
  const content = `<h1 style="color:#00ff00;font-size:24px;line-height:1.2;margin:0 0 12px">Welcome to 10X!</h1>
    <p style="font-size:15px;line-height:1.6;margin:0 0 18px">${escapeHtml(preview)}</p>
    <p style="font-size:15px;line-height:1.6;margin:0 0 16px">Here are three good places to start:</p>
    ${links.map(([label, href]) => `<p style="margin:0 0 12px">${button(label, href)}</p>`).join("")}`;
  return {
    stepKey: "welcome",
    alias: "10x-onboarding-v1-01-welcome",
    subject: "Welcome to 10X!",
    html: layout(preview, content),
    text: `Welcome to 10X!\n\n${preview}\n\n${links.map(([label, href]) => `${label}: ${href}`).join("\n")}${postscriptText()}${legalText()}`,
  };
}

const PERK_ORDER: PerksSubpage[] = ["memes", "rwas", "nfts", "ai", "attention", "alpha"];

function perkTemplate(id: PerksSubpage, index: number): TemplateSpec {
  const definition = PERKS_DEFINITIONS[id];
  const share = PERKS_SHARE_CONTENT[id];
  const subject = `10X ${share.label}: ${share.eyebrow}`;
  const route = `https://warplet.10x.meme/perks/${id}`;
  const explanations = definition.explanation.map((item) => {
    const paragraphs = item.body.split(/\n\n+/).map((paragraph) => `<p style="font-size:15px;line-height:1.65;margin:0 0 14px">${escapeHtml(paragraph).replace(/\n/g, "<br>")}</p>`).join("");
    return `<h2 style="color:#00ff00;font-size:18px;margin:24px 0 8px">${escapeHtml(item.title)}</h2>${paragraphs}`;
  }).join("");
  const content = `<h1 style="color:#00ff00;font-size:24px;line-height:1.2;margin:0 0 12px">${escapeHtml(subject)}</h1>
    <p style="font-size:15px;line-height:1.6;margin:0 0 20px"><strong>${escapeHtml(share.summary)}</strong></p>
    <div style="margin:0 0 22px">${imageButtonCard(`View 10X ${share.label} Mockup`, route, `https://warplets.10x.meme/${share.tokenId}.png`)}</div>
    <p style="background:#2a2600;border:1px solid #a79d00;border-radius:8px;padding:12px;color:#fff7a8;font-size:13px;line-height:1.5">⚠️ Future 10X Ecosystem. Plans may change.</p>
    ${explanations}
    <p style="font-size:20px;line-height:1.35;font-weight:900;color:#00ff00;margin:26px 0">${escapeHtml(share.callout)}</p>
    <table role="presentation" cellspacing="0" cellpadding="0"><tr>
      <td style="padding:0 8px 8px 0">${button("Preview", route)}</td>
      <td style="padding:0 8px 8px 0">${button("Share", `${route}?share=1`)}</td>
      <td style="padding:0 0 8px">${button("Discuss", "https://discord.gg/G5P5cV94Uz")}</td>
    </tr></table>`;
  const bodyText = definition.explanation.map((item) => `${item.title}\n${item.body}`).join("\n\n");
  return {
    stepKey: id,
    alias: `10x-onboarding-v1-${String(index + 2).padStart(2, "0")}-${id}`,
    subject,
    html: layout(share.summary, content),
    text: `${subject}\n\n${share.summary}\n\nView 10X ${share.label} Mockup: ${route}\n\n⚠️ Future 10X Ecosystem. Plans may change.\n\n${bodyText}\n\n${share.callout}\n\nPreview: ${route}\nShare: ${route}?share=1\nDiscuss: https://discord.gg/G5P5cV94Uz${postscriptText()}${legalText()}`,
  };
}

const SOCIAL_LINKS = [
  ["10X Warplets", "/menu/10xwarplets.jpg", "https://warplet.10x.meme/"],
  ["Farcaster", "/menu/farcaster.png", "https://farcaster.xyz/10xmeme.eth"],
  ["X (Twitter)", "/menu/x.png", "https://twitter.com/intent/follow?user_id=3275559396"],
  ["Discord", "/menu/discord.png", "https://discord.gg/X7QrXueZkn"],
  ["Telegram", "/menu/telegram.png", "https://t.me/The10XNetwork"],
  ["OpenSea", "/menu/opensea.png", "https://link.10x.meme/10xwarplets"],
  ["FOMO", "/menu/fomo.jpg", "https://fomo.family/profile/10XMemeX"],
  ["Pump.fun", "/menu/pumpfun.png", "https://pump.fun/profile/10XMemeX"],
  ["YouTube", "https://www.gstatic.com/youtube/img/branding/favicon/favicon_144x144.png", "https://www.youtube.com/@10XMemeX"],
] as const;

function socialTemplate(): TemplateSpec {
  const preview = "(so you don't miss out)";
  const rows = Array.from({ length: 3 }, (_, row) => SOCIAL_LINKS.slice(row * 3, row * 3 + 3));
  const grid = rows.map((items) => `<tr>${items.map(([label, image, href]) => `<td class="link-card" width="33.333%" valign="top" style="padding:5px">
    <a href="${escapeHtml(href)}" style="display:block;border:1px solid #00a52a;border-radius:10px;overflow:hidden;text-decoration:none;background:#001b08">
      <img class="link-img" src="${absoluteAsset(image)}" width="166" height="150" alt="${escapeHtml(label)}" style="display:block;width:100%;height:150px;object-fit:cover;border:0">
      <span style="display:block;background:#00ff00;color:#003300;text-align:center;padding:9px 3px;font-weight:700;font-size:14px">${escapeHtml(label)}</span>
    </a>
  </td>`).join("")}</tr>`).join("");
  const content = `<h1 style="color:#00ff00;font-size:24px;line-height:1.25;text-align:center;margin:0 0 4px">Follow + <span style="white-space:nowrap">Notifications&nbsp;ON&nbsp;🔔</span></h1>
    <p style="font-size:14px;text-align:center;margin:0 0 20px"><strong>(so you don't miss out)</strong></p>
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0">${grid}</table>`;
  return {
    stepKey: "follow",
    alias: "10x-onboarding-v1-08-follow",
    subject: "Follow + Notifications ON 🔔",
    html: layout(preview, content),
    text: `Follow + Notifications ON 🔔\n${preview}\n\n${SOCIAL_LINKS.map(([label, , href]) => `${label}: ${href}`).join("\n")}${postscriptText()}${legalText()}`,
  };
}

const templates = [welcomeTemplate(), ...PERK_ORDER.map(perkTemplate), socialTemplate()];

function validateTemplates(): void {
  if (templates.length !== 8) throw new Error("The onboarding sequence must contain exactly eight templates");
  if (new Set(templates.map((template) => template.alias)).size !== templates.length) throw new Error("Template aliases must be unique");
  for (const template of templates) {
    for (const required of [
      "{{{RESEND_UNSUBSCRIBE_URL}}}",
      "© 2026 Code Hunt Pty. Ltd.",
      "https://10x.meme/terms",
      "https://10x.meme/privacy",
      "Just One Trade Away...",
      "https://x.com/10XChrisX",
      "https://warplet.10x.meme",
    ]) {
      if (!template.html.includes(required) || !template.text.includes(required)) {
        throw new Error(`${template.alias} is missing required content: ${required}`);
      }
    }
  }
  if (!templates.every((template) => template.html.includes('class="shell" width="500"'))) throw new Error("Every email must use the 500px mini-app shell width");
  for (const [, , href] of SOCIAL_LINKS) {
    if (!templates[7].html.includes(href) || !templates[7].text.includes(href)) throw new Error(`Final email is missing ${href}`);
  }
}

async function resend(path: string, init: RequestInit = {}): Promise<ApiObject> {
  const response = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
      "user-agent": "10x-onboarding-provisioner/1.0",
      ...(init.headers ?? {}),
    },
  });
  const payload = await response.json().catch(() => ({})) as ApiObject;
  if (!response.ok) throw new Error(`${init.method ?? "GET"} ${path} failed (${response.status}): ${JSON.stringify(payload)}`);
  return payload;
}

async function getOrCreateTemplate(spec: TemplateSpec): Promise<{ id: string; publishedAt: string }> {
  // Resend limits the internal template display name to 50 characters. Keep
  // the complete customer-facing subject while using the stable step key for
  // the shorter internal name.
  const body = {
    name: `10X onboarding v${VERSION}: ${spec.stepKey}`,
    alias: spec.alias,
    from,
    subject: spec.subject,
    html: spec.html,
    text: spec.text,
  };
  let existing: ApiObject | null = null;
  const response = await fetch(`${API}/templates/${encodeURIComponent(spec.alias)}`, {
    headers: { authorization: `Bearer ${apiKey}`, "user-agent": "10x-onboarding-provisioner/1.0" },
  });
  if (response.ok) existing = await response.json() as ApiObject;
  else if (response.status !== 404) throw new Error(`GET template ${spec.alias} failed (${response.status})`);
  const result = existing
    ? await resend(`/templates/${encodeURIComponent(spec.alias)}`, { method: "PATCH", body: JSON.stringify(body) })
    : await resend("/templates", { method: "POST", body: JSON.stringify(body) });
  const id = String(result.id ?? existing?.id ?? "");
  if (!id) throw new Error(`Template ${spec.alias} returned no ID`);
  await resend(`/templates/${encodeURIComponent(id)}/publish`, { method: "POST" });
  return { id, publishedAt: new Date().toISOString() };
}

async function ensureEvent(): Promise<void> {
  const response = await fetch(`${API}/events/${encodeURIComponent(EVENT_NAME)}`, {
    headers: { authorization: `Bearer ${apiKey}`, "user-agent": "10x-onboarding-provisioner/1.0" },
  });
  if (response.ok) {
    await resend(`/events/${encodeURIComponent(EVENT_NAME)}`, {
      method: "PATCH",
      body: JSON.stringify({ schema: { start_step: "number", onboarding_version: "number" } }),
    });
    return;
  }
  if (response.status !== 404) throw new Error(`GET event failed (${response.status})`);
  await resend("/events", {
    method: "POST",
    body: JSON.stringify({ name: EVENT_NAME, schema: { start_step: "number", onboarding_version: "number" } }),
  });
}

function automationGraph(templateIds: string[]) {
  const firstDelay = testDelays ? "1 minute" : "1 minute";
  const dailyDelay = testDelays ? "1 minute" : "1 day";
  // Resend's public examples use camelCase at the SDK boundary, but its REST
  // wire format requires the trigger field to be serialized as `event_name`.
  const steps: ApiObject[] = [{ key: "start", type: "trigger", config: { event_name: EVENT_NAME } }];
  const connections: ApiObject[] = [];
  for (let index = 0; index < 7; index += 1) {
    steps.push({ key: `resume_at_${index}`, type: "condition", config: { type: "rule", field: "event.start_step", operator: "eq", value: index } });
    connections.push({ from: index === 0 ? "start" : `resume_at_${index - 1}`, to: `resume_at_${index}`, type: index === 0 ? "default" : "condition_not_met" });
  }
  // Each resume branch has its own linear suffix. Avoiding graph joins makes it
  // unambiguous that a resumed contact does not wait on an inactive earlier path.
  for (let startIndex = 0; startIndex < 8; startIndex += 1) {
    const resumeDelayKey = `resume_${startIndex}_delay`;
    steps.push({ key: resumeDelayKey, type: "delay", config: { duration: firstDelay } });
    connections.push({
      from: startIndex < 7 ? `resume_at_${startIndex}` : "resume_at_6",
      to: resumeDelayKey,
      type: startIndex < 7 ? "condition_met" : "condition_not_met",
    });
    let previousKey = resumeDelayKey;
    for (let emailIndex = startIndex; emailIndex < 8; emailIndex += 1) {
      if (emailIndex > startIndex) {
        const delayKey = `resume_${startIndex}_daily_${emailIndex}`;
        steps.push({ key: delayKey, type: "delay", config: { duration: dailyDelay } });
        connections.push({ from: previousKey, to: delayKey, type: "default" });
        previousKey = delayKey;
      }
      const emailKey = `resume_${startIndex}_email_${emailIndex}`;
      steps.push({ key: emailKey, type: "send_email", config: { template: { id: templateIds[emailIndex] } } });
      connections.push({ from: previousKey, to: emailKey, type: "default" });
      previousKey = emailKey;
    }
  }
  if (steps.length > 150) throw new Error(`Automation graph has ${steps.length} steps; Resend permits 150`);
  return { name: `10X Onboarding v${VERSION}${testDelays ? " TEST DELAYS" : ""}`, status: "disabled", steps, connections };
}

async function ensureAutomation(templateIds: string[]): Promise<string> {
  const graph = automationGraph(templateIds);
  const listed = await resend("/automations?limit=100");
  const existing = (Array.isArray(listed.data) ? listed.data : []).find((item) => (
    item && typeof item === "object" && (item as ApiObject).name === graph.name
  )) as ApiObject | undefined;
  if (existing?.id) return String(existing.id);
  const created = await resend("/automations", { method: "POST", body: JSON.stringify(graph) });
  const id = String(created.id ?? "");
  if (!id) throw new Error("Automation creation returned no ID");
  return id;
}

const WEBHOOK_EVENTS = [
  "email.sent", "email.delivered", "email.opened", "email.clicked", "email.delivery_delayed",
  "email.failed", "email.suppressed", "email.bounced", "email.complained",
];

async function ensureWebhook(): Promise<{ id: string; signingSecret: string | null }> {
  const endpoint = `${webhookOrigin}/api/webhooks/resend`;
  const listed = await resend("/webhooks");
  const existing = (Array.isArray(listed.data) ? listed.data : []).find((item) => (
    item && typeof item === "object" && (item as ApiObject).endpoint === endpoint
  )) as ApiObject | undefined;
  if (existing?.id) {
    const webhookId = String(existing.id);
    await resend(`/webhooks/${encodeURIComponent(String(existing.id))}`, {
      method: "PATCH",
      body: JSON.stringify({ endpoint, events: WEBHOOK_EVENTS, status: "enabled" }),
    });
    // List responses may omit the signing secret. Retrieve the existing
    // webhook explicitly so repeat provisioning preserves it in the local,
    // gitignored configuration file instead of overwriting it with null.
    const retrieved = await resend(`/webhooks/${encodeURIComponent(webhookId)}`);
    return {
      id: webhookId,
      signingSecret: typeof retrieved.signing_secret === "string" ? retrieved.signing_secret : null,
    };
  }
  const created = await resend("/webhooks", { method: "POST", body: JSON.stringify({ endpoint, events: WEBHOOK_EVENTS }) });
  return { id: String(created.id ?? ""), signingSecret: typeof created.signing_secret === "string" ? created.signing_secret : null };
}

async function registerConfig(payload: ApiObject): Promise<void> {
  if (!adminToken || !adminSession) throw new Error("ADMIN_API_TOKEN and ADMIN_SESSION_TOKEN are required to register IDs in D1");
  const response = await fetch(`${adminOrigin}/api/admin/email-onboarding/config`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-admin-token": adminToken,
      "x-admin-session": adminSession,
    },
    body: JSON.stringify(payload),
  });
  if (!response.ok) throw new Error(`D1 configuration registration failed (${response.status}): ${(await response.text()).slice(0, 300)}`);
}

async function main(): Promise<void> {
  validateTemplates();
  console.log(JSON.stringify({
    mode: apply ? "apply" : "dry-run",
    event: EVENT_NAME,
    templates: templates.map(({ alias, subject }) => ({ alias, subject })),
    automation: automationGraph(templates.map((template) => `<${template.alias}>`)),
    webhook: `${webhookOrigin}/api/webhooks/resend`,
    testDelays,
  }, null, 2));
  if (!apply) {
    console.log("Dry run only. Re-run with --apply after reviewing the generated resource plan.");
    return;
  }
  if (!apiKey) throw new Error("RESEND_API_KEY is required with --apply");
  await ensureEvent();
  const provisionedTemplates = [];
  for (let index = 0; index < templates.length; index += 1) {
    const result = await getOrCreateTemplate(templates[index]);
    provisionedTemplates.push({
      stepIndex: index,
      stepKey: templates[index].stepKey,
      templateId: result.id,
      subject: templates[index].subject,
      publishedAt: result.publishedAt,
    });
  }
  const automationId = await ensureAutomation(provisionedTemplates.map((template) => template.templateId));
  const webhook = await ensureWebhook();
  const config = { version: VERSION, eventName: EVENT_NAME, automationId, webhookId: webhook.id, templates: provisionedTemplates };
  if (!testDelays && !skipRegister) await registerConfig(config);
  const outputDirectory = resolve(".onboarding-provisioning");
  await mkdir(outputDirectory, { recursive: true });
  const outputPath = resolve(outputDirectory, `resend-onboarding-v${VERSION}.json`);
  await writeFile(outputPath, `${JSON.stringify({ ...config, webhookSigningSecret: webhook.signingSecret }, null, 2)}\n`, { mode: 0o600 });
  console.log(`Provisioned disabled Automation ${automationId}. Configuration saved to ${outputPath}.`);
  if (testDelays) console.log("Test-delay resources were not registered in D1. Enable them only while sending the controlled test event.");
  if (skipRegister) console.log("D1 registration was skipped; register the saved configuration before enabling production onboarding.");
  if (webhook.signingSecret) console.log("A new webhook signing secret was saved locally; set it as RESEND_WEBHOOK_SECRET before testing.");
}

await main();
