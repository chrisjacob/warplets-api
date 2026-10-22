// Planning arithmetic only. A model never grants source, runtime or Free admission.
import {z} from "zod";
export const FREE_SERVING_LIMITS={checked_on:"2026-10-22",worker_requests_daily:100000,worker_cpu_ms:10,worker_memory_bytes:128*1024**2,d1_queries_per_invocation:50,d1_rows_read_daily:5000000,d1_rows_written_daily:100000,d1_database_bytes:500000000,d1_account_bytes:5000000000,d1_row_bytes:2000000} as const;
const Count=z.number().int().safe().nonnegative(),Positive=Count.positive();
const Input=z.object({viewers:Positive,poll_seconds:Positive,active_seconds_daily:Positive.max(86400),requests_per_poll:Positive,measured_queries:Count,measured_rows_read:Count,measured_rows_written:Count,shared_worker_requests:Count.nullable(),shared_d1_reads:Count.nullable(),shared_d1_writes:Count.nullable(),worker_cpu_ms:z.number().finite().nonnegative().nullable(),database_bytes:Count.nullable(),account_storage_bytes:Count.nullable(),largest_row_bytes:Count.nullable()}).strict();
const state=(value:number|null,limit:number)=>value===null?"unknown":value>limit?"over_limit":"within_model";
export function assessFreeServing(input:z.input<typeof Input>){
  const p=Input.parse(input),pollsPerViewer=Math.ceil(p.active_seconds_daily/p.poll_seconds),requests=p.viewers*pollsPerViewer*p.requests_per_poll;
  const reads=requests*p.measured_rows_read,writes=requests*p.measured_rows_written;
  if([requests,reads,writes].some(n=>!Number.isSafeInteger(n)))throw Error("serving_arithmetic_overflow");
  const total=(usage:number,other:number|null)=>{if(other===null)return null;const n=usage+other;if(!Number.isSafeInteger(n))throw Error("serving_arithmetic_overflow");return n;};
  const dimensions={worker_requests:{model:requests,total:total(requests,p.shared_worker_requests),limit:FREE_SERVING_LIMITS.worker_requests_daily},d1_reads:{model:reads,total:total(reads,p.shared_d1_reads),limit:FREE_SERVING_LIMITS.d1_rows_read_daily},d1_writes:{model:writes,total:total(writes,p.shared_d1_writes),limit:FREE_SERVING_LIMITS.d1_rows_written_daily}};
  return {assumptions:p,polls_per_viewer:pollsPerViewer,dimensions:Object.fromEntries(Object.entries(dimensions).map(([name,v])=>[name,{...v,status:v.model>v.limit?"over_limit":state(v.total,v.limit)}])),per_invocation_queries:state(p.measured_queries,FREE_SERVING_LIMITS.d1_queries_per_invocation),cpu:state(p.worker_cpu_ms,FREE_SERVING_LIMITS.worker_cpu_ms),database_storage:state(p.database_bytes,FREE_SERVING_LIMITS.d1_database_bytes),account_storage:state(p.account_storage_bytes,FREE_SERVING_LIMITS.d1_account_bytes),row_size:state(p.largest_row_bytes,FREE_SERVING_LIMITS.d1_row_bytes),decision:"held" as const,free_acceptance:false as const,action_authority:false as const,provider_requests:0 as const};
}
