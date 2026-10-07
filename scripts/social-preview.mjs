// Public development preview of COMPILED Social only. Never proxies Vite or
// serves source directories, source maps, generic admin routes or other apps.
import http from "node:http";
import assert from "node:assert/strict";
const port = Number(process.env.SOCIAL_PREVIEW_PORT || 8794);
const upstream = "http://127.0.0.1:8793";
// Exact public images used by the shared menu; no directory passthrough.
const menuImages = new Set([
  "/menu/menu-10x-app.png",
  "/menu/10xwarplets.jpg",
  "/icon_stonklet.jpg",
  "/menu/menu-drop-app.jpg",
  "/menu/discord.png",
  "/menu/telegram.png",
  "/menu/fomo.jpg",
  "/menu/pumpfun.png",
  "/menu/farcaster.png",
  "/menu/x.png",
  "/menu/menu-farcaster-channels.jpg",
  "/menu/opensea.png",
  "/menu/menu-opensea-1mwarplet.jpg",
  "/menu/menu-10x-website.png",
  "/menu/youtube.png",
]);
const allowedHost = new Set([
  "social-local.10x.meme",
  `127.0.0.1:${port}`,
  `localhost:${port}`,
]);
export function allowedPreviewPath(path, method) {
  if (method !== "GET" && method !== "POST") return false;
  if (path.includes("..") || path.includes("\\") || /%2f|%5c|%2e/i.test(path))
    return false;
  if (path === "/api/social/embed/cast") return method === "GET";
  if (path.startsWith("/api/social/"))
    return /^\/api\/social\/(?:config|feed|leaderboard|me|casts|publish|interact|visit|refresh-evidence|signer|checkin|preferences|report|mute|delete|view\/(?:start|complete)|post\/[a-zA-Z0-9-]+)$/.test(
      path,
    );
  if (
    /^\/api\/auth\/(?:session|logout|link|wallet\/(?:challenge|verify)|farcaster\/(?:challenge|verify|channel|status))$/.test(
      path,
    )
  )
    return true;
  if (path === "/api/email/social-proof") return method === "GET";
  if (path === "/api/email/subscribe-10x") return method === "POST";
  if (path === "/webhook/social") return method === "POST";
  if (method !== "GET") return false;
  return (
    menuImages.has(path) ||
    /^\/assets\/[a-zA-Z0-9_.-]+\.(?:js|css|woff2)$/.test(path) ||
    /^\/(?:icon_social\.png|splash_social\.png|embed_social\.png|favicon-social\.ico|favicon\.ico|icon\.png|splash\.png|embed\.png|favicon-10x-v2\.(?:png|ico)|farcaster\.webp|base\.webp|trust\.webp|matrix_bg_500x500_v2\.mp4|manifest-social\.webmanifest|\.well-known\/farcaster\.json)$/.test(
      path,
    ) ||
    /^\/(?:social\/?|menu|privacy|terms|post\/[a-zA-Z0-9-]+)?$/.test(path)
  );
}
const server = http.createServer(async (req, res) => {
  try {
    if (!allowedHost.has(req.headers.host || "")) {
      res.writeHead(421);
      res.end("Unknown preview host");
      return;
    }
    const url = new URL(req.url || "/", "http://preview.invalid");
    if (!allowedPreviewPath(url.pathname, req.method)) {
      res.writeHead(404, { "cache-control": "no-store" });
      res.end("Not available in Social preview");
      return;
    }
    let size = 0;
    const chunks = [];
    for await (const chunk of req) {
      size += chunk.length;
      if (size > 65536) {
        res.writeHead(413);
        res.end();
        return;
      }
      chunks.push(chunk);
    }
    const headers = new Headers();
    for (const name of [
      "content-type",
      "cookie",
      "authorization",
      "origin",
      "sec-fetch-site",
      "accept",
    ]) {
      const value = req.headers[name];
      if (typeof value === "string") headers.set(name, value);
    }
    const host = req.headers.host;
    headers.set("host", host);
    if (host === "social-local.10x.meme")
      headers.set("x-10x-public-origin", "https://social-local.10x.meme");
    // Node fetch replaces Host with the destination authority. Preserve the
    // allowlisted original host for domain-bound SIWE and mini-app metadata.
    await new Promise((resolve, reject) => {
      const upstreamRequest = http.request(
        `${upstream}${url.pathname}${url.search}`,
        {
          method: req.method,
          headers: Object.fromEntries(headers),
          timeout: 60_000,
        },
        (response) => {
          res.writeHead(response.statusCode || 502, {
            ...response.headers,
            "x-robots-tag": "noindex, nofollow",
            "cache-control": "no-store",
          });
          response.pipe(res);
          response.on("end", resolve);
          response.on("error", reject);
        },
      );
      upstreamRequest.on("timeout", () =>
        upstreamRequest.destroy(new Error("Preview timeout")),
      );
      upstreamRequest.on("error", reject);
      upstreamRequest.end(chunks.length ? Buffer.concat(chunks) : undefined);
    });
  } catch {
    if (!res.headersSent) res.writeHead(502);
    res.end("Social preview is restarting. Please retry.");
  }
});
if (!process.argv.includes("--test"))
  server.listen(port, "127.0.0.1", () =>
    console.log(`Restricted compiled Social preview: http://127.0.0.1:${port}`),
  );

if (process.argv.includes("--test")) {
  for (const path of [
    "/src/SocialApp.tsx",
    "/@vite/client",
    "/.dev.vars",
    "/.git/config",
    "/api/admin/social",
    "/assets/test.js.map",
    "/api/stonklets/spotlight",
    "/menu/private.json",
    "/%2e%2e/.dev.vars",
  ])
    assert.equal(allowedPreviewPath(path, "GET"), false, path);
  for (const path of [
    "/",
    "/social",
    "/api/social/feed",
    "/api/social/embed/cast",
    "/.well-known/farcaster.json",
    "/assets/SocialApp.js",
    "/base.webp",
    "/farcaster.webp",
    "/trust.webp",
    ...menuImages,
  ])
    assert.equal(allowedPreviewPath(path, "GET"), true, path);
  assert.equal(allowedPreviewPath("/api/social/publish", "DELETE"), false);
  assert.equal(allowedPreviewPath("/api/social/embed/cast", "POST"), false);
  assert.equal(allowedPreviewPath("/api/social/embed/arbitrary", "GET"), false);
  assert.equal(allowedPreviewPath("/webhook/social", "POST"), true);
  console.log("Social preview route restrictions passed.");
}
