// Private retained producer/cohort pairs. Never schedules or dispatches sources.
import {z} from "zod";
import {isDeepStrictEqual} from "node:util";
import {CandidateSchema} from "../../discovery/src/model";
import {captureCohort} from "../../discovery/src/store";
import {validateEvidenceTargetPlan,validateEvidenceCohortPlan,previewEvidenceCandidateForCohort,readEvidenceCohortHeads} from "../discovery-evidence-publication.mjs";
import {cohortKeys} from "../evidence-cohort-plan.mjs";
import {readEvidencePublicationIntent,readEvidencePublicationIntentIfPresent,persistEvidencePublicationIntent,publishStoredEvidenceIntent,reconcileStoredEvidenceIntent} from "../discovery-evidence-intents.mjs";
import type {ProducerStatement} from "./evidence-producer-plan";
import type {ProducerPublication,ProducerJournal,ProducerGrant,ProducerPublicationOutcome,ProducerHeld} from "./evidence-producer-publication";
const Id=z.string().uuid();
const held=(id:unknown,phase:"preflight"|"persist"|"publish"|"reconcile"):ProducerHeld=>({state:"held",publication_id:Id.safeParse(id).success?id as string:null,stage_id:null,phase,sql_attempt:phase==="publish"?"unconfirmed":phase==="reconcile"?"read_only":"not_started",code:phase==="publish"?"producer_publication_unconfirmed":phase==="persist"?"producer_intent_held":phase==="reconcile"?"producer_reconciliation_held":"producer_preflight_held",runtime_activated:false,action_authority:false,evidence_qualified:false,provider_requests:0,free_acceptance:false});
const inactive=()=>({provider_requests:0 as const,source_authorized:false as const,runtime_activated:false as const,action_authority:false as const,evidence_qualified:false as const,free_acceptance:false as const});
export async function retainLinkedCohortReadiness(publication:ProducerPublication,journal:ProducerJournal,grant:ProducerGrant,input:unknown){
  const saved=structuredClone({publication,journal,grant,input}),parent=validateEvidenceTargetPlan(saved.input);
  if(!("cohort_id" in parent)||!parent.cohort_id)throw Error("cohort_link_required");
  const prior=await readEvidencePublicationIntentIfPresent(saved.publication,saved.journal,saved.grant,parent.cohort_id);
  if(prior){
    const retained=validateEvidenceCohortPlan(prior.plan);
    if(!isDeepStrictEqual(prior.original_grant,saved.grant)||!isDeepStrictEqual(retained.parent,parent))throw Error("cohort_link_identity_conflict");
    return;
  }
  const preview=await previewEvidenceCandidateForCohort(saved.publication,saved.grant,parent),candidate=CandidateSchema.parse(JSON.parse(preview.payload)),statements:ProducerStatement[]=[];
  const recorder={prepare(sql:string){return {bind(...bindings:ProducerStatement["bindings"]){statements.push({sql,bindings});return {};}};},async batch(){return [];}} as unknown as D1Database;
  await captureCohort(recorder,candidate,candidate.checked_at);
  let child=validateEvidenceCohortPlan({kind:"candidate_cohorts",publication_id:parent.cohort_id,parent,candidate_hash:preview.hash,heads:statements.map(()=>null),operations:statements.map(r=>({kind:"sql",...r}))});
  child=validateEvidenceCohortPlan({...child,heads:(await readEvidenceCohortHeads(saved.publication,saved.grant,{keys:cohortKeys(child)})).heads});
  await persistEvidencePublicationIntent(saved.publication,saved.journal,saved.grant,child);
}

// Only a completely absent parent may be materialized from the authenticated
// child. Pending snapshots still pass their current native lease/source guards.
export async function recoverLinkedCohortBatch(publication:ProducerPublication,journal:ProducerJournal,grant:ProducerGrant,input:{cohortId:string;mode:"publish"|"reconcile"},domain:"candidate"|"snapshot"){
  let producer:ProducerPublicationOutcome|undefined,phase:"preflight"|"persist"|"publish"|"reconcile"="preflight",id:unknown;
  try{
    const saved=structuredClone({publication,journal,grant,input,domain}),i=z.object({cohortId:Id,mode:z.enum(["publish","reconcile"])}).strict().parse(saved.input),kind=z.enum(["candidate","snapshot"]).parse(saved.domain),child=await readEvidencePublicationIntent(saved.publication,saved.journal,saved.grant,i.cohortId),plan=validateEvidenceCohortPlan(child.plan);id=plan.parent.publication_id;
    if(plan.parent.cohort_id!==i.cohortId||!plan.candidate_hash||(kind==="candidate"?![undefined,"candidate_metadata"].includes(plan.parent.kind):plan.parent.kind!=="wallet_snapshot_cycle"||!plan.parent.ticket))throw Error("cohort_link_domain_required");
    const execute=i.mode==="publish"?publishStoredEvidenceIntent:reconcileStoredEvidenceIntent;
    if(i.mode==="publish"){
      if(!isDeepStrictEqual(child.original_grant,saved.grant))throw Error("cohort_link_original_owner_required");
      const parent=await readEvidencePublicationIntentIfPresent(saved.publication,saved.journal,saved.grant,plan.parent.publication_id);
      if(parent&&(!isDeepStrictEqual(parent.original_grant,child.original_grant)||!isDeepStrictEqual(parent.plan,plan.parent)))throw Error("cohort_link_parent_conflict");
      if(!parent){phase="persist";await persistEvidencePublicationIntent(saved.publication,saved.journal,saved.grant,plan.parent);}
    }
    phase=i.mode;producer=await execute(saved.publication,saved.journal,saved.grant,plan.parent.publication_id) as ProducerPublicationOutcome;
    id=i.cohortId;const cohort=await execute(saved.publication,saved.journal,saved.grant,i.cohortId) as ProducerPublicationOutcome;
    return {state:"completed" as const,producer,cohort,...inactive()};
  }catch{return {state:"held" as const,producer,cohort:undefined,failure:held(id,phase),...inactive()};}
}
