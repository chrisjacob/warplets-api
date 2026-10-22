// Offline original candidate-save workflow only. Not an exported D1 backend.
import {z} from "zod";
import {saveCandidate} from "../../discovery/src/store";
import type {Candidate} from "../../discovery/src/model";
import type {HolderEvidence} from "../../discovery/src/holders";
import type {Transaction,Accounts} from "../../discovery/src/rpc";
import {readEvidenceCandidateMetadata,writeEvidenceCandidateCohorts} from "../discovery-evidence-publication.mjs";
import {holderEvidenceSql,ProducerStatements,type ProducerStatement} from "./evidence-producer-plan";
import {publishEvidenceProducerBatch,publishEvidenceCandidateMetadataBatch,type ProducerPublication,type ProducerJournal,type ProducerGrant,type ProducerPublicationOutcome} from "./evidence-producer-publication";

const proofSql="SELECT payload_hash FROM tenx_proofs WHERE address=?1 AND kind=?2",candidateSql="SELECT payload FROM tenx_candidates WHERE mode='live' AND address=?1";
const cohortSql="INSERT OR IGNORE INTO tenx_cohorts(day,address,selected_at,recommended,input_hash,payload) VALUES(?1,?2,?3,?4,?5,?6)",walletSql="INSERT OR IGNORE INTO tenx_wallet_cohorts(day,address,selected_at,input_hash,payload) VALUES(?1,?2,?3,?4,?5)",selectionSql="INSERT OR IGNORE INTO tenx_selections(day,address,selected_at,input_hash,payload) VALUES(?1,?2,?3,?4,?5)";
export type CandidateTargetInput={publicationId:string;stageId?:string;candidate:Candidate;transactions?:Transaction[];state?:Accounts;holderEvidence?:HolderEvidence};
export type CandidateTargetOutcome=ProducerPublicationOutcome&{workflow:"candidate_save";cohort:"not_started"|"completed"|"unconfirmed"};

export async function saveCandidateOnEvidenceTarget(publication:ProducerPublication,journal:ProducerJournal,grant:ProducerGrant,input:CandidateTargetInput):Promise<CandidateTargetOutcome>{
  let published:ProducerPublicationOutcome|undefined,cohort:CandidateTargetOutcome["cohort"]="not_started",id:string|null=null;
  try{
    // Retain exact object/key order: the original writer validates but does not
    // replace the candidate/evidence with schema-normalized objects before hash.
    const saved=structuredClone({publication,journal,grant,input});
    id=z.string().uuid().parse(saved.input.publicationId);
    const receipt=Boolean(saved.input.candidate.holders?.payload_hash&&saved.input.holderEvidence);
    if(saved.input.candidate.mode!=="live")throw Error("candidate_target_live_required");
    if(receipt)z.string().uuid().parse(saved.input.stageId);else if(saved.input.stageId!==undefined)throw Error("candidate_target_metadata_stage_id_forbidden");
    const owned=new WeakMap<object,ProducerStatement>();let producerBatches=0;
    function prepare(sql:string,bindings:unknown[]=[]):D1PreparedStatement{
      const statement={
        bind:(...values:unknown[])=>prepare(sql,[...values]),
        async first(column?:string){
          if(column!==undefined)throw Error("candidate_target_column_read_not_supported");
          let request;
          if(sql===proofSql&&bindings.length===2)request={kind:"proof",address:bindings[0],proof_kind:bindings[1]};
          else if(sql===candidateSql&&bindings.length===1)request={kind:"candidate",address:bindings[0]};
          else throw Error("candidate_target_read_not_supported");
          return (await readEvidenceCandidateMetadata(saved.publication,saved.grant,request)).row;
        },
      };
      // No statement executes or has a delegate; complete bounds apply at batch.
      owned.set(statement,{sql,bindings:bindings as ProducerStatement["bindings"]});return statement as unknown as D1PreparedStatement;
    }
    const db={prepare,async batch(statements:D1PreparedStatement[]){
      const rows=ProducerStatements.parse(statements.map(statement=>{const row=owned.get(statement);if(!row)throw Error("candidate_target_foreign_statement");return row;}));
      if(!producerBatches){
        if(rows.some(row=>row.sql===holderEvidenceSql)!==receipt)throw Error("candidate_target_receipt_mode_mismatch");
        if(++producerBatches!==1)throw Error("candidate_target_multiple_producer_batches");
        published=receipt?await publishEvidenceProducerBatch(saved.publication,saved.journal,saved.grant,{publicationId:saved.input.publicationId,stageId:saved.input.stageId!,statements:rows}):await publishEvidenceCandidateMetadataBatch(saved.publication,saved.journal,saved.grant,{publicationId:saved.input.publicationId,statements:rows});
        if(published.state!=="committed")throw Error("candidate_target_publication_held");return published.results;
      }
      if(published?.state!=="committed"||cohort!=="not_started")throw Error("candidate_target_cohort_order_invalid");
      cohort="unconfirmed";
      const records=rows.map(({sql,bindings:b})=>{
        if(sql===cohortSql&&b.length===6)return {kind:"cohort",day:b[0],address:b[1],selected_at:b[2],recommended:b[3],input_hash:b[4],payload:b[5]};
        if((sql===walletSql||sql===selectionSql)&&b.length===5)return {kind:sql===walletSql?"wallet":"selection",day:b[0],address:b[1],selected_at:b[2],input_hash:b[3],payload:b[4]};
        throw Error("candidate_target_cohort_not_supported");
      });
      const result=await writeEvidenceCandidateCohorts(saved.publication,saved.grant,{publication_id:saved.input.publicationId,rows:records});cohort="completed";return result.results;
    }} as unknown as D1Database;
    await saveCandidate(db,saved.input.candidate,saved.input.transactions,saved.input.state,saved.input.holderEvidence);
    if(!published||published.state!=="committed"||String(cohort)!=="completed")throw Error("candidate_target_incomplete");
    return {...published,post_commit:"completed",workflow:"candidate_save",cohort:"completed"};
  }catch{
    if(published?.state==="committed")return {...published,post_commit:"failed",post_commit_error:"candidate_target_post_commit_failed",workflow:"candidate_save",cohort};
    if(published)return {...published,workflow:"candidate_save",cohort};
    return {state:"held",publication_id:id,stage_id:null,phase:"preflight",sql_attempt:"not_started",code:"producer_preflight_held",workflow:"candidate_save",cohort:"not_started",runtime_activated:false,action_authority:false,evidence_qualified:false,provider_requests:0,free_acceptance:false};
  }
}
