// Private non-executable scope and read-only known-job inspection. No resumption.
import {z} from "zod";
import {createHash} from "node:crypto";
import {isDeepStrictEqual} from "node:util";
import {validateEvidenceWalletJobPlan,walletJobSlots,validateWalletJobStep} from "../evidence-wallet-job-plan.mjs";
import {readEvidenceJobPublicationRecords} from "../discovery-evidence-publication.mjs";
import {readEvidencePublicationIntent,readEvidencePublicationIntentIfPresent,persistEvidencePublicationIntent,reconcileStoredEvidenceIntent} from "../discovery-evidence-intents.mjs";
import type {ProducerPublication,ProducerJournal,ProducerGrant,ProducerCommitted} from "./evidence-producer-publication";
const Id=z.string().uuid(),sha=(s:string)=>createHash("sha256").update(s).digest("hex");
const inactive=()=>({provider_requests:0 as const,source_authorized:false as const,current_authority:false as const,runtime_activated:false as const,action_authority:false as const,evidence_qualified:false as const,free_acceptance:false as const,sql_attempt:"read_only" as const});
export async function retainCachedWalletJob(publication:ProducerPublication,journal:ProducerJournal,grant:ProducerGrant,input:unknown){
  const saved=structuredClone({publication,journal,grant,input}),plan=validateEvidenceWalletJobPlan(saved.input),ids=[plan.publication_id,...walletJobSlots(plan).map(s=>s.id)];
  if((await readEvidenceJobPublicationRecords(saved.publication,saved.grant,ids)).records.length)throw Error("wallet_job_prior_publication");
  for(const id of ids)if(await readEvidencePublicationIntentIfPresent(saved.publication,saved.journal,saved.grant,id))throw Error("wallet_job_prior_intent");
  await persistEvidencePublicationIntent(saved.publication,saved.journal,saved.grant,plan);
  return {progress_id:plan.publication_id,state:"retained" as const};
}
type Step={id:string;role:string;state:"not_retained"|"pending"|"committed"|"held"|"orphan_commit";results?:ProducerCommitted["results"]};
export async function inspectCachedWalletJob(publication:ProducerPublication,journal:ProducerJournal,grant:ProducerGrant,input:{progressId:string}){
  try{
    const saved=structuredClone({publication,journal,grant,input}),request=z.object({progressId:Id}).strict().parse(saved.input),job=await readEvidencePublicationIntent(saved.publication,saved.journal,saved.grant,request.progressId),plan=validateEvidenceWalletJobPlan(job.plan),slots=walletJobSlots(plan),ids=[plan.publication_id,...slots.map(s=>s.id)],before=(await readEvidenceJobPublicationRecords(saved.publication,saved.grant,ids)).records;
    if(before.some(r=>r.publication_id===plan.publication_id))throw Error("wallet_job_manifest_was_published");
    const steps:Step[]=[],heads=new Map<string,string|null>();
    for(const slot of slots){
      try{
        const record=before.find(r=>r.publication_id===slot.id),intent=await readEvidencePublicationIntentIfPresent(saved.publication,saved.journal,saved.grant,slot.id);heads.set(slot.id,intent?.ready_sha256??null);
        if(!intent){steps.push({...slot,state:record?"orphan_commit":"not_retained"});continue;}
        if(!isDeepStrictEqual(intent.original_grant,job.original_grant)||record&&(!isDeepStrictEqual(record.grant,job.original_grant)||record.plan_sha256!==sha(JSON.stringify(intent.plan))))throw Error("wallet_job_step_owner_or_hash");
        validateWalletJobStep(plan,slot,intent.plan);
        if(!record){steps.push({...slot,state:"pending"});continue;}
        const result=await reconcileStoredEvidenceIntent(saved.publication,saved.journal,saved.grant,slot.id) as ProducerCommitted;
        steps.push({...slot,state:"committed",results:result.results});
      }catch{steps.push({...slot,state:"held"});}
    }
    // Detect a mixed ledger snapshot, changed readiness, or owner loss before
    // returning any successful historical diagnostics. None grant permission.
    for(const [id,head] of heads)if((await readEvidencePublicationIntentIfPresent(saved.publication,saved.journal,saved.grant,id))?.ready_sha256!== (head??undefined))throw Error("wallet_job_readiness_changed");
    const final=await readEvidencePublicationIntent(saved.publication,saved.journal,saved.grant,request.progressId);
    if(final.ready_sha256!==job.ready_sha256||!isDeepStrictEqual((await readEvidenceJobPublicationRecords(saved.publication,saved.grant,ids)).records,before))throw Error("wallet_job_progress_changed");
    const committed=(role:string)=>steps.find(s=>s.role===role&&s.state==="committed"),lease=committed("lease"),held=steps.some(s=>s.state==="held"||s.state==="orphan_commit"),progress=held?"unconfirmed":committed("finish")?"finish_recorded":committed("failure_run")&&committed("failure_release")&&committed("failure_attempt")?"failure_recorded":lease?.results?.[0]?.results.length===0?"lease_declined":"incomplete";
    return {state:held?"held" as const:"observed" as const,progress,job:{progress_id:plan.publication_id,...plan.cycle,stage:plan.stage,candidate_hash:plan.candidate_hash,source_hash:plan.source_hash,limits:plan.limits},original_owner_current:isDeepStrictEqual(job.original_grant,saved.grant),steps,...inactive()};
  }catch{return {state:"held" as const,progress:"unconfirmed",steps:[] as Step[],code:"wallet_job_inspection_held",...inactive()};}
}
