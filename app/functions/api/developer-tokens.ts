import { getAppSession, type AppAuthEnv } from "../_lib/appAuth.js";
import { jsonSecure, sha256Hex } from "../_lib/security.js";

interface Env extends AppAuthEnv {}

const ALLOWED_SCOPES = new Set([
  "favourites:read",
  "favourites:write",
  "alerts:read",
  "alerts:write",
  "stats:shares",
]);

function sameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  return !origin || origin === new URL(request.url).origin;
}

function randomToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return `10x_${btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")}`;
}

async function requireWallet(request: Request, env: Env): Promise<`0x${string}` | null> {
  return (await getAppSession(request, env))?.walletAddress ?? null;
}

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const wallet = await requireWallet(request, env);
  if (!wallet) return jsonSecure({ error: "verified wallet session required" }, { status: 401 });
  const rows = await env.WARPLETS.prepare(
    `SELECT id, name, scopes_json, created_at, last_used_at, expires_at, revoked_at
       FROM api_credentials WHERE wallet_address = ? ORDER BY created_at DESC`,
  ).bind(wallet).all<Record<string, unknown>>();
  return jsonSecure({ credentials: rows.results ?? [] });
};

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  if (!sameOrigin(request)) return jsonSecure({ error: "cross-origin request rejected" }, { status: 403 });
  const wallet = await requireWallet(request, env);
  if (!wallet) return jsonSecure({ error: "verified wallet session required" }, { status: 401 });
  const body = await request.json<{ name?: string; scopes?: string[] }>().catch(
    (): { name?: string; scopes?: string[] } => ({}),
  );
  const name = body.name?.trim().slice(0, 80) || "10X API token";
  const scopes = [...new Set((body.scopes ?? []).filter((scope) => ALLOWED_SCOPES.has(scope)))];
  if (!scopes.length) return jsonSecure({ error: "select at least one valid scope" }, { status: 400 });
  const token = randomToken();
  const id = crypto.randomUUID();
  const createdAt = new Date().toISOString();
  await env.WARPLETS.prepare(
    `INSERT INTO api_credentials (id, token_hash, wallet_address, name, scopes_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).bind(id, await sha256Hex(token), wallet, name, JSON.stringify(scopes), createdAt).run();
  return jsonSecure({ credential: { id, name, scopes, createdAt }, token }, { status: 201 });
};

export const onRequestDelete: PagesFunction<Env> = async ({ request, env }) => {
  if (!sameOrigin(request)) return jsonSecure({ error: "cross-origin request rejected" }, { status: 403 });
  const wallet = await requireWallet(request, env);
  if (!wallet) return jsonSecure({ error: "verified wallet session required" }, { status: 401 });
  const id = new URL(request.url).searchParams.get("id")?.trim() ?? "";
  if (!id) return jsonSecure({ error: "credential id is required" }, { status: 400 });
  await env.WARPLETS.prepare(
    "UPDATE api_credentials SET revoked_at = ? WHERE id = ? AND wallet_address = ? AND revoked_at IS NULL",
  ).bind(new Date().toISOString(), id, wallet).run();
  return jsonSecure({ ok: true });
};
