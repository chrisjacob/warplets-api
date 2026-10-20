import { spawn, spawnSync } from "node:child_process";
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { checkDiscovery, publishWatchdog, restartAllowance, watchdogDecision } from "./discovery-watchdog.mjs";

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
let child, stopping = false,restartTimes=[],cooling=false;
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
async function observe(){
  const report=await checkDiscovery();
  try{writeFileSync(`${temp}discovery-watchdog.pending`,JSON.stringify(report));renameSync(`${temp}discovery-watchdog.pending`,`${temp}discovery-watchdog.json`);}catch{log("Independent watchdog file could not be updated; service remains running.");}
  const tokenFile=fileURLToPath(new URL("../discovery/.dev.vars",import.meta.url));
  const token=existsSync(tokenFile)?readFileSync(tokenFile,"utf8").match(/^TENX_ADMIN_TOKEN=([a-f0-9]{64})\s*$/m)?.[1]:null;
  await publishWatchdog(report,token);return report;
}
try {
  log("Local discovery supervisor started. No deploy or remote writes.");
  while (!stopping) {
    if (!child && !await healthy()) {
      const budget=restartAllowance(restartTimes);restartTimes=budget.recent;
      if(!budget.allowed){if(!cooling)log("Owned launcher restart budget exhausted; cooling down before another attempt.");cooling=true;await observe();await wait(30000);continue;}
      cooling=false;restartTimes.push(Date.now());
      child = spawn(process.execPath, [fileURLToPath(new URL("./dev-discovery.mjs", import.meta.url))], { cwd: root, stdio: ["ignore", output, output], windowsHide: true });
      log(`Started owned discovery launcher PID ${child.pid}`);
      await wait(60000);
    }
    let healthState={failures:0},lastCode,lastAction;
    while (!stopping) {
      await wait(30000);
      if (child?.exitCode !== null && child) break;
      const report=await observe();healthState=watchdogDecision(healthState,report,Boolean(child));
      if(report.code!==lastCode || healthState.action!==lastAction){log(`Independent watchdog: ${report.code}; action=${healthState.action}`);lastCode=report.code;lastAction=healthState.action;}
      if(healthState.action==="restart_owned"){log("Independent watchdog requested owned launcher restart after three consecutive failures.");terminateChild();break;}
    }
    child = undefined;
    if (!stopping) { log("Owned service exited or failed health checks; restarting after 15s."); await wait(15000); }
  }
} finally { terminateChild(); closeSync(lockFd); if (existsSync(lock) && readFileSync(lock, "utf8") === String(process.pid)) unlinkSync(lock); closeSync(output); }
