// Private offline comparison only. This does not choose or activate a runtime backend.
import {DatabaseSync} from "node:sqlite";
import {mkdir,lstat,realpath,writeFile} from "node:fs/promises";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {createHash} from "node:crypto";
import {verifyArchive,hashFile} from "./discovery-archive.mjs";
import {evidencePrivatePath,evidenceRegularFile} from "./discovery-evidence-objects.mjs";
import {withScratchEvidenceResolver} from "./discovery-evidence-scratch.mjs";
import {scratchEvidenceReadStore} from "./lib/evidence-scratch-read-store";
import {d1EvidenceReadStore,type EvidenceReadStore} from "../discovery/src/evidence-read-store";
import {holderAcquisitionInputsFromStore} from "../discovery/src/holder-acquisition-store";
import {reviewHolderAcquisitionData} from "../discovery/src/holder-acquisition";
import {reviewHolderParticipationContext} from "../discovery/src/holder-participation";
import {reviewTradeSampleContext} from "../discovery/src/trade-sample";
import {hashJson} from "../discovery/src/solana";
import {sqliteD1} from "../app/functions/_lib/sqliteTestDb";
import {priorWalletEvidenceFromStore} from "../discovery/src/wallet-work";
import {walletHolderInputFromStore} from "../discovery/src/wallet-cycle";
import {CandidateSchema} from "../discovery/src/model";

const sha=(v:string)=>createHash("sha256").update(v).digest("hex");
async function outcome(store:EvidenceReadStore,address:string,at:Date){
  try{
    const inputs=await holderAcquisitionInputsFromStore(store,address,at),context=await reviewHolderAcquisitionData(inputs);
    const participation=await reviewHolderParticipationContext(context),trades=await reviewTradeSampleContext(context);
    return {state:"reviewed" as const,input_hash:await hashJson(inputs),history_hash:context.history.report_hash,acquisition_hash:context.report.report_hash,participation_hash:await hashJson(participation),trade_hash:await hashJson(trades),meaningful_growth_held:participation.meaningful_holder_growth_24h===null,organic_demand_held:!participation.organic_demand_certified};
  }catch(e){return{state:"held" as const,error_name:e instanceof Error?e.name:"unknown",error_sha256:sha(e instanceof Error?e.message:String(e))};}
}
export async function runEvidenceReadParity(args:string[]){
  if(args.length!==9)throw Error("Usage: ARCHIVE ARCHIVE_PIN CAPACITY CAPACITY_PIN REFERENCES REFERENCE_PIN SEALED KEY NEW_PRIVATE_OUTPUT");
  const [archiveDirectory,archivePin,capacityDirectory,capacityPin,referenceDirectory,referencePin,sealedDirectory,keyFile,target]=args as [string,string,string,string,string,string,string,string,string];
  const source=await evidencePrivatePath(archiveDirectory),output=await evidencePrivatePath(target,true),root=await realpath(".tmp");
  for(let parent=path.dirname(output);parent===root||parent.startsWith(root+path.sep);parent=path.dirname(parent)){
    for(const marker of ["manifest.json","pack.json","objects.json","sealed.json","index.json","references.json","capacity.json","replay.json","metadata-sealed.json","metadata-restored.json","read-parity.json","key-backup.json","wrapping.json","restore.json"]){
      try{await lstat(path.join(parent,marker));}catch(e){if((e as NodeJS.ErrnoException).code==="ENOENT")continue;throw e;}throw Error("read_parity_separate_output_required");
    }if(parent===root)break;
  }
  const saved=await evidenceRegularFile(path.join(source,"discovery.sqlite"),2*1024**3),archive=await verifyArchive(source,archivePin);
  await mkdir(output,{mode:0o700});
  const sqlite=new DatabaseSync(saved.file,{readOnly:true});let network=0;const previousFetch=globalThis.fetch;
  globalThis.fetch=async()=>{network++;throw Error("read_parity_network_blocked");};
  try{
    sqlite.exec("PRAGMA query_only=ON; PRAGMA trusted_schema=OFF; BEGIN");
    const result=await withScratchEvidenceResolver({capacityDirectory,capacityPin,referenceDirectory,referencePin,sealedDirectory,keyFile},async reader=>{
      if(reader.capacity.source_archive_manifest_sha256!==archivePin||reader.capacity.source_database_sha256!==archive.database.sha256)throw Error("read_parity_archive_context_mismatch");
      // One cutoff per retained evidence address, fixed before report/outcome inspection.
      const cases=sqlite.prepare(`SELECT address,max(observed_at) AS latest FROM (
        SELECT address,observed_at FROM tenx_holder_evidence UNION ALL SELECT address,observed_at FROM tenx_wallet_evidence)
        GROUP BY address ORDER BY address LIMIT 1001`).all();
      if(!cases.length||cases.length>1000)throw Error("read_parity_population_bound");
      const ordinary=d1EvidenceReadStore(sqliteD1(sqlite)),compact=scratchEvidenceReadStore(reader),comparisons=[];
      for(const item of cases){
        const address=String(item.address),cutoff=new Date(Date.parse(String(item.latest))+300000);
        if(!Number.isFinite(cutoff.getTime()))throw Error("read_parity_cutoff_invalid");
        const before=await outcome(ordinary,address,cutoff),after=await outcome(compact,address,cutoff);
        // Compare complete success/held results, not just a shared boolean or error category.
        if(await hashJson(before)!==await hashJson(after))throw Error("read_parity_semantics_mismatch");
        comparisons.push({address,cutoff_at:cutoff.toISOString(),...after,identical:true});
      }
      const receipts=[];
      for(const table of ["tenx_holder_evidence","tenx_wallet_evidence"] as const){
        const entries=sqlite.prepare(`SELECT payload_hash FROM ${table} ORDER BY payload_hash LIMIT 10001`).all();
        if(entries.length>10000)throw Error("read_parity_receipt_bound");
        for(const entry of entries){
          const hash=String(entry.payload_hash),read=table==="tenx_holder_evidence"?"holderReceipt":"walletReceipt",before=await ordinary[read](hash),after=await compact[read](hash);
          if(!before||!after||await hashJson(before)!==await hashJson(after))throw Error("read_parity_raw_receipt_mismatch");
          receipts.push({table,payload_hash:hash,row_sha256:await hashJson(after),identical:true});
        }
      }
      const continuations=[],columns=sqlite.prepare("PRAGMA table_info(tenx_candidates)").all();
      // Minimal synthetic legacy fixtures may lack payload; real candidate stores must compare every retained row.
      if(columns.some(c=>c.name==="payload")){
        const inventory=sqlite.prepare("SELECT count(*) AS n,max(length(CAST(payload AS BLOB))) AS maximum FROM tenx_candidates").get()!,count=Number(inventory.n);if(count>1000)throw Error("read_parity_candidate_bound");
        if(Number(inventory.maximum)>1900000)throw Error("read_parity_candidate_byte_bound");
        // Keep only one bounded candidate body while replaying; do not materialize the full table.
        for(const saved of sqlite.prepare("SELECT payload,length(CAST(payload AS BLOB)) AS bytes FROM tenx_candidates ORDER BY address").iterate()){
          if(Number(saved.bytes)>1900000)throw Error("read_parity_candidate_byte_bound");
          const candidate=CandidateSchema.parse(JSON.parse(String(saved.payload)));
          const evaluate=async(store:EvidenceReadStore)=>{
            try{return{state:"reviewed",wallet_hash:await hashJson(await priorWalletEvidenceFromStore(store,candidate)),holder_hash:await hashJson(await walletHolderInputFromStore(store,candidate))};}
            catch(e){return{state:"held",error_name:e instanceof Error?e.name:"unknown",error_sha256:sha(e instanceof Error?e.message:String(e))};}
          };
          const before=await evaluate(ordinary),after=await evaluate(compact);if(await hashJson(before)!==await hashJson(after))throw Error("read_parity_continuation_mismatch");
          continuations.push({address:candidate.address,...after,identical:true});
        }
        if(continuations.length!==count)throw Error("read_parity_candidate_population_changed");
      }
      return {cases:comparisons,receipts,continuations,candidate_payload_column_present:columns.some(c=>c.name==="payload")};
    });
    if(network||sqlite.prepare("SELECT total_changes() AS n").get()!.n!==0||await hashFile(saved.file)!==archive.database.sha256)throw Error("read_parity_source_changed");
    await verifyArchive(source,archivePin);
    const rows=result.value.cases,report={version:"discovery-evidence-read-parity-v2",source_archive_manifest_sha256:archivePin,capacity_manifest_sha256:capacityPin,reference_manifest_sha256:referencePin,
      selection:"all_retained_evidence_addresses_latest_receipt_plus_5m",cases:rows,reviewed:rows.filter(r=>r.state==="reviewed").length,held:rows.filter(r=>r.state==="held").length,
      receipt_comparisons:result.value.receipts,continuations:result.value.continuations,candidate_payload_column_present:result.value.candidate_payload_column_present,
      statistics:result.statistics,all_cases_identical:true,original_file_unchanged:true,provider_requests:0,database_writes:0,runtime_activated:false,operational_adoption_accepted:false,free_acceptance:false};
    const bytes=JSON.stringify(report,null,2)+"\n";if(Buffer.byteLength(bytes)>2*1024**2)throw Error("read_parity_report_bound");
    await writeFile(path.join(output,"read-parity.json"),bytes,{flag:"wx",mode:0o600});
    return {report_file_sha256:sha(bytes),cases:rows.length,reviewed:report.reviewed,held:report.held,receipts:report.receipt_comparisons.length,continuations:report.continuations.length,continuations_held:report.continuations.filter(c=>c.state==="held").length,all_cases_identical:true,...result.statistics,provider_requests:0,database_writes:0,runtime_activated:false};
  }finally{globalThis.fetch=previousFetch;sqlite.close();}
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))runEvidenceReadParity(process.argv.slice(2)).then(r=>console.log(JSON.stringify(r,null,2))).catch(()=>{console.error("Private evidence read comparison held; check independent source pins, exact read contracts and separate private output. No backend activated.");process.exitCode=1;});
