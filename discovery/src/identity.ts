import { ed25519 } from "@noble/curves/ed25519.js";
import { API_HEADERS } from "./request-security";
import { IdentityChallengeRequest, IdentityChallengeResponse, IdentitySessionResponse, IdentityVerifyRequest } from "./identity-model";
import { hashBytes, publicKey, toBase58 } from "./solana";

const TUNNEL = "https://app-local.10x.meme";
const ORIGINS = new Set([TUNNEL, "http://localhost:5183", "http://127.0.0.1:5183", "http://localhost:8794", "http://127.0.0.1:8794"]);
const ANON_MS = 10 * 60_000, CHALLENGE_MS = 5 * 60_000, SESSION_MS = 12 * 3600_000;
const encoder = new TextEncoder();
type Session = { token_hash: string; identity_id: string | null; origin: string; expires_at: string };
type Challenge = { id: string; session_hash: string; address: string; intent: "login" | "link" | "unlink"; origin: string; message: string; issued_at: string; expires_at: string; consumed_by: string | null };
export class IdentityError extends Error { constructor(message: string, readonly status: number) { super(message); } }
function fail(message: string, status = 400): never { throw new IdentityError(message, status); }
const random = () => Array.from(crypto.getRandomValues(new Uint8Array(32)), v => v.toString(16).padStart(2, "0")).join("");
const digest = (value: string) => hashBytes(encoder.encode(value));
const sessionHash = (token: string) => digest(`tenx-local-solana-session:v1:${token}`);
const cookieName = (origin: string) => origin === TUNNEL ? "__Host-tenx_solana" : "tenx_solana_local";
function cookie(origin: string, token: string, maxAge: number) {
  return `${cookieName(origin)}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${origin === TUNNEL ? "; Secure" : ""}`;
}
function browserOrigin(request: Request): string {
  // Vite supplies a fixed public origin based on its allowlisted Host, never an
  // arbitrary forwarded header. Direct API calls default to their loopback URL.
  const forwarded = request.headers.get("x-10x-identity-origin");
  const origin = forwarded ?? new URL(request.url).origin;
  if (!ORIGINS.has(origin)) fail("identity_origin_not_allowed", 403);
  return origin;
}
function requireWriteOrigin(request: Request, origin: string) {
  if (request.headers.get("origin") !== origin || request.headers.get("x-tenx-identity") !== "1") fail("identity_origin_required", 403);
  const site = request.headers.get("sec-fetch-site");
  if (site && site !== "same-origin" && site !== "none") fail("identity_cross_site_request", 403);
  if (request.headers.get("content-type")?.split(";")[0]?.trim() !== "application/json") fail("identity_json_required", 415);
}
async function body(request: Request): Promise<unknown> {
  const reader = request.body?.getReader();
  if (!reader) fail("identity_body_required");
  const chunks: Uint8Array[] = []; let bytes = 0;
  while (true) {
    const next = await reader.read(); if (next.done) break;
    bytes += next.value.length;
    if (bytes > 4096) { await reader.cancel(); fail("identity_body_too_large", 413); }
    chunks.push(next.value);
  }
  const out = new Uint8Array(bytes); let offset = 0;
  for (const chunk of chunks) { out.set(chunk, offset); offset += chunk.length; }
  return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(out));
}
async function current(db: D1Database, request: Request, origin: string, now: string): Promise<Session | null> {
  const name = cookieName(origin);
  const matches = (request.headers.get("cookie") ?? "").split(";").map(s => s.trim()).filter(s => s.startsWith(`${name}=`));
  if (matches.length !== 1) return null;
  const token = matches[0]!.slice(name.length + 1);
  if (!/^[a-f0-9]{64}$/.test(token)) return null;
  return db.prepare("SELECT token_hash,identity_id,origin,expires_at FROM tenx_identity_sessions WHERE token_hash=? AND origin=? AND revoked_at IS NULL AND expires_at>?")
    .bind(await sessionHash(token), origin, now).first<Session>();
}
async function view(db: D1Database, session: Session | null) {
  const identity = session?.identity_id ?? null;
  const wallets = identity ? (await db.prepare("SELECT address,linked_at FROM tenx_identity_wallets WHERE identity_id=? ORDER BY linked_at,address LIMIT 10").bind(identity).all()).results : [];
  return IdentitySessionResponse.parse({ authenticated: Boolean(identity), identity_id: identity, expires_at: identity ? session!.expires_at : null, wallets, scope: "local_solana_identity", voting_enabled: false, human_verification: "unverified" });
}
function response(value: unknown, setCookie?: string) {
  return Response.json(value, { headers: { ...API_HEADERS, "vary": "Cookie", ...(setCookie ? { "set-cookie": setCookie } : {}) } });
}
export async function identityRoute(request: Request, db: D1Database, at = new Date()): Promise<Response> {
  try { return await route(request, db, at); }
  catch (error) {
    if (error instanceof IdentityError) return Response.json({ error: error.message }, { status: error.status, headers: { ...API_HEADERS, "vary": "Cookie" } });
    throw error;
  }
}
async function route(request: Request, db: D1Database, at: Date): Promise<Response> {
  const path = new URL(request.url).pathname.replace(/\/+$/, "");
  const origin = browserOrigin(request), now = at.toISOString();
  if (request.method === "GET" && path === "/api/10x/identity/session") return response(await view(db, await current(db, request, origin, now)));
  if (request.method !== "POST") fail("identity_method_not_allowed", 405);
  requireWriteOrigin(request, origin);
  const input = await body(request);
  const session = await current(db, request, origin, now);
  if (path === "/api/10x/identity/challenge") {
    const { address, intent } = IdentityChallengeRequest.parse(input);
    try {
      const key = publicKey(address), point = ed25519.Point.fromBytes(key, false);
      if (toBase58(key) !== address || point.isSmallOrder() || !point.isTorsionFree()) fail("identity_invalid_signer");
    } catch { fail("identity_invalid_signer"); }
    if ((intent === "login") === Boolean(session?.identity_id)) fail("identity_session_intent_mismatch", 409);
    if (intent === "unlink" && !await db.prepare("SELECT address FROM tenx_identity_wallets WHERE address=? AND identity_id=?").bind(address, session!.identity_id).first()) fail("identity_wallet_not_linked", 409);
    const token = session ? null : random(), hash = session?.token_hash ?? await sessionHash(token!);
    const id = crypto.randomUUID(), expires = new Date(at.getTime() + CHALLENGE_MS).toISOString();
    const description = intent === "login" ? "Sign in to your local 10X Solana identity." : intent === "link" ? `Link this wallet to local 10X identity ${session!.identity_id}.` : `Unlink this wallet from local 10X identity ${session!.identity_id} and revoke all its sessions.`;
    const message = `${new URL(origin).host} requests a Solana wallet ownership proof:\n${address}\n\n${description}\nThis grants no votes and authorizes no transactions or spending.\n\nURI: ${origin}/wallets\nVersion: 1\nChain ID: solana:mainnet\nIntent: ${intent}\nNonce: ${random()}\nIssued At: ${now}\nExpiration Time: ${expires}\nRequest ID: ${id}`;
    // Atomic global/per-browser admission. No IP address or signer secret stored.
    const daily = `SELECT count(*) FROM tenx_identity_challenges WHERE issued_at>=? AND issued_at<?`;
    const start = now.slice(0, 10) + "T00:00:00.000Z", end = new Date(Date.parse(start) + 86400000).toISOString();
    const batch: D1PreparedStatement[] = [];
    if (token) batch.push(db.prepare(`INSERT INTO tenx_identity_sessions(token_hash,origin,created_at,expires_at) SELECT ?,?,?,? WHERE (${daily})<500`).bind(hash, origin, now, new Date(at.getTime() + ANON_MS).toISOString(), start, end));
    batch.push(db.prepare(`INSERT INTO tenx_identity_challenges(id,session_hash,address,intent,origin,message,issued_at,expires_at)
      SELECT ?,?,?,?,?,?,?,? WHERE (${daily})<500 AND
      (SELECT count(*) FROM tenx_identity_challenges WHERE session_hash=? AND issued_at>?)<10 AND
      EXISTS(SELECT 1 FROM tenx_identity_sessions WHERE token_hash=? AND revoked_at IS NULL AND expires_at>? AND identity_id IS ?)`)
      .bind(id, hash, address, intent, origin, message, now, expires, start, end, hash, new Date(at.getTime() - 60_000).toISOString(), hash, now, session?.identity_id ?? null));
    const result = await db.batch(batch);
    if (!result.at(-1)?.meta.changes) fail("identity_challenge_limit_or_session_changed", 429);
    return response(IdentityChallengeResponse.parse({ challenge_id: id, address, intent, message, expires_at: expires, chain: "solana:mainnet" }), token ? cookie(origin, token, ANON_MS / 1000) : undefined);
  }
  if (path === "/api/10x/identity/logout") {
    if (!input || typeof input !== "object" || Array.isArray(input) || Object.keys(input).length) fail("identity_invalid_logout");
    if (session) await db.batch([
      db.prepare("UPDATE tenx_identity_sessions SET revoked_at=? WHERE token_hash=?").bind(now, session.token_hash),
      ...(session.identity_id ? [db.prepare("INSERT INTO tenx_identity_audit(id,identity_id,action,created_at) VALUES(?,?,'logout',?)").bind(crypto.randomUUID(), session.identity_id, now)] : []),
    ]);
    return response(await view(db, null), cookie(origin, "", 0));
  }
  if (path !== "/api/10x/identity/verify") fail("identity_not_found", 404);
  const { challenge_id: id, signature: encoded } = IdentityVerifyRequest.parse(input);
  if (!session) fail("identity_session_required", 401);
  const challenge = await db.prepare("SELECT * FROM tenx_identity_challenges WHERE id=? AND session_hash=? AND origin=?").bind(id, session.token_hash, origin).first<Challenge>();
  if (!challenge || challenge.consumed_by || challenge.expires_at <= now || challenge.issued_at > now) fail("identity_challenge_expired_or_used", 409);
  if ((challenge.intent === "login") === Boolean(session.identity_id)) fail("identity_session_intent_mismatch", 409);
  const signature = Uint8Array.from(atob(encoded), c => c.charCodeAt(0));
  if (signature.length !== 64 || btoa(String.fromCharCode(...signature)) !== encoded || !ed25519.verify(signature, encoder.encode(challenge.message), publicKey(challenge.address), { zip215: false })) fail("identity_invalid_signature", 401);
  const owner = await db.prepare("SELECT identity_id FROM tenx_identity_wallets WHERE address=?").bind(challenge.address).first<{ identity_id: string }>();
  if (session.identity_id && owner && owner.identity_id !== session.identity_id) fail("identity_wallet_link_conflict", 409);
  const identity = session.identity_id ?? owner?.identity_id ?? crypto.randomUUID();
  const attempt = crypto.randomUUID(), token = random(), hash = await sessionHash(token), expires = new Date(at.getTime() + SESSION_MS).toISOString();
  const guard = "EXISTS(SELECT 1 FROM tenx_identity_challenges WHERE id=? AND consumed_by=?)";
  const ownership = owner ? "EXISTS(SELECT 1 FROM tenx_identity_wallets WHERE address=? AND identity_id=?)" : "NOT EXISTS(SELECT 1 FROM tenx_identity_wallets WHERE address=?)";
  const countGuard = challenge.intent === "unlink" ? ">1" : owner ? ">=0" : "<10";
  const statements = [db.prepare(`UPDATE tenx_identity_challenges SET consumed_by=?,consumed_at=? WHERE id=? AND consumed_by IS NULL AND expires_at>? AND issued_at<=? AND ${ownership}
      AND (SELECT count(*) FROM tenx_identity_wallets WHERE identity_id=?)${countGuard}
      AND EXISTS(SELECT 1 FROM tenx_identity_sessions WHERE token_hash=? AND revoked_at IS NULL AND expires_at>? AND identity_id IS ?)`)
    .bind(attempt, now, id, now, now, challenge.address, ...(owner ? [identity] : []), identity, session.token_hash, now, session.identity_id)];
  if (challenge.intent === "unlink") {
    statements.push(db.prepare(`DELETE FROM tenx_identity_wallets WHERE address=? AND identity_id=? AND ${guard}`).bind(challenge.address, identity, id, attempt));
    statements.push(db.prepare(`UPDATE tenx_identity_sessions SET revoked_at=? WHERE identity_id=? AND ${guard}`).bind(now, identity, id, attempt));
  } else {
    if (!session.identity_id && !owner) statements.push(db.prepare(`INSERT INTO tenx_identities(id,created_at) SELECT ?,? WHERE ${guard}`).bind(identity, now, id, attempt));
    if (!owner) statements.push(db.prepare(`INSERT INTO tenx_identity_wallets(address,identity_id,linked_at) SELECT ?,?,? WHERE ${guard}`).bind(challenge.address, identity, now, id, attempt));
    statements.push(db.prepare(`UPDATE tenx_identity_sessions SET revoked_at=? WHERE token_hash=? AND ${guard}`).bind(now, session.token_hash, id, attempt));
    statements.push(db.prepare(`INSERT INTO tenx_identity_sessions(token_hash,identity_id,origin,created_at,expires_at) SELECT ?,?,?,?,? WHERE ${guard}`).bind(hash, identity, origin, now, expires, id, attempt));
  }
  statements.push(db.prepare(`INSERT INTO tenx_identity_audit(id,identity_id,address,action,challenge_id,message_hash,signature_hash,created_at) SELECT ?,?,?,?,?,?,?,? WHERE ${guard}`)
    .bind(attempt, identity, challenge.address, challenge.intent, id, await digest(challenge.message), await hashBytes(signature), now, id, attempt));
  const result = await db.batch(statements);
  if (!result[0]?.meta.changes) fail("identity_replay_conflict_or_wallet_limit", 409);
  if (challenge.intent === "unlink") return response(await view(db, null), cookie(origin, "", 0));
  return response(await view(db, { token_hash: hash, identity_id: identity, origin, expires_at: expires }), cookie(origin, token, SESSION_MS / 1000));
}
