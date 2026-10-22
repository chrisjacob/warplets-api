// Private candidate publication only. No scheduler, transport or lease revival.
import {z} from "zod";
import {isDeepStrictEqual} from "node:util";
import {CandidateSchema} from "../../discovery/src/model";
import {captureCohort} from "../../discovery/src/store";
import {prepareEvidenceProducerBatch,ProducerStatements,type ProducerStatement} from "./evidence-producer-plan";
import {validateEvidenceTargetPlan,validateEvidenceCohortPlan,previewEvidenceCandidateForCohort,readEvidenceCohortHeads} from "../discovery-evidence-publication.mjs";
import {cohortKeys} from "../evidence-cohort-plan.mjs";
import {readEvidencePublicationIntent,readEvidencePublicationIntentIfPresent,persistEvidencePublicationIntent,publishStoredEvidenceIntent,reconcileStoredEvidenceIntent} from "../discovery-evidence-intents.mjs";
import type {ProducerPublication,ProducerJournal,ProducerGrant,ProducerPublicationOutcome,ProducerCommitted,ProducerHeld} from "./evidence-producer-publication";
const Id=z.string().uuid();
const Input=z.object({publicationId:Id,stageId:Id.optional(),cohortId:Id,statements:ProducerStatements}).strict();
type Input=z.infer<typeof Input>;
const held=(id:unknown,phase:"preflight"|"persist"|"publish"|"reconcile"):ProducerHeld=>({state:"held",publication_id:Id.safeParse(id).success?id as string:null,stage_id:null,phase,sql_attempt:phase==="publish"?"unconfirmed":phase==="reconcile"?"read_only":"not_started",code:phase==="publish"?"producer_publication_unconfirmed":phase==="persist"?"producer_intent_held":phase==="reconcile"?"producer_reconciliation_held":"producer_preflight_held",runtime_activated:false,action_authority:false,evidence_qualified:false,provider_requests:0,free_acceptance:false});

export async function publishLinkedCandidateBatch(publication:ProducerPublication,journal:ProducerJournal,grant:ProducerGrant,input:Input,afterCommit?:(outcome:ProducerCommitted)=>void|Promise<void>):Promise<ProducerPublicationOutcome>{
  let phase:"preflight"|"persist"|"publish"="preflight",id:unknown;
  try{
    const saved=structuredClone({publication,journal,grant,input}),i=Input.parse(saved.input);id=i.publicationId;
    if(new Set([i.publicationId,i.cohortId,...(i.stageId?[i.stageId]:[])]).size!==2+Number(Boolean(i.stageId)))throw Error("candidate_workflow_identity_duplicate");
    if(afterCommit!==undefined&&typeof afterCommit!=="function")throw Error("candidate_workflow_callback");
    const parent=validateEvidenceTargetPlan({...i.stageId?await prepareEvidenceProducerBatch(saved.publication.stage,{publicationId:i.publicationId,stageId:i.stageId,statements:i.statements}):{kind:"candidate_metadata",publication_id:i.publicationId,operations:i.statements.map(r=>({kind:"sql",...r}))},cohort_id:i.cohortId});
    const prior=await readEvidencePublicationIntentIfPresent(saved.publication,saved.journal,saved.grant,i.cohortId);
    if(prior){
      const retained=validateEvidenceCohortPlan(prior.plan);
      if(!isDeepStrictEqual(prior.original_grant,saved.grant)||!isDeepStrictEqual(retained.parent,parent))throw Error("candidate_workflow_identity_conflict");
    }else{
      const preview=await previewEvidenceCandidateForCohort(saved.publication,saved.grant,parent),candidate=CandidateSchema.parse(JSON.parse(preview.payload)),statements:ProducerStatement[]=[];
      const recorder={prepare(sql:string){return {bind(...bindings:ProducerStatement["bindings"]){statements.push({sql,bindings});return {};}};},async batch(){return [];}} as unknown as D1Database;
      await captureCohort(recorder,candidate,candidate.checked_at);
      let child=validateEvidenceCohortPlan({kind:"candidate_cohorts",publication_id:i.cohortId,parent,candidate_hash:preview.hash,heads:statements.map(()=>null),operations:statements.map(r=>({kind:"sql",...r}))});
      child=validateEvidenceCohortPlan({...child,heads:(await readEvidenceCohortHeads(saved.publication,saved.grant,{keys:cohortKeys(child)})).heads});
      phase="persist";await persistEvidencePublicationIntent(saved.publication,saved.journal,saved.grant,child);
    }
    // Parent readiness is never published before its exact child's readiness.
    phase="persist";await persistEvidencePublicationIntent(saved.publication,saved.journal,saved.grant,parent);
    phase="publish";return await publishStoredEvidenceIntent(saved.publication,saved.journal,saved.grant,i.publicationId,afterCommit) as ProducerPublicationOutcome;
  }catch{return held(id,phase);}
}

// Explicit recovery from the retained cohort ID only. Partial files hold; only
// an absent parent directory may be materialized from its authenticated child.
export async function recoverLinkedCandidateBatch(publication:ProducerPublication,journal:ProducerJournal,grant:ProducerGrant,input:{cohortId:string;mode:"publish"|"reconcile"}){
  let producer:ProducerPublicationOutcome|undefined,phase:"preflight"|"persist"|"publish"|"reconcile"="preflight",id:unknown;
  try{
    const saved=structuredClone({publication,journal,grant,input}),i=z.object({cohortId:Id,mode:z.enum(["publish","reconcile"])}).strict().parse(saved.input),child=await readEvidencePublicationIntent(saved.publication,saved.journal,saved.grant,i.cohortId),plan=validateEvidenceCohortPlan(child.plan);id=plan.parent.publication_id;
    if(plan.parent.cohort_id!==i.cohortId||!plan.candidate_hash)throw Error("candidate_workflow_link_required");
    const execute=i.mode==="publish"?publishStoredEvidenceIntent:reconcileStoredEvidenceIntent;
    if(i.mode==="publish"){
      if(!isDeepStrictEqual(child.original_grant,saved.grant))throw Error("candidate_workflow_original_owner_required");
      const parent=await readEvidencePublicationIntentIfPresent(saved.publication,saved.journal,saved.grant,plan.parent.publication_id);
      if(parent&&(!isDeepStrictEqual(parent.original_grant,child.original_grant)||!isDeepStrictEqual(parent.plan,plan.parent)))throw Error("candidate_workflow_parent_conflict");
      if(!parent){phase="persist";await persistEvidencePublicationIntent(saved.publication,saved.journal,saved.grant,plan.parent);}
    }
    phase=i.mode;producer=await execute(saved.publication,saved.journal,saved.grant,plan.parent.publication_id) as ProducerPublicationOutcome;
    id=i.cohortId;const cohort=await execute(saved.publication,saved.journal,saved.grant,i.cohortId) as ProducerPublicationOutcome;
    return {state:"completed" as const,producer,cohort,provider_requests:0 as const,source_authorized:false as const,runtime_activated:false as const,action_authority:false as const,evidence_qualified:false as const,free_acceptance:false as const};
  }catch{return {state:"held" as const,producer,cohort:undefined,failure:held(id,phase),provider_requests:0 as const,source_authorized:false as const,runtime_activated:false as const,action_authority:false as const,evidence_qualified:false as const,free_acceptance:false as const};}
}
