// Full signed-message check against an isolated, disposable local Workerd/D1.
// Never points at the running app, a user wallet, RPC or a remote database.
import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { generateKeyPairSync, sign } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { toBase58 } from "../discovery/src/solana";
import { IdentityChallengeResponse, IdentitySessionResponse } from "../discovery/src/identity-model";

const root = fileURLToPath(new URL("../", import.meta.url)), execute = promisify(execFile);
const run = fileURLToPath(new URL(`../.tmp/identity-runtime-${crypto.randomUUID()}/`, import.meta.url));
mkdirSync(run, { recursive: true });
const config = `${run}/wrangler.jsonc`, persistence = `${run}/state`;
writeFileSync(config, JSON.stringify({
  name: "tenx-identity-isolated-check", main: fileURLToPath(new URL("../discovery/src/worker.ts", import.meta.url)),
  compatibility_date: "2026-09-01", compatibility_flags: ["nodejs_compat"], workers_dev: false, preview_urls: false,
  vars: { TENX_LOCAL_ONLY: "true" },
  d1_databases: [{ binding: "TENX_DB", database_name: "tenx-identity-isolated-check", database_id: "00000000-0000-0000-0000-000000000018", migrations_dir: fileURLToPath(new URL("../discovery/migrations/", import.meta.url)), remote: false }],
}));
const wrangler = fileURLToPath(new URL("../discovery/node_modules/wrangler/bin/wrangler.js", import.meta.url));
const options = { cwd: root, windowsHide: true, env: { ...process.env, CI: "true", WRANGLER_SEND_METRICS: "false" }, maxBuffer: 2_000_000 };
await execute(process.execPath, [wrangler, "d1", "migrations", "apply", "TENX_DB", "--local", "--config", config, "--persist-to", persistence], options);
const port = 18796, origin = "https://app-local.10x.meme", base = `http://127.0.0.1:${port}/api/10x`;
// Refuse an occupied port: never run signatures against an existing service.
try { await fetch(`${base}/health`, { signal: AbortSignal.timeout(1000) }); throw new Error("isolated_port_already_in_use"); }
catch (error) { if (error instanceof Error && error.message === "isolated_port_already_in_use") throw error; }
const child = spawn(process.execPath, [wrangler, "dev", "--local", "--ip", "127.0.0.1", "--port", String(port), "--config", config, "--persist-to", persistence], { ...options, stdio: ["ignore", "pipe", "pipe"] });
let log = ""; child.stdout.on("data", chunk => { log = (log + String(chunk)).slice(-8000); }); child.stderr.on("data", chunk => { log = (log + String(chunk)).slice(-8000); });
const pause = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
function wallet() {
  const keys = generateKeyPairSync("ed25519"), der = keys.publicKey.export({ format: "der", type: "spki" });
  return { address: toBase58(new Uint8Array(der.subarray(-32))), sign: (message: string) => sign(null, Buffer.from(message), keys.privateKey).toString("base64") };
}
async function call(path: string, body?: unknown, cookie?: string) {
  return fetch(`${base}/identity/${path}`, { signal: AbortSignal.timeout(15000), headers: { "x-10x-identity-origin": origin, ...(body === undefined ? {} : { origin, "content-type": "application/json", "x-tenx-identity": "1" }), ...(cookie ? { cookie } : {}) }, ...(body === undefined ? {} : { method: "POST", body: JSON.stringify(body) }) });
}
async function challenge(w: ReturnType<typeof wallet>, intent: string, cookie?: string) {
  const result = await call("challenge", { address: w.address, intent }, cookie);
  assert.equal(result.status, 200); return { value: IdentityChallengeResponse.parse(await result.json()), cookie: cookie ?? result.headers.get("set-cookie")!.split(";")[0]! };
}
async function login(w: ReturnType<typeof wallet>) {
  const c = await challenge(w, "login"), result = await call("verify", { challenge_id: c.value.challenge_id, signature: w.sign(c.value.message) }, c.cookie);
  assert.equal(result.status, 200); return { value: IdentitySessionResponse.parse(await result.json()), cookie: result.headers.get("set-cookie")!.split(";")[0]! };
}
try {
  let ready = false;
  for (let i = 0; i < 80; i++) {
    if (child.exitCode !== null) throw new Error(`isolated_runtime_stopped: ${log}`);
    try { if ((await fetch(`${base}/health`, { signal: AbortSignal.timeout(500) })).ok) { ready = true; break; } } catch { /* Starting owned runtime. */ }
    await pause(250);
  }
  assert(ready, `isolated_runtime_not_ready: ${log}`);
  const a = wallet(), b = wallet(), c = await challenge(a, "login");
  assert(c.value.message.includes(`URI: ${origin}/wallets`));
  const proof = { challenge_id: c.value.challenge_id, signature: a.sign(c.value.message) };
  const responses = await Promise.all([call("verify", proof, c.cookie), call("verify", proof, c.cookie)]);
  assert.equal(responses.filter(r => r.status === 200).length, 1);
  // If the losing request reads after rotation it sees a revoked session (401).
  // If both read before rotation, the atomic nonce guard rejects it (409).
  assert([401, 409].includes(responses.find(r => r.status !== 200)!.status));
  const success = responses.find(r => r.status === 200)!;
  assert.match(success.headers.get("set-cookie")!, /^__Host-tenx_solana=.*; HttpOnly; SameSite=Strict; Max-Age=43200; Secure$/);
  const user = IdentitySessionResponse.parse(await success.json()), cookie = success.headers.get("set-cookie")!.split(";")[0]!;
  assert.equal(user.voting_enabled, false);
  const link = await challenge(b, "link", cookie), linked = await call("verify", { challenge_id: link.value.challenge_id, signature: b.sign(link.value.message) }, cookie);
  assert.equal(linked.status, 200); assert.equal(IdentitySessionResponse.parse(await linked.json()).wallets.length, 2);
  const rotated = linked.headers.get("set-cookie")!.split(";")[0]!, recovered = await login(b);
  assert.equal(recovered.value.identity_id, user.identity_id);
  const other = await login(wallet()), conflict = await challenge(b, "link", other.cookie);
  assert.equal((await call("verify", { challenge_id: conflict.value.challenge_id, signature: b.sign(conflict.value.message) }, other.cookie)).status, 409);
  const unlink = await challenge(a, "unlink", rotated);
  assert.equal((await call("verify", { challenge_id: unlink.value.challenge_id, signature: a.sign(unlink.value.message) }, rotated)).status, 200);
  for (const oldCookie of [rotated, recovered.cookie]) assert.equal(IdentitySessionResponse.parse(await (await call("session", undefined, oldCookie)).json()).authenticated, false);
  assert.equal((await login(b)).value.identity_id, user.identity_id);
  console.log(JSON.stringify({ isolated_workerd_d1: "passed", concurrent_replay: "one admission", signed_link: true, same_identity_recovery: true, ownership_conflict: "rejected", signed_unlink_revokes_all_sessions: true, wallet_keys: "ephemeral test keys only", provider_requests: 0, live_app_database_writes: 0, deploy: false }, null, 2));
} finally {
  if (child.pid && child.exitCode === null) {
    if (process.platform === "win32") await execute("taskkill", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true }).catch(() => {});
    else child.kill("SIGTERM");
  }
}
