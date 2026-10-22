// Frozen private read rehearsal. Opens the existing publication target read-only.
import {open,writeFile,realpath} from "node:fs/promises";
import {createHash} from "node:crypto";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {z} from "zod";
import {hashFile} from "./discovery-archive.mjs";
import {evidenceRegularFile} from "./discovery-evidence-objects.mjs";
import {runEvidenceReadParity} from "./discovery-evidence-read-parity";
import {publicationEvidenceReadStore} from "./lib/evidence-publication-read-store";

const sha=(bytes:string|Uint8Array)=>createHash("sha256").update(bytes).digest("hex"),Hash=z.string().regex(/^[a-f0-9]{64}$/);
export async function studyEvidencePublicationReads(args:string[]){
  if(args.length!==15)throw Error("Expected ARCHIVE ARCHIVE_PIN CAPACITY CAPACITY_PIN REFERENCES REFERENCE_PIN SEALED KEY PUBLICATION_TARGET TARGET_PIN STAGE CONTEXT_PIN AUTHORITY_REPORT AUTHORITY_REPORT_PIN NEW_PRIVATE_OUTPUT");
  const [archive,archivePin,capacity,capacityPin,references,referencePin,sealed,keyFile,directory,targetPin,stageDirectory,contextPin,reportFile,reportPin,output]=args as [string,string,string,string,string,string,string,string,string,string,string,string,string,string,string];
  for(const pin of [archivePin,capacityPin,referencePin,targetPin,contextPin,reportPin])Hash.parse(pin);
  const root=await realpath(".tmp");if(path.dirname(path.resolve(output))!==root)throw Error("publication_read_study_standalone_output_required");
  const info=await evidenceRegularFile(reportFile,2*1024**2),handle=await open(info.file,"r");let bytes:Buffer;
  try{const buffer=Buffer.alloc(info.bytes+1),read=await handle.read(buffer,0,buffer.length,0);if(read.bytesRead!==info.bytes||(await handle.stat()).size!==info.bytes)throw Error("publication_read_study_authority_size_changed");bytes=buffer.subarray(0,read.bytesRead);}finally{await handle.close();}
  if(sha(bytes)!==reportPin)throw Error("publication_read_study_authority_pin_mismatch");
  const authority=JSON.parse(bytes.toString("utf8"));
  if(authority.version!=="discovery-evidence-publication-study-v1"||authority.target_pin!==targetPin||authority.capacity_pin!==capacityPin||authority.base_reference_pin!==referencePin)throw Error("publication_read_study_authority_context_mismatch");
  const grant=z.object({generation:z.string().uuid(),owner:z.string().uuid(),epoch:z.number().int().safe().positive()}).strict().parse(authority.current_grant),options={directory,targetPin,stage:{directory:stageDirectory,contextPin,keyFile}};
  const file=(await evidenceRegularFile(path.join(directory,"metadata.sqlite"),2*1024**3)).file,before=await hashFile(file),headerFile=(await evidenceRegularFile(path.join(directory,"publication.json"),4096)).file,headerBefore=await hashFile(headerFile);
  const parity=await runEvidenceReadParity([archive,archivePin,capacity,capacityPin,references,referencePin,sealed,keyFile,output],source=>publicationEvidenceReadStore(source,options,grant));
  if(await hashFile(file)!==before||await hashFile(headerFile)!==headerBefore||await hashFile(info.file)!==reportPin)throw Error("publication_read_study_target_changed");
  const report={version:"discovery-evidence-publication-read-study-v1",target_pin:targetPin,authority_report_sha256:reportPin,target_database_sha256:before,target_header_sha256:headerBefore,...parity,read_contract:"unified_frozen_and_published",target_unchanged:true,new_real_observations:0,synthetic_dynamic_coverage:"separate_tests",evidence_qualified:false,action_authority:false,operational_adoption_accepted:false,free_acceptance:false,cpu_acceptance:false};
  const encoded=JSON.stringify(report,null,2)+"\n";await writeFile(path.join(output,"publication-read.json"),encoded,{flag:"wx",mode:0o600});
  return {...report,publication_read_report_sha256:sha(encoded)};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))studyEvidencePublicationReads(process.argv.slice(2)).then(v=>console.log(JSON.stringify(v))).catch(()=>{console.error("Private unified read rehearsal held; check pinned sources, current ownership, exact reads and separate output. No runtime adopted.");process.exitCode=1;});
