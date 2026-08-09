import { getAppSession, type AppAuthEnv, type AppSession } from "./appAuth.js";
import { requireSameOrigin } from "./authValidation.js";
import { jsonSecure, sha256Hex } from "./security.js";
import { WARPLETS_APP_ORIGINS } from "../../shared/warpletsApp.js";

export interface WarpmojiAdminEnv extends AppAuthEnv {
  WARPMOJI_ADMIN_FIDS?: string;
}

function allowedFids(env: WarpmojiAdminEnv): Set<number> {
  const configured = env.WARPMOJI_ADMIN_FIDS?.trim() || "1129138";
  return new Set(configured.split(",").map((value) => Number.parseInt(value.trim(), 10)).filter(Number.isInteger));
}

export function isWarpmojiLocalRequest(request: Request): boolean {
  const hostname = new URL(request.url).hostname.toLowerCase();
  return hostname === new URL(WARPLETS_APP_ORIGINS.local).hostname || hostname === "localhost" || hostname === "127.0.0.1";
}

export async function warpmojiCsrfToken(env: WarpmojiAdminEnv, session: AppSession): Promise<string> {
  return sha256Hex(`warpmoji-csrf:v1:${env.APP_SESSION_SECRET ?? ""}:${session.sessionHash}`);
}

export async function requireWarpmojiAdmin(
  request: Request,
  env: WarpmojiAdminEnv,
  options: { mutation?: boolean } = {},
): Promise<{ session: AppSession; csrfToken: string } | Response> {
  if (!isWarpmojiLocalRequest(request)) return jsonSecure({ error: "not_found" }, { status: 404 });
  if (options.mutation) {
    const originError = requireSameOrigin(request);
    if (originError) return originError;
  }
  const session = await getAppSession(request, env).catch(() => null);
  if (!session?.farcasterFid || !allowedFids(env).has(session.farcasterFid)) {
    return jsonSecure({ error: "A verified 10xchris.eth or warpmoji.eth Farcaster session is required." }, { status: 403 });
  }
  const csrfToken = await warpmojiCsrfToken(env, session);
  if (options.mutation && request.headers.get("x-warpmoji-csrf") !== csrfToken) {
    return jsonSecure({ error: "Invalid Warpmoji CSRF token." }, { status: 403 });
  }
  return { session, csrfToken };
}

export async function auditWarpmoji(db: D1Database, fid: number, action: string, target: string, detail: unknown = {}): Promise<void> {
  await db.prepare("INSERT INTO warpmoji_admin_audit (id, admin_fid, action, target, detail_json) VALUES (?, ?, ?, ?, ?)")
    .bind(crypto.randomUUID(), fid, action, target.slice(0, 300), JSON.stringify(detail)).run();
}

