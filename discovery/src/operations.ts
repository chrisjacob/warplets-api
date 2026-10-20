import { z } from "zod";
import { control } from "./store";
import type { Settings } from "./ingest";
import { OperationsSchema, WatchdogReportSchema, type Operations } from "./operations-model";

export class OperationsError extends Error {}
type LoopState={lease_until:string|null;next_refresh_at:string|null;last_success:string|null;last_error:string|null};
export function heartbeatState(at:string|null,now:Date):Operations["timer"] {
  if(!at)return "missing";const age=now.getTime()-Date.parse(at);
  return !Number.isFinite(age)||age<0?"future":age>1_200_000?"stale":"recent";
}
export function loopState(row:LoopState,now:Date,options:{enabled:boolean;paused:boolean;limited:boolean;backoff?:string|null}):Operations["loops"][number]["state"] {
  if(!options.enabled)return "disabled";
  if([row.last_success].some(t=>t && Date.parse(t)>now.getTime()) || [row.next_refresh_at,row.lease_until,options.backoff].some(t=>t && !Number.isFinite(Date.parse(t))))return "clock_invalid";
  if(options.paused)return "paused";
  if(options.limited)return "budget_limited";
  if(options.backoff && Date.parse(options.backoff)>now.getTime())return "backoff";
  if(row.lease_until && Date.parse(row.lease_until)>now.getTime())return "running";
  if(row.last_error && row.next_refresh_at && Date.parse(row.next_refresh_at)>now.getTime())return "backoff";
  if(!row.next_refresh_at)return row.last_success?"scheduled":"not_started";
  return now.getTime()-Date.parse(row.next_refresh_at)>1_200_000?"overdue":"scheduled";
}
export async function operations(settings:Settings,now=new Date()) {
  const db=settings.db,root=await control(db),at=now.toISOString(),day=at.slice(0,10);
  const usage=(await db.prepare("SELECT provider,used FROM tenx_usage WHERE day=?1").bind(day).all<{provider:string;used:number}>()).results;
  const used=(p:string)=>usage.find(r=>r.provider===p)?.used??0;
  const wallet=await db.prepare("SELECT used FROM tenx_wallet_usage WHERE day=?1").bind(day).first<{used:number}>();
  const quality=await db.prepare("SELECT used FROM tenx_quality_usage WHERE day=?1").bind(day).first<{used:number}>();
  const abandoned=await db.prepare("SELECT COUNT(*) AS n FROM tenx_jobs WHERE state='running' AND started_at<?1 AND id<>COALESCE(?2,'')").bind(new Date(now.getTime()-1_200_000).toISOString(),root.lease_owner && root.lease_until && root.lease_until>at?root.lease_owner:null).first<{n:number}>();
  const loops:Operations["loops"]=[];
  const add=(name:string,row:LoopState,enabled:boolean,limited:boolean,backoff?:string|null)=>loops.push({name,state:loopState(row,now,{enabled,limited,paused:Boolean(root.paused),backoff}),next_at:row.next_refresh_at,last_success:row.last_success,last_error:row.last_error});
  add("discovery",{lease_until:root.lease_until,next_refresh_at:root.next_refresh_at,last_success:root.last_success,last_error:root.last_error},true,used("rpc")>=settings.rpcDailyLimit,root.retry_after);
  for(const [name,table,enabled,limited,backoff] of [
    ["market","tenx_market_control",settings.marketEnabled,used("market")>=settings.marketDailyLimit,null],
    ["holders","tenx_quality_control",settings.qualityEnabled??false,used("rpc")>=settings.rpcDailyLimit || (quality?.used??0)>=(settings.qualityDailyLimit??0),root.last_error?.startsWith("rpc_")?root.retry_after:null],
    ["wallets","tenx_wallet_control",settings.walletEnabled??false,used("rpc")>=settings.rpcDailyLimit || (wallet?.used??0)>=(settings.walletDailyLimit??0),root.last_error?.startsWith("rpc_")?root.retry_after:null],
  ] as const){const row=await db.prepare(`SELECT lease_until,next_refresh_at,last_success,last_error FROM ${table} WHERE id=1`).first<LoopState>();if(!row)throw new OperationsError("operations_control_missing");add(name,row,enabled,limited,backoff);}
  const timer=heartbeatState(root.heartbeat_at,now),issues:string[]=[];
  if(timer!=="recent")issues.push(`timer_${timer}`);
  if(!root.reviewed_at || now.getTime()-Date.parse(root.reviewed_at)>5_400_000 || Date.parse(root.reviewed_at)>now.getTime())issues.push("daily_review_check_overdue_or_invalid");
  for(const loop of loops)if(["overdue","clock_invalid","not_started"].includes(loop.state))issues.push(`${loop.name}_${loop.state}`);else if(loop.last_error && loop.state!=="disabled" && loop.state!=="paused")issues.push(`${loop.name}_source_issue`);
  if(abandoned?.n)issues.push("abandoned_jobs_retained");
  if(used("rpc")>settings.rpcDailyLimit || used("market")>settings.marketDailyLimit || (wallet?.used??0)>(settings.walletDailyLimit??0) || (quality?.used??0)>(settings.qualityDailyLimit??0))issues.push("usage_exceeds_configured_limit");
  const latest=await db.prepare("SELECT payload FROM tenx_watchdog WHERE id=1").first<{payload:string}>();
  const last=latest?WatchdogReportSchema.parse(JSON.parse(latest.payload)):null;
  const events=await db.prepare("SELECT payload FROM tenx_watchdog_events ORDER BY checked_at DESC,id DESC LIMIT 10").all<{payload:string}>();
  return OperationsSchema.parse({at,scope:"local_discovery_operations",provider_requests:0,state:timer!=="recent" || issues.length?"degraded":root.paused?"paused":"healthy",heartbeat_at:root.heartbeat_at,timer,heartbeat_limit_seconds:1200,issues,loops,abandoned_jobs:abandoned?.n??0,watchdog:{last,fresh:Boolean(last && Date.parse(last.checked_at)<=now.getTime() && now.getTime()-Date.parse(last.checked_at)<=120000),events:events.results.map(r=>WatchdogReportSchema.parse(JSON.parse(r.payload))),external_channels_configured:false}});
}
export async function recordWatchdog(db:D1Database,raw:z.infer<typeof WatchdogReportSchema>,now=new Date()) {
  const parsed=WatchdogReportSchema.parse(raw),time=Date.parse(parsed.checked_at),report={...parsed,checked_at:new Date(time).toISOString()};
  if(time>now.getTime() || now.getTime()-time>120000)throw new OperationsError("watchdog_report_outside_admission_window");
  const payload=JSON.stringify(report),id=crypto.randomUUID();
  await db.batch([
    db.prepare("INSERT INTO tenx_watchdog_events(id,checked_at,payload) SELECT ?1,?2,?3 WHERE NOT EXISTS(SELECT 1 FROM tenx_watchdog WHERE id=1 AND (checked_at>=?2 OR json_extract(payload,'$.code')=?4))").bind(id,report.checked_at,payload,report.code),
    db.prepare("INSERT INTO tenx_watchdog(id,checked_at,payload) VALUES(1,?1,?2) ON CONFLICT(id) DO UPDATE SET checked_at=excluded.checked_at,payload=excluded.payload WHERE excluded.checked_at>checked_at").bind(report.checked_at,payload),
  ]);
  return {accepted:true,provider_requests:0};
}
