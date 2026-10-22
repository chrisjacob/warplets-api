// Offline original cache-only funding continuation and completion. No RPC path.
import {z} from "zod";
import {continueCachedFunding,recordCachedFundingWork} from "../../discovery/src/funding-cache-work";
import {priorWalletEvidence} from "../../discovery/src/wallet-work";
import {expandedFundingScope,directFundingLimit} from "../../discovery/src/wallet-funding-scope";
import {loadFundingCheckpoints,fundingTask} from "../../discovery/src/funding-history";
import {CandidateSchema,type Candidate} from "../../discovery/src/model";
import {readEvidenceWalletMetadata} from "../discovery-evidence-publication.mjs";
import type {ScratchOptions} from "../discovery-evidence-scratch.mjs";
import {readWalletReplayReceipt} from "./evidence-wallet-replay-target";
import {ProducerStatements,type ProducerStatement} from "./evidence-producer-plan";
import {publishEvidenceWalletCachedBatch,type ProducerPublication,type ProducerJournal,type ProducerGrant,type ProducerPublicationOutcome} from "./evidence-producer-publication";
import {cachedCheckpointSql,cachedFinishSql} from "../evidence-wallet-cached-sql.mjs";

const Id=z.string().uuid(),Checkpoint=z.object({wallet:z.string().min(1).max(4096),anchorSignature:z.string().min(1).max(4096),publicationId:Id}).strict();
export type WalletCachedTargetInput={candidate:Candidate;owner:string;now:string;started:string;finishPublicationId:string;checkpoints:z.infer<typeof Checkpoint>[]};
const inactive=()=>({provider_requests:0,runtime_activated:false,action_authority:false,evidence_qualified:false,free_acceptance:false} as const);

export async function continueCachedFundingOnEvidenceTarget(source:ScratchOptions,publication:ProducerPublication,journal:ProducerJournal,grant:ProducerGrant,input:WalletCachedTargetInput){
  const publications:ProducerPublicationOutcome[]=[];let phase:"preflight"|"projection"|"checkpoint"|"completion"="preflight";
  try{
    const saved=structuredClone({source,publication,journal,grant,input}),request=z.object({candidate:CandidateSchema,owner:z.string().min(1).max(4096),now:z.string().datetime(),started:z.string().datetime(),finishPublicationId:Id,checkpoints:Checkpoint.array().max(20)}).strict().parse(saved.input);
    request.candidate=saved.input.candidate;
    if(request.candidate.mode!=="live"||!request.candidate.wallet_analysis)throw Error("wallet_cached_live_required");
    const ids=[request.finishPublicationId,...request.checkpoints.map(c=>c.publicationId)],keys=request.checkpoints.map(c=>JSON.stringify([c.wallet,c.anchorSignature]));if(new Set(ids).size!==ids.length||new Set(keys).size!==keys.length)throw Error("wallet_cached_identity_duplicate");
    const owned=new WeakMap<object,ProducerStatement>(),used=new Set<string>();
    async function publish(id:string,rows:ProducerStatement[]){const outcome=await publishEvidenceWalletCachedBatch(saved.publication,saved.journal,saved.grant,{publicationId:id,statements:rows});publications.push(outcome);if(outcome.state!=="committed")throw Error("wallet_cached_publication_unconfirmed");return outcome.results;}
    function prepare(sql:string,bindings:unknown[]=[]):D1PreparedStatement{
      const statement={bind:(...values:unknown[])=>prepare(sql,[...values]),async first(column?:string){
        if(column!==undefined)throw Error("wallet_cached_column_unsupported");
        if(sql==="SELECT payload_hash,address,payload,observed_at FROM tenx_wallet_evidence WHERE payload_hash=?1 AND address=?2"&&bindings.length===2)return readWalletReplayReceipt(saved.source,saved.publication,saved.grant,String(bindings[0]),String(bindings[1]));
        if(sql==="SELECT payload,payload_hash,fetched_at FROM tenx_wallet_transactions WHERE signature=?1"&&bindings.length===1)return (await readEvidenceWalletMetadata(saved.publication,saved.grant,{kind:"transaction",signature:bindings[0]})).row;
        for(const [hop,table] of [["direct","tenx_funding_scans"],["second","tenx_second_hop_scans"]])if(sql===`SELECT payload,payload_hash FROM ${table} WHERE address=?1 AND wallet=?2 AND anchor_signature=?3`&&bindings.length===3)return (await readEvidenceWalletMetadata(saved.publication,saved.grant,{kind:"checkpoint",hop,address:bindings[0],wallet:bindings[1],anchor_signature:bindings[2]})).row;
        throw Error("wallet_cached_read_unsupported");
      },async run(){
        if(sql!==cachedCheckpointSql||bindings.length!==9||bindings[3]!==request.candidate.address)throw Error("wallet_cached_write_unsupported");phase="checkpoint";
        const identity=request.checkpoints.find(c=>c.wallet===bindings[4]&&c.anchorSignature===bindings[5]);if(!identity||used.has(identity.publicationId))throw Error("wallet_cached_checkpoint_identity_required");used.add(identity.publicationId);
        return (await publish(identity.publicationId,ProducerStatements.parse([{sql,bindings}])))[0];
      }};owned.set(statement,{sql,bindings:bindings as ProducerStatement["bindings"]});return statement as unknown as D1PreparedStatement;
    }
    const db={prepare,async batch(statements:D1PreparedStatement[]){
      phase="completion";const rows=ProducerStatements.parse(statements.map(statement=>{const row=owned.get(statement);if(!row)throw Error("wallet_cached_foreign_statement");return row;}));
      if(rows.length!==4||rows.some((row,i)=>row.sql!==cachedFinishSql[i]))throw Error("wallet_cached_finish_unsupported");return publish(request.finishPublicationId,rows);
    }} as unknown as D1Database;
    // Require stable IDs for the complete admitted scope BEFORE any checkpoint
    // can advance. Extra retained identities remain usable after partial work.
    const retained=await priorWalletEvidence(db,request.candidate);if(!retained)throw Error("wallet_cached_receipt_required");
    const prepared=await expandedFundingScope(db,retained),required=prepared.funding_scans;
    if(!required?.length||required.some(scan=>!request.checkpoints.some(c=>c.wallet===scan.wallet&&c.anchorSignature===scan.anchor.signature)))throw Error("wallet_cached_checkpoint_identity_required");
    const baseline=await loadFundingCheckpoints(db,request.candidate.address,required.map(scan=>scan.anchor),false,directFundingLimit(prepared)),examined=baseline.map(fundingTask).filter(task=>task.coverage.status==="window_examined").length;
    phase="projection";const progress=await continueCachedFunding(db,request.candidate,request.owner,new Date(request.now));
    const recorded=await recordCachedFundingWork(db,request.candidate,request.owner,request.started,progress,Math.max(0,progress.examined_windows-examined));
    return {state:"completed" as const,progress,recorded,publications,...inactive()};
  }catch(error){return {state:"held" as const,code:"wallet_cached_target_held",reason:error instanceof Error&&/^[a-z0-9_]{1,80}$/.test(error.message)?error.message:"wallet_cached_not_certified",phase,publications,...inactive()};}
}
