import { outboundFetch } from "../../../_lib/outbound.js";
import {
  getClientIp,
  jsonSecure,
  rateLimit,
  readJsonBodyWithLimit,
  sha256Hex,
} from "../../../_lib/security.js";

interface Env {
  WARPLETS: D1Database;
  WARPLETS_KV?: KVNamespace;
  RESEND_API_KEY?: string;
  RESEND_FROM_EMAIL?: string;
}

type RequestBody = {
  email?: unknown;
};

const RESTORE_TTL_SECONDS = 600;
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function currentMonth(now = new Date()): string {
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
}

function cleanEmail(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const email = value.trim().toLowerCase();
  return EMAIL_REGEX.test(email) ? email : null;
}

function createCode(): string {
  const bytes = new Uint8Array(4);
  crypto.getRandomValues(bytes);
  const value = ((bytes[0] << 24) | (bytes[1] << 16) | (bytes[2] << 8) | bytes[3]) >>> 0;
  return String(value % 1000000).padStart(6, "0");
}

export const onRequestPost: PagesFunction<Env> = async (context) => {
  const parsed = await readJsonBodyWithLimit<RequestBody>(context.request, 1024);
  if (!parsed.ok) return parsed.response;

  const email = cleanEmail(parsed.value.email);
  if (!email) return jsonSecure({ error: "A valid email is required." }, { status: 400 });

  const ip = getClientIp(context.request);
  const rate = await rateLimit(context.env.WARPLETS_KV, "million-grant-restore-request", `${email}:${ip}`, 5, 600);
  if (!rate.allowed) {
    const response = jsonSecure({ error: "Too many restore requests" }, { status: 429 });
    response.headers.set("retry-after", String(rate.retryAfterSeconds));
    return response;
  }

  if (!context.env.WARPLETS_KV || !context.env.RESEND_API_KEY?.trim()) {
    return jsonSecure({
      ok: true,
      message: "If an accepted application exists for that email this month, a restore code has been sent.",
    });
  }

  const nonce = crypto.randomUUID();
  const code = createCode();

  const application = await context.env.WARPLETS.prepare(
    `SELECT id
     FROM million_grant_applications
     WHERE LOWER(email) = LOWER(?)
       AND grant_month = ?
       AND status = 'accepted'
     LIMIT 1`
  )
    .bind(email, currentMonth())
    .first<{ id: number }>();

  if (application) {
    const codeHash = await sha256Hex(`million-grant-restore:v1:${nonce}:${code}`);
    await context.env.WARPLETS_KV.put(
      `million-grant-restore:${nonce}`,
      JSON.stringify({
        applicationId: application.id,
        email,
        codeHash,
        expiresAt: Date.now() + RESTORE_TTL_SECONDS * 1000,
      }),
      { expirationTtl: RESTORE_TTL_SECONDS }
    );

    const fromEmail = context.env.RESEND_FROM_EMAIL?.trim() || "10X Meme <10x@10x.meme>";
    await outboundFetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        Authorization: `Bearer ${context.env.RESEND_API_KEY.trim()}`,
      },
      body: JSON.stringify({
        from: fromEmail,
        to: [email],
        subject: "Your 10X Grant Application restore code",
        html: `<p>Your 10X Grant Application restore code is:</p><p style="font-size:24px;font-weight:700;letter-spacing:4px">${code}</p><p>This code expires in 10 minutes.</p>`,
      }),
    }).catch(() => null);
  }

  return jsonSecure({
    ok: true,
    nonce,
    message: "If an accepted application exists for that email this month, a restore code has been sent.",
  });
};
