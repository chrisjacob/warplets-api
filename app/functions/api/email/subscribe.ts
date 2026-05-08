interface Env {
  WARPLETS: D1Database;
  RESEND_API_KEY?: string;
  RESEND_FROM_EMAIL?: string;
  WARPLETS_KV?: KVNamespace;
}
import { getClientIp, jsonSecure, rateLimit, readJsonBody } from "../../_lib/security.js";

interface SubscribeBody {
  email?: unknown;
  fid?: unknown;
  username?: unknown;
  tokenId?: unknown;
  matched?: unknown;
}

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const RESEND_SEGMENT_ID = "e52bdc31-4f3c-4ec6-a623-9bc3977042e2";
const RESEND_TOPIC_ID = "c3e8d591-73e6-4e98-a873-5e197a8581ee";
const ALLOWED_ORIGINS = new Set([
  "https://10x.meme",
  "https://www.10x.meme",
  "https://app.10x.meme",
  "https://drop.10x.meme",
  "https://drop-dev.10x.meme",
  "https://web-dev.10x.meme",
]);

function buildCorsHeaders(request: Request): Headers {
  const headers = new Headers();
  const origin = request.headers.get("origin") ?? "";
  if (ALLOWED_ORIGINS.has(origin)) {
    headers.set("access-control-allow-origin", origin);
  }
  headers.set("access-control-allow-methods", "POST,OPTIONS");
  headers.set("access-control-allow-headers", "content-type");
  return headers;
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function asPositiveInteger(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : null;
}

function asBoolean(value: unknown): boolean {
  return value === true;
}

function buildVerifyEmailHtml(verifyUrl: string, unsubscribeUrl: string): string {
  return `
  <div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;padding:20px;color:#111;">
    <h2 style="margin:0 0 14px;">Welcome to 10X Meme</h2>
    <p style="margin:0 0 12px;">Thanks for joining the waitlist.</p>
    <p style="margin:0 0 18px;">Please verify your email to confirm your spot:</p>
    <p style="margin:0 0 24px;">
      <a href="${verifyUrl}" style="display:inline-block;background:#00FF00;color:#053505;text-decoration:none;padding:10px 16px;border-radius:8px;font-weight:700;">Verify Email</a>
    </p>
    <p style="margin:0;color:#555;font-size:12px;word-break:break-all;">If the button doesn't work, use this link: ${verifyUrl}</p>
    <hr style="margin:20px 0;border:none;border-top:1px solid #eee;" />
    <p style="margin:0;color:#999;font-size:11px;">You received this email because you signed up at 10x.meme. <a href="${unsubscribeUrl}" style="color:#999;">Unsubscribe</a></p>
  </div>
  `;
}

function toPropertyValue(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return JSON.stringify(value);
}

async function loadWarpletsUserProperties(
  db: D1Database,
  fid: number
): Promise<{ properties: Record<string, string>; username: string; fidString: string } | null> {
  const schema = await db.prepare(`PRAGMA table_info("warplets_users")`).all<{ name: string }>();
  const columnNames = (schema.results ?? [])
    .map((row) => row.name)
    .filter((name): name is string => typeof name === "string" && name.length > 0);

  if (columnNames.length === 0) return null;

  const userRow = await db
    .prepare("SELECT * FROM warplets_users WHERE fid = ? LIMIT 1")
    .bind(fid)
    .first<Record<string, unknown>>();

  if (!userRow) return null;

  const properties: Record<string, string> = {};
  for (const columnName of columnNames) {
    properties[columnName] = toPropertyValue(userRow[columnName]);
  }

  const username = typeof userRow.username === "string" ? userRow.username : "";
  const fidString = typeof userRow.fid === "number" ? String(userRow.fid) : String(fid);

  return { properties, username, fidString };
}

async function upsertResendContact(
  resendApiKey: string,
  email: string,
  firstName: string,
  lastName: string,
  properties: Record<string, string>
): Promise<void> {
  const createResponse = await fetch("https://api.resend.com/contacts", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      Authorization: `Bearer ${resendApiKey}`,
    },
    body: JSON.stringify({
      email,
      firstName,
      lastName,
      unsubscribed: false,
      properties,
      segments: [{ id: RESEND_SEGMENT_ID }],
      topics: [{ id: RESEND_TOPIC_ID, subscription: "opt_in" }],
    }),
  });

  if (createResponse.ok) return;

  const updateResponse = await fetch("https://api.resend.com/contacts", {
    method: "PATCH",
    headers: {
      "content-type": "application/json",
      Authorization: `Bearer ${resendApiKey}`,
    },
    body: JSON.stringify({
      email,
      firstName,
      lastName,
      unsubscribed: false,
      properties,
      segments: [{ id: RESEND_SEGMENT_ID }],
      topics: [{ id: RESEND_TOPIC_ID, subscription: "opt_in" }],
    }),
  });

  if (!updateResponse.ok) {
    const createText = await createResponse.text().catch(() => "");
    const updateText = await updateResponse.text().catch(() => "");
    console.error("Resend contact upsert failed:", createText || createResponse.statusText, updateText || updateResponse.statusText);
  }
}

export const onRequestOptions: PagesFunction<Env> = async (context) => {
  return new Response(null, { status: 204, headers: buildCorsHeaders(context.request) });
};

export const onRequestPost: PagesFunction<Env> = async (context) => {
  const corsHeaders = buildCorsHeaders(context.request);
  const ip = getClientIp(context.request);
  const ipRate = await rateLimit(context.env.WARPLETS_KV, "email-subscribe-ip", ip, 30, 60);
  if (!ipRate.allowed) {
    const response = jsonSecure({ error: "Rate limit exceeded" }, { status: 429, headers: corsHeaders });
    response.headers.set("retry-after", String(ipRate.retryAfterSeconds));
    return response;
  }

  const parsedBody = await readJsonBody<SubscribeBody>(context.request);
  if (!parsedBody.ok) {
    const response = parsedBody.response;
    const headers = new Headers(response.headers);
    corsHeaders.forEach((value, key) => headers.set(key, value));
    return new Response(response.body, { status: response.status, headers });
  }
  const body = parsedBody.value;

  const rawEmail = asString(body.email);
  const email = rawEmail?.toLowerCase() ?? "";
  if (!email || !EMAIL_REGEX.test(email)) {
    return jsonSecure({ error: "A valid email is required" }, { status: 400, headers: corsHeaders });
  }

  const fid = asPositiveInteger(body.fid);
  const username = asString(body.username);
  const tokenId = asPositiveInteger(body.tokenId);
  const matched = asBoolean(body.matched) ? 1 : 0;

  const now = new Date().toISOString();
  const verifyToken = crypto.randomUUID().replace(/-/g, "");

  await context.env.WARPLETS.prepare(
    `INSERT INTO email_waitlist (
        email, fid, username, token_id, matched, verified, verify_token, subscribed_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?)
      ON CONFLICT(email) DO UPDATE SET
        fid = excluded.fid,
        username = excluded.username,
        token_id = excluded.token_id,
        matched = excluded.matched,
        verify_token = CASE
          WHEN email_waitlist.verified = 1 THEN email_waitlist.verify_token
          ELSE excluded.verify_token
        END,
        unsubscribed_at = NULL,
        updated_at = excluded.updated_at`
  )
    .bind(email, fid, username, tokenId, matched, verifyToken, now, now)
    .run();

  const row = await context.env.WARPLETS.prepare(
    `SELECT verified, verify_token FROM email_waitlist WHERE email = ? LIMIT 1`
  )
    .bind(email)
    .first<{ verified: number; verify_token: string }>();

  if (!row) {
    return jsonSecure({ error: "Failed to persist waitlist record" }, { status: 500, headers: corsHeaders });
  }

  const alreadyVerified = row.verified === 1;
  const resendApiKey = context.env.RESEND_API_KEY?.trim();
  const fromEmail = context.env.RESEND_FROM_EMAIL?.trim() || "10X Meme <10x@10x.meme>";

  let verificationEmailSent = false;

  if (resendApiKey) {
    const userProps = fid ? await loadWarpletsUserProperties(context.env.WARPLETS, fid) : null;
    const firstName = userProps?.username || username || "";
    const lastName = userProps?.fidString || (fid ? String(fid) : "");
    const properties = userProps?.properties ?? {};

    await upsertResendContact(resendApiKey, email, firstName, lastName, properties);
  }

  if (!alreadyVerified && resendApiKey) {
    const verifyUrl = new URL(context.request.url);
    verifyUrl.pathname = "/api/email/verify";
    verifyUrl.search = "";
    verifyUrl.searchParams.set("token", row.verify_token);

    const unsubscribeUrl = new URL(context.request.url);
    unsubscribeUrl.pathname = "/api/email/unsubscribe";
    unsubscribeUrl.search = "";
    unsubscribeUrl.searchParams.set("email", email);
    unsubscribeUrl.searchParams.set("token", row.verify_token);

    const resendResponse = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        Authorization: `Bearer ${resendApiKey}`,
      },
      body: JSON.stringify({
        from: fromEmail,
        to: [email],
        subject: "Verify your 10X Meme email",
        html: buildVerifyEmailHtml(verifyUrl.toString(), unsubscribeUrl.toString()),
      }),
    });

    verificationEmailSent = resendResponse.ok;
    if (!resendResponse.ok) {
      const text = await resendResponse.text().catch(() => "");
      console.error("Resend verification email failed:", text || resendResponse.statusText);
    }
  }

  return jsonSecure({
    success: true,
    email,
    alreadyVerified,
    verificationEmailSent,
  }, { headers: corsHeaders });
};
