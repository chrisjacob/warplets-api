interface Env {
  WARPLETS: D1Database;
  RESEND_API_KEY?: string;
  RESEND_FROM_EMAIL?: string;
  WARPLETS_KV?: KVNamespace;
  SECURITY_LOG_SALT?: string;
  ACTION_SESSION_SECRET?: string;
  ALLOW_INSECURE_ACTION_FID_FALLBACK?: string;
}
import {
  getClientIp,
  jsonSecure,
  logSecurityEvent,
  rateLimit,
  readJsonBodyWithLimit,
  verifyActionSessionToken,
} from "../../_lib/security.js";
import { outboundFetch } from "../../_lib/outbound.js";

interface SubscribeBody {
  email?: unknown;
  fid?: unknown;
  username?: unknown;
  tokenId?: unknown;
  matched?: unknown;
  sessionToken?: unknown;
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

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function hasOnlyAllowedKeys(value: Record<string, unknown>, allowedKeys: string[]): boolean {
  return Object.keys(value).every((key) => allowedKeys.includes(key));
}

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
  if (typeof value === "number" && Number.isInteger(value) && value > 0) return value;
  if (typeof value === "string" && /^\d+$/.test(value.trim())) {
    const parsed = Number.parseInt(value.trim(), 10);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
  }
  return null;
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
  const contactPath = `https://api.resend.com/contacts/${encodeURIComponent(email)}`;
  const headers = {
    "content-type": "application/json",
    Authorization: `Bearer ${resendApiKey}`,
  };
  const contactBody = {
    email,
    firstName,
    lastName,
    unsubscribed: false,
    properties,
    segments: [{ id: RESEND_SEGMENT_ID }],
    topics: [{ id: RESEND_TOPIC_ID, subscription: "opt_in" }],
  };

  try {
    const createResponse = await outboundFetch("https://api.resend.com/contacts", {
      method: "POST",
      headers,
      body: JSON.stringify(contactBody),
    });

    if (!createResponse.ok) {
      const updateResponse = await outboundFetch(contactPath, {
        method: "PATCH",
        headers,
        body: JSON.stringify({
          firstName,
          lastName,
          unsubscribed: false,
          properties,
        }),
      });

      if (!updateResponse.ok) {
        const createText = await createResponse.text().catch(() => "");
        const updateText = await updateResponse.text().catch(() => "");
        console.error("Resend contact upsert failed:", createText || createResponse.statusText, updateText || updateResponse.statusText);
        return;
      }
    }

    const segmentResponse = await outboundFetch(
      `${contactPath}/segments/${RESEND_SEGMENT_ID}`,
      {
        method: "POST",
        headers,
      }
    );
    if (!segmentResponse.ok && segmentResponse.status !== 409) {
      const text = await segmentResponse.text().catch(() => "");
      console.error("Resend segment add failed:", text || segmentResponse.statusText);
    }

    const topicResponse = await outboundFetch(`${contactPath}/topics`, {
      method: "PATCH",
      headers,
      body: JSON.stringify({
        topics: [{ id: RESEND_TOPIC_ID, subscription: "opt_in" }],
      }),
    });

    if (!topicResponse.ok) {
      const text = await topicResponse.text().catch(() => "");
      console.error("Resend topic opt-in failed:", text || topicResponse.statusText);
    }
  } catch (error) {
    console.error("Resend contact upsert failed:", error);
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
    await logSecurityEvent(context.env.WARPLETS, { logSalt: context.env.SECURITY_LOG_SALT }, {
      eventType: "rate_limit",
      outcome: "email_subscribe_rate_limited",
      actorType: "ip",
      ipAddress: ip,
      route: new URL(context.request.url).pathname,
    });
    const response = jsonSecure({ error: "Rate limit exceeded" }, { status: 429, headers: corsHeaders });
    response.headers.set("retry-after", String(ipRate.retryAfterSeconds));
    return response;
  }

  const parsedBody = await readJsonBodyWithLimit<unknown>(context.request, 8 * 1024);
  if (!parsedBody.ok) {
    const response = parsedBody.response;
    const headers = new Headers(response.headers);
    corsHeaders.forEach((value, key) => headers.set(key, value));
    return new Response(response.body, { status: response.status, headers });
  }
  if (!isPlainObject(parsedBody.value)) {
    return jsonSecure({ error: "Invalid JSON payload" }, { status: 400, headers: corsHeaders });
  }
  if (!hasOnlyAllowedKeys(parsedBody.value, ["email", "fid", "username", "tokenId", "matched", "sessionToken"])) {
    return jsonSecure({ error: "Unexpected fields in payload" }, { status: 400, headers: corsHeaders });
  }
  const body = parsedBody.value as SubscribeBody;

  const rawEmail = asString(body.email);
  const email = rawEmail?.toLowerCase() ?? "";
  if (!email || !EMAIL_REGEX.test(email)) {
    return jsonSecure({ error: "A valid email is required" }, { status: 400, headers: corsHeaders });
  }

  const requestUrl = new URL(context.request.url);
  const sessionToken = asString(body.sessionToken);
  const session = await verifyActionSessionToken(context.env.ACTION_SESSION_SECRET, sessionToken);
  const bodyFid = asPositiveInteger(body.fid);
  const allowInsecureFallback =
    context.env.ALLOW_INSECURE_ACTION_FID_FALLBACK === "1" &&
    (
      requestUrl.hostname.includes("-local.") ||
      requestUrl.hostname.includes("-dev.") ||
      requestUrl.hostname.endsWith(".pages.dev") ||
      requestUrl.hostname === "127.0.0.1" ||
      requestUrl.hostname === "localhost" ||
      requestUrl.hostname === "::1"
    );
  const fid = session.valid ? session.fid : (allowInsecureFallback ? bodyFid : null);
  if (!session.valid && bodyFid && !allowInsecureFallback) {
    await logSecurityEvent(context.env.WARPLETS, { logSalt: context.env.SECURITY_LOG_SALT }, {
      eventType: "email_subscribe_auth",
      outcome: session.reason,
      actorType: "ip",
      ipAddress: ip,
      route: requestUrl.pathname,
      details: "fid_rejected_without_valid_session",
    });
  }
  const username = asString(body.username);
  const tokenId = asPositiveInteger(body.tokenId);
  const matched = asBoolean(body.matched) ? 1 : 0;

  if (fid) {
    const fidRate = await rateLimit(context.env.WARPLETS_KV, "email-subscribe-fid", String(fid), 8, 300);
    if (!fidRate.allowed) {
      const response = jsonSecure({ error: "Rate limit exceeded" }, { status: 429, headers: corsHeaders });
      response.headers.set("retry-after", String(fidRate.retryAfterSeconds));
      return response;
    }
  }

  if (sessionToken) {
    const sessionRate = await rateLimit(context.env.WARPLETS_KV, "email-subscribe-session", sessionToken, 12, 300);
    if (!sessionRate.allowed) {
      const response = jsonSecure({ error: "Rate limit exceeded" }, { status: 429, headers: corsHeaders });
      response.headers.set("retry-after", String(sessionRate.retryAfterSeconds));
      return response;
    }
  }

  const now = new Date().toISOString();
  const verifyToken = crypto.randomUUID().replace(/-/g, "");
  const existingRow = await context.env.WARPLETS.prepare(
    `SELECT verified, verify_token, unsubscribed_at
     FROM email_waitlist
     WHERE email = ?
     LIMIT 1`
  )
    .bind(email)
    .first<{ verified: number; verify_token: string; unsubscribed_at: string | null }>();
  const hadPendingUnverifiedBefore =
    Boolean(existingRow) &&
    existingRow?.verified === 0 &&
    existingRow?.unsubscribed_at === null;
  const tokenToPersist = hadPendingUnverifiedBefore
    ? existingRow?.verify_token ?? verifyToken
    : verifyToken;

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
          WHEN email_waitlist.unsubscribed_at IS NULL THEN email_waitlist.verify_token
          ELSE excluded.verify_token
        END,
        unsubscribed_at = NULL,
        updated_at = excluded.updated_at`
  )
    .bind(email, fid, username, tokenId, matched, tokenToPersist, now, now)
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

  if (!alreadyVerified && resendApiKey && !hadPendingUnverifiedBefore) {
    const verifyUrl = new URL(context.request.url);
    verifyUrl.pathname = "/api/email/verify";
    verifyUrl.search = "";
    verifyUrl.searchParams.set("token", row.verify_token);

    const unsubscribeUrl = new URL(context.request.url);
    unsubscribeUrl.pathname = "/api/email/unsubscribe";
    unsubscribeUrl.search = "";
    unsubscribeUrl.searchParams.set("email", email);
    unsubscribeUrl.searchParams.set("token", row.verify_token);

    try {
      const resendResponse = await outboundFetch("https://api.resend.com/emails", {
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
    } catch (error) {
      verificationEmailSent = false;
      console.error("Resend verification email failed:", error);
    }
  }

  return jsonSecure({
    success: true,
    email,
    alreadyVerified,
    verificationEmailSent,
  }, { headers: corsHeaders });
};
