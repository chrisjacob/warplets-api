// Offline historical study. No worker, live database, provider access or adoption.
import {mkdir,lstat,realpath,writeFile} from "node:fs/promises";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {createHash} from "node:crypto";
import {withScratchEvidenceResolver} from "./discovery-evidence-scratch.mjs";
import {evidencePrivatePath} from "./discovery-evidence-objects.mjs";
import {scratchCandidateReplayer,ScratchReplayError} from "./lib/evidence-scratch-replay";
import {ScoreCohortSchema} from "../discovery/src/score-research-model";
import {replayScoreCohort} from "../discovery/src/score-research-analysis";
import {electionRecord,replayElection} from "../discovery/src/elections";
import {hashJson} from "../discovery/src/solana";
import {sqliteD1} from "../app/functions/_lib/sqliteTestDb";

async function newOutput(target:string){
  const output=await evidencePrivatePath(target,true),root=await realpath(".tmp");
  for(let parent=path.dirname(output);parent===root||parent.startsWith(root+path.sep);parent=path.dirname(parent)){
    for(const marker of ["manifest.json","pack.json","objects.json","sealed.json","index.json","references.json","capacity.json","replay.json"]){
      try{await lstat(path.join(parent,marker));}catch(e){if((e as NodeJS.ErrnoException).code==="ENOENT")continue;throw e;}throw Error("scratch_separate_output_required");
    }if(parent===root)break;
  }
  return output;
}
export async function runScratchReplay(args:string[]){
  if(args.length!==7)throw Error("Usage: CAPACITY CAPACITY_PIN REFERENCES REFERENCE_PIN SEALED KEY NEW_PRIVATE_DIRECTORY");
  const [capacityDirectory,capacityPin,referenceDirectory,referencePin,sealedDirectory,keyFile,target]=args as [string,string,string,string,string,string,string],output=await newOutput(target);
  // Reserve a new private output before work; failed attempts remain as partial artifacts.
  await mkdir(output,{mode:0o700});let outbound=0;const originalFetch=globalThis.fetch;
  globalThis.fetch=async()=>{outbound++;throw Error("scratch_network_blocked");};
  try{
    const result=await withScratchEvidenceResolver({capacityDirectory,capacityPin,referenceDirectory,referencePin,sealedDirectory,keyFile},async reader=>{
      const sqlite=reader.sqlite,db=sqliteD1(sqlite),replayer=scratchCandidateReplayer(reader),cohorts=[],elections=[];
      const cohortCount=sqlite.prepare("SELECT count(*) AS n FROM tenx_score_cohorts").get()!.n as number,electionCount=sqlite.prepare("SELECT count(*) AS n FROM tenx_election_runs").get()!.n as number;
      if(!cohortCount||!electionCount)throw Error("scratch_replay_population_missing");
      if(cohortCount>10000||electionCount>1000)throw Error("scratch_record_bound");
      for(const saved of sqlite.prepare("SELECT payload FROM tenx_score_cohorts ORDER BY model,captured_at,address").iterate()){
        if(typeof saved.payload!=="string"||Buffer.byteLength(saved.payload)>1900000)throw Error("scratch_cohort_byte_bound");
        const original=ScoreCohortSchema.parse(JSON.parse(saved.payload));await replayScoreCohort(original);
        let held:string|null=null;try{
          const rebuilt=structuredClone(original);rebuilt.scorecard.inputs.candidate=await replayer.rebuild(original.scorecard.inputs.candidate,original.scorecard.inputs.as_of);
          await replayScoreCohort(rebuilt);if(await hashJson(rebuilt)!==await hashJson(original))throw new ScratchReplayError("scratch_cohort_hash_mismatch");
        }catch(e){held=e instanceof ScratchReplayError?e.message:"scratch_source_or_analysis_held";}
        cohorts.push({model:original.summary.score.version,cohort_hash:original.summary.cohort_hash,original_replay:"verified",reconstructed_replay:held?"held":"verified",held_reason:held});
      }
      for(const saved of sqlite.prepare("SELECT id FROM tenx_election_runs ORDER BY created_at,id").iterate()){
        const original=await electionRecord(db,String(saved.id));if(!original)throw Error("scratch_election_missing");
        let held:string|null=null;try{
          const rebuilt=structuredClone(original);for(let i=0;i<rebuilt.inputs.candidates.length;i++)rebuilt.inputs.candidates[i]=await replayer.rebuild(original.inputs.candidates[i]!,original.inputs.as_of);
          await replayElection(rebuilt);if(await hashJson(rebuilt)!==await hashJson(original))throw new ScratchReplayError("scratch_election_hash_mismatch");
        }catch(e){held=e instanceof ScratchReplayError?e.message:"scratch_source_or_analysis_held";}
        elections.push({record_hash:original.record_hash,input_hash:original.input_hash,result_hash:original.result_hash,candidates:original.inputs.candidates.length,original_replay:"verified",reconstructed_replay:held?"held":"verified",held_reason:held});
      }
      if(cohorts.length!==cohortCount||elections.length!==electionCount)throw Error("scratch_incomplete_record_population");
      return {source_archive_manifest_sha256:reader.capacity.source_archive_manifest_sha256,cohorts,elections,analysis:replayer.statistics()};
    });
    if(outbound)throw Error("scratch_outbound_attempted");
    const holds=[...result.value.cohorts,...result.value.elections].filter(r=>r.reconstructed_replay==="held").length;
    const body={version:"discovery-evidence-scratch-replay-v1",capacity_manifest_sha256:capacityPin,reference_manifest_sha256:referencePin,...result,status:holds?"held":"verified",
      reconstructed_records_held:holds,network_attempts:outbound,production_adoption_accepted:false,cpu_acceptance:false,free_acceptance:false};
    const serialized=JSON.stringify(body,null,2)+"\n";if(Buffer.byteLength(serialized)>4*1024**2)throw Error("scratch_report_bound");
    await writeFile(path.join(output,"replay.json"),serialized,{flag:"wx",mode:0o600});
    return {report_file_sha256:createHash("sha256").update(serialized).digest("hex"),status:body.status,cohorts:result.value.cohorts.length,elections:result.value.elections.length,held_records:holds,...result.statistics,provider_requests:0,database_writes:0,runtime_activated:false};
  }finally{globalThis.fetch=originalFetch;}
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))runScratchReplay(process.argv.slice(2)).then(r=>console.log(JSON.stringify(r,null,2))).catch(()=>{console.error("Private scratch replay held; check retained source pins, separate key, metadata and original evidence. Partial outputs retained; no runtime activated.");process.exitCode=1;});
