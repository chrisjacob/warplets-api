interface AdminKeyRecord {
  id: string;
  key: string;
  scopes: string[];
  active?: boolean;
}

interface RequireAdminScopeOptions {
  scope: string;
  require2fa?: boolean;
}

interface RequireAdminHostOptions {
  redirectToCanonical?: boolean;
}

interface ActionSessionTokenPayload {
  fid: number;
  exp: number;
}

interface AdminSessionTokenPayload {
  purpose: "admin_2fa";
  keyId: string;
  exp: number;
}

interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
}

interface CloudflareAccessJwtPayload {
  aud?: string | string[];
  email?: string;
  exp?: number;
  iss?: string;
  sub?: string;
  common_name?: string;
}

export interface SecurityEnv {
  WARPLETS?: D1Database;
  WARPLETS_KV?: KVNamespace;
  ADMIN_API_KEYS_JSON?: string;
  ADMIN_API_KEYS_JSON_EXTRA?: string;
  ACTION_SESSION_SECRET?: string;
  SECURITY_LOG_SALT?: string;
  CF_ACCESS_TEAM_DOMAIN?: string;
  CF_ACCESS_AUD?: string;
  CF_ACCESS_ALLOWED_EMAILS?: string;
  CF_ACCESS_ALLOWED_SERVICE_TOKENS?: string;
  ADMIN_ALLOWED_HOSTS?: string;
}

let cloudflareAccessCertsCache:
  | { issuer: string; expiresAt: number; keysByKid: Map<string, JsonWebKey> }
  | null = null;

const DEFAULT_CSP = [
  "default-src 'self'",
  "img-src 'self' https: data: blob:",
  "media-src 'self' https: blob:",
  "style-src 'self' 'unsafe-inline'",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval' 'wasm-unsafe-eval' https://www.googletagmanager.com https://www.google-analytics.com https://www.google.com https://static.cloudflareinsights.com https://challenges.cloudflare.com https://ph.neynar.com",
  "frame-src 'self' https://www.youtube-nocookie.com https://www.youtube.com https://www.google.com",
  "worker-src 'self' blob:",
  "connect-src 'self' https:",
  "frame-ancestors 'self' https://farcaster.xyz https://*.farcaster.xyz https://warpcast.com https://*.warpcast.com",
  "base-uri 'self'",
].join("; ");

const DEFAULT_ADMIN_HOSTS = new Set([
  "admin.10x.meme",
  "admin-dev.10x.meme",
  "admin-local.10x.meme",
  "localhost",
  "127.0.0.1",
  "::1",
]);

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
  headers.set("permissions-policy", "camera=(), microphone=(), geolocation=()");
  headers.set("cache-control", headers.get("cache-control") ?? "no-store");

  const contentType = headers.get("content-type") ?? "";
  const shouldSetCsp = options?.isHtml || contentType.includes("text/html");
  if (!shouldSetCsp) {
    headers.set("x-frame-options", "DENY");
  } else {
    headers.delete("x-frame-options");
  }
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

export async function sha256Hex(input: string): Promise<string> {
  const payload = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", payload);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function compactWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function sanitizeAuditText(value: string | null | undefined, maxLength: number): string | null {
  if (!value) return null;
  const cleaned = compactWhitespace(value.replace(/[\u0000-\u001F\u007F]/g, ""));
  if (!cleaned) return null;
  return cleaned.slice(0, maxLength);
}

async function hashAuditIp(ipAddress: string | null | undefined, salt?: string): Promise<string | null> {
  if (!ipAddress) return null;
  const normalizedIp = sanitizeAuditText(ipAddress, 128);
  if (!normalizedIp) return null;
  const pepper = (salt ?? "").trim();
  return sha256Hex(`audit-ip:v1:${pepper}:${normalizedIp}`);
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

function readAdminKeys(env: SecurityEnv): AdminKeyRecord[] {
  return [
    ...parseAdminKeyConfig(env.ADMIN_API_KEYS_JSON),
    ...parseAdminKeyConfig(env.ADMIN_API_KEYS_JSON_EXTRA),
  ];
}

function keyHasScope(scopes: string[], scope: string): boolean {
  return scopes.includes("*") || scopes.includes(scope);
}

function parseCsvSet(value: string | undefined): Set<string> {
  return new Set(
    (value ?? "")
      .split(",")
      .map((item) => item.trim().toLowerCase())
      .filter(Boolean)
  );
}

function getAllowedAdminHosts(env: SecurityEnv): Set<string> {
  const configuredHosts = parseCsvSet(env.ADMIN_ALLOWED_HOSTS);
  return configuredHosts.size > 0 ? configuredHosts : DEFAULT_ADMIN_HOSTS;
}

function getCanonicalAdminHost(hostname: string): string {
  const normalized = hostname.toLowerCase();
  if (normalized === "admin-dev.10x.meme" || normalized.includes("-dev.") || normalized.includes("-local.")) {
    return "admin-dev.10x.meme";
  }
  return "admin.10x.meme";
}

export function isAdminHost<T extends SecurityEnv>(context: { env: T; request: Request }): boolean {
  const hostname = new URL(context.request.url).hostname.toLowerCase();
  return getAllowedAdminHosts(context.env).has(hostname);
}

export function requireAdminHost<T extends SecurityEnv>(
  context: { env: T; request: Request },
  options: RequireAdminHostOptions = {}
): { ok: true } | { ok: false; response: Response } {
  if (isAdminHost(context)) return { ok: true };

  const requestUrl = new URL(context.request.url);
  if (options.redirectToCanonical) {
    requestUrl.hostname = getCanonicalAdminHost(requestUrl.hostname);
    requestUrl.protocol = "https:";
    requestUrl.port = "";
    return {
      ok: false,
      response: Response.redirect(requestUrl.toString(), 302),
    };
  }

  return {
    ok: false,
    response: jsonSecure({ error: "Not found" }, { status: 404 }),
  };
}

function normalizeAccessTeamDomain(value: string | undefined): string {
  const raw = (value ?? "").trim().replace(/^https?:\/\//, "").replace(/\/+$/, "");
  if (!raw) return "";
  return raw.endsWith(".cloudflareaccess.com") ? raw : `${raw}.cloudflareaccess.com`;
}

function timingSafeEqualString(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let index = 0; index < a.length; index += 1) {
    mismatch |= a.charCodeAt(index) ^ b.charCodeAt(index);
  }
  return mismatch === 0;
}

function base64UrlToString(value: string): string | null {
  const bytes = base64UrlToBytes(value);
  if (!bytes) return null;
  return new TextDecoder().decode(bytes);
}

function parseJwtJson<T>(encoded: string): T | null {
  const decoded = base64UrlToString(encoded);
  if (!decoded) return null;
  try {
    return JSON.parse(decoded) as T;
  } catch {
    return null;
  }
}

function payloadHasAudience(payload: CloudflareAccessJwtPayload, expectedAud: string): boolean {
  const audiences = Array.isArray(payload.aud) ? payload.aud : typeof payload.aud === "string" ? [payload.aud] : [];
  return audiences.some((aud) => timingSafeEqualString(aud, expectedAud));
}

async function getCloudflareAccessKey(issuer: string, kid: string): Promise<JsonWebKey | null> {
  const now = Date.now();
  if (!cloudflareAccessCertsCache || cloudflareAccessCertsCache.issuer !== issuer || cloudflareAccessCertsCache.expiresAt <= now) {
    const response = await fetch(`${issuer}/cdn-cgi/access/certs`, {
      headers: { accept: "application/json" },
    });
    if (!response.ok) return null;

    const certs = (await response.json()) as { keys?: JsonWebKey[] };
    const keysByKid = new Map<string, JsonWebKey>();
    for (const key of certs.keys ?? []) {
      const kid = (key as JsonWebKey & { kid?: unknown }).kid;
      if (typeof kid === "string") keysByKid.set(kid, key);
    }
    cloudflareAccessCertsCache = {
      issuer,
      expiresAt: now + 60 * 60 * 1000,
      keysByKid,
    };
  }

  return cloudflareAccessCertsCache.keysByKid.get(kid) ?? null;
}

async function verifyCloudflareAccessJwt(
  token: string,
  issuer: string,
  expectedAud: string
): Promise<{ ok: true; payload: CloudflareAccessJwtPayload } | { ok: false; reason: string }> {
  const [headerEncoded, payloadEncoded, sigEncoded] = token.split(".");
  if (!headerEncoded || !payloadEncoded || !sigEncoded) return { ok: false, reason: "invalid_format" };

  const header = parseJwtJson<{ alg?: string; kid?: string }>(headerEncoded);
  const payload = parseJwtJson<CloudflareAccessJwtPayload>(payloadEncoded);
  if (!header?.kid || header.alg !== "RS256" || !payload) return { ok: false, reason: "invalid_payload" };
  if (payload.iss !== issuer) return { ok: false, reason: "invalid_issuer" };
  if (!payloadHasAudience(payload, expectedAud)) return { ok: false, reason: "invalid_audience" };
  if (typeof payload.exp !== "number" || Math.floor(Date.now() / 1000) > payload.exp) {
    return { ok: false, reason: "expired" };
  }

  const jwk = await getCloudflareAccessKey(issuer, header.kid);
  const signatureBytes = base64UrlToBytes(sigEncoded);
  if (!jwk || !signatureBytes) return { ok: false, reason: "invalid_signature" };

  const key = await crypto.subtle.importKey(
    "jwk",
    jwk,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["verify"]
  );
  const verified = await crypto.subtle.verify(
    "RSASSA-PKCS1-v1_5",
    key,
    signatureBytes.buffer as ArrayBuffer,
    new TextEncoder().encode(`${headerEncoded}.${payloadEncoded}`)
  );

  return verified ? { ok: true, payload } : { ok: false, reason: "invalid_signature" };
}

export async function requireCloudflareAccess<T extends SecurityEnv>(
  context: { env: T; request: Request }
): Promise<{ ok: true; identity: string | null } | { ok: false; response: Response }> {
  const teamDomain = normalizeAccessTeamDomain(context.env.CF_ACCESS_TEAM_DOMAIN);
  const expectedAud = context.env.CF_ACCESS_AUD?.trim() ?? "";
  const allowedEmails = parseCsvSet(context.env.CF_ACCESS_ALLOWED_EMAILS);
  const allowedServiceTokens = parseCsvSet(context.env.CF_ACCESS_ALLOWED_SERVICE_TOKENS);

  const isConfigured =
    Boolean(teamDomain) || Boolean(expectedAud) || allowedEmails.size > 0 || allowedServiceTokens.size > 0;
  if (!isConfigured) return { ok: true, identity: null };
  if (!teamDomain || !expectedAud || (allowedEmails.size === 0 && allowedServiceTokens.size === 0)) {
    return { ok: false, response: jsonSecure({ error: "Cloudflare Access is not fully configured" }, { status: 503 }) };
  }

  const token = context.request.headers.get("cf-access-jwt-assertion")?.trim() ?? "";
  if (!token) return { ok: false, response: jsonSecure({ error: "Cloudflare Access required" }, { status: 401 }) };

  const issuer = `https://${teamDomain}`;
  const verified = await verifyCloudflareAccessJwt(token, issuer, expectedAud).catch(() => null);
  if (!verified?.ok) {
    return { ok: false, response: jsonSecure({ error: "Invalid Cloudflare Access session" }, { status: 401 }) };
  }

  const email = verified.payload.email?.trim().toLowerCase() ?? "";
  if (email && allowedEmails.has(email)) return { ok: true, identity: email };

  const serviceIdentity = (verified.payload.common_name ?? verified.payload.sub ?? "").trim().toLowerCase();
  if (serviceIdentity && allowedServiceTokens.has(serviceIdentity)) {
    return { ok: true, identity: serviceIdentity };
  }

  return { ok: false, response: jsonSecure({ error: "Cloudflare Access identity is not allowed" }, { status: 403 }) };
}

export function maskEmailAddress(email: string): string {
  const [local = "", domain = ""] = email.split("@");
  if (!local || !domain) return "configured admin email";
  const visible = local.slice(0, Math.min(2, local.length));
  return `${visible}${"*".repeat(Math.max(2, local.length - visible.length))}@${domain}`;
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

  try {
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
  } catch {
    // Never hard-fail request handling due to KV availability/config issues.
    return { allowed: true, remaining: Math.max(0, limit - 1), retryAfterSeconds: 0 };
  }
}

export async function logSecurityEvent(
  db: D1Database | undefined,
  options: { logSalt?: string } | undefined,
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
    const hashedIp = await hashAuditIp(payload.ipAddress ?? null, options?.logSalt);
    const safeEventType = sanitizeAuditText(payload.eventType, 80) ?? "unknown";
    const safeOutcome = sanitizeAuditText(payload.outcome, 80) ?? "unknown";
    const safeActorType = sanitizeAuditText(payload.actorType ?? "system", 40) ?? "system";
    const safeActorId = sanitizeAuditText(payload.actorId ?? null, 120);
    const safeRoute = sanitizeAuditText(payload.route ?? null, 180);
    const safeDetails = sanitizeAuditText(payload.details ?? null, 1024);

    await db
      .prepare(
        `INSERT INTO security_audit_events (
           event_type, outcome, actor_type, actor_id, ip_address, route, details, created_on
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        safeEventType,
        safeOutcome,
        safeActorType,
        safeActorId,
        hashedIp,
        safeRoute,
        safeDetails,
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
  const adminHost = requireAdminHost(context);
  if (!adminHost.ok) return adminHost;

  const access = await requireCloudflareAccess(context);
  if (!access.ok) return access;

  const suppliedToken = context.request.headers.get("x-admin-token")?.trim();
  const requestUrl = new URL(context.request.url);
  const ip = getClientIp(context.request);
  const keys = readAdminKeys(context.env);

  if (!suppliedToken && options.require2fa !== false) {
    const sessionToken = context.request.headers.get("x-admin-session")?.trim() ?? null;
    const session = await verifyAdminSessionToken(context.env.ACTION_SESSION_SECRET, sessionToken);
    if (session.valid) {
      const sessionKey = keys.find(
        (record) => record.active !== false && record.id === session.keyId && keyHasScope(record.scopes, options.scope)
      );
      if (sessionKey) {
        return { ok: true, keyId: sessionKey.id };
      }
    }

    await logSecurityEvent(context.env.WARPLETS, { logSalt: context.env.SECURITY_LOG_SALT }, {
      eventType: "admin_auth",
      outcome: session.valid ? "session_scope_denied" : `invalid_2fa:${session.reason}`,
      actorType: "admin_key",
      actorId: session.valid ? session.keyId : null,
      ipAddress: ip,
      route: requestUrl.pathname,
      details: options.scope,
    });
    return { ok: false, response: jsonSecure({ error: "Unauthorized" }, { status: 401 }) };
  }

  if (!suppliedToken) {
    await logSecurityEvent(context.env.WARPLETS, { logSalt: context.env.SECURITY_LOG_SALT }, {
      eventType: "admin_auth",
      outcome: "missing_token",
      actorType: "admin_key",
      ipAddress: ip,
      route: requestUrl.pathname,
      details: options.scope,
    });
    return { ok: false, response: jsonSecure({ error: "Unauthorized" }, { status: 401 }) };
  }

  const validKey = keys.find(
    (record) => record.active !== false && record.key === suppliedToken && keyHasScope(record.scopes, options.scope)
  );

  if (validKey) {
    if (options.require2fa === false) {
      return { ok: true, keyId: validKey.id };
    }

    const sessionToken = context.request.headers.get("x-admin-session")?.trim() ?? null;
    const session = await verifyAdminSessionToken(context.env.ACTION_SESSION_SECRET, sessionToken);
    if (!session.valid || session.keyId !== validKey.id) {
      await logSecurityEvent(context.env.WARPLETS, { logSalt: context.env.SECURITY_LOG_SALT }, {
        eventType: "admin_auth",
        outcome: session.valid ? "wrong_2fa_key" : `invalid_2fa:${session.reason}`,
        actorType: "admin_key",
        actorId: validKey.id,
        ipAddress: ip,
        route: requestUrl.pathname,
        details: options.scope,
      });
      return { ok: false, response: jsonSecure({ error: "2FA required" }, { status: 401 }) };
    }

    return { ok: true, keyId: validKey.id };
  }

  const authRate = await rateLimit(context.env.WARPLETS_KV, "admin-auth", ip, 20, 60);
  if (!authRate.allowed) {
    const response = jsonSecure({ error: "Too many failed auth attempts" }, { status: 429 });
    response.headers.set("retry-after", String(authRate.retryAfterSeconds));
    return { ok: false, response };
  }

  await logSecurityEvent(context.env.WARPLETS, { logSalt: context.env.SECURITY_LOG_SALT }, {
    eventType: "admin_auth",
    outcome: "invalid_token",
    actorType: "admin_key",
    ipAddress: ip,
    route: requestUrl.pathname,
    details: options.scope,
  });

  return { ok: false, response: jsonSecure({ error: "Unauthorized" }, { status: 401 }) };
}

export async function createAdminSessionToken(
  secret: string | undefined,
  keyId: string,
  ttlSeconds = 1800
): Promise<string | null> {
  const trimmed = secret?.trim();
  if (!trimmed) return null;
  const payload: AdminSessionTokenPayload = {
    purpose: "admin_2fa",
    keyId,
    exp: Math.floor(Date.now() / 1000) + ttlSeconds,
  };
  const payloadJson = JSON.stringify(payload);
  const payloadEncoded = arrayBufferToBase64Url(new TextEncoder().encode(payloadJson).buffer);
  const key = await importActionKey(trimmed);
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payloadEncoded));
  const sigEncoded = arrayBufferToBase64Url(signature);
  return `${payloadEncoded}.${sigEncoded}`;
}

export async function verifyAdminSessionToken(
  secret: string | undefined,
  token: string | null
): Promise<{ valid: true; keyId: string } | { valid: false; reason: string }> {
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
    const payload = JSON.parse(new TextDecoder().decode(payloadBytes)) as AdminSessionTokenPayload;
    if (!payload || payload.purpose !== "admin_2fa" || typeof payload.keyId !== "string" || !payload.keyId.trim()) {
      return { valid: false, reason: "invalid_payload" };
    }
    if (typeof payload.exp !== "number" || Math.floor(Date.now() / 1000) > payload.exp) {
      return { valid: false, reason: "expired" };
    }
    return { valid: true, keyId: payload.keyId };
  } catch {
    return { valid: false, reason: "invalid_payload" };
  }
}

export async function readJsonBody<T>(request: Request): Promise<{ ok: true; value: T } | { ok: false; response: Response }> {
  try {
    const parsed = (await request.json()) as T;
    return { ok: true, value: parsed };
  } catch {
    return { ok: false, response: jsonSecure({ error: "Invalid JSON" }, { status: 400 }) };
  }
}

export async function readJsonBodyWithLimit<T>(
  request: Request,
  maxBytes: number
): Promise<{ ok: true; value: T } | { ok: false; response: Response }> {
  const contentLengthHeader = request.headers.get("content-length");
  if (contentLengthHeader) {
    const contentLength = Number.parseInt(contentLengthHeader, 10);
    if (Number.isFinite(contentLength) && contentLength > maxBytes) {
      return { ok: false, response: jsonSecure({ error: "Payload too large" }, { status: 413 }) };
    }
  }

  try {
    const raw = await request.text();
    if (new TextEncoder().encode(raw).length > maxBytes) {
      return { ok: false, response: jsonSecure({ error: "Payload too large" }, { status: 413 }) };
    }
    const parsed = JSON.parse(raw) as T;
    return { ok: true, value: parsed };
  } catch {
    return { ok: false, response: jsonSecure({ error: "Invalid JSON" }, { status: 400 }) };
  }
}

export function parseObjectPayload<T extends object>(
  value: unknown,
  allowedKeys: string[]
): { ok: true; payload: T } | { ok: false; response: Response } {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { ok: false, response: jsonSecure({ error: "Invalid JSON payload" }, { status: 400 }) };
  }

  const payload = value as Record<string, unknown>;
  const hasUnexpectedKeys = Object.keys(payload).some((key) => !allowedKeys.includes(key));
  if (hasUnexpectedKeys) {
    return { ok: false, response: jsonSecure({ error: "Unexpected fields in payload" }, { status: 400 }) };
  }

  return { ok: true, payload: payload as T };
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
