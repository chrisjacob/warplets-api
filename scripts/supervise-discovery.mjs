import { spawn, spawnSync } from "node:child_process";
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { boundedWatchdogJson, checkDiscovery, publishWatchdog } from "./discovery-watchdog.mjs";
import { discoverySupervisor } from "./discovery-supervision.mjs";

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
const log = message => writeFileSync(output, `${new Date().toISOString()} ${message}\n`);
async function healthy(signal) {
  try { const r = await fetch("http://127.0.0.1:8794/api/10x/health", { signal: AbortSignal.any([signal, AbortSignal.timeout(3000)]), redirect: "manual", cache: "no-store" }); const j = await boundedWatchdogJson(r); return r.ok && j.local === true && j.ready === true; } catch { return false; }
}
async function observe(signal){
  const transport=(url,init)=>fetch(url,{...init,signal:AbortSignal.any([signal,init.signal])});
  const report=await checkDiscovery(transport);
  if(signal.aborted)return report;
  try{writeFileSync(`${temp}discovery-watchdog.pending`,JSON.stringify(report));renameSync(`${temp}discovery-watchdog.pending`,`${temp}discovery-watchdog.json`);}catch{log("Independent watchdog file could not be updated; service remains running.");}
  const tokenFile=fileURLToPath(new URL("../discovery/.dev.vars",import.meta.url));
  const token=existsSync(tokenFile)?readFileSync(tokenFile,"utf8").match(/^TENX_ADMIN_TOKEN=([a-f0-9]{64})\s*$/m)?.[1]:null;
  await publishWatchdog(report,token,transport);return report;
}
const supervisor = discoverySupervisor({ healthy, observe, log,
  start: () => spawn(process.execPath, [fileURLToPath(new URL("./dev-discovery.mjs", import.meta.url))], { cwd: root, stdio: ["ignore", output, output], windowsHide: true }),
  terminate(child) {
    if (process.platform === "win32") return spawnSync("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore", windowsHide: true }).status === 0;
    return child.kill("SIGTERM");
  },
});
process.on("SIGINT", supervisor.stop); process.on("SIGTERM", supervisor.stop);
try {
  log("Local discovery supervisor started. No deploy or remote writes.");
  await supervisor.run();
} finally { supervisor.stop(); closeSync(lockFd); if (existsSync(lock) && readFileSync(lock, "utf8") === String(process.pid)) unlinkSync(lock); closeSync(output); }
