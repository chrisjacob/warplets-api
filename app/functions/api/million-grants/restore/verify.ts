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
}

type VerifyBody = {
  nonce?: unknown;
  code?: unknown;
};

function cleanCode(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const code = value.replace(/\D/g, "");
  return /^\d{6}$/.test(code) ? code : null;
}

export const onRequestPost: PagesFunction<Env> = async (context) => {
  if (!context.env.WARPLETS_KV) {
    return jsonSecure({ error: "Restore storage is not configured." }, { status: 503 });
  }

  const parsed = await readJsonBodyWithLimit<VerifyBody>(context.request, 1024);
  if (!parsed.ok) return parsed.response;

  const nonce = typeof parsed.value.nonce === "string" ? parsed.value.nonce.trim() : "";
  const code = cleanCode(parsed.value.code);
  if (!nonce || !code) return jsonSecure({ error: "Invalid code." }, { status: 400 });

  const ip = getClientIp(context.request);
  const rate = await rateLimit(context.env.WARPLETS_KV, "million-grant-restore-verify", `${ip}:${nonce}`, 6, 600);
  if (!rate.allowed) {
    const response = jsonSecure({ error: "Too many code attempts" }, { status: 429 });
    response.headers.set("retry-after", String(rate.retryAfterSeconds));
    return response;
  }

  const record = await context.env.WARPLETS_KV.get(`million-grant-restore:${nonce}`, "json") as {
    applicationId?: unknown;
    email?: unknown;
    codeHash?: unknown;
    expiresAt?: unknown;
  } | null;

  if (
    !record ||
    typeof record.applicationId !== "number" ||
    typeof record.codeHash !== "string" ||
    typeof record.expiresAt !== "number" ||
    record.expiresAt < Date.now()
  ) {
    return jsonSecure({ error: "Invalid or expired code." }, { status: 401 });
  }

  const codeHash = await sha256Hex(`million-grant-restore:v1:${nonce}:${code}`);
  if (codeHash !== record.codeHash) {
    return jsonSecure({ error: "Invalid or expired code." }, { status: 401 });
  }

  const application = await context.env.WARPLETS.prepare(
    `SELECT mga.id, mga.status, mga.full_name, mga.email, mga.build_answer, mga.x_post_url,
            COALESCE(ew.verified, 0) AS email_verified
     FROM million_grant_applications mga
     LEFT JOIN email_waitlist ew ON LOWER(ew.email) = LOWER(mga.email)
     WHERE mga.id = ?
       AND mga.status = 'accepted'
     LIMIT 1`
  )
    .bind(record.applicationId)
    .first<{
      id: number;
      status: string;
      full_name: string;
      email: string;
      build_answer: string;
      x_post_url: string | null;
      email_verified: number;
    }>();

  if (!application) {
    return jsonSecure({ error: "Invalid or expired code." }, { status: 401 });
  }

  await context.env.WARPLETS_KV.delete(`million-grant-restore:${nonce}`);

  return jsonSecure({
    ok: true,
    application: {
      id: application.id,
      status: application.status,
      fullName: application.full_name,
      email: application.email,
      buildAnswer: application.build_answer,
      xPostUrl: application.x_post_url,
      emailVerified: application.email_verified === 1,
    },
  });
};
