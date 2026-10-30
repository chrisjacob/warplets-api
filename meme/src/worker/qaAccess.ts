import { session } from "./auth";
import { type Database, requireThat, run, json } from "./db";
import { timingSafeEqual } from "node:crypto";

export function qaTransportRequest(
  request: Request,
  origin: string,
  secret: string,
) {
  requireThat(qaOrigin(origin), 404, "Local application only");
  const token = request.headers.get("x-meme-qa-gateway") ?? "";
  requireThat(
    /^[A-Za-z0-9_-]{43}$/.test(secret) &&
      /^[A-Za-z0-9_-]{43}$/.test(token) &&
      timingSafeEqual(
        new TextEncoder().encode(secret),
        new TextEncoder().encode(token),
      ),
    403,
    "QA gateway authentication required",
  );
  const input = new URL(request.url);
  requireThat(
    ["localhost", "127.0.0.1", "[::1]", new URL(origin).hostname].includes(
      input.hostname,
    ),
    404,
    "Local application only",
  );
  const target = new URL(origin);
  target.pathname = input.pathname;
  target.search = input.search;
  return new Request(target, request);
}

// QA is deliberately incompatible with every existing product/dev hostname.
export function qaOrigin(value: string): string | null {
  try {
    const u = new URL(value);
    return u.origin === value &&
      u.protocol === "https:" &&
      !u.port &&
      /^[a-z0-9]+(?:-[a-z0-9]+)*\.trycloudflare\.com$/.test(u.hostname)
      ? value
      : null;
  } catch {
    return null;
  }
}
function allowed(value: string) {
  const ids = value.split(",");
  requireThat(
    ids.length > 0 &&
      ids.length <= 100 &&
      ids.every(
        (x) => /^[1-9]\d{0,14}$/.test(x) && Number.isSafeInteger(Number(x)),
      ) &&
      new Set(ids).size === ids.length,
    503,
    "QA roster is not configured",
  );
  return new Set(ids.map(Number));
}
export function qaRoute(path: string, method: string) {
  if (path.startsWith("/api/auth/"))
    return ["GET", "POST", "DELETE"].includes(method);
  if (method === "GET")
    return (
      ["/api/meme/state", "/api/meme/preview"].includes(path) ||
      /^\/api\/meme\/(?:cycles|settlements)\/[a-zA-Z0-9_-]+$/.test(path)
    );
  return (
    method === "POST" &&
    /^\/api\/meme\/rounds\/[a-zA-Z0-9_-]+\/vote$/.test(path)
  );
}
export async function qaRequest(
  db: Database,
  request: Request,
  roster: string,
) {
  const ids = allowed(roster),
    path = new URL(request.url).pathname;
  requireThat(qaRoute(path, request.method), 404, "Not found");
  const s = await session(db, request);
  if (path === "/api/auth/logout") return;
  requireThat(
    s?.fid == null || ids.has(s.fid),
    403,
    "This account is outside the QA cohort",
  );
  if (!path.startsWith("/api/auth/"))
    requireThat(
      s?.fid && ids.has(s.fid),
      401,
      "Connect an invited Farcaster account",
    );
}
// Inspect the server-verified identity, never a supplied FID or relay payload.
export async function qaResponse(
  db: Database,
  request: Request,
  response: Response,
  roster: string,
) {
  const cookie = response.headers.get("set-cookie");
  if (!cookie) return response;
  const headers = new Headers(request.headers);
  headers.set("cookie", cookie.split(";")[0]);
  const s = await session(db, new Request(request.url, { headers }));
  if (s?.fid && !allowed(roster).has(s.fid)) {
    await run(db, "DELETE FROM meme_sessions WHERE token_hash=?", s.token_hash);
    return json({ error: "This account is outside the QA cohort" }, 403, {
      "set-cookie":
        "__Host-meme_session=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0",
    });
  }
  return response;
}
