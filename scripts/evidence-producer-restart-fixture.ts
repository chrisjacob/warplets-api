// Bounded private fault-test subprocess only; not an operator/runtime command.
import fs from "node:fs/promises";
import path from "node:path";
import {evidenceRegularFile} from "./discovery-evidence-objects.mjs";
import {publishEvidenceProducerBatch,publishEvidenceCandidateMetadataBatch,publishEvidenceWalletCachedBatch,publishEvidenceWalletQuotaBatch,publishEvidenceWalletCycleBatch,publishEvidenceWalletCollectionBatch,publishEvidenceWalletDirectBatch,recoverEvidenceProducerBatch} from "./lib/evidence-producer-publication";

const [file,mode]=process.argv.slice(2),info=await evidenceRegularFile(file!,65536),handle=await fs.open(info.file,"r");
let input;
try{const bytes=Buffer.alloc(info.bytes+1),read=await handle.read(bytes,0,bytes.length,0);if(read.bytesRead!==info.bytes||(await handle.stat()).size!==info.bytes)throw Error("fixture_input_size_changed");input=JSON.parse(bytes.subarray(0,read.bytesRead).toString("utf8"));}finally{await handle.close();}
globalThis.fetch=async()=>{throw Error("fixture_network_forbidden");};
if(mode==="ready_stop"){
  const open=fs.open;
  fs.open=async function(name,flags,...args){
    const file=await open(name,flags,...args);
    if(flags==="wx"&&String(name)===path.join(input.journal.directory,"pending",input.batch.publicationId,"ready.json")){
      const sync=file.sync.bind(file);file.sync=async()=>{await sync();process.exit(75);};
    }
    return file;
  };
}
let outcome;
if(mode==="submit"||mode==="ready_stop"||mode==="commit_stop")outcome=await (input.plan_kind==="candidate_metadata"?publishEvidenceCandidateMetadataBatch:input.plan_kind==="wallet_cached_progress"?publishEvidenceWalletCachedBatch:input.plan_kind==="wallet_quota"?publishEvidenceWalletQuotaBatch:input.plan_kind==="wallet_cycle_control"?publishEvidenceWalletCycleBatch:input.plan_kind==="wallet_collection"?publishEvidenceWalletCollectionBatch:input.plan_kind==="wallet_direct_cycle"?publishEvidenceWalletDirectBatch:publishEvidenceProducerBatch)(input.publication,input.journal,input.grant,input.batch,mode==="commit_stop"?()=>{process.exit(76);}:undefined);
else if(mode==="publish"||mode==="reconcile")outcome=await recoverEvidenceProducerBatch(input.publication,input.journal,input.grant,{publicationId:input.id,mode});
else throw Error("fixture_mode_invalid");
console.log(JSON.stringify(outcome));
