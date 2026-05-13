import { createClient } from "@farcaster/quick-auth";
import {
  getClientIp,
  jsonSecure,
  logSecurityEvent,
  rateLimit,
} from "../../_lib/security.js";
import { outboundFetch } from "../../_lib/outbound.js";

interface Env {
  WARPLETS: D1Database;
  WARPLETS_KV?: KVNamespace;
  SECURITY_LOG_SALT?: string;
  RESEND_API_KEY?: string;
}

type EmailRow = {
  id: number;
  email: string;
  unsubscribed_at: string | null;
};

const RESEND_TOPIC_ID = "c3e8d591-73e6-4e98-a873-5e197a8581ee";

function decodeJwtAudience(token: string): string | null {
  const payload = token.split(".")[1];
  if (!payload) return null;
  try {
    const normalized = payload.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
    const parsed = JSON.parse(atob(padded)) as { aud?: unknown };
    return typeof parsed.aud === "string" && parsed.aud.trim() ? parsed.aud.trim() : null;
  } catch {
    return null;
  }
}

function hostnameFromHeader(value: string | null): string | null {
  const raw = value?.trim();
  if (!raw) return null;
  try {
    return new URL(raw).hostname;
  } catch {
    return raw.split(",")[0]?.trim().replace(/:\d+$/, "") || null;
  }
}

function quickAuthCandidateDomains(request: Request, token: string): string[] {
  const requestUrl = new URL(request.url);
  return Array.from(new Set([
    decodeJwtAudience(token),
    requestUrl.hostname,
    hostnameFromHeader(request.headers.get("origin")),
    hostnameFromHeader(request.headers.get("referer")),
    hostnameFromHeader(request.headers.get("x-forwarded-host")),
    hostnameFromHeader(request.headers.get("x-original-host")),
    "app-local.10x.meme",
    "app-dev.10x.meme",
    "app.10x.meme",
  ].filter((domain): domain is string => Boolean(domain))));
}

async function verifyQuickAuthFid(request: Request): Promise<number | null> {
  const authHeader = request.headers.get("authorization") ?? "";
  const token = authHeader.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
  if (!token) return null;

  const client = createClient();
  const candidateDomains = quickAuthCandidateDomains(request, token);

  for (const domain of candidateDomains) {
    try {
      const payload = await client.verifyJwt({ token, domain });
      const sub = Number(payload.sub);
      if (Number.isInteger(sub) && sub > 0) return sub;
    } catch {
      // Try the next plausible audience domain.
    }
  }

  return null;
}

async function requireFid(context: EventContext<Env, string, unknown>, namespace: string) {
  const ip = getClientIp(context.request);
  const rate = await rateLimit(context.env.WARPLETS_KV, namespace, ip, 30, 60);
  if (!rate.allowed) {
    const response = jsonSecure({ error: "Rate limit exceeded" }, { status: 429 });
    response.headers.set("retry-after", String(rate.retryAfterSeconds));
    return { ok: false as const, response };
  }

  const fid = await verifyQuickAuthFid(context.request);
  if (!fid) {
    await logSecurityEvent(context.env.WARPLETS, { logSalt: context.env.SECURITY_LOG_SALT }, {
      eventType: "email_unsubscribe_self_auth",
      outcome: "invalid_quick_auth",
      actorType: "ip",
      ipAddress: ip,
      route: new URL(context.request.url).pathname,
    });
    return { ok: false as const, response: jsonSecure({ error: "Unauthorized" }, { status: 401 }) };
  }

  return { ok: true as const, fid };
}

async function loadEmails(db: D1Database, fid: number): Promise<EmailRow[]> {
  const result = await db.prepare(
    `SELECT id, email, unsubscribed_at
     FROM email_waitlist
     WHERE fid = ?
     ORDER BY subscribed_at DESC, id DESC`
  )
    .bind(fid)
    .all<EmailRow>();

  return result.results ?? [];
}

async function unsubscribeResendContact(resendApiKey: string | undefined, email: string): Promise<void> {
  const apiKey = resendApiKey?.trim();
  if (!apiKey) return;

  const contactPath = `https://api.resend.com/contacts/${encodeURIComponent(email)}`;
  const headers = {
    "content-type": "application/json",
    Authorization: `Bearer ${apiKey}`,
  };

  try {
    await outboundFetch(contactPath, {
      method: "PATCH",
      headers,
      body: JSON.stringify({ unsubscribed: true }),
    });
    await outboundFetch(`${contactPath}/topics`, {
      method: "PATCH",
      headers,
      body: JSON.stringify({
        topics: [{ id: RESEND_TOPIC_ID, subscription: "opt_out" }],
      }),
    });
  } catch (error) {
    console.error("Resend self-unsubscribe failed:", error);
  }
}

function summarize(fid: number, rows: EmailRow[]) {
  const active = rows.filter((row) => !row.unsubscribed_at);
  return {
    fid,
    matchedEmails: rows.map((row) => ({
      email: row.email,
      unsubscribed: Boolean(row.unsubscribed_at),
    })),
    activeCount: active.length,
    hasMatchedEmail: rows.length > 0,
    requiresEmailLink: rows.length === 0,
  };
}

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const auth = await requireFid(context, "email-unsubscribe-self-get");
  if (!auth.ok) return auth.response;

  const rows = await loadEmails(context.env.WARPLETS, auth.fid);
  return jsonSecure(summarize(auth.fid, rows));
};

export const onRequestPost: PagesFunction<Env> = async (context) => {
  const auth = await requireFid(context, "email-unsubscribe-self-post");
  if (!auth.ok) return auth.response;

  const rows = await loadEmails(context.env.WARPLETS, auth.fid);
  const activeRows = rows.filter((row) => !row.unsubscribed_at);
  if (activeRows.length > 0) {
    const now = new Date().toISOString();
    const placeholders = activeRows.map(() => "?").join(", ");
    await context.env.WARPLETS.prepare(
      `UPDATE email_waitlist
       SET unsubscribed_at = ?,
           updated_at = ?
       WHERE id IN (${placeholders})`
    )
      .bind(now, now, ...activeRows.map((row) => row.id))
      .run();

    await Promise.all(
      activeRows.map((row) => unsubscribeResendContact(context.env.RESEND_API_KEY, row.email))
    );
  }

  const nextRows = await loadEmails(context.env.WARPLETS, auth.fid);
  return jsonSecure({
    ...summarize(auth.fid, nextRows),
    unsubscribedCount: activeRows.length,
    unsubscribedEmails: activeRows.map((row) => row.email),
  });
};
