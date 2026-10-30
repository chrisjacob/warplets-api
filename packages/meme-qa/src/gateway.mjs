import { createServer } from "node:http";
import { randomBytes, createHash, timingSafeEqual } from "node:crypto";
import {
  readFileSync,
  realpathSync,
  statSync,
  mkdirSync,
  writeFileSync,
} from "node:fs";
import { resolve, sep, extname, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { loopback } from "./safety.mjs";
import { boundedJson } from "./safety.mjs";
import { requireOutsideRepository } from "./wallets.mjs";

const digest = (value) => createHash("sha256").update(value).digest();
const same = (a, b) => timingSafeEqual(digest(a), digest(b));
export function validateGateway(config, now = Date.now()) {
  const u = new URL(config.origin);
  if (
    u.origin !== config.origin ||
    u.protocol !== "https:" ||
    u.port ||
    !/^[a-z0-9]+(?:-[a-z0-9]+)*\.trycloudflare\.com$/.test(u.hostname)
  )
    throw Error("An exact isolated HTTPS Quick Tunnel origin is required");
  loopback(config.worker);
  if (!/^[A-Za-z0-9_-]{43}$/.test(config.upstreamToken ?? ""))
    throw Error("Private gateway transport token required");
  if (
    !Array.isArray(config.grants) ||
    !config.grants.length ||
    config.grants.length > 100 ||
    config.grants.some(
      (g) =>
        !Number.isSafeInteger(g.fid) ||
        g.fid <= 0 ||
        !/^[a-f0-9]{64}$/.test(g.codeHash) ||
        !Number.isSafeInteger(g.expiresAt) ||
        g.expiresAt <= now ||
        g.expiresAt > now + 8 * 3600000,
    ) ||
    new Set(config.grants.map((g) => g.fid)).size !== config.grants.length
  )
    throw Error(
      "Provide 1–100 unique invited FIDs with hashed access codes expiring within eight hours",
    );
  return config;
}
export function issueGrant(fid, now = Date.now()) {
  const code = randomBytes(32).toString("base64url");
  return {
    code,
    grant: {
      fid,
      codeHash: digest(code).toString("hex"),
      expiresAt: now + 2 * 3600000,
    },
  };
}
export function permittedApi(path, method) {
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
const types = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".wasm": "application/wasm",
};
const entry =
  '<!doctype html><meta name="viewport" content="width=device-width"><title>10X QA</title><style>body{font:18px system-ui;max-width:24rem;margin:15vh auto;padding:1rem}input,button{font:inherit;padding:.7rem;margin:.5rem 0;width:100%;box-sizing:border-box}</style><h1>10X QA</h1><form method="post" action="/qa/access"><label>Access code<input type="password" name="code" required autocomplete="off" maxlength="100"></label><button>Continue</button></form>';
async function body(req, max) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > max) throw Error("Request too large");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}
export function createGateway(
  config,
  { now = Date.now, fetcher = fetch } = {},
) {
  validateGateway(config, now());
  const root = realpathSync(config.staticDirectory),
    sessions = new Map();
  // Global cap cannot be evaded by spoofing forwarded IP headers. No request logs or codes.
  let window = 0,
    attempts = 0;
  return createServer(async (req, res) => {
    const send = (
      status,
      text,
      type = "text/plain; charset=utf-8",
      extra = {},
    ) => {
      res.writeHead(status, {
        "content-type": type,
        "cache-control": "no-store",
        "referrer-policy": "no-referrer",
        "x-content-type-options": "nosniff",
        "x-robots-tag": "noindex, nofollow",
        "x-frame-options": "DENY",
        "content-security-policy": "frame-ancestors 'none'",
        ...extra,
      });
      res.end(req.method === "HEAD" ? undefined : text);
    };
    try {
      const u = new URL(req.url, config.origin),
        method = req.method;
      if (
        req.headers.host !== new URL(config.origin).host ||
        u.origin !== config.origin ||
        (req.headers.origin && req.headers.origin !== config.origin) ||
        ((u.pathname.startsWith("/api/") ||
          !["GET", "HEAD"].includes(method)) &&
          req.headers["sec-fetch-site"] &&
          !["same-origin", "none"].includes(req.headers["sec-fetch-site"]))
      )
        return send(403, "Origin mismatch");
      if (u.search || /%|\\|\.{2}/.test(req.url.split("?")[0]))
        return send(404, "Not found");
      if (u.pathname === "/qa/access" && method === "POST") {
        if (
          req.headers.origin !== config.origin ||
          req.headers["content-type"] !== "application/x-www-form-urlencoded"
        )
          return send(403, "Origin mismatch");
        const w = Math.floor(now() / 60000);
        if (window !== w) {
          window = w;
          attempts = 0;
        }
        if (++attempts > 10) return send(429, "Try again later");
        const code =
          new URLSearchParams((await body(req, 256)).toString()).get("code") ??
          "";
        const grant = config.grants.find(
          (g) =>
            g.expiresAt > now() &&
            same(digest(code).toString("hex"), g.codeHash),
        );
        if (!grant) return send(403, "Access code expired or invalid");
        // One active session per grant. A stolen code cannot fill unbounded memory.
        for (const [id, s] of sessions)
          if (s.fid === grant.fid || s.expiresAt <= now()) sessions.delete(id);
        const token = randomBytes(32).toString("base64url");
        sessions.set(digest(token).toString("hex"), {
          fid: grant.fid,
          expiresAt: grant.expiresAt,
        });
        return send(303, "", "text/plain", {
          location: "/",
            "set-cookie": `__Host-meme_qa=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${Math.floor((grant.expiresAt - now()) / 1000)}`,
        });
      }
      const token =
        (req.headers.cookie ?? "")
          .split(";")
          .map((x) => x.trim())
          .find((x) => x.startsWith("__Host-meme_qa="))
          ?.slice(15) ?? "";
      const access = sessions.get(digest(token).toString("hex"));
      if (!access || access.expiresAt <= now())
        return send(401, entry, "text/html; charset=utf-8");
      if (u.pathname.startsWith("/api/")) {
        if (!permittedApi(u.pathname, method)) return send(404, "Not found");
        if (
          !["GET", "HEAD"].includes(method) &&
          req.headers.origin !== config.origin
        )
          return send(403, "Origin mismatch");
        const headers = new Headers();
        for (const name of [
          "origin",
          "cookie",
          "content-type",
          "sec-fetch-site",
        ])
          if (req.headers[name]) headers.set(name, req.headers[name]);
        headers.set("host", u.host);
        headers.set("x-meme-qa-gateway", config.upstreamToken);
        // Never forward client-supplied principal/operator/forwarded headers.
        const current = await boundedJson(
          await fetcher(new URL("/api/auth/session", config.worker), {
            headers: new Headers({
              host: u.host,
              "x-meme-qa-gateway": config.upstreamToken,
              cookie: headers.get("cookie") ?? "",
            }),
            redirect: "error",
            signal: AbortSignal.timeout(15000),
          }),
          65536,
        );
        if (
          current.farcasterFid != null &&
          current.farcasterFid !== access.fid &&
          u.pathname !== "/api/auth/logout"
        )
          return send(403, "Use the invited Farcaster account");
        const response = await fetcher(new URL(u.pathname, config.worker), {
          method,
          headers,
          redirect: "error",
          signal: AbortSignal.timeout(15000),
          ...(!["GET", "HEAD"].includes(method)
            ? { body: await body(req, 65536) }
            : {}),
        });
        const responseHeaders = {};
        const cookie = response.headers.get("set-cookie");
        if (cookie) responseHeaders["set-cookie"] = cookie;
        // Bind a gateway invitation to its server-verified identity, after login and on every request.
        const sessionHeaders = new Headers({
          host: u.host,
          "x-meme-qa-gateway": config.upstreamToken,
        });
        sessionHeaders.set(
          "cookie",
          cookie ? cookie.split(";")[0] : (headers.get("cookie") ?? ""),
        );
        const check = await fetcher(
          new URL("/api/auth/session", config.worker),
          {
            headers: sessionHeaders,
            redirect: "error",
            signal: AbortSignal.timeout(15000),
          },
        );
        const identity = await boundedJson(check, 65536);
        const fid = identity.farcasterFid;
        if (fid != null && fid !== access.fid)
          return send(403, "Use the invited Farcaster account");
        // Bound error bodies too, while preserving the Worker's actual status.
        const data = await boundedJson(
          new Response(response.body),
          1024 * 1024,
        );
        return send(
          response.status,
          JSON.stringify(data),
          "application/json",
          responseHeaders,
        );
      }
      if (!["GET", "HEAD"].includes(method))
        return send(405, "Method not allowed");
      const path = u.pathname === "/" ? "index.html" : u.pathname.slice(1);
      if (
        path.startsWith(".") ||
        path.split("/").some((x) => x.startsWith("."))
      )
        return send(404, "Not found");
      const type = types[extname(path)];
      if (!type) return send(404, "Not found");
      const file = realpathSync(resolve(root, path));
      if (
        !file.startsWith(root + sep) ||
        !statSync(file).isFile() ||
        statSync(file).size > 8 * 1024 * 1024
      )
        return send(404, "Not found");
      return send(200, readFileSync(file), type);
    } catch {
      return send(400, "Request could not complete");
    }
  });
}
if (
  process.argv[1] &&
  relative(resolve(process.argv[1]), fileURLToPath(import.meta.url)) === ""
) {
  const [command, file, origin, ...fids] = process.argv.slice(2);
  if (command === "prepare") {
    const target = requireOutsideRepository(file);
    mkdirSync(target, { recursive: true, mode: 0o700 });
    requireOutsideRepository(realpathSync(target));
    const invitations = fids.map((fid) => issueGrant(Number(fid)));
    const config = validateGateway({
      origin,
      worker: "http://127.0.0.1:8799",
      staticDirectory: resolve(
        import.meta.dirname,
        "../../../meme/.tmp/restricted-qa-web",
      ),
      grants: invitations.map((x) => x.grant),
      upstreamToken: randomBytes(32).toString("base64url"),
    });
    writeFileSync(
      resolve(target, "gateway.json"),
      JSON.stringify(config, null, 2),
      { flag: "wx", mode: 0o600 },
    );
    writeFileSync(
      resolve(target, ".dev.vars"),
      `MEME_QA_GATEWAY_TOKEN="${config.upstreamToken}"\n`,
      { flag: "wx", mode: 0o600 },
    );
    const workerConfig = {
      name: "meme-restricted-qa-local",
      main: resolve(import.meta.dirname, "../../../meme/src/worker/index.ts"),
      compatibility_date: "2026-10-30",
      compatibility_flags: ["nodejs_compat"],
      workers_dev: false,
      vars: {
        LOCAL_PREVIEW_ONLY: "true",
        LOCAL_PARTICIPATION_ENABLED: "true",
        LOCAL_OPERATIONS_ENABLED: "false",
        MEME_QA_ORIGIN: origin,
        MEME_QA_FIDS: fids.join(","),
      },
      d1_databases: [
        {
          binding: "MEME_DB",
          database_name: "meme-local",
          migrations_dir: resolve(
            import.meta.dirname,
            "../../../meme/migrations",
          ),
        },
      ],
    };
    writeFileSync(
      resolve(target, "wrangler.jsonc"),
      JSON.stringify(workerConfig, null, 2),
      { flag: "wx", mode: 0o600 },
    );
    writeFileSync(
      resolve(target, "invitations.private.json"),
      JSON.stringify(invitations, null, 2),
      { flag: "wx", mode: 0o600 },
    );
    console.log(
      "Private gateway configuration prepared. Read invitations locally; no tunnel started.",
    );
    process.exit(0);
  }
  if (command !== "serve" || !file)
    throw Error(
      "Usage: gateway serve <private-config.json>; never starts a tunnel",
    );
  const config = JSON.parse(readFileSync(file, "utf8"));
  createGateway(config).listen(8800, "127.0.0.1", () =>
    console.log(
      "Restricted QA gateway on loopback port 8800. No tunnel started.",
    ),
  );
}
