import { spawn, spawnSync } from "node:child_process";
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const temp = fileURLToPath(new URL("../.tmp/", import.meta.url)); mkdirSync(temp, { recursive: true });
const lock = `${temp}discovery-supervisor.lock`;
if (existsSync(lock)) {
  const pid = Number(readFileSync(lock, "utf8"));
  try { process.kill(pid, 0); process.exit(0); } catch { unlinkSync(lock); }
}
let lockFd;
try { lockFd = openSync(lock, "wx"); } catch { process.exit(0); }
writeFileSync(lockFd, String(process.pid));
const output = openSync(`${temp}discovery-supervisor.log`, "a");
let child, stopping = false;
const log = message => writeFileSync(output, `${new Date().toISOString()} ${message}\n`);
function terminateChild() {
  if (!child?.pid || child.exitCode !== null) return;
  if (process.platform === "win32") spawnSync("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
  else child.kill("SIGTERM");
}
function stop() { stopping = true; terminateChild(); }
process.on("SIGINT", stop); process.on("SIGTERM", stop);
async function healthy() {
  try { const r = await fetch("http://127.0.0.1:8794/api/10x/health", { signal: AbortSignal.timeout(3000) }); const j = await r.json(); return r.ok && j.local === true && j.ready === true; } catch { return false; }
}
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
try {
  log("Local discovery supervisor started. No deploy or remote writes.");
  while (!stopping) {
    if (!child && !await healthy()) {
      child = spawn(process.execPath, [fileURLToPath(new URL("./dev-discovery.mjs", import.meta.url))], { cwd: root, stdio: ["ignore", output, output], windowsHide: true });
      log(`Started owned discovery launcher PID ${child.pid}`);
      await wait(60000);
    }
    let failures = 0;
    while (!stopping) {
      await wait(30000);
      if (child?.exitCode !== null && child) break;
      if (await healthy()) failures = 0;
      else if (++failures >= 3) { if (!child) throw new Error("Unhealthy existing service is not owned by this supervisor; refusing to terminate it"); terminateChild(); break; }
    }
    child = undefined;
    if (!stopping) { log("Owned service exited or failed health checks; restarting after 15s."); await wait(15000); }
  }
} finally { terminateChild(); closeSync(lockFd); if (existsSync(lock) && readFileSync(lock, "utf8") === String(process.pid)) unlinkSync(lock); closeSync(output); }
