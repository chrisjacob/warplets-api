import type { Plugin } from "vite";

// Keep Vite's defaults and explicitly protect ignored local runtime material.
// A workspace allowlist permits shared source imports, not credential exports.
export const LOCAL_PRIVATE_FILES = [".env", ".env.*", "*.{crt,pem,key,p12,pfx,sqlite,sqlite3,db,log}", "**/.git/**", "**/.dev.vars", "**/.dev.vars.*", "**/.wrangler/**", "**/.tmp/**", "**/tmp/**", "**/.codex/**", "**/.agents/**", "**/.aws/**", "**/.cloudflared/**"];
const privateDirectories = new Set([".git", ".wrangler", ".tmp", "tmp", ".codex", ".agents", ".aws", ".cloudflared"]);
export function privatePreviewRequest(rawUrl: string): boolean {
  let path = rawUrl.split(/[?#]/, 1)[0];
  // Decode before testing names, including encoded separators and double encoding.
  // The early guard also covers public/ files, which Vite's fs.deny excludes.
  for (let i = 0; i < 3; i++) {
    try { const decoded = decodeURIComponent(path); if (decoded === path) break; path = decoded; }
    catch { return true; }
  }
  if (/%[a-f0-9]{2}/i.test(path) || /[\u0000-\u001f\u007f]/.test(path)) return true;
  // A tunneled preview never needs to invoke a workstation editor from HTTP.
  if (path.replaceAll("\\", "/").toLowerCase().split("/").includes("__open-in-editor")) return true;
  return path.replaceAll("\\", "/").toLowerCase().split("/").some(raw => {
    // Windows normalizes trailing dots/spaces and supports alternate data
    // streams and short-name aliases. Refuse those aliases before file lookup.
    const segment = raw.split(":", 1)[0].replace(/[ .]+$/, "");
    if (/^[a-z0-9_.$-]{1,6}~\d+(?:\.[a-z0-9]{1,3})?$/.test(segment)) return true;
    return privateDirectories.has(segment) || /^\.(?:env|dev\.vars)(?:\.|$)/.test(segment) || /\.(?:crt|pem|key|p12|pfx|sqlite|sqlite3|db|log)(?:-(?:wal|shm))?$/.test(segment);
  });
}
export function localPreviewSecurity(): Plugin {
  return { name: "tenx-private-local-files", apply: "serve", enforce: "pre", configureServer(server) {
    server.middlewares.use((request, response, next) => {
      if (!privatePreviewRequest(request.url ?? "/")) return next();
      response.writeHead(403, { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff", "referrer-policy": "no-referrer" });
      response.end("Private local files are not available.");
    });
  } };
}
