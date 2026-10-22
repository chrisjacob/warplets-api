// Offline only. Never a D1 proxy, Worker import or application backend.
import {z} from "zod";
import {prepareEvidenceProducerBatch,type ProducerBatchInput} from "./evidence-producer-plan";
import {persistEvidencePublicationIntent,publishStoredEvidenceIntent,reconcileStoredEvidenceIntent} from "../discovery-evidence-intents.mjs";
import {validateEvidenceCandidateMetadataPlan,validateEvidenceWalletCachedPlan,validateEvidenceWalletQuotaPlan,validateEvidenceWalletCyclePlan,validateEvidenceWalletCollectionPlan,validateEvidenceWalletDirectPlan,validateEvidenceWalletRecoveryPlan} from "../discovery-evidence-publication.mjs";
import type {FundingRecovery} from "../../discovery/src/funding-recovery";
import {validWalletTransaction} from "../../discovery/src/wallet-trades";
import {keys} from "../../discovery/src/wallet-rpc";
import {recoveryCacheSql} from "../evidence-wallet-recovery-sql.mjs";
import {WalletWorkSchema} from "../../discovery/src/wallet-work-model";
import {directWorkSql} from "../evidence-wallet-direct-sql.mjs";
import {FundingScanSchema,fundingTask} from "../../discovery/src/funding-history";
import {WalletTransactionSchema} from "../../discovery/src/wallet-rpc";
import {collectionTransactionSql,collectionRepairSql} from "../evidence-wallet-collection-sql.mjs";
import {hashJson} from "../../discovery/src/solana";
import {ProducerStatements} from "./evidence-producer-plan";
import {validateEvidenceWalletSnapshotPlan} from "../discovery-evidence-publication.mjs";
import {WalletEvidenceSchema,analyzeWalletEvidence} from "../../discovery/src/wallet-analysis";
import {isDeepStrictEqual} from "node:util";
import {retainLinkedCohortReadiness,recoverLinkedCohortBatch} from "./evidence-linked-cohort";

const Hash=z.string().regex(/^[a-f0-9]{64}$/),Id=z.string().uuid(),Path=z.string().min(1).max(4096);
const Publication=z.object({directory:Path,targetPin:Hash,stage:z.object({directory:Path,contextPin:Hash,keyFile:Path}).strict()}).strict();
const Journal=z.object({directory:Path,contextPin:Hash}).strict();
const Grant=z.object({generation:Id,owner:Id,epoch:z.number().int().safe().positive()}).strict();
export type ProducerPublication=z.infer<typeof Publication>;
export type ProducerJournal=z.infer<typeof Journal>;
export type ProducerGrant=z.infer<typeof Grant>;
type Inactive={runtime_activated:false;action_authority:false;evidence_qualified:false;provider_requests:0;free_acceptance:false};
// Native validation scopes returned quota/lease/reader-claim rows by domain.
// Receipt/candidate/cached-progress and other control results stay empty.
type PositionResult={success:true;results:({used:number}|{id:1}|{signature:string})[];meta:{changes:number}};
export type ProducerCommitted=Inactive&{state:"committed";publication_id:string;results:PositionResult[];reconciled:boolean;post_commit:"not_requested"|"completed"|"failed";post_commit_error?:string};
type Phase="preflight"|"stage"|"persist"|"publish"|"reconcile";
export type ProducerHeld=Inactive&{state:"held";publication_id:string|null;stage_id:string|null;phase:Phase;sql_attempt:"not_started"|"unconfirmed"|"read_only";code:"producer_preflight_held"|"producer_stage_held"|"producer_intent_held"|"producer_publication_unconfirmed"|"producer_reconciliation_held"};
export type ProducerPublicationOutcome=ProducerCommitted|ProducerHeld;
type AfterCommit=(outcome:ProducerCommitted)=>Promise<void>|void;
const inactive=():Inactive=>({runtime_activated:false,action_authority:false,evidence_qualified:false,provider_requests:0,free_acceptance:false});
function held(phase:Phase,id:unknown,stage:unknown):ProducerHeld{
  const codes={preflight:"producer_preflight_held",stage:"producer_stage_held",persist:"producer_intent_held",publish:"producer_publication_unconfirmed",reconcile:"producer_reconciliation_held"} as const;
  return {state:"held",publication_id:Id.safeParse(id).success?id as string:null,stage_id:Id.safeParse(stage).success?stage as string:null,phase,sql_attempt:phase==="publish"?"unconfirmed":phase==="reconcile"?"read_only":"not_started",code:codes[phase],...inactive()};
}
function context(publication:ProducerPublication,journal:ProducerJournal,grant:ProducerGrant,callback?:AfterCommit){
  if(callback!==undefined&&typeof callback!=="function")throw Error("producer_callback_invalid");
  return {publication:Publication.parse(publication),journal:Journal.parse(journal),grant:Grant.parse(grant)};
}

// The caller supplies and retains BOTH IDs before invoking this API. Publication
// always reads the persisted, authenticated plan; it never executes the in-memory
// statements directly. A held result carries no successful D1 result vector.
export async function publishEvidenceProducerBatch(publication:ProducerPublication,journal:ProducerJournal,grant:ProducerGrant,input:ProducerBatchInput,afterCommit?:AfterCommit):Promise<ProducerPublicationOutcome>{
  let phase:Phase="preflight",id:unknown,stageId:unknown;
  try{
    id=input?.publicationId;stageId=input?.stageId;
    const saved=context(publication,journal,grant,afterCommit),identity={publicationId:Id.parse(id),stageId:Id.parse(stageId),statements:input.statements};
    phase="stage";
    // prepare normalizes the complete original ordered batch before its first
    // await, including the original receipt position and all coordinator bounds.
    const plan=await prepareEvidenceProducerBatch(saved.publication.stage,identity);
    phase="persist";await persistEvidencePublicationIntent(saved.publication,saved.journal,saved.grant,plan);
    phase="publish";return await publishStoredEvidenceIntent(saved.publication,saved.journal,saved.grant,identity.publicationId,afterCommit) as ProducerCommitted;
  }catch{return held(phase,id,stageId);}
}

export type WalletSnapshotBatchInput={publicationId:string;stageId?:string;cohortId?:string;cycle:WalletCycleContext;sourceHash:string|null;candidateHash:string;limits:{wallet:number;rpc:number};statements:unknown};
export async function publishEvidenceWalletSnapshotBatch(publication:ProducerPublication,journal:ProducerJournal,grant:ProducerGrant,input:WalletSnapshotBatchInput,afterCommit?:AfterCommit):Promise<ProducerPublicationOutcome>{
  let phase:Phase="preflight",id:unknown,stageId:unknown;
  try{
    const saved=structuredClone({publication,journal,grant,input});id=saved.input.publicationId;stageId=saved.input.stageId;const ctx=context(saved.publication,saved.journal,saved.grant,afterCommit),i=saved.input,rows=ProducerStatements.parse(i.statements);
    if(i.cohortId!==undefined&&(stageId===undefined||[i.publicationId,i.stageId,i.cycle.lease_id,i.cycle.job].includes(Id.parse(i.cohortId))))throw Error("wallet_snapshot_cohort_identity");
    const base={kind:"wallet_snapshot_cycle",publication_id:Id.parse(id),cycle:i.cycle,source_hash:i.sourceHash,candidate_hash:i.candidateHash,limits:i.limits,...(i.cohortId!==undefined?{cohort_id:Id.parse(i.cohortId)}:{})};let plan;
    if(stageId!==undefined){
      const placeholder={...base,ticket:{context_pin:ctx.publication.stage.contextPin,stage_id:Id.parse(stageId),ticket_sha256:"0".repeat(64)},operations:rows.map((r,index)=>index===1?{kind:"receipt"}:{kind:"sql",...r})};validateEvidenceWalletSnapshotPlan(placeholder);
      const body=rows[1]!.bindings[2];if(typeof body!=="string")throw Error("wallet_snapshot_body_required");const evidence=WalletEvidenceSchema.parse(JSON.parse(body)),analysis=await analyzeWalletEvidence(evidence);
      if(JSON.stringify(evidence)!==body||!isDeepStrictEqual(analysis,JSON.parse(String(rows[2]!.bindings[0]))))throw Error("wallet_snapshot_analysis_mismatch");
      phase="stage";const prepared=await prepareEvidenceProducerBatch(ctx.publication.stage,{publicationId:i.publicationId,stageId:Id.parse(stageId),statements:rows});
      plan=validateEvidenceWalletSnapshotPlan({...base,ticket:prepared.ticket,operations:prepared.operations});
    }else plan=validateEvidenceWalletSnapshotPlan({...base,operations:rows.map(r=>({kind:"sql",...r}))});
    phase="persist";if(i.cohortId!==undefined)await retainLinkedCohortReadiness(ctx.publication,ctx.journal,ctx.grant,plan);
    await persistEvidencePublicationIntent(ctx.publication,ctx.journal,ctx.grant,plan);
    phase="publish";return await publishStoredEvidenceIntent(ctx.publication,ctx.journal,ctx.grant,i.publicationId,afterCommit) as ProducerCommitted;
  }catch{return held(phase,id,stageId);}
}

export function recoverLinkedWalletSnapshotBatch(publication:ProducerPublication,journal:ProducerJournal,grant:ProducerGrant,input:{cohortId:string;mode:"publish"|"reconcile"}){
  return recoverLinkedCohortBatch(publication,journal,grant,input,"snapshot");
}

// Explicit recovery: no original statements, replacement identities, automatic
// fallback to publication or inferred absence. Reconciliation is read-only;
// publishing an uncommitted intent still requires its exact original grant.
export async function recoverEvidenceProducerBatch(publication:ProducerPublication,journal:ProducerJournal,grant:ProducerGrant,input:{publicationId:string;mode:"publish"|"reconcile"},afterCommit?:AfterCommit):Promise<ProducerPublicationOutcome>{
  let phase:Phase="preflight",id:unknown;
  try{
    id=input?.publicationId;const saved=context(publication,journal,grant,afterCommit),request=z.object({publicationId:Id,mode:z.enum(["publish","reconcile"])}).strict().parse(input);
    phase=request.mode;
    const execute=request.mode==="publish"?publishStoredEvidenceIntent:reconcileStoredEvidenceIntent;
    return await execute(saved.publication,saved.journal,saved.grant,request.publicationId,afterCommit) as ProducerCommitted;
  }catch{return held(phase,id,null);}
}

// Receipt-free candidate metadata uses a distinct plan kind, with no invented
// receipt/ticket/stage ID. Existing target/stage/key context admission remains.
export async function publishEvidenceCandidateMetadataBatch(publication:ProducerPublication,journal:ProducerJournal,grant:ProducerGrant,input:{publicationId:string;statements:unknown},afterCommit?:AfterCommit):Promise<ProducerPublicationOutcome>{
  let phase:Phase="preflight",id:unknown;
  try{
    id=input?.publicationId;const saved=context(publication,journal,grant,afterCommit),plan=validateEvidenceCandidateMetadataPlan({publication_id:Id.parse(id),kind:"candidate_metadata",operations:ProducerStatements.parse(input.statements).map(row=>({kind:"sql",...row}))});
    phase="persist";await persistEvidencePublicationIntent(saved.publication,saved.journal,saved.grant,plan);
    phase="publish";return await publishStoredEvidenceIntent(saved.publication,saved.journal,saved.grant,plan.publication_id,afterCommit) as ProducerCommitted;
  }catch{return held(phase,id,null);}
}

// One original checkpoint CAS or its original four-statement completion batch.
// No receipt/stage ID, lease acquisition, quota write or generic SQL admission.
export async function publishEvidenceWalletCachedBatch(publication:ProducerPublication,journal:ProducerJournal,grant:ProducerGrant,input:{publicationId:string;statements:unknown},afterCommit?:AfterCommit):Promise<ProducerPublicationOutcome>{
  let phase:Phase="preflight",id:unknown;
  try{
    id=input?.publicationId;const saved=context(publication,journal,grant,afterCommit),plan=validateEvidenceWalletCachedPlan({publication_id:Id.parse(id),kind:"wallet_cached_progress",operations:ProducerStatements.parse(input.statements).map(row=>({kind:"sql",...row}))});
    phase="persist";await persistEvidencePublicationIntent(saved.publication,saved.journal,saved.grant,plan);
    phase="publish";return await publishStoredEvidenceIntent(saved.publication,saved.journal,saved.grant,plan.publication_id,afterCommit) as ProducerCommitted;
  }catch{return held(phase,id,null);}
}

export type WalletQuotaReservation={wallet:string;rpc:string;day:string;wallet_limit:number;rpc_limit:number};
export async function publishEvidenceWalletQuotaBatch(publication:ProducerPublication,journal:ProducerJournal,grant:ProducerGrant,input:{publicationId:string;reservation:WalletQuotaReservation;statements:unknown},afterCommit?:AfterCommit):Promise<ProducerPublicationOutcome>{
  let phase:Phase="preflight",id:unknown;
  try{
    id=input?.publicationId;const saved=context(publication,journal,grant,afterCommit),plan=validateEvidenceWalletQuotaPlan({publication_id:Id.parse(id),kind:"wallet_quota",reservation:input.reservation,operations:ProducerStatements.parse(input.statements).map(row=>({kind:"sql",...row}))});
    phase="persist";await persistEvidencePublicationIntent(saved.publication,saved.journal,saved.grant,plan);
    phase="publish";return await publishStoredEvidenceIntent(saved.publication,saved.journal,saved.grant,plan.publication_id,afterCommit) as ProducerCommitted;
  }catch{return held(phase,id,null);}
}

export type WalletCycleContext={lease_id:string;job:string;address:string;at:string;until:string;rapid:0|1};
export async function publishEvidenceWalletCycleBatch(publication:ProducerPublication,journal:ProducerJournal,grant:ProducerGrant,input:{publicationId:string;cycle:WalletCycleContext;statements:unknown},afterCommit?:AfterCommit):Promise<ProducerPublicationOutcome>{
  let phase:Phase="preflight",id:unknown;
  try{
    id=input?.publicationId;const saved=context(publication,journal,grant,afterCommit),plan=validateEvidenceWalletCyclePlan({publication_id:Id.parse(id),kind:"wallet_cycle_control",cycle:input.cycle,operations:ProducerStatements.parse(input.statements).map(row=>({kind:"sql",...row}))});
    phase="persist";await persistEvidencePublicationIntent(saved.publication,saved.journal,saved.grant,plan);
    phase="publish";return await publishStoredEvidenceIntent(saved.publication,saved.journal,saved.grant,plan.publication_id,afterCommit) as ProducerCommitted;
  }catch{return held(phase,id,null);}
}

export async function publishEvidenceWalletCollectionBatch(publication:ProducerPublication,journal:ProducerJournal,grant:ProducerGrant,input:{publicationId:string;statements:unknown},afterCommit?:AfterCommit):Promise<ProducerPublicationOutcome>{
  let phase:Phase="preflight",id:unknown;
  try{
    id=input?.publicationId;const saved=context(publication,journal,grant,afterCommit),plan=validateEvidenceWalletCollectionPlan({publication_id:Id.parse(id),kind:"wallet_collection",operations:ProducerStatements.parse(input.statements).map(row=>({kind:"sql",...row}))}),op=plan.operations[0];
    if(op.kind!=="sql")throw Error("wallet_collection_sql_required");
    if(op.sql===collectionTransactionSql){const tx=WalletTransactionSchema.parse(JSON.parse(String(op.bindings[2])));if(await hashJson(tx)!==op.bindings[1])throw Error("wallet_collection_normalized_hash_required");}
    else fundingTask(FundingScanSchema.parse(JSON.parse(String(op.bindings[Object.values(collectionRepairSql).includes(op.sql)?0:3]))));
    phase="persist";await persistEvidencePublicationIntent(saved.publication,saved.journal,saved.grant,plan);
    phase="publish";return await publishStoredEvidenceIntent(saved.publication,saved.journal,saved.grant,plan.publication_id,afterCommit) as ProducerCommitted;
  }catch{return held(phase,id,null);}
}

export async function publishEvidenceWalletDirectBatch(publication:ProducerPublication,journal:ProducerJournal,grant:ProducerGrant,input:{publicationId:string;cycle:WalletCycleContext;sourceHash:string;limits:{wallet:number;rpc:number};statements:unknown},afterCommit?:AfterCommit):Promise<ProducerPublicationOutcome>{
  let phase:Phase="preflight",id:unknown;
  try{
    id=input?.publicationId;const saved=context(publication,journal,grant,afterCommit),plan=validateEvidenceWalletDirectPlan({publication_id:Id.parse(id),kind:"wallet_direct_cycle",cycle:input.cycle,source_hash:input.sourceHash,limits:input.limits,operations:ProducerStatements.parse(input.statements).map(row=>({kind:"sql",...row}))});
    for(const op of plan.operations)if(op.kind==="sql"&&op.sql===directWorkSql)WalletWorkSchema.parse(JSON.parse(String(op.bindings[2])));
    phase="persist";await persistEvidencePublicationIntent(saved.publication,saved.journal,saved.grant,plan);
    phase="publish";return await publishStoredEvidenceIntent(saved.publication,saved.journal,saved.grant,plan.publication_id,afterCommit) as ProducerCommitted;
  }catch{return held(phase,id,null);}
}

export async function publishEvidenceWalletRecoveryBatch(publication:ProducerPublication,journal:ProducerJournal,grant:ProducerGrant,input:{publicationId:string;claimId:string;cycle:WalletCycleContext;sourceHash:string;row:FundingRecovery;statements:unknown},afterCommit?:AfterCommit):Promise<ProducerPublicationOutcome>{
  let phase:Phase="preflight",id:unknown;
  try{
    id=input?.publicationId;const saved=context(publication,journal,grant,afterCommit),plan=validateEvidenceWalletRecoveryPlan({publication_id:Id.parse(id),kind:"wallet_reader_recovery",claim_id:input.claimId,cycle:input.cycle,source_hash:input.sourceHash,row:input.row,operations:ProducerStatements.parse(input.statements).map(row=>({kind:"sql",...row}))});
    for(const op of plan.operations)if(op.kind==="sql"&&op.sql===recoveryCacheSql[plan.row.hop]){
      const tx=WalletTransactionSchema.parse(JSON.parse(String(op.bindings[5])));validWalletTransaction(tx);
      if(await hashJson(tx)!==op.bindings[4]||!keys(tx).includes(plan.row.wallet)||tx.blockTime!*1000>Date.parse(String(op.bindings[3])))throw Error("wallet_recovery_body_not_certified");
    }
    phase="persist";await persistEvidencePublicationIntent(saved.publication,saved.journal,saved.grant,plan);
    phase="publish";return await publishStoredEvidenceIntent(saved.publication,saved.journal,saved.grant,plan.publication_id,afterCommit) as ProducerCommitted;
  }catch{return held(phase,id,null);}
}
