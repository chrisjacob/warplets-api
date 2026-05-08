interface AdminKeyRecord {
  id: string;
  key: string;
  scopes: string[];
  active?: boolean;
}

interface RequireAdminScopeOptions {
  scope: string;
}

interface ActionSessionTokenPayload {
  fid: number;
  exp: number;
}

interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
}

export interface SecurityEnv {
  WARPLETS?: D1Database;
  WARPLETS_KV?: KVNamespace;
  ADMIN_NOTIFY_TEST_TOKEN?: string;
  ADMIN_API_KEYS_JSON?: string;
  ACTION_SESSION_SECRET?: string;
}

const DEFAULT_CSP = [
  "default-src 'self'",
  "img-src 'self' https: data: blob:",
  "media-src 'self' https: blob:",
  "style-src 'self' 'unsafe-inline'",
  "script-src 'self' 'unsafe-inline'",
  "connect-src 'self' https:",
  "frame-ancestors 'none'",
  "base-uri 'self'",
].join("; ");

function cloneHeaders(headers?: HeadersInit): Headers {
  return new Headers(headers);
}

export function applySecurityHeaders(
  response: Response,
  options?: { isHtml?: boolean; csp?: string }
): Response {
  const headers = cloneHeaders(response.headers);
  headers.set("x-content-type-options", "nosniff");
  headers.set("referrer-policy", "strict-origin-when-cross-origin");
  headers.set("x-frame-options", "DENY");
  headers.set("permissions-policy", "camera=(), microphone=(), geolocation=()");
  headers.set("cache-control", headers.get("cache-control") ?? "no-store");

  const contentType = headers.get("content-type") ?? "";
  const shouldSetCsp = options?.isHtml || contentType.includes("text/html");
  if (shouldSetCsp) {
    headers.set("content-security-policy", options?.csp ?? DEFAULT_CSP);
  }

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export function jsonSecure(data: unknown, init?: ResponseInit): Response {
  const response = Response.json(data, init);
  return applySecurityHeaders(response);
}

export function getClientIp(request: Request): string {
  return (
    request.headers.get("cf-connecting-ip") ||
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    "unknown"
  );
}

async function sha256Hex(input: string): Promise<string> {
  const payload = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", payload);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function parseAdminKeyConfig(raw?: string): AdminKeyRecord[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    const records = parsed
      .map((row) => {
        if (!row || typeof row !== "object") return null;
        const rec = row as Record<string, unknown>;
        const id = typeof rec.id === "string" ? rec.id.trim() : "";
        const key = typeof rec.key === "string" ? rec.key.trim() : "";
        const scopes = Array.isArray(rec.scopes)
          ? rec.scopes.filter((scope): scope is string => typeof scope === "string" && scope.length > 0)
          : [];
        const active = rec.active !== false;
        if (!id || !key || scopes.length === 0) return null;
        return { id, key, scopes, active } as AdminKeyRecord;
      })
      .filter((row): row is AdminKeyRecord => row !== null);
    return records;
  } catch {
    return [];
  }
}

function keyHasScope(scopes: string[], scope: string): boolean {
  return scopes.includes("*") || scopes.includes(scope);
}

export async function rateLimit(
  kv: KVNamespace | undefined,
  namespace: string,
  subject: string,
  limit: number,
  windowSeconds: number
): Promise<RateLimitResult> {
  if (!kv) {
    return { allowed: true, remaining: Math.max(0, limit - 1), retryAfterSeconds: 0 };
  }

  const now = Date.now();
  const keyHash = await sha256Hex(`${namespace}:${subject}`);
  const key = `rl:v1:${namespace}:${keyHash}`;
  const raw = await kv.get(key, "json");
  const current = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const count = typeof current.count === "number" ? current.count : 0;
  const resetAt = typeof current.resetAt === "number" ? current.resetAt : now + windowSeconds * 1000;

  if (now > resetAt) {
    await kv.put(
      key,
      JSON.stringify({
        count: 1,
        resetAt: now + windowSeconds * 1000,
      }),
      { expirationTtl: windowSeconds }
    );
    return { allowed: true, remaining: Math.max(0, limit - 1), retryAfterSeconds: 0 };
  }

  const nextCount = count + 1;
  await kv.put(
    key,
    JSON.stringify({
      count: nextCount,
      resetAt,
    }),
    { expirationTtl: Math.max(1, Math.ceil((resetAt - now) / 1000)) }
  );

  if (nextCount > limit) {
    return {
      allowed: false,
      remaining: 0,
      retryAfterSeconds: Math.max(1, Math.ceil((resetAt - now) / 1000)),
    };
  }

  return {
    allowed: true,
    remaining: Math.max(0, limit - nextCount),
    retryAfterSeconds: 0,
  };
}

export async function logSecurityEvent(
  db: D1Database | undefined,
  payload: {
    eventType: string;
    outcome: string;
    actorType?: string;
    actorId?: string | null;
    ipAddress?: string | null;
    route?: string | null;
    details?: string | null;
  }
): Promise<void> {
  if (!db) return;
  const now = new Date().toISOString();
  try {
    await db
      .prepare(
        `INSERT INTO security_audit_events (
           event_type, outcome, actor_type, actor_id, ip_address, route, details, created_on
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        payload.eventType,
        payload.outcome,
        payload.actorType ?? "system",
        payload.actorId ?? null,
        payload.ipAddress ?? null,
        payload.route ?? null,
        payload.details ?? null,
        now
      )
      .run();
  } catch {
    // Best-effort audit logging must never break live requests.
  }
}

export async function requireAdminScope<T extends SecurityEnv>(
  context: { env: T; request: Request },
  options: RequireAdminScopeOptions
): Promise<{ ok: true; keyId: string } | { ok: false; response: Response }> {
  const suppliedToken = context.request.headers.get("x-admin-token")?.trim();
  const requestUrl = new URL(context.request.url);
  const ip = getClientIp(context.request);

  if (!suppliedToken) {
    await logSecurityEvent(context.env.WARPLETS, {
      eventType: "admin_auth",
      outcome: "missing_token",
      actorType: "admin_key",
      ipAddress: ip,
      route: requestUrl.pathname,
      details: options.scope,
    });
    return { ok: false, response: jsonSecure({ error: "Unauthorized" }, { status: 401 }) };
  }

  const keys = parseAdminKeyConfig(context.env.ADMIN_API_KEYS_JSON);
  const validKey = keys.find(
    (record) => record.active !== false && record.key === suppliedToken && keyHasScope(record.scopes, options.scope)
  );

  if (validKey) {
    return { ok: true, keyId: validKey.id };
  }

  // Backward compatibility: single global token remains full-access if explicitly set.
  const legacyToken = context.env.ADMIN_NOTIFY_TEST_TOKEN?.trim();
  if (legacyToken && suppliedToken === legacyToken) {
    return { ok: true, keyId: "legacy-admin-token" };
  }

  const authRate = await rateLimit(context.env.WARPLETS_KV, "admin-auth", ip, 20, 60);
  if (!authRate.allowed) {
    const response = jsonSecure({ error: "Too many failed auth attempts" }, { status: 429 });
    response.headers.set("retry-after", String(authRate.retryAfterSeconds));
    return { ok: false, response };
  }

  await logSecurityEvent(context.env.WARPLETS, {
    eventType: "admin_auth",
    outcome: "invalid_token",
    actorType: "admin_key",
    ipAddress: ip,
    route: requestUrl.pathname,
    details: options.scope,
  });

  return { ok: false, response: jsonSecure({ error: "Unauthorized" }, { status: 401 }) };
}

export async function readJsonBody<T>(request: Request): Promise<{ ok: true; value: T } | { ok: false; response: Response }> {
  try {
    const parsed = (await request.json()) as T;
    return { ok: true, value: parsed };
  } catch {
    return { ok: false, response: jsonSecure({ error: "Invalid JSON" }, { status: 400 }) };
  }
}

function arrayBufferToBase64Url(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64UrlToBytes(value: string): Uint8Array | null {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
  try {
    const binary = atob(padded);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return bytes;
  } catch {
    return null;
  }
}

async function importActionKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"]
  );
}

export async function createActionSessionToken(
  secret: string | undefined,
  fid: number,
  ttlSeconds = 3600
): Promise<string | null> {
  const trimmed = secret?.trim();
  if (!trimmed) return null;
  const payload: ActionSessionTokenPayload = {
    fid,
    exp: Math.floor(Date.now() / 1000) + ttlSeconds,
  };
  const payloadJson = JSON.stringify(payload);
  const payloadEncoded = arrayBufferToBase64Url(new TextEncoder().encode(payloadJson).buffer);
  const key = await importActionKey(trimmed);
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payloadEncoded));
  const sigEncoded = arrayBufferToBase64Url(signature);
  return `${payloadEncoded}.${sigEncoded}`;
}

export async function verifyActionSessionToken(
  secret: string | undefined,
  token: string | null
): Promise<{ valid: true; fid: number } | { valid: false; reason: string }> {
  const trimmed = secret?.trim();
  if (!trimmed) return { valid: false, reason: "missing_secret" };
  if (!token) return { valid: false, reason: "missing_token" };
  const [payloadEncoded, sigEncoded] = token.split(".");
  if (!payloadEncoded || !sigEncoded) return { valid: false, reason: "invalid_format" };

  const key = await importActionKey(trimmed);
  const signatureBytes = base64UrlToBytes(sigEncoded);
  if (!signatureBytes) return { valid: false, reason: "invalid_signature" };
  const verified = await crypto.subtle.verify(
    "HMAC",
    key,
    signatureBytes.buffer as ArrayBuffer,
    new TextEncoder().encode(payloadEncoded)
  );
  if (!verified) return { valid: false, reason: "invalid_signature" };

  const payloadBytes = base64UrlToBytes(payloadEncoded);
  if (!payloadBytes) return { valid: false, reason: "invalid_payload" };

  try {
    const payload = JSON.parse(new TextDecoder().decode(payloadBytes)) as ActionSessionTokenPayload;
    if (!payload || typeof payload.fid !== "number" || !Number.isInteger(payload.fid) || payload.fid <= 0) {
      return { valid: false, reason: "invalid_payload" };
    }
    if (typeof payload.exp !== "number" || Math.floor(Date.now() / 1000) > payload.exp) {
      return { valid: false, reason: "expired" };
    }
    return { valid: true, fid: payload.fid };
  } catch {
    return { valid: false, reason: "invalid_payload" };
  }
}
