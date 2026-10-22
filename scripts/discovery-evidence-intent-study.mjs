// Read-only frozen-commit reconciliation. Writes only a NEW private journal.
import fs from "node:fs/promises";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {createHash} from "node:crypto";
import {promisify,isDeepStrictEqual} from "node:util";
import {execFile} from "node:child_process";
import {z} from "zod";
import {evidenceRegularFile} from "./discovery-evidence-objects.mjs";
import {hashFile} from "./discovery-archive.mjs";
import {readStagedEvidenceAppend} from "./discovery-evidence-append-stage.mjs";
import {createEvidenceIntentJournal,persistEvidencePublicationIntent,readEvidencePublicationIntent} from "./discovery-evidence-intents.mjs";
const exec=promisify(execFile),sha=bytes=>createHash("sha256").update(bytes).digest("hex"),digest=value=>sha(JSON.stringify(value)),Hash=z.string().regex(/^[a-f0-9]{64}$/);
async function pinned(file,pin){
  Hash.parse(pin);const info=await evidenceRegularFile(file,2*1024**2),handle=await fs.open(info.file,"r");
  try{const bytes=Buffer.alloc(info.bytes+1),read=await handle.read(bytes,0,bytes.length,0);if(read.bytesRead!==info.bytes||(await handle.stat()).size!==info.bytes||sha(bytes.subarray(0,read.bytesRead))!==pin)throw Error("intent_study_source_pin_mismatch");return JSON.parse(bytes.subarray(0,read.bytesRead));}finally{await handle.close();}
}
export async function studyEvidenceIntents(args){
  if(args.length!==10)throw Error("Expected TARGET TARGET_PIN STAGE STAGE_PIN KEY AUTHORITY_REPORT AUTHORITY_PIN STAGING_REPORT STAGING_PIN NEW_JOURNAL");
  const [directory,targetPin,stageDirectory,contextPin,keyFile,authorityFile,authorityPin,stagingFile,stagingPin,target]=args,publication={directory,targetPin,stage:{directory:stageDirectory,contextPin,keyFile}},authority=await pinned(authorityFile,authorityPin),staging=await pinned(stagingFile,stagingPin);
  if(authority.version!=="discovery-evidence-publication-study-v1"||authority.target_pin!==targetPin||staging.context_pin!==contextPin||authority.capacity_pin!==staging.capacity_pin||authority.base_reference_pin!==staging.base_reference_pin||authority.cases?.length!==4||staging.cases?.length!==4)throw Error("intent_study_source_context_mismatch");
  const database=(await evidenceRegularFile(path.join(directory,"metadata.sqlite"),2*1024**3)).file,before=await hashFile(database),created=await createEvidenceIntentJournal({target,publication,grant:authority.current_grant}),journal={directory:target,contextPin:created.context_pin},cases=[];
  for(const saved of authority.cases){
    const source=staging.cases.find(item=>item.table===saved.table&&item.identity===saved.identity);if(!source)throw Error("intent_study_original_stage_missing");
    const staged=await readStagedEvidenceAppend(publication.stage,source.ticket);if(digest(staged.row)!==saved.original_row_sha256)throw Error("intent_study_original_row_mismatch");
    const plan={publication_id:saved.publication_id,ticket:source.ticket,operations:[{kind:"sql",sql:"UPDATE tenx_candidates SET payload=payload WHERE mode='live' AND address=?1",bindings:[staged.row.address]},{kind:"receipt"}]};
    await persistEvidencePublicationIntent(publication,journal,authority.current_grant,plan);
    const recoveryFile=path.join(target,"recovery-"+plan.publication_id+".json");await fs.writeFile(recoveryFile,JSON.stringify({publication,journal,grant:authority.current_grant,id:plan.publication_id})+"\n",{flag:"wx",mode:0o600});
    const child=await exec(process.execPath,["scripts/evidence-intent-restart-fixture.mjs",recoveryFile,"reconcile"],{timeout:30000,maxBuffer:100000}),result=JSON.parse(child.stdout),restored=await readEvidencePublicationIntent(publication,journal,authority.current_grant,plan.publication_id);
    if(!result.reconciled||result.state!=="committed"||!isDeepStrictEqual(result.results.map(row=>row.meta.changes),saved.result_changes)||!isDeepStrictEqual(restored.plan,plan))throw Error("intent_study_recovery_mismatch");
    cases.push({table:saved.table,publication_id:plan.publication_id,original_row_sha256:saved.original_row_sha256,result_changes:saved.result_changes,ready_sha256:restored.ready_sha256,original_plan_identical:true,fresh_process_reconciled:true});
  }
  if(await hashFile(database)!==before||await hashFile(authorityFile)!==authorityPin||await hashFile(stagingFile)!==stagingPin)throw Error("intent_study_frozen_inputs_changed");
  const report={version:"discovery-evidence-intent-study-v1",target_pin:targetPin,journal_context_pin:created.context_pin,authority_report_sha256:authorityPin,staging_report_sha256:stagingPin,target_database_sha256:before,cases,historical_committed_plan_reconstruction:true,actual_precommit_crash_evidence:false,fresh_processes:cases.length,target_bytes_unchanged:true,new_real_observations:0,provider_requests:0,database_writes:0,new_private_intent_files_written:true,runtime_activated:false,action_authority:false,evidence_qualified:false,free_acceptance:false,cpu_acceptance:false};
  const encoded=JSON.stringify(report,null,2)+"\n";await fs.writeFile(path.join(target,"restart-study.json"),encoded,{flag:"wx",mode:0o600});return {cases:cases.length,fresh_processes:cases.length,target_bytes_unchanged:true,report_sha256:sha(encoded),provider_requests:0,database_writes:0,runtime_activated:false};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))studyEvidenceIntents(process.argv.slice(2)).then(result=>console.log(JSON.stringify(result))).catch(()=>{console.error("Private frozen intent study held; check independent pins, current ownership and separate journal. No target adopted.");process.exitCode=1;});
