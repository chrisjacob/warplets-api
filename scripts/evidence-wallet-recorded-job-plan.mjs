// Private non-executable scope, write associations and recorded response handoffs.
import {z} from "zod";
import {createHash} from "node:crypto";
import {isDeepStrictEqual} from "node:util";
import {walletLeaseSql,walletSpacingSql,walletReleaseSql,walletFailureSql,walletAttemptSql,walletFailureRunSql} from "./evidence-wallet-cycle-sql.mjs";
import {directCatchupSql,directBackoffSql,directWorkSql,directFinishSql,directUnsupportedSql} from "./evidence-wallet-direct-sql.mjs";
import {collectionTransactionSql,collectionCheckpointSql} from "./evidence-wallet-collection-sql.mjs";
import {walletQuotaSql,rpcQuotaSql} from "./evidence-wallet-quota-sql.mjs";
const Id=z.string().uuid(),Hash=z.string().regex(/^[a-f0-9]{64}$/),Limit=z.number().int().safe().positive(),Text=z.string().min(1).max(4096),Time=z.string().datetime();
const Cycle=z.object({lease_id:Id,job:Id,address:Text,at:Time,until:Time,rapid:z.union([z.literal(0),z.literal(1)])}).strict();
const Ids=z.object({lease:Id,spacing:Id,release:Id,catchup:Id,backoff:Id,work:Id,finish:Id,failure_run:Id,failure_release:Id,failure_attempt:Id}).strict();
export const recordedJobHash=value=>createHash("sha256").update(JSON.stringify(value)).digest("hex");
const derived=(id,role,index)=>{const b=createHash("sha256").update(JSON.stringify(["wallet-recorded-job-v1",Id.parse(id),role,index])).digest().subarray(0,16);b[6]=(b[6]&15)|80;b[8]=(b[8]&63)|128;const s=b.toString("hex");return `${s.slice(0,8)}-${s.slice(8,12)}-${s.slice(12,16)}-${s.slice(16,20)}-${s.slice(20)}`;};
const Reply=z.object({method:z.enum(["getGenesisHash","getSignaturesForAddress","getTransaction"]),params:z.unknown().array().max(4),body:z.string().max(3000000),status:z.number().int().min(200).max(599),retryAfter:z.string().max(100).optional()}).strict();
export const recordedJobReply=reply=>Reply.parse({method:reply.method,params:reply.params,body:reply.body,status:reply.status,...(reply.retryAfter!==undefined?{retryAfter:reply.retryAfter}:{})});
export function recordedJobLinks(id,writeIds,replies){return {writes:writeIds.map((publication_id,index)=>({publication_id,binding_id:derived(id,"write",index)})),responses:replies.map((r,index)=>({wallet:r.walletPublicationId,rpc:r.rpcPublicationId,handoff:derived(id,"handoff",index),reply_sha256:recordedJobHash(recordedJobReply(r))}))};}
const Plan=z.object({kind:z.literal("wallet_recorded_job"),publication_id:Id,cycle:Cycle,stage:z.literal("direct_funding"),candidate_hash:Hash,source_hash:Hash,limits:z.object({wallet:Limit,rpc:Limit,market:Limit}).strict(),ids:Ids,writes:z.object({publication_id:Id,binding_id:Id}).strict().array().max(128),responses:z.object({wallet:Id,rpc:Id,handoff:Id,reply_sha256:Hash}).strict().array().max(18),operations:z.tuple([]).default([])}).strict();
export function recordedJobIds(p){return [p.publication_id,...Object.values(p.ids),...p.writes.flatMap(r=>[r.publication_id,r.binding_id]),...p.responses.flatMap(r=>[r.wallet,r.rpc,r.handoff])];}
export function validateEvidenceWalletRecordedJobPlan(input){const p=Plan.parse(input),ids=[p.cycle.job,...recordedJobIds(p)];if(p.ids.lease!==p.cycle.lease_id||Date.parse(p.cycle.until)!==Date.parse(p.cycle.at)+360000||new Set(ids).size!==ids.length||Buffer.byteLength(JSON.stringify(p))>256000||p.writes.some((r,i)=>r.binding_id!==derived(p.publication_id,"write",i))||p.responses.some((r,i)=>r.handoff!==derived(p.publication_id,"handoff",i)))throw Error("wallet_recorded_job_scope");return p;}
const Association=z.object({kind:z.literal("wallet_recorded_write"),publication_id:Id,job_id:Id,job_plan_sha256:Hash,index:z.number().int().min(0).max(127),plan:z.unknown(),operations:z.tuple([]).default([])}).strict();
export function validateEvidenceWalletRecordedWrite(input,normalize){const p=Association.parse(input);if(!["wallet_collection","wallet_direct_cycle"].includes(p.plan?.kind))throw Error("wallet_recorded_write_domain");p.plan=normalize(p.plan);if(Buffer.byteLength(JSON.stringify(p))>15*1024**2)throw Error("wallet_recorded_write_bound");return p;}
const Handoff=z.object({kind:z.literal("wallet_recorded_handoff"),publication_id:Id,job_id:Id,job_plan_sha256:Hash,index:z.number().int().min(0).max(17),reply:Reply,operations:z.tuple([]).default([])}).strict();
export function validateEvidenceWalletRecordedHandoff(input){const p=Handoff.parse(input);if(Buffer.byteLength(p.reply.body)>3000000||Buffer.byteLength(JSON.stringify(p))>15*1024**2)throw Error("wallet_recorded_handoff_bound");return p;}
export const isNonExecutableWalletPlan=plan=>["wallet_cached_job","wallet_recorded_job","wallet_recorded_write","wallet_recorded_handoff"].includes(plan.kind);
export function recordedJobSlots(p){return [...Object.entries(p.ids).map(([role,id])=>({role,id})),...p.writes.map((r,index)=>({role:"write",id:r.publication_id,index,bindingId:r.binding_id})),...p.responses.flatMap((r,index)=>[{role:"wallet_quota",id:r.wallet,index},{role:"rpc_quota",id:r.rpc,index},{role:"response",id:r.handoff,index}])];}
export function validateRecordedJobStep(job,slot,plan,binding){
  if(plan.publication_id!==slot.id)throw Error("wallet_recorded_step_identity");
  if(slot.role==="response"){const r=job.responses[slot.index];if(plan.kind!=="wallet_recorded_handoff"||plan.job_id!==job.publication_id||plan.job_plan_sha256!==recordedJobHash(job)||plan.index!==slot.index||recordedJobHash(plan.reply)!==r.reply_sha256)throw Error("wallet_recorded_response_scope");return;}
  if(slot.role==="write"){
    if(!binding||binding.kind!=="wallet_recorded_write"||binding.publication_id!==slot.bindingId||binding.job_id!==job.publication_id||binding.job_plan_sha256!==recordedJobHash(job)||binding.index!==slot.index||!isDeepStrictEqual(binding.plan,plan))throw Error("wallet_recorded_write_scope");
    const op=plan.operations[0];if(plan.kind==="wallet_direct_cycle"?op.sql!==directUnsupportedSql||!isDeepStrictEqual(plan.cycle,job.cycle)||plan.source_hash!==job.source_hash||!isDeepStrictEqual(plan.limits,{wallet:job.limits.wallet,rpc:job.limits.rpc}):plan.kind!=="wallet_collection"||op.sql!==collectionTransactionSql&&op.bindings[Object.values(collectionCheckpointSql).includes(op.sql)?0:3]!==job.cycle.address)throw Error("wallet_recorded_write_context");return;
  }
  if(slot.role.endsWith("_quota")){const r=job.responses[slot.index],reservation={wallet:r.wallet,rpc:r.rpc,day:job.cycle.at.slice(0,10),wallet_limit:job.limits.wallet,rpc_limit:job.limits.rpc};if(plan.kind!=="wallet_quota"||!isDeepStrictEqual(plan.reservation,reservation)||plan.operations[0].sql!==(slot.role==="wallet_quota"?walletQuotaSql:rpcQuotaSql))throw Error("wallet_recorded_quota_scope");return;}
  if(!isDeepStrictEqual(plan.cycle,job.cycle))throw Error("wallet_recorded_cycle_scope");
  const control={lease:walletLeaseSql,spacing:walletSpacingSql,release:walletReleaseSql,failure_release:walletFailureSql,failure_attempt:walletAttemptSql}[slot.role];
  if(control){if(plan.kind!=="wallet_cycle_control"||plan.operations.length!==1||plan.operations[0].sql!==control)throw Error("wallet_recorded_control_scope");return;}
  const sql={catchup:directCatchupSql,backoff:directBackoffSql,work:directWorkSql,finish:walletFailureRunSql,failure_run:walletFailureRunSql}[slot.role];
  if(plan.kind!=="wallet_direct_cycle"||plan.source_hash!==job.source_hash||!isDeepStrictEqual(plan.limits,{wallet:job.limits.wallet,rpc:job.limits.rpc})||!sql||plan.operations[0].sql!==sql||plan.operations.length!==(slot.role==="finish"?3:1)||slot.role==="finish"&&plan.operations[2].sql!==directFinishSql)throw Error("wallet_recorded_direct_scope");
}
