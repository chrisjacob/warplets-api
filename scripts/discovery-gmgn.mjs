import { readFileSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { gmgnWindowPlan, collectGmgnWindow } from "./gmgn-window-operator.mjs";

export function gmgnKeyFromVars(text) {
  const lines = text.split(/\r?\n/).filter(line => /^\s*GMGN_API_KEY\s*=/.test(line));
  if (lines.length !== 1) throw new Error("GMGN key missing or duplicated; check the ignored root .dev.vars");
  let value = lines[0].slice(lines[0].indexOf("=") + 1).trim();
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
  if (!/^[\x21-\x7e]{8,512}$/.test(value)) throw new Error("GMGN key format invalid");
  return value;
}
export function syncGmgnKey(rootFile, discoveryFile) {
  const value = gmgnKeyFromVars(readFileSync(rootFile, "utf8")), old = readFileSync(discoveryFile, "utf8");
  if (/^\s*GMGN_API_KEY\s*=/m.test(old)) {
    if (gmgnKeyFromVars(old) !== value) throw new Error("Discovery already has a different GMGN key; not overwritten");
    return { key_configured: true, changed: false };
  }
  const eol = old.includes("\r\n") ? "\r\n" : "\n";
  writeFileSync(discoveryFile, old + (old.endsWith("\n") ? "" : eol) + `GMGN_API_KEY=${value}${eol}`, { mode: 0o600 });
  return { key_configured: true, changed: true };
}
export function gmgnOperatorRequest(args, now = new Date()) {
  const [command, address, kind] = args;
  if (command === "status" && args.length === 1) return { path: "admin/gmgn/status", method: "GET" };
  if (command === "saved" && args.length === 2 && /^[a-f0-9-]{36}$/i.test(address)) return { path: `admin/gmgn/reviews/${address}`, method: "GET" };
  if (command === "window-saved" && args.length === 2 && /^[a-f0-9-]{36}$/i.test(address)) return { path: `admin/gmgn/windows/${address}`, method: "GET" };
  if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address ?? "")) throw new Error("Provide an exact Solana mint");
  let request;
  if (command === "probe" && args.length === 2) request = { kind: "gmgn_token_info", address };
  else if (command === "review" && args.length === 3 && ["info", "security", "pool", "candles", "traders"].includes(kind)) {
    request = { kind: `gmgn_token_${kind}`, address };
    if (kind === "candles") {
      const end = Math.floor(now.getTime() / 60_000) * 60_000;
      request.start_at = new Date(end - 6 * 3600_000).toISOString(); request.end_at = new Date(end).toISOString();
    }
  } else throw new Error("Use status | probe MINT | review MINT info|security|pool|candles|traders | saved UUID | window MINT | window-saved UUID | resume-window UUID | sync-key");
  return { path: "admin/gmgn/review", method: "POST", body: { reason: "Founder authorized bounded GMGN data investigation", request_id: randomUUID(), mode: command === "probe" ? "access_probe" : "retained_research", request } };
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const rootVars = fileURLToPath(new URL("../.dev.vars", import.meta.url));
    const discoveryVars = fileURLToPath(new URL("../discovery/.dev.vars", import.meta.url));
    if (process.argv.length === 3 && process.argv[2] === "sync-key") console.log(JSON.stringify(syncGmgnKey(rootVars, discoveryVars)));
    else {
      const token = readFileSync(discoveryVars, "utf8").match(/^TENX_ADMIN_TOKEN=([a-f0-9]{64})\s*$/m)?.[1];
      if (!token) throw new Error("Local Discovery operator credential missing");
      const call = async descriptor => {
        const response = await fetch(`http://127.0.0.1:8794/api/10x/${descriptor.path}`, { method: descriptor.method,
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        ...(descriptor.body ? { body: JSON.stringify(descriptor.body) } : {}), redirect: "manual", signal: AbortSignal.timeout(30_000) });
        const data = await response.json();if(!response.ok)throw new Error("Local request failed");return data;
      };
      const args=process.argv.slice(2);
      let data;
      if(args[0]==="window"&&args.length===2)data=await collectGmgnWindow(gmgnWindowPlan(args[1]),call);
      else if(args[0]==="resume-window"&&args.length===2){
        const old=await call(gmgnOperatorRequest(["window-saved",args[1]]));
        data=await collectGmgnWindow(gmgnWindowPlan(old.address,new Date(),old.window_id,{start_at:old.window_start,end_at:old.window_end}),call,{existing:old.receipt_refs});
      }else data=await call(gmgnOperatorRequest(args));
      console.log(JSON.stringify(data,null,2));
    }
  } catch { console.error("GMGN local operation failed; check command, ignored configuration and local service. No credentials printed."); process.exitCode = 1; }
}
