// Bounded private fault-test subprocess only; not an operator/runtime command.
import fs from "node:fs/promises";
import path from "node:path";
import {mock} from "node:test";
import {DatabaseSync} from "node:sqlite";
import {runCachedWalletCycleOnEvidenceTarget} from "./lib/evidence-wallet-cycle-target";
import {inspectCachedWalletJob} from "./lib/evidence-wallet-job";
import {publishEvidenceCohortBatch} from "./lib/evidence-cohort-publication";
import {publishLinkedCandidateBatch,recoverLinkedCandidateBatch} from "./lib/evidence-candidate-workflow";
import {evidenceRegularFile} from "./discovery-evidence-objects.mjs";
import {publishEvidenceProducerBatch,publishEvidenceCandidateMetadataBatch,publishEvidenceWalletCachedBatch,publishEvidenceWalletQuotaBatch,publishEvidenceWalletCycleBatch,publishEvidenceWalletCollectionBatch,publishEvidenceWalletDirectBatch,publishEvidenceWalletRecoveryBatch,publishEvidenceWalletSnapshotBatch,recoverLinkedWalletSnapshotBatch,recoverEvidenceProducerBatch} from "./lib/evidence-producer-publication";

const [file,mode]=process.argv.slice(2),info=await evidenceRegularFile(file!,65536),handle=await fs.open(info.file,"r");
let input;
try{const bytes=Buffer.alloc(info.bytes+1),read=await handle.read(bytes,0,bytes.length,0);if(read.bytesRead!==info.bytes||(await handle.stat()).size!==info.bytes)throw Error("fixture_input_size_changed");input=JSON.parse(bytes.subarray(0,read.bytesRead).toString("utf8"));}finally{await handle.close();}
globalThis.fetch=async()=>{throw Error("fixture_network_forbidden");};
// Only synthetic snapshot fault fixtures need a shared historical test clock:
// their lease must be current in this subprocess as well as in the parent.
// The actual publication coordinator always checks its own current clock.
if(input.plan_kind==="wallet_snapshot_cycle"&&input.batch?.stageId)mock.timers.enable({apis:["Date"],now:new Date(input.batch.cycle.at)});
if(input.plan_kind==="wallet_cached_cycle"){mock.timers.enable({apis:["Date"],now:new Date(input.batch.now)});mock.method(globalThis.crypto,"randomUUID",()=>input.job);}
if(mode==="ready_stop"||mode==="cohort_ready_stop"||mode==="job_ready_stop"){
  const open=fs.open;
  fs.open=async function(name,flags,...args){
    const file=await open(name,flags,...args);
    if(flags==="wx"&&String(name)===path.join(input.journal.directory,"pending",mode==="job_ready_stop"?input.batch.progressId:mode==="cohort_ready_stop"?input.batch.cohortId:input.batch.publicationId,"ready.json")){
      const sync=file.sync.bind(file);file.sync=async()=>{await sync();process.exit(mode==="job_ready_stop"?80:mode==="cohort_ready_stop"?77:75);};
    }
    return file;
  };
}
if(["job_lease_stop","job_checkpoint_stop","job_finish_stop"].includes(mode!)){
  const id=mode==="job_lease_stop"?input.batch.ids.lease:mode==="job_checkpoint_stop"?input.batch.checkpoints[0].publicationId:input.batch.ids.finish,original=DatabaseSync.prototype.exec;
  mock.method(DatabaseSync.prototype,"exec",function(this:DatabaseSync,sql:string){const stop=sql==="COMMIT"&&!!this.prepare("SELECT 1 FROM tenx_append_publications WHERE publication_id=?").get(id),result=original.call(this,sql);if(stop)process.exit(mode==="job_lease_stop"?81:mode==="job_checkpoint_stop"?82:83);return result;});
}
let outcome;
if(input.plan_kind==="wallet_cached_cycle")outcome=await runCachedWalletCycleOnEvidenceTarget(input.source,input.publication,input.journal,input.grant,input.batch);
else if(mode==="job_inspect")outcome=await inspectCachedWalletJob(input.publication,input.journal,input.grant,{progressId:input.id});
else if(mode==="submit"||mode==="ready_stop"||mode==="cohort_ready_stop"||mode==="commit_stop")outcome=await (input.plan_kind==="linked_candidate"?publishLinkedCandidateBatch:input.plan_kind==="candidate_cohorts"?publishEvidenceCohortBatch:input.plan_kind==="wallet_snapshot_cycle"?publishEvidenceWalletSnapshotBatch:input.plan_kind==="candidate_metadata"?publishEvidenceCandidateMetadataBatch:input.plan_kind==="wallet_cached_progress"?publishEvidenceWalletCachedBatch:input.plan_kind==="wallet_quota"?publishEvidenceWalletQuotaBatch:input.plan_kind==="wallet_cycle_control"?publishEvidenceWalletCycleBatch:input.plan_kind==="wallet_collection"?publishEvidenceWalletCollectionBatch:input.plan_kind==="wallet_direct_cycle"?publishEvidenceWalletDirectBatch:input.plan_kind==="wallet_reader_recovery"?publishEvidenceWalletRecoveryBatch:publishEvidenceProducerBatch)(input.publication,input.journal,input.grant,input.batch,mode==="commit_stop"?()=>{process.exit(76);}:undefined);
else if(mode==="linked_publish"||mode==="linked_reconcile")outcome=await recoverLinkedCandidateBatch(input.publication,input.journal,input.grant,{cohortId:input.id,mode:mode==="linked_publish"?"publish":"reconcile"});
else if(mode==="linked_snapshot_publish"||mode==="linked_snapshot_reconcile")outcome=await recoverLinkedWalletSnapshotBatch(input.publication,input.journal,input.grant,{cohortId:input.id,mode:mode==="linked_snapshot_publish"?"publish":"reconcile"});
else if(mode==="publish"||mode==="reconcile")outcome=await recoverEvidenceProducerBatch(input.publication,input.journal,input.grant,{publicationId:input.id,mode});
else throw Error("fixture_mode_invalid");
console.log(JSON.stringify(outcome));
