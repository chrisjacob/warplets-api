import { sha256Hex } from "./security.js";

export interface AppAuthEnv {
  WARPLETS: D1Database;
  APP_SESSION_SECRET?: string;
}

export interface AppSession {
  sessionHash: string;
  farcasterFid: number | null;
  walletAddress: `0x${string}` | null;
  farcasterSignerUuid: string | null;
  createdAt: string;
  lastSeenAt: string;
  expiresAt: string;
  absoluteExpiresAt: string;
}

interface SessionRow {
  session_hash: string;
  farcaster_fid: number | null;
  wallet_address: string | null;
  farcaster_signer_uuid: string | null;
  created_at: string;
  last_seen_at: string;
  expires_at: string;
  absolute_expires_at: string;
}

const SESSION_COOKIE = "warplets_session";
const SECURE_SESSION_COOKIE = "__Host-warplets_session";
const SLIDING_SESSION_MS = 30 * 24 * 60 * 60 * 1000;
const ABSOLUTE_SESSION_MS = 90 * 24 * 60 * 60 * 1000;
const WALLET_PATTERN = /^0x[a-f0-9]{40}$/;

function normalizeWallet(value: string | null | undefined): `0x${string}` | null {
  const normalized = value?.trim().toLowerCase() ?? "";
  return WALLET_PATTERN.test(normalized) ? (normalized as `0x${string}`) : null;
}

function parseCookies(request: Request): Map<string, string> {
  const result = new Map<string, string>();
  for (const part of (request.headers.get("cookie") ?? "").split(";")) {
    const index = part.indexOf("=");
    if (index <= 0) continue;
    result.set(part.slice(0, index).trim(), decodeURIComponent(part.slice(index + 1).trim()));
  }
  return result;
}

export function getRawSessionToken(request: Request): string | null {
  const cookies = parseCookies(request);
  return cookies.get(SECURE_SESSION_COOKIE) ?? cookies.get(SESSION_COOKIE) ?? null;
}

function isSecureRequest(request: Request): boolean {
  const requestUrl = new URL(request.url);
  if (requestUrl.protocol === "https:") return true;

  // The local HTTPS tunnel terminates TLS in front of Vite/Pages dev, so the
  // Worker-facing URL is HTTP. Vite supplies the original public origin and
  // only a matching HTTPS host is allowed to affect cookie security.
  const forwardedOrigin = request.headers.get("x-10x-public-origin")?.trim();
  if (!forwardedOrigin) return false;
  try {
    const forwardedUrl = new URL(forwardedOrigin);
    return forwardedUrl.protocol === "https:" && forwardedUrl.host === requestUrl.host;
  } catch {
    return false;
  }
}

function requireSessionSecret(env: AppAuthEnv): string {
  const secret = env.APP_SESSION_SECRET?.trim();
  if (!secret || secret.length < 32) throw new Error("APP_SESSION_SECRET must contain at least 32 characters");
  return secret;
}

async function hashSessionToken(env: AppAuthEnv, token: string): Promise<string> {
  return sha256Hex(`app-session:v1:${requireSessionSecret(env)}:${token}`);
}

function randomSessionToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function rowToSession(row: SessionRow): AppSession {
  return {
    sessionHash: row.session_hash,
    farcasterFid: row.farcaster_fid == null ? null : Number(row.farcaster_fid),
    walletAddress: normalizeWallet(row.wallet_address),
    farcasterSignerUuid: row.farcaster_signer_uuid,
    createdAt: row.created_at,
    lastSeenAt: row.last_seen_at,
    expiresAt: row.expires_at,
    absoluteExpiresAt: row.absolute_expires_at,
  };
}

export function sessionCookie(request: Request, token: string, expiresAt: string): string {
  const secure = isSecureRequest(request);
  const name = secure ? SECURE_SESSION_COOKIE : SESSION_COOKIE;
  return [
    `${name}=${encodeURIComponent(token)}`,
    "Path=/",
    "HttpOnly",
    secure ? "SameSite=None" : "SameSite=Lax",
    secure ? "Secure" : "",
    secure ? "Partitioned" : "",
    `Expires=${new Date(expiresAt).toUTCString()}`,
  ].filter(Boolean).join("; ");
}

export function clearSessionCookies(): string[] {
  return [
    `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`,
    `${SECURE_SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=None; Secure; Partitioned; Max-Age=0`,
  ];
}

export async function getAppSession(
  request: Request,
  env: AppAuthEnv,
  options: { touch?: boolean } = {},
): Promise<AppSession | null> {
  const token = getRawSessionToken(request);
  if (!token || token.length > 256) return null;

  const sessionHash = await hashSessionToken(env, token);
  const row = await env.WARPLETS.prepare(
    `SELECT session_hash, farcaster_fid, wallet_address, farcaster_signer_uuid,
            created_at, last_seen_at, expires_at, absolute_expires_at
     FROM app_auth_sessions
     WHERE session_hash = ? LIMIT 1`,
  ).bind(sessionHash).first<SessionRow>();
  if (!row) return null;

  const now = Date.now();
  const expiresAt = Date.parse(row.expires_at);
  const absoluteExpiresAt = Date.parse(row.absolute_expires_at);
  if (!Number.isFinite(expiresAt) || !Number.isFinite(absoluteExpiresAt) || now >= expiresAt || now >= absoluteExpiresAt) {
    await env.WARPLETS.prepare("DELETE FROM app_auth_sessions WHERE session_hash = ?").bind(sessionHash).run();
    return null;
  }

  if (options.touch !== false) {
    const nextExpiry = new Date(Math.min(now + SLIDING_SESSION_MS, absoluteExpiresAt)).toISOString();
    const nowIso = new Date(now).toISOString();
    await env.WARPLETS.prepare(
      "UPDATE app_auth_sessions SET last_seen_at = ?, expires_at = ? WHERE session_hash = ?",
    ).bind(nowIso, nextExpiry, sessionHash).run();
    row.last_seen_at = nowIso;
    row.expires_at = nextExpiry;
  }

  return rowToSession(row);
}

export async function createOrMergeAppSession(
  request: Request,
  env: AppAuthEnv,
  identity: {
    farcasterFid?: number | null;
    walletAddress?: string | null;
    farcasterSignerUuid?: string | null;
  },
): Promise<{ session: AppSession; cookie: string }> {
  const existing = await getAppSession(request, env, { touch: false });
  let token = getRawSessionToken(request) ?? "";
  const now = new Date();
  const nowIso = now.toISOString();

  const fid = identity.farcasterFid == null ? existing?.farcasterFid ?? null : Number(identity.farcasterFid);
  const wallet = identity.walletAddress === undefined
    ? existing?.walletAddress ?? null
    : normalizeWallet(identity.walletAddress);
  const signerUuid = identity.farcasterSignerUuid === undefined
    ? existing?.farcasterSignerUuid ?? null
    : identity.farcasterSignerUuid?.trim() || null;

  if (existing && token) {
    const absoluteMs = Date.parse(existing.absoluteExpiresAt);
    const expiresAt = new Date(Math.min(now.getTime() + SLIDING_SESSION_MS, absoluteMs)).toISOString();
    await env.WARPLETS.prepare(
      `UPDATE app_auth_sessions
       SET farcaster_fid = ?, wallet_address = ?, farcaster_signer_uuid = ?, last_seen_at = ?, expires_at = ?
       WHERE session_hash = ?`,
    ).bind(fid, wallet, signerUuid, nowIso, expiresAt, existing.sessionHash).run();
    return {
      session: { ...existing, farcasterFid: fid, walletAddress: wallet, farcasterSignerUuid: signerUuid, lastSeenAt: nowIso, expiresAt },
      cookie: sessionCookie(request, token, expiresAt),
    };
  }

  token = randomSessionToken();
  const sessionHash = await hashSessionToken(env, token);
  const expiresAt = new Date(now.getTime() + SLIDING_SESSION_MS).toISOString();
  const absoluteExpiresAt = new Date(now.getTime() + ABSOLUTE_SESSION_MS).toISOString();
  await env.WARPLETS.prepare(
    `INSERT INTO app_auth_sessions (
       session_hash, farcaster_fid, wallet_address, farcaster_signer_uuid,
       created_at, last_seen_at, expires_at, absolute_expires_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(sessionHash, fid, wallet, signerUuid, nowIso, nowIso, expiresAt, absoluteExpiresAt).run();

  return {
    session: {
      sessionHash,
      farcasterFid: fid,
      walletAddress: wallet,
      farcasterSignerUuid: signerUuid,
      createdAt: nowIso,
      lastSeenAt: nowIso,
      expiresAt,
      absoluteExpiresAt,
    },
    cookie: sessionCookie(request, token, expiresAt),
  };
}

export async function deleteAppSession(request: Request, env: AppAuthEnv): Promise<void> {
  const session = await getAppSession(request, env, { touch: false });
  if (session) {
    await env.WARPLETS.prepare("DELETE FROM app_auth_sessions WHERE session_hash = ?")
      .bind(session.sessionHash)
      .run();
  }
}

export async function clearWalletFromSession(request: Request, env: AppAuthEnv): Promise<void> {
  const session = await getAppSession(request, env, { touch: false });
  if (!session) return;
  await env.WARPLETS.prepare(
    "UPDATE app_auth_sessions SET wallet_address = NULL, last_seen_at = ? WHERE session_hash = ?",
  ).bind(new Date().toISOString(), session.sessionHash).run();
}

export async function clearFarcasterFromSession(request: Request, env: AppAuthEnv): Promise<void> {
  const session = await getAppSession(request, env, { touch: false });
  if (!session) return;
  await env.WARPLETS.prepare(
    `UPDATE app_auth_sessions
     SET farcaster_fid = NULL, farcaster_signer_uuid = NULL, last_seen_at = ?
     WHERE session_hash = ?`,
  ).bind(new Date().toISOString(), session.sessionHash).run();
}
