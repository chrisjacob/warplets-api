import { spawn, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import net from "node:net";
import { startRelay } from "./discovery-relay.mjs";

const dir = fileURLToPath(new URL("../discovery/", import.meta.url));
const base = "http://127.0.0.1:8794";
const persist = path.join(dir, ".wrangler", "local");
const varsFile = path.join(dir, ".dev.vars");
function run(args) {
  const result = spawnSync("pnpm", ["exec", "wrangler", ...args], { cwd: dir, stdio: "inherit", shell: process.platform === "win32" });
  if (result.status !== 0) throw new Error("Local Wrangler command failed");
}
async function assertPortFree() {
  await new Promise((resolve, reject) => {
    const server = net.createServer(); server.once("error", () => reject(new Error("Discovery port 8794 is already in use")));
    server.listen(8794, "127.0.0.1", () => server.close(resolve));
  });
}
await assertPortFree();
if (!existsSync(varsFile)) {
  writeFileSync(varsFile, `TENX_ADMIN_TOKEN=${randomBytes(32).toString("hex")}\nTENX_MARKET_ENABLED=true\nTENX_NODE_RELAY=true\n`, { mode: 0o600, flag: "wx" });
}
const token = readFileSync(varsFile, "utf8").match(/^TENX_ADMIN_TOKEN=([a-f0-9]{64})\s*$/m)?.[1];
if (!token) throw new Error("Set a 64-character random hexadecimal TENX_ADMIN_TOKEN in discovery/.dev.vars");
run(["d1", "migrations", "apply", "TENX_DB", "--local", "--config", "wrangler.local.jsonc", "--persist-to", persist]);
const vars = readFileSync(varsFile, "utf8");
const relay = /\bTENX_NODE_RELAY=true\b/.test(vars) ? await startRelay({ token, rpcUrl: "https://api.mainnet-beta.solana.com" }) : null;
const child = spawn("pnpm", ["exec", "wrangler", "dev", "--local", "--config", "wrangler.local.jsonc", "--port", "8794", "--ip", "127.0.0.1", "--inspector-port", "9237", "--persist-to", persist], { cwd: dir, stdio: "inherit", shell: process.platform === "win32" });
let stopping = false, busy = false;
let timer;
function stop() {
  if (stopping) return; stopping = true; clearInterval(timer); relay?.close();
  if (process.platform === "win32" && child.pid) spawnSync("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
  else child.kill();
}
process.on("SIGINT", stop); process.on("SIGTERM", stop);
child.on("exit", () => { stopping = true; clearInterval(timer); relay?.close(); });
const deadline = Date.now() + 90_000;
while (Date.now() < deadline && !stopping) {
  try { if ((await fetch(`${base}/api/10x/health`, { signal: AbortSignal.timeout(2000) })).ok) break; } catch { /* booting */ }
  await new Promise(resolve => setTimeout(resolve, 500));
}
if (stopping || Date.now() >= deadline) { stop(); throw new Error("Local discovery did not become ready"); }
console.log("Local discovery ready on port 8794. Timer: 60s. Operator token stays in discovery/.dev.vars.");
async function tick() {
  if (busy || stopping) return; busy = true;
  try {
    const maintenance = await fetch(`${base}/api/10x/admin/maintenance`, {
      method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ reason: "Local timer heartbeat and daily outcome review" }), signal: AbortSignal.timeout(120_000),
    });
    if (!maintenance.ok) console.warn("Discovery maintenance HTTP", maintenance.status);
    const market = await fetch(`${base}/api/10x/admin/market-refresh`, {
      method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ reason: "Local batched chart and image refresh" }), signal: AbortSignal.timeout(60000),
    });
    if (market.ok) console.log("Market cycle:", JSON.stringify(await market.json()));
    else console.warn("Market cycle HTTP", market.status);
    const response = await fetch(`${base}/api/10x/admin/refresh`, {
      method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ reason: "Local bounded discovery timer" }), signal: AbortSignal.timeout(360_000),
    });
    if (response.ok) console.log("Discovery cycle:", JSON.stringify(await response.json()));
    else console.warn("Discovery cycle HTTP", response.status);
  } catch { console.warn("Local discovery refresh interrupted; durable state retained."); }
  finally { busy = false; }
}
await tick();
timer = setInterval(() => { void tick(); }, 60_000);
