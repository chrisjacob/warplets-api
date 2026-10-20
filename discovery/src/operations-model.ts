import { z } from "zod";
export const WatchdogCode=z.enum(["healthy","degraded","timer_missing","timer_stale","timer_future","api_unreachable","invalid_status"]);
export const WatchdogReportSchema=z.object({version:z.literal("local-watchdog-v1"),checked_at:z.string().datetime(),code:WatchdogCode,restart_recommended:z.boolean()}).strict().superRefine((r,ctx)=>{
  if(r.restart_recommended !== ["timer_missing","timer_stale","timer_future","api_unreachable","invalid_status"].includes(r.code))ctx.addIssue({code:"custom",message:"watchdog_restart_mismatch"});
});
export const OperationsSchema=z.object({
  at:z.string().datetime(),scope:z.literal("local_discovery_operations"),provider_requests:z.literal(0),
  state:z.enum(["healthy","degraded","paused"]),heartbeat_at:z.string().datetime().nullable(),
  timer:z.enum(["recent","missing","stale","future"]),heartbeat_limit_seconds:z.literal(1200),
  issues:z.array(z.string()).max(30),
  loops:z.array(z.object({name:z.string(),state:z.enum(["scheduled","running","overdue","backoff","budget_limited","paused","disabled","not_started","clock_invalid"]),next_at:z.string().datetime().nullable(),last_success:z.string().datetime().nullable(),last_error:z.string().nullable()})).max(5),
  abandoned_jobs:z.number().int().nonnegative(),
  watchdog:z.object({last:WatchdogReportSchema.nullable(),fresh:z.boolean(),events:z.array(WatchdogReportSchema).max(10),external_channels_configured:z.literal(false)}),
}).strict();
export type Operations=z.infer<typeof OperationsSchema>;
