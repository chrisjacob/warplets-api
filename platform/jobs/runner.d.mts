import type {JsonValue,JobLease} from '../application/ports';
import type {Job,JobType,JobRepository,JobResult,JobOutcome} from './repository.mjs';
export type HandlerContext={job:Job;lease:JobLease;payload:JsonValue;signal:AbortSignal;deadlineMs:number;checkpoint(value:JsonValue,sequence?:number):Promise<JobResult>};
export type Handler=(context:HandlerContext)=>Promise<JobOutcome>;
export type Registry=Readonly<Record<JobType,Handler>>;
export function retryDelay(attempt:number,jitter?:()=>number):number;
export function runTick(options:{repository:JobRepository;clock:{nowMs():number};handlers?:Registry;outbox?:(options:{limit:number})=>Promise<unknown>;limit?:number;deadlineMs?:number;leaseMs?:number;jitter?:()=>number}):Promise<{mode:'local-validation';processed:number;items:JobResult[];deadlineReached:boolean;financialExecution:false}>;
