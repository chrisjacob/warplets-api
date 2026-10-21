// Private frozen-data publication rehearsal; never a live store or cutover.
import fs from "node:fs/promises";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {DatabaseSync} from "node:sqlite";
import {createHash,randomUUID} from "node:crypto";
import {isDeepStrictEqual} from "node:util";
import {evidenceRegularFile} from "./discovery-evidence-objects.mjs";
import {withScratchEvidenceResolver} from "./discovery-evidence-scratch.mjs";
import {readStagedEvidenceAppend} from "./discovery-evidence-append-stage.mjs";
import {metadataValueInventory} from "./discovery-metadata-capacity.mjs";
import {createEvidencePublicationTarget,publishEvidenceAppend,transferEvidencePublicationOwner} from "./discovery-evidence-publication.mjs";
const sha=b=>createHash("sha256").update(b).digest("hex"),digest=v=>sha(JSON.stringify(v));
export async function studyEvidencePublication(args){
  if(args.length!==11)throw Error("Expected capacityDirectory capacityPin referenceDirectory referencePin sealedDirectory keyFile stageDirectory contextPin stagingReport stagingReportSHA256 NEW-target");
  const [capacityDirectory,capacityPin,referenceDirectory,referencePin,sealedDirectory,keyFile,directory,contextPin,reportFile,reportPin,target]=args,source={capacityDirectory,capacityPin,referenceDirectory,referencePin,sealedDirectory,keyFile},stage={directory,contextPin,keyFile};
  const info=await evidenceRegularFile(reportFile,2*1024**2),handle=await fs.open(info.file,"r");let input;
  try{const bytes=Buffer.alloc(info.bytes+1),read=await handle.read(bytes,0,bytes.length,0);if(read.bytesRead!==info.bytes||sha(bytes.subarray(0,read.bytesRead))!==reportPin)throw Error("publication_study_input_pin_mismatch");input=JSON.parse(bytes.subarray(0,read.bytesRead));}finally{await handle.close();}
  if(input.context_pin!==contextPin||input.capacity_pin!==capacityPin||input.base_reference_pin!==referencePin||input.cases?.length!==4)throw Error("publication_study_input_mismatch");
  const created=await createEvidencePublicationTarget({target,source,stage,owner:randomUUID()}),options={directory:target,targetPin:created.target_pin,stage};
  const checked=await withScratchEvidenceResolver(source,async reader=>{
    const cases=[],plans=[];
    for(const entry of input.cases){
      const staged=await readStagedEvidenceAppend(stage,entry.ticket),original=await reader.resolve(staged.table,staged.row.payload_hash);
      if(staged.table!==entry.table||digest(original)!==entry.original_row_sha256||digest(staged.row)!==digest(original))throw Error("publication_study_original_row_mismatch");
      const plan={publication_id:randomUUID(),ticket:entry.ticket,operations:[{kind:"sql",sql:"UPDATE tenx_candidates SET payload=payload WHERE mode='live' AND address=?1",bindings:[original.address]},{kind:"receipt"}]},published=await publishEvidenceAppend(options,created.grant,plan);
      if(published.state!=="committed"||published.reconciled||published.results[1].meta.changes!==0)throw Error("publication_study_base_semantics_mismatch");plans.push(plan);cases.push({table:entry.table,identity:original.payload_hash,original_row_sha256:digest(original),base_receipt_changes:0,result_changes:published.results.map(r=>r.meta.changes),publication_id:plan.publication_id});
    }
    const next=await transferEvidencePublicationOwner(options,created.grant,randomUUID());let fenced=false;try{await publishEvidenceAppend(options,created.grant,plans[0]);}catch(error){if(error.message==="publication_owner_fenced")fenced=true;else throw error;}
    if(!fenced)throw Error("publication_study_stale_owner_accepted");
    for(const plan of plans)if(!(await publishEvidenceAppend(options,next.grant,plan)).reconciled)throw Error("publication_study_reconciliation_failed");
    const db=new DatabaseSync(path.join(target,"metadata.sqlite"),{readOnly:true});let tables,rows,publicationRows,referenceRows,baseRows;
    try{
      db.exec("PRAGMA query_only=ON; BEGIN");const all=metadataValueInventory(db),expected=reader.capacity.inventory.map(({table,columns,rows,values_sha256})=>({table,columns,rows,values_sha256})),original=all.filter(t=>expected.some(e=>e.table===t.table));
      if(!isDeepStrictEqual(original,expected)||db.prepare("PRAGMA integrity_check").get().integrity_check!=="ok"||db.prepare("PRAGMA foreign_key_check").all().length)throw Error("publication_study_original_metadata_changed");
      tables=original.length;rows=original.reduce((n,t)=>n+t.rows,0);publicationRows=db.prepare("SELECT count(*) AS n FROM tenx_append_publications").get().n;referenceRows=db.prepare("SELECT count(*) AS n FROM tenx_append_references").get().n;baseRows=db.prepare("SELECT count(*) AS n FROM tenx_append_base").get().n;
    }finally{db.close();}
    return {cases,original_tables:tables,original_rows:rows,all_original_typed_values_identical:true,base_receipts:baseRows,committed_publications:publicationRows,new_dynamic_references:referenceRows,stale_owner_fenced:true,current_owner_reconciled:true,current_grant:next.grant};
  });
  const report={version:"discovery-evidence-publication-study-v1",target_pin:created.target_pin,capacity_pin:capacityPin,base_reference_pin:referencePin,source_staging_report_sha256:reportPin,...checked.value,statistics:checked.statistics,target_database_bytes:(await fs.stat(path.join(target,"metadata.sqlite"))).size,source_session_final_checks_passed:true,private_target_database_writes:true,live_database_writes:0,provider_requests:0,runtime_activated:false,action_authority:false,evidence_qualified:false,free_acceptance:false,cpu_acceptance:false};
  const bytes=JSON.stringify(report,null,2)+"\n";await fs.writeFile(path.join(target,"rehearsal.json"),bytes,{flag:"wx",mode:0o600});
  return {cases:report.cases.length,original_tables:report.original_tables,original_rows:report.original_rows,all_original_typed_values_identical:true,committed_publications:report.committed_publications,stale_owner_fenced:true,current_owner_reconciled:true,target_database_bytes:report.target_database_bytes,report_sha256:sha(bytes),live_database_writes:0,provider_requests:0,runtime_activated:false};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))studyEvidencePublication(process.argv.slice(2)).then(v=>console.log(JSON.stringify(v))).catch(e=>{console.error(e.message);process.exitCode=1;});
