// Offline planning only; no result authorizes a service, schedule or evidence use.
import {z} from "zod";
import {FREE_SERVING_LIMITS as limits} from "./discovery-serving-capacity";
const Count=z.number().int().safe().nonnegative(),Maybe=Count.nullable();
export const D1TraceSchema=z.object({sql:z.string(),rows_read:Maybe,rows_written:Maybe,changes:Maybe,returned_rows:Count}).strict();
export type D1Trace=z.infer<typeof D1TraceSchema>;
const add=(a:number,b:number)=>{const n=a+b;if(!Number.isSafeInteger(n))throw Error("serving_arithmetic_overflow");return n;};
const multiply=(a:number,b:number)=>{const n=a*b;if(!Number.isSafeInteger(n))throw Error("serving_arithmetic_overflow");return n;};
export function summarizeD1Trace(raw:unknown){
  const rows=D1TraceSchema.array().parse(raw);
  const sum=(key:"rows_read"|"rows_written"|"changes")=>({known_minimum:rows.reduce((n,row)=>add(n,row[key]??0),0),total:rows.some(row=>row[key]===null)?null:rows.reduce((n,row)=>add(n,row[key]!),0)});
  return {queries:rows.length,reads:sum("rows_read"),writes:sum("rows_written"),logical_changes:sum("changes")};
}
const Component=z.object({name:z.string().min(1).max(100),invocations_daily:Maybe,rows_read:Maybe,rows_written:Maybe,queries:Maybe,cpu_ms:z.number().finite().nonnegative().nullable()}).strict();
const Plan=z.object({components:Component.array().min(1).max(30),background:z.object({worker_requests:Maybe,d1_reads:Maybe,d1_writes:Maybe}).strict(),refresh_seconds:Count.positive(),validity_seconds:Count.positive(),database_bytes:Maybe,account_bytes:Maybe,largest_row_bytes:Maybe}).strict();
const state=(value:number|null,ceiling:number)=>value===null?"unknown":value>ceiling?"over_limit":"within_model";
export function assessFreeServingWorkload(raw:z.input<typeof Plan>){
  const p=Plan.parse(raw);if(new Set(p.components.map(c=>c.name)).size!==p.components.length)throw Error("duplicate_workload_component");
  const dimension=(field:"rows_read"|"rows_written"|null,other:number|null,ceiling:number)=>{
    let known=0,unknown=other===null;
    for(const c of p.components){const count=c.invocations_daily,cost=field?c[field]:1;
      if(count===0||cost===0)continue;
      if(count===null||cost===null)unknown=true;else known=add(known,multiply(count,cost));}
    const minimum=add(known,other??0),total=unknown?null:minimum;
    return {known_minimum:minimum,total,ceiling,status:minimum>ceiling?"over_limit":state(total,ceiling)};
  };
  return {assumptions:p,requests:dimension(null,p.background.worker_requests,limits.worker_requests_daily),reads:dimension("rows_read",p.background.d1_reads,limits.d1_rows_read_daily),writes:dimension("rows_written",p.background.d1_writes,limits.d1_rows_written_daily),
    per_invocation:p.components.map(c=>({name:c.name,queries:state(c.queries,limits.d1_queries_per_invocation),cpu:state(c.cpu_ms,limits.worker_cpu_ms)})),
    freshness_schedule:p.refresh_seconds>p.validity_seconds?"gap_in_model":"no_gap_assuming_instant_success",database_storage:state(p.database_bytes,limits.d1_database_bytes),account_storage:state(p.account_bytes,limits.d1_account_bytes),row_size:state(p.largest_row_bytes,limits.d1_row_bytes),
    decision:"held" as const,free_acceptance:false as const,action_authority:false as const,provider_requests:0 as const};
}
