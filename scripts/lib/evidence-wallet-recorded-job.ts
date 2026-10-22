// Private recorded direct-job history only. Never resumes work or returns bodies.
import {z} from "zod";
import {isDeepStrictEqual} from "node:util";
import {validateEvidenceWalletRecordedJobPlan,recordedJobIds,recordedJobSlots,recordedJobHash,recordedJobReply,validateRecordedJobStep} from "../evidence-wallet-recorded-job-plan.mjs";
import {readEvidenceJobPublicationRecords,validateEvidenceTargetPlan} from "../discovery-evidence-publication.mjs";
import {readEvidencePublicationIntent,readEvidencePublicationIntentIfPresent,persistEvidencePublicationIntent,reconcileStoredEvidenceIntent} from "../discovery-evidence-intents.mjs";
import type {ProducerPublication,ProducerJournal,ProducerGrant,ProducerCommitted} from "./evidence-producer-publication";
type Context={publication:ProducerPublication;journal:ProducerJournal;grant:ProducerGrant};
const inactive=()=>({provider_requests:0 as const,source_authorized:false as const,current_authority:false as const,runtime_activated:false as const,action_authority:false as const,evidence_qualified:false as const,free_acceptance:false as const,sql_attempt:"read_only" as const});
async function records(c:Context,ids:string[]){const all=[];for(let i=0;i<ids.length;i+=28)all.push(...(await readEvidenceJobPublicationRecords(c.publication,c.grant,ids.slice(i,i+28))).records);return all;}
export async function retainRecordedWalletJob(publication:ProducerPublication,journal:ProducerJournal,grant:ProducerGrant,input:unknown){
  const c=structuredClone({publication,journal,grant}),p=validateEvidenceWalletRecordedJobPlan(structuredClone(input)),ids=recordedJobIds(p);
  if((await records(c,ids)).length)throw Error("wallet_recorded_job_prior_publication");
  for(const id of ids)if(await readEvidencePublicationIntentIfPresent(c.publication,c.journal,c.grant,id))throw Error("wallet_recorded_job_prior_intent");
  await persistEvidencePublicationIntent(c.publication,c.journal,c.grant,p);return {progress_id:p.publication_id,state:"retained" as const};
}
async function original(c:Context,id:string){const saved=await readEvidencePublicationIntent(c.publication,c.journal,c.grant,id);if(!isDeepStrictEqual(saved.original_grant,c.grant))throw Error("wallet_recorded_job_original_owner");return validateEvidenceWalletRecordedJobPlan(saved.plan);}
export async function retainRecordedWalletWrite(publication:ProducerPublication,journal:ProducerJournal,grant:ProducerGrant,progressId:string,index:number,input:unknown){
  const c=structuredClone({publication,journal,grant}),job=await original(c,progressId),link=job.writes[index],plan=validateEvidenceTargetPlan(structuredClone(input));
  if(!link||plan.publication_id!==link.publication_id)throw Error("wallet_recorded_write_identity");
  const binding={kind:"wallet_recorded_write",publication_id:link.binding_id,job_id:job.publication_id,job_plan_sha256:recordedJobHash(job),index,plan,operations:[]};
  validateRecordedJobStep(job,{role:"write",id:link.publication_id,index,bindingId:link.binding_id},plan,binding);
  if((await records(c,[link.publication_id,link.binding_id])).length||await readEvidencePublicationIntentIfPresent(c.publication,c.journal,c.grant,link.publication_id)||await readEvidencePublicationIntentIfPresent(c.publication,c.journal,c.grant,link.binding_id))throw Error("wallet_recorded_write_already_retained");
  await persistEvidencePublicationIntent(c.publication,c.journal,c.grant,binding);
}
export async function retainRecordedWalletHandoff(publication:ProducerPublication,journal:ProducerJournal,grant:ProducerGrant,progressId:string,index:number,input:unknown){
  const c=structuredClone({publication,journal,grant}),reply=recordedJobReply(structuredClone(input)),job=await original(c,progressId),link=job.responses[index];
  if(!link||recordedJobHash(reply)!==link.reply_sha256)throw Error("wallet_recorded_response_identity");
  for(const role of ["wallet_quota","rpc_quota"]){const id=role==="wallet_quota"?link.wallet:link.rpc,saved=await readEvidencePublicationIntent(c.publication,c.journal,c.grant,id);if(!isDeepStrictEqual(saved.original_grant,c.grant))throw Error("wallet_recorded_response_owner");validateRecordedJobStep(job,{role,id,index},saved.plan);const r=await reconcileStoredEvidenceIntent(c.publication,c.journal,c.grant,id);if(r.results[0]?.results.length!==1)throw Error("wallet_recorded_response_quota_rejected");}
  if((await records(c,[link.handoff])).length||await readEvidencePublicationIntentIfPresent(c.publication,c.journal,c.grant,link.handoff))throw Error("wallet_recorded_response_already_retained");
  await persistEvidencePublicationIntent(c.publication,c.journal,c.grant,{kind:"wallet_recorded_handoff",publication_id:link.handoff,job_id:job.publication_id,job_plan_sha256:recordedJobHash(job),index,reply,operations:[]});
  return {state:"handoff_prepared" as const};
}
type Step={id:string;role:string;index?:number;state:"not_retained"|"pending"|"committed"|"held"|"orphan_commit"|"handoff_prepared"|"write_prepared";results?:ProducerCommitted["results"]};
export async function inspectRecordedWalletJob(publication:ProducerPublication,journal:ProducerJournal,grant:ProducerGrant,input:{progressId:string}){
  try{
    const c=structuredClone({publication,journal,grant}),request=z.object({progressId:z.string().uuid()}).strict().parse(structuredClone(input)),saved=await readEvidencePublicationIntent(c.publication,c.journal,c.grant,request.progressId),job=validateEvidenceWalletRecordedJobPlan(saved.plan),ids=recordedJobIds(job),before=await records(c,ids),heads=new Map<string,string|null>(),intents=new Map<string,Awaited<ReturnType<typeof readEvidencePublicationIntentIfPresent>>>(),broken=new Set<string>();
    if(before.some(r=>r.publication_id===job.publication_id||job.writes.some(w=>w.binding_id===r.publication_id)||job.responses.some(rp=>rp.handoff===r.publication_id)))throw Error("wallet_recorded_descriptor_published");
    for(const id of ids){try{const intent=await readEvidencePublicationIntentIfPresent(c.publication,c.journal,c.grant,id);heads.set(id,intent?.ready_sha256??null);if(intent&&!isDeepStrictEqual(intent.original_grant,saved.original_grant))throw Error("wallet_recorded_step_owner");intents.set(id,intent);}catch{broken.add(id);}}
    const steps:Step[]=[];
    for(const slot of recordedJobSlots(job)){
      try{
        const record=before.find(r=>r.publication_id===slot.id),intent=intents.get(slot.id),binding=slot.role==="write"?intents.get(slot.bindingId!):undefined;
        if(broken.has(slot.id)||slot.role==="write"&&broken.has(slot.bindingId!))throw Error("wallet_recorded_step_partial");
        if(!intent){if(slot.role==="write"&&binding&&!record){if(!("kind" in binding.plan)||binding.plan.kind!=="wallet_recorded_write")throw Error("wallet_recorded_binding_domain");validateRecordedJobStep(job,slot,binding.plan.plan,binding.plan);steps.push({...slot,state:"write_prepared"});}else steps.push({...slot,state:record?"orphan_commit":"not_retained"});continue;}
        validateRecordedJobStep(job,slot,intent.plan,binding?.plan);
        if(record&&(!isDeepStrictEqual(record.grant,saved.original_grant)||record.plan_sha256!==recordedJobHash(intent.plan)))throw Error("wallet_recorded_step_hash");
        if(slot.role==="response"){
          const pair=steps.filter(s=>s.index===slot.index&&["wallet_quota","rpc_quota"].includes(s.role));
          if(pair.length!==2||pair.some(s=>s.state!=="committed"||s.results?.[0]?.results.length!==1))throw Error("wallet_recorded_response_without_spend");
          steps.push({...slot,state:"handoff_prepared"});continue;
        }
        if(!record){steps.push({...slot,state:"pending"});continue;}
        const result=await reconcileStoredEvidenceIntent(c.publication,c.journal,c.grant,slot.id) as ProducerCommitted;steps.push({...slot,state:"committed",results:result.results});
      }catch{steps.push({...slot,state:"held"});}
    }
    for(const [id,head] of heads)if((await readEvidencePublicationIntentIfPresent(c.publication,c.journal,c.grant,id))?.ready_sha256!==(head??undefined))throw Error("wallet_recorded_readiness_changed");
    const final=await readEvidencePublicationIntent(c.publication,c.journal,c.grant,request.progressId);if(final.ready_sha256!==saved.ready_sha256||!isDeepStrictEqual(await records(c,ids),before))throw Error("wallet_recorded_progress_changed");
    const committed=(role:string)=>steps.find(s=>s.role===role&&s.state==="committed"),held=steps.some(s=>["held","orphan_commit"].includes(s.state)),lease=committed("lease");
    return {state:held?"held" as const:"observed" as const,progress:held?"unconfirmed":committed("finish")?"finish_recorded":committed("failure_run")&&committed("failure_release")&&committed("failure_attempt")?"failure_recorded":lease?.results?.[0]?.results.length===0?"lease_declined":"incomplete",job:{progress_id:job.publication_id,...job.cycle,stage:job.stage,candidate_hash:job.candidate_hash,source_hash:job.source_hash,limits:job.limits},original_owner_current:isDeepStrictEqual(saved.original_grant,c.grant),steps,response_consumption:"unknown" as const,...inactive()};
  }catch{return {state:"held" as const,progress:"unconfirmed",steps:[] as Step[],response_consumption:"unknown" as const,code:"wallet_recorded_job_inspection_held",...inactive()};}
}
