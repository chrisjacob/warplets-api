import type {AtomicDriver} from '../storage/atomic-earn.mjs';
import type {CanonicalCrypto,OperatorPrincipal,JsonValue,JobLease,Revisions} from '../application/ports';
export type JobState='queued'|'running'|'held'|'retry'|'completed'|'failed';
export type JobType='capture-eligibility'|'complete-cutoff'|'finalize-board'|'allocate-token-day'|'publish-archive'|'reconcile-publication'|'retention-maintenance'|'deliver-local-notice';
export type JobInput={businessKey:string;sourceKey:string;type:JobType;payload:JsonValue;readyMs:number;maxAttempts:number};
export type JobCommand={operationKind:'jobs.enqueue.v1';principal:OperatorPrincipal;requestKey:string;requestDigest:string;businessIdentity:string;input:JobInput;nowMs:number;expectedRevisions:Revisions};
export type Job={id:string;businessKey:string;type:JobType;payload:JsonValue;payloadDigest:string;state:JobState;readyMs:number|null;attempt:number;maxAttempts:number;
 checkpoint:JsonValue;checkpointSeq:number;result:JsonValue;resultDigest:string|null;reason:string|null;dependency:string|null;lease:JobLease|null};
export type JobOutcome={state:'completed';result:JsonValue}|{state:'held'|'retry';reason:string;dependency:string|null;readyMs:number|null;result?:JsonValue}|{state:'failed';certainty:'no-effect';reason:string;result?:JsonValue};
export type JobResult={kind:'committed'|'replayed'|'acquired'|'checkpointed'|'finished'|'woken'|'unchanged';job:Job}|{kind:'conflict';code:string}|{kind:'pending';reason:string}|{kind:'idle'};
export interface JobRepository {
 readonly principal:OperatorPrincipal;
 readJob(id:string):Promise<Job|null>;
 enqueue(command:JobCommand):Promise<JobResult>;
 acquireJob(options?:{leaseMs?:number}):Promise<JobResult>;
 checkpoint(lease:JobLease,input:{sequence:number;value:JsonValue}):Promise<JobResult>;
 finish(lease:JobLease,outcome:JobOutcome):Promise<JobResult>;
 wake(input:{jobId:string;dependency:string;evidenceDigest:string}):Promise<JobResult>;
}
export function createJobRepository(driver:AtomicDriver,ports:{crypto:CanonicalCrypto;ids:{next():string};clock:{nowMs():number};principal:OperatorPrincipal}):JobRepository;
