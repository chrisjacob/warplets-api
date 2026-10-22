// Durable captured post-commit work only; never calls a source or scheduler.
import {z} from "zod";
import {isDeepStrictEqual} from "node:util";
import {CandidateSchema} from "../../discovery/src/model";
import {captureCohort} from "../../discovery/src/store";
import {readEvidencePublicationIntent,readEvidencePublicationIntentIfPresent,persistEvidencePublicationIntent,publishStoredEvidenceIntent,reconcileStoredEvidenceIntent} from "../discovery-evidence-intents.mjs";
import {readEvidenceCandidateMetadata,readEvidenceCohortHeads,validateEvidenceCohortPlan} from "../discovery-evidence-publication.mjs";
import {cohortKeys} from "../evidence-cohort-plan.mjs";
import {ProducerStatements,type ProducerStatement} from "./evidence-producer-plan";
import type {ProducerPublication,ProducerJournal,ProducerGrant,ProducerPublicationOutcome,ProducerCommitted} from "./evidence-producer-publication";
const Id=z.string().uuid();
export type CohortBatchInput={publicationId:string;parentId:string;statements:unknown};
export async function publishEvidenceCohortBatch(publication:ProducerPublication,journal:ProducerJournal,grant:ProducerGrant,input:CohortBatchInput,afterCommit?:(outcome:ProducerCommitted)=>void|Promise<void>):Promise<ProducerPublicationOutcome>{
  let phase:"preflight"|"persist"|"publish"="preflight",id:unknown;
  try{
    const saved=structuredClone({publication,journal,grant,input});id=saved.input.publicationId;Id.parse(id);Id.parse(saved.input.parentId);
    if(afterCommit!==undefined&&typeof afterCommit!=="function")throw Error("cohort_callback_invalid");
    const statements=ProducerStatements.parse(saved.input.statements),parent=await readEvidencePublicationIntent(saved.publication,saved.journal,saved.grant,saved.input.parentId);
    if(!isDeepStrictEqual(parent.original_grant,saved.grant))throw Error("cohort_original_owner_required");
    let plan=validateEvidenceCohortPlan({kind:"candidate_cohorts",publication_id:id,parent:parent.plan,heads:statements.map(()=>null),operations:statements.map(r=>({kind:"sql",...r}))});
    const prior=await readEvidencePublicationIntentIfPresent(saved.publication,saved.journal,saved.grant,Id.parse(id));
    if(prior){
      const retained=validateEvidenceCohortPlan(prior.plan);
      if(!isDeepStrictEqual(prior.original_grant,saved.grant)||!isDeepStrictEqual(retained.parent,plan.parent)||!isDeepStrictEqual(retained.operations,plan.operations))throw Error("cohort_identity_conflict");
      phase="publish";return await publishStoredEvidenceIntent(saved.publication,saved.journal,saved.grant,Id.parse(id),afterCommit) as ProducerPublicationOutcome;
    }
    // Admission replays the original policy/cohort builder on the exact current
    // candidate. Recovery later uses these saved bytes, never today's candidate.
    const first=statements[0]!,body=JSON.parse(String(first.bindings[5])),picked=Object.fromEntries(Object.keys(CandidateSchema.shape).filter(k=>Object.hasOwn(body.candidate??{},k)).map(k=>[k,body.candidate[k]])),candidate=CandidateSchema.parse(picked);
    const current=(await readEvidenceCandidateMetadata(saved.publication,saved.grant,{kind:"candidate",address:candidate.address})).row;
    if(!current?.payload||!isDeepStrictEqual(CandidateSchema.parse(JSON.parse(current.payload)),candidate))throw Error("cohort_candidate_changed");
    const expected:ProducerStatement[]=[],db={prepare(sql:string){return {bind(...bindings:ProducerStatement["bindings"]){const statement={sql,bindings};expected.push(statement);return statement;}};},async batch(){return [];}} as unknown as D1Database;
    await captureCohort(db,candidate,String(first.bindings[2]));if(!isDeepStrictEqual(expected,statements))throw Error("cohort_original_capture_required");
    // Reconcile authenticates the accepted parent/receipt without executing it.
    await reconcileStoredEvidenceIntent(saved.publication,saved.journal,saved.grant,saved.input.parentId);
    plan=validateEvidenceCohortPlan({...plan,heads:(await readEvidenceCohortHeads(saved.publication,saved.grant,{keys:cohortKeys(plan)})).heads});
    phase="persist";await persistEvidencePublicationIntent(saved.publication,saved.journal,saved.grant,plan);
    phase="publish";return await publishStoredEvidenceIntent(saved.publication,saved.journal,saved.grant,Id.parse(id),afterCommit) as ProducerPublicationOutcome;
  }catch{return {state:"held",publication_id:Id.safeParse(id).success?id as string:null,stage_id:null,phase,sql_attempt:phase==="publish"?"unconfirmed":"not_started",code:phase==="publish"?"producer_publication_unconfirmed":phase==="persist"?"producer_intent_held":"producer_preflight_held",provider_requests:0,runtime_activated:false,action_authority:false,evidence_qualified:false,free_acceptance:false};}
}
