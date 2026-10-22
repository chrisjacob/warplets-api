// Non-executable, encrypted scope for one original cache-only scheduler job.
import {z} from "zod";
import {isDeepStrictEqual} from "node:util";
import {cachedCheckpointSql,cachedFinishSql} from "./evidence-wallet-cached-sql.mjs";
import {walletLeaseSql,walletSpacingSql,walletReleaseSql,walletFailureSql,walletFailureRunSql,walletAttemptSql} from "./evidence-wallet-cycle-sql.mjs";
const Id=z.string().uuid(),Hash=z.string().regex(/^[a-f0-9]{64}$/),Time=z.string().datetime(),Text=z.string().min(1).max(4096),Limit=z.number().int().safe().positive();
const Cycle=z.object({lease_id:Id,job:Id,address:Text,at:Time,until:Time,rapid:z.union([z.literal(0),z.literal(1)])}).strict();
const Ids=z.object({lease:Id,spacing:Id,release:Id,finish:Id,failure_run:Id,failure_release:Id,failure_attempt:Id}).strict();
const Checkpoint=z.object({wallet:Text,anchorSignature:Text,publicationId:Id}).strict();
const Plan=z.object({kind:z.literal("wallet_cached_job"),publication_id:Id,cycle:Cycle,stage:z.enum(["cached_funding","cache_invalid","source_limited","empty"]),candidate_hash:Hash.nullable(),source_hash:Hash.nullable(),limits:z.object({wallet:Limit,rpc:Limit,market:Limit}).strict(),ids:Ids,checkpoints:Checkpoint.array().max(20),operations:z.tuple([]).default([])}).strict();
export function validateEvidenceWalletJobPlan(input){
  const p=Plan.parse(input),c=p.cycle,ids=[p.publication_id,c.job,...Object.values(p.ids),...p.checkpoints.map(r=>r.publicationId)];
  if(p.ids.lease!==c.lease_id||Date.parse(c.until)!==Date.parse(c.at)+360000||new Set(ids).size!==ids.length||new Set(p.checkpoints.map(r=>JSON.stringify([r.wallet,r.anchorSignature]))).size!==p.checkpoints.length)throw Error("wallet_job_identity");
  if(p.stage==="empty"?(p.candidate_hash!==null||p.source_hash!==null):p.candidate_hash===null||p.stage==="cached_funding"&&p.source_hash===null)throw Error("wallet_job_source_scope");
  if(Buffer.byteLength(JSON.stringify(p))>256000)throw Error("wallet_job_byte_bound");return p;
}
export function walletJobSlots(plan){return [...Object.entries(plan.ids).map(([role,id])=>({role,id})),...plan.checkpoints.map((r,index)=>({role:"checkpoint",id:r.publicationId,index}))];}
export function validateWalletJobStep(job,slot,plan){
  if(plan.publication_id!==slot.id||!Array.isArray(plan.operations))throw Error("wallet_job_step_identity");
  if(slot.role==="checkpoint"){
    const op=plan.operations[0],b=op.bindings,c=job.checkpoints[slot.index];
    if(plan.kind!=="wallet_cached_progress"||plan.operations.length!==1||op.sql!==cachedCheckpointSql||b[3]!==job.cycle.address||b[4]!==c.wallet||b[5]!==c.anchorSignature||b[7]!==job.source_hash||b[8]!==job.cycle.job)throw Error("wallet_job_checkpoint_scope");
  }else if(slot.role==="finish"){
    const op=plan.operations[0],b=op.bindings;
    if(plan.kind!=="wallet_cached_progress"||plan.operations.length!==4||plan.operations.some((r,i)=>r.sql!==cachedFinishSql[i])||b[0]!==job.cycle.job||b[2]!==job.cycle.address||b[3]!==job.source_hash)throw Error("wallet_job_finish_scope");
  }else{
    const expected={lease:walletLeaseSql,spacing:walletSpacingSql,release:walletReleaseSql,failure_run:walletFailureRunSql,failure_release:walletFailureSql,failure_attempt:walletAttemptSql}[slot.role];
    if(!expected||plan.kind!=="wallet_cycle_control"||!isDeepStrictEqual(plan.cycle,job.cycle)||plan.operations.length!==1||plan.operations[0].sql!==expected||slot.role==="failure_run"&&plan.operations[0].bindings[2]!==job.source_hash)throw Error("wallet_job_control_scope");
  }
}
