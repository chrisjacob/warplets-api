interface Env {
  WARPLETS: D1Database;
  RESEND_API_KEY?: string;
  RESEND_FROM_EMAIL?: string;
}

interface SubscribeBody {
  email?: unknown;
  fid?: unknown;
  username?: unknown;
  tokenId?: unknown;
  matched?: unknown;
}

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ALLOWED_ORIGINS = new Set([
  "https://10x.meme",
  "https://www.10x.meme",
  "https://app.10x.meme",
  "https://drop.10x.meme",
  "https://drop-dev.10x.meme",
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

function buildVerifyEmailHtml(verifyUrl: string): string {
  return `
  <div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;padding:20px;color:#111;">
    <h2 style="margin:0 0 14px;">Welcome to 10X Meme</h2>
    <p style="margin:0 0 12px;">Thanks for joining the waitlist.</p>
    <p style="margin:0 0 18px;">Please verify your email to confirm your spot:</p>
    <p style="margin:0 0 24px;">
      <a href="${verifyUrl}" style="display:inline-block;background:#00FF00;color:#053505;text-decoration:none;padding:10px 16px;border-radius:8px;font-weight:700;">Verify Email</a>
    </p>
    <p style="margin:0;color:#555;font-size:12px;word-break:break-all;">If the button doesn't work, use this link: ${verifyUrl}</p>
  </div>
  `;
}

export const onRequestOptions: PagesFunction<Env> = async (context) => {
  return new Response(null, { status: 204, headers: buildCorsHeaders(context.request) });
};

export const onRequestPost: PagesFunction<Env> = async (context) => {
  const corsHeaders = buildCorsHeaders(context.request);

  let body: SubscribeBody;
  try {
    body = (await context.request.json()) as SubscribeBody;
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400, headers: corsHeaders });
  }

  const rawEmail = asString(body.email);
  const email = rawEmail?.toLowerCase() ?? "";
  if (!email || !EMAIL_REGEX.test(email)) {
    return Response.json({ error: "A valid email is required" }, { status: 400, headers: corsHeaders });
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
    return Response.json({ error: "Failed to persist waitlist record" }, { status: 500, headers: corsHeaders });
  }

  const alreadyVerified = row.verified === 1;
  const resendApiKey = context.env.RESEND_API_KEY?.trim();
  const fromEmail = context.env.RESEND_FROM_EMAIL?.trim() || "10X Meme <hello@10x.meme>";

  let verificationEmailSent = false;

  if (!alreadyVerified && resendApiKey) {
    const verifyUrl = new URL(context.request.url);
    verifyUrl.pathname = "/api/email/verify";
    verifyUrl.search = "";
    verifyUrl.searchParams.set("token", row.verify_token);

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
        html: buildVerifyEmailHtml(verifyUrl.toString()),
      }),
    });

    verificationEmailSent = resendResponse.ok;
    if (!resendResponse.ok) {
      const text = await resendResponse.text().catch(() => "");
      console.error("Resend verification email failed:", text || resendResponse.statusText);
    }
  }

  return Response.json({
    success: true,
    email,
    alreadyVerified,
    verificationEmailSent,
  }, { headers: corsHeaders });
};
