import { readFileSync } from "node:fs";
const action = process.argv[2] ?? "status";
const routes = { status: "system/status", jobs: "admin/jobs", refresh: "admin/refresh", pause: "admin/pause", resume: "admin/pause", fixtures: "admin/seed-fixtures", "dry-run": "admin/dry-run" };
if (!(action in routes)) throw new Error("Use status, jobs, refresh, pause, resume, fixtures or dry-run");
const readOnly = action === "status" || action === "jobs";
const token = readFileSync(new URL("../discovery/.dev.vars", import.meta.url), "utf8").match(/^TENX_ADMIN_TOKEN=([a-f0-9]{64})\s*$/m)?.[1];
if (!token) throw new Error("Start the local discovery service first");
const response = await fetch(`http://127.0.0.1:8794/api/10x/${routes[action]}`, {
  method: readOnly ? "GET" : "POST",
  headers: { authorization: `Bearer ${token}`, ...(readOnly ? {} : { "content-type": "application/json" }) },
  ...(readOnly ? {} : { body: JSON.stringify({ reason: `Local operator requested ${action}`, ...(["pause", "resume"].includes(action) ? { paused: action === "pause" } : {}) }) }),
});
console.log(JSON.stringify(await response.json(), null, 2));
if (!response.ok) process.exitCode = 1;
