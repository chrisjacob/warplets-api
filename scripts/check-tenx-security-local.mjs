import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseEnv } from "node:util";
import { createHmac } from "node:crypto";

// Read-only local checks. Credentials stay in memory, never in output/URLs.
const root = fileURLToPath(new URL("../", import.meta.url));
const vite = "http://127.0.0.1:5183", api = "http://127.0.0.1:8794/api/10x";
const discovery = parseEnv(readFileSync(resolve(root, "discovery/.dev.vars"), "utf8"));
const app = parseEnv(readFileSync(resolve(root, "app/.dev.vars"), "utf8"));
const request = (url, init = {}) => fetch(url, { ...init, signal: AbortSignal.timeout(20000) });
let privatePaths = 0;
for (const path of ["/.dev.vars", "/.env.local", "/__open-in-editor", `/@fs/${root.replaceAll("\\", "/")}discovery/.dev.vars`, `/@fs/${root.replaceAll("\\", "/")}.tmp/attention-local.json`]) {
  for (const suffix of ["", "?raw", "?import"]) {
    const r = await request(vite + path + suffix); assert.equal(r.status, 403, "Private path was not denied");
    assert.equal(r.headers.get("cache-control"), "no-store"); await r.body?.cancel(); privatePaths++;
  }
}
for (const path of ["/backing", "/discover", "/thesis", "/src/main.tsx"]) {
  const r = await request(vite + path); assert.equal(r.status, 200, "Public preview unavailable"); await r.body?.cancel();
}
const headers = { authorization: `Bearer ${discovery.TENX_ADMIN_TOKEN}` };
const cases = [
  ["/admin/jobs", {}, 401],
  ["/admin/jobs", { headers: { authorization: discovery.TENX_ADMIN_TOKEN } }, 401],
  ["/admin/jobs", { headers: { ...headers, origin: "https://evil.example" } }, 403],
  ["/admin/jobs", { headers: { ...headers, "sec-fetch-site": "cross-site" } }, 403],
  ["/admin/jobs", { headers }, 200],
  ["/admin/rewards/lab", { method: "POST", headers: { ...headers, "content-type": "text/plain" }, body: "{}" }, 415],
  ["/admin/rewards/lab", { method: "POST", headers: { ...headers, "content-type": "application/json" }, body: "{" }, 400],
  ["/admin/rewards/lab", { method: "POST", headers: { ...headers, "content-type": "application/json" }, body: "x".repeat(32001) }, 413],
  ["/identity/session", {}, 200],
  ["/backing", {}, 200],
];
for (const [path, init, status] of cases) {
  const r = await request(api + path, init); assert.equal(r.status, status, path);
  assert.equal(r.headers.get("cache-control"), "no-store"); assert.equal(r.headers.get("x-content-type-options"), "nosniff");
  assert.equal(r.headers.get("referrer-policy"), "no-referrer"); await r.body?.cancel();
}
const p = Buffer.from(JSON.stringify({ fid: 42, exp: Math.floor(Date.now() / 1000) + 60 })).toString("base64url");
const sessionToken = p + "." + createHmac("sha256", app.ACTION_SESSION_SECRET).update(p).digest("base64url");
for (const [token, expected] of [[null, 401], [sessionToken, 400], [sessionToken + ".suffix", 401]]) {
  const r = await request(vite + "/api/actions-verify", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ fid: 999, actionSlug: "unsupported-security-probe", sessionToken: token }) });
  assert.equal(r.status, expected, "Action identity boundary"); await r.body?.cancel();
}
console.log(JSON.stringify({ private_requests_denied: privatePaths, public_routes: "available", admin_origin_body_checks: cases.length, signed_action_session: "required", source_requests: 0, policy_gates_changed: false, deploy: false }, null, 2));
