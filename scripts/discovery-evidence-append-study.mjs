// Bounded private study of admitted frozen receipts; no publication or live IO.
import fs from "node:fs/promises";
import path from "node:path";
import {createHash,randomUUID} from "node:crypto";
import {fileURLToPath} from "node:url";
import {evidencePrivatePath} from "./discovery-evidence-objects.mjs";
import {withScratchEvidenceResolver} from "./discovery-evidence-scratch.mjs";
import {createEvidenceAppendStage,stageEvidenceAppend,readStagedEvidenceAppend} from "./discovery-evidence-append-stage.mjs";
const digest=value=>createHash("sha256").update(JSON.stringify(value)).digest("hex");
export async function studyEvidenceAppendStaging(args){
  if(args.length!==7)throw Error("Expected capacityDirectory capacityPin referenceDirectory referencePin sealedDirectory keyFile NEW-output");
  const [capacityDirectory,capacityPin,referenceDirectory,referencePin,sealedDirectory,keyFile,target]=args,output=await evidencePrivatePath(target,true);
  if(path.dirname(output)!==await fs.realpath(".tmp"))throw Error("Standalone private .tmp output required");
  const checked=await withScratchEvidenceResolver({capacityDirectory,capacityPin,referenceDirectory,referencePin,sealedDirectory,keyFile},async reader=>{
    const selected=[];
    for(const table of ["tenx_holder_evidence","tenx_wallet_evidence"]){
      const population=reader.sqlite.prepare(`SELECT count(*) AS n FROM ${table}`).get().n;if(population>10000)throw Error("append_study_population_bound");
      let smallest,largest,count=0;
      for(const row of reader.sqlite.prepare(`SELECT payload_hash FROM ${table} ORDER BY payload_hash`).iterate()){
        const meta=reader.describe(table,row.payload_hash);if(!smallest||meta.bytes<smallest.bytes)smallest={key:row.payload_hash,bytes:meta.bytes};if(!largest||meta.bytes>largest.bytes)largest={key:row.payload_hash,bytes:meta.bytes};count++;
      }
      if(count!==population)throw Error("append_study_incomplete_enumeration");
      if(smallest)selected.push({table,...smallest});if(largest&&largest.key!==smallest.key)selected.push({table,...largest});
    }
    if(selected.length!==4)throw Error("Expected distinct smallest/largest holder and wallet receipts");
    await fs.mkdir(output,{mode:0o700});const created=await createEvidenceAppendStage({target:path.join(output,"stage"),keyFile,generation:randomUUID(),sourceArchivePin:reader.capacity.source_archive_manifest_sha256,baseReferencePin:referencePin}),options={directory:path.join(output,"stage"),contextPin:created.context_pin,keyFile},cases=[];
    for(const selectedRow of selected){
      const row=await reader.resolve(selectedRow.table,selectedRow.key),item={stageId:randomUUID(),table:selectedRow.table,row},staged=await stageEvidenceAppend(options,item),read=await readStagedEvidenceAppend(options,staged.ticket),retry=await stageEvidenceAppend(options,item);
      if(read.table!==selectedRow.table||digest(row)!==digest(read.row)||!retry.reused||digest(staged.ticket)!==digest(retry.ticket)||read.published||read.evidence_admitted)throw Error("append_study_parity_failed");
      cases.push({table:selectedRow.table,identity:row.payload_hash,raw_payload_bytes:Buffer.byteLength(row.payload),original_row_sha256:digest(row),staged_row_sha256:digest(read.row),identical:true,retry_reused:true,ticket:staged.ticket,encrypted_bytes:read.ciphertext_bytes});
    }
    return {context_pin:created.context_pin,cases};
  });
  const report={version:"discovery-evidence-append-study-v1",capacity_pin:capacityPin,base_reference_pin:referencePin,...checked.value,statistics:checked.statistics,source_session_final_checks_passed:true,provider_requests:0,database_writes:0,staging_files_written:13,published:false,evidence_admitted:false,runtime_activated:false,action_authority:false,free_acceptance:false,cpu_acceptance:false};
  await fs.writeFile(path.join(output,"staging.json"),JSON.stringify(report,null,2)+"\n",{flag:"wx",mode:0o600});
  return {cases:report.cases.length,all_identical:true,retries_reused:true,raw_payload_bytes:report.cases.reduce((n,c)=>n+c.raw_payload_bytes,0),encrypted_bytes:report.cases.reduce((n,c)=>n+c.encrypted_bytes,0),provider_requests:0,database_writes:0,published:false,runtime_activated:false};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))studyEvidenceAppendStaging(process.argv.slice(2)).then(value=>console.log(JSON.stringify(value))).catch(error=>{console.error(error.message);process.exitCode=1;});
