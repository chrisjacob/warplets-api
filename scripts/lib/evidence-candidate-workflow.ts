// Private candidate publication only. No scheduler, transport or lease revival.
import {z} from "zod";
import {prepareEvidenceProducerBatch,ProducerStatements} from "./evidence-producer-plan";
import {validateEvidenceTargetPlan} from "../discovery-evidence-publication.mjs";
import {retainLinkedCohortReadiness,recoverLinkedCohortBatch} from "./evidence-linked-cohort";
import {persistEvidencePublicationIntent,publishStoredEvidenceIntent} from "../discovery-evidence-intents.mjs";
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
    phase="persist";await retainLinkedCohortReadiness(saved.publication,saved.journal,saved.grant,parent);
    // Parent readiness is never published before its exact child's readiness.
    phase="persist";await persistEvidencePublicationIntent(saved.publication,saved.journal,saved.grant,parent);
    phase="publish";return await publishStoredEvidenceIntent(saved.publication,saved.journal,saved.grant,i.publicationId,afterCommit) as ProducerPublicationOutcome;
  }catch{return held(id,phase);}
}

// Explicit recovery from the retained cohort ID only. Partial files hold; only
// an absent parent directory may be materialized from its authenticated child.
export async function recoverLinkedCandidateBatch(publication:ProducerPublication,journal:ProducerJournal,grant:ProducerGrant,input:{cohortId:string;mode:"publish"|"reconcile"}){
  return recoverLinkedCohortBatch(publication,journal,grant,input,"candidate");
}
