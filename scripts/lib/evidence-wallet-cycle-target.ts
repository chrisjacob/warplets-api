// Complete explicit-mint cached scheduler path only; not a runtime D1 backend.
import {z} from "zod";
import {Address,CandidateSchema,type Candidate} from "../../discovery/src/model";
import {runWalletCycle,type WalletSettings} from "../../discovery/src/wallet-cycle";
import {walletPlan} from "../../discovery/src/wallet-plan";
import {priorWalletEvidence} from "../../discovery/src/wallet-work";
import {expandedFundingScope} from "../../discovery/src/wallet-funding-scope";
import type {ScratchOptions} from "../discovery-evidence-scratch.mjs";
import {readEvidenceWalletMetadata,readEvidenceWalletCycleMetadata,readEvidenceCandidateMetadata} from "../discovery-evidence-publication.mjs";
import {readWalletReplayReceipt} from "./evidence-wallet-replay-target";
import {ProducerStatements,type ProducerStatement} from "./evidence-producer-plan";
import {publishEvidenceWalletCycleBatch,publishEvidenceWalletCachedBatch,type WalletCycleContext,type ProducerPublication,type ProducerJournal,type ProducerGrant,type ProducerPublicationOutcome} from "./evidence-producer-publication";
import {walletLeaseSql,walletSpacingSql,walletReleaseSql,walletFailureSql,walletFailureRunSql,walletAttemptSql} from "../evidence-wallet-cycle-sql.mjs";
import {cachedCheckpointSql,cachedFinishSql} from "../evidence-wallet-cached-sql.mjs";

const Id=z.string().uuid(),Limit=z.number().int().safe().positive(),Ids=z.object({lease:Id,spacing:Id,release:Id,finish:Id,failure_run:Id,failure_release:Id,failure_attempt:Id}).strict();
const Request=z.object({address:Address,now:z.string().datetime(),walletEnabled:z.boolean(),walletDailyLimit:Limit,rpcDailyLimit:Limit,marketDailyLimit:Limit,ids:Ids,checkpoints:z.object({wallet:Address,anchorSignature:z.string().min(1).max(4096),publicationId:Id}).strict().array().max(20)}).strict();
export type WalletCycleTargetInput=z.infer<typeof Request>;
const inactive=()=>({provider_requests:0,source_authorized:false,runtime_activated:false,action_authority:false,evidence_qualified:false,free_acceptance:false} as const);

export async function runCachedWalletCycleOnEvidenceTarget(source:ScratchOptions,publication:ProducerPublication,journal:ProducerJournal,grant:ProducerGrant,input:WalletCycleTargetInput){
  const publications:ProducerPublicationOutcome[]=[];let phase="preflight",cycle:WalletCycleContext|null=null;
  try{
    const saved=structuredClone({source,publication,journal,grant,input}),request=Request.parse(saved.input),ids=[...Object.values(request.ids),...request.checkpoints.map(c=>c.publicationId)];
    if(new Set(ids).size!==ids.length||new Set(request.checkpoints.map(c=>JSON.stringify([c.wallet,c.anchorSignature]))).size!==request.checkpoints.length)throw Error("wallet_cycle_identity_duplicate");
    const owned=new WeakMap<object,ProducerStatement>(),used=new Set<string>();let unsupported=false,selectedIndex:Candidate|null=null;
    async function publish(id:string,rows:ProducerStatement[],cached=false){
      if(!cycle||used.has(id))throw Error("wallet_cycle_operation_identity");used.add(id);
      const outcome=await(cached?publishEvidenceWalletCachedBatch(saved.publication,saved.journal,saved.grant,{publicationId:id,statements:rows}):publishEvidenceWalletCycleBatch(saved.publication,saved.journal,saved.grant,{publicationId:id,cycle,statements:rows}));publications.push(outcome);if(outcome.state!=="committed")throw Error("wallet_cycle_publication_unconfirmed");return outcome.results;
    }
    const failure=(code:string):never=>{unsupported=true;throw Error(code);};
    function prepare(sql:string,bindings:unknown[]=[]):D1PreparedStatement{
      const statement={bind:(...values:unknown[])=>prepare(sql,[...values]),async first(column?:string):Promise<unknown>{
        if(column!==undefined)return failure("wallet_cycle_column_unsupported");
        if(sql===walletLeaseSql&&bindings.length===4){
          phase="admission";
          const row=selectedIndex?null:(await readEvidenceCandidateMetadata(saved.publication,saved.grant,{kind:"candidate",address:request.address})).row;
          if(row&&typeof row.payload!=="string")throw Error("wallet_cycle_candidate_payload_required");
          const candidate=selectedIndex??(row?CandidateSchema.parse(JSON.parse(row.payload!)):null);
          if(candidate){
            const plan=await walletPlan(db,candidate,new Date(request.now));
            if(unsupported||!["cached_funding","cache_invalid","source_limited"].includes(plan.stage))throw Error("wallet_cycle_cached_path_required");
            if(plan.stage==="cached_funding"){
              const retained=await priorWalletEvidence(db,candidate);if(!retained)throw Error("wallet_cycle_receipt_required");const prepared=await expandedFundingScope(db,retained);
              if(!prepared.funding_scans?.length||prepared.funding_scans.some(scan=>!scan.anchor.signature||!request.checkpoints.some(c=>c.wallet===scan.wallet&&c.anchorSignature===scan.anchor.signature)))throw Error("wallet_cycle_checkpoint_identity_required");
            }
          }
          cycle={lease_id:request.ids.lease,job:String(bindings[0]),until:String(bindings[1]),at:new Date(request.now).toISOString(),rapid:bindings[3] as 0|1,address:request.address};phase="lease";
          return (await publish(request.ids.lease,ProducerStatements.parse([{sql,bindings}])))[0]!.results[0]??null;
        }
        if(sql==="SELECT * FROM tenx_control WHERE id=1")return (await readEvidenceWalletCycleMetadata(saved.publication,saved.grant,{kind:"control"})).row;
        if(sql==="SELECT used FROM tenx_usage WHERE provider='wallet_catchup' AND day=?1"&&bindings.length===1)return (await readEvidenceWalletCycleMetadata(saved.publication,saved.grant,{kind:"catchup",day:bindings[0]})).row;
        if(sql==="SELECT used FROM tenx_wallet_usage WHERE day=?1"&&bindings.length===1)return (await readEvidenceWalletCycleMetadata(saved.publication,saved.grant,{kind:"wallet_usage",day:bindings[0]})).row;
        if(sql==="SELECT payload FROM tenx_candidates WHERE mode='live' AND address=?1"&&bindings.length===1)return (await readEvidenceCandidateMetadata(saved.publication,saved.grant,{kind:"candidate",address:bindings[0]})).row;
        if(sql==="SELECT payload_hash,address,payload,observed_at FROM tenx_wallet_evidence WHERE payload_hash=?1 AND address=?2"&&bindings.length===2)return readWalletReplayReceipt(saved.source,saved.publication,saved.grant,String(bindings[0]),String(bindings[1]));
        if(sql==="SELECT payload,payload_hash,fetched_at FROM tenx_wallet_transactions WHERE signature=?1"&&bindings.length===1)return (await readEvidenceWalletMetadata(saved.publication,saved.grant,{kind:"transaction",signature:bindings[0]})).row;
        for(const [hop,table] of [["direct","tenx_funding_scans"],["second","tenx_second_hop_scans"]])if(sql===`SELECT payload,payload_hash FROM ${table} WHERE address=?1 AND wallet=?2 AND anchor_signature=?3`&&bindings.length===3)return (await readEvidenceWalletMetadata(saved.publication,saved.grant,{kind:"checkpoint",hop,address:bindings[0],wallet:bindings[1],anchor_signature:bindings[2]})).row;
        return failure("wallet_cycle_source_or_read_unsupported");
      },async all(){
        if(sql==="SELECT payload FROM tenx_active_candidates WHERE mode=?1 ORDER BY checked_at DESC,address LIMIT 500"&&bindings.length===1&&bindings[0]==="live"){
          const rows=(await readEvidenceWalletMetadata(saved.publication,saved.grant,{kind:"candidates"})).rows;
          selectedIndex=rows.map(row=>CandidateSchema.parse(JSON.parse(row.payload))).find(candidate=>candidate.address===request.address)??null;
          return {success:true,results:rows};
        }
        if(sql==="SELECT address,attempted_at,next_attempt_at FROM tenx_wallet_attempts"&&bindings.length===0)return {success:true,results:(await readEvidenceWalletCycleMetadata(saved.publication,saved.grant,{kind:"attempts"})).rows};
        if(sql==="SELECT w.payload FROM tenx_wallet_work w JOIN tenx_candidates c ON c.address=w.address AND c.mode='live' WHERE w.source_evidence_hash=json_extract(c.payload,'$.wallet_analysis.evidence_hash') ORDER BY w.attempted_at DESC LIMIT 20"&&bindings.length===0)return {success:true,results:(await readEvidenceWalletCycleMetadata(saved.publication,saved.grant,{kind:"work"})).rows};
        return failure("wallet_cycle_index_unsupported");
      },async run(){
        phase="write";const rows=ProducerStatements.parse([{sql,bindings}]);
        if(sql===cachedCheckpointSql){const id=request.checkpoints.find(c=>c.wallet===bindings[4]&&c.anchorSignature===bindings[5])?.publicationId;if(!id||bindings[3]!==request.address)throw Error("wallet_cycle_checkpoint_identity_required");return (await publish(id,rows,true))[0];}
        const id=sql===walletSpacingSql?request.ids.spacing:sql===walletReleaseSql?request.ids.release:sql===walletFailureSql?request.ids.failure_release:sql===walletFailureRunSql?request.ids.failure_run:sql===walletAttemptSql?request.ids.failure_attempt:null;
        if(!id)return failure("wallet_cycle_write_unsupported");return (await publish(id,rows))[0];
      }};owned.set(statement,{sql,bindings:bindings as ProducerStatement["bindings"]});return statement as unknown as D1PreparedStatement;
    }
    const db={prepare,async batch(statements:D1PreparedStatement[]){
      phase="completion";const rows=ProducerStatements.parse(statements.map(statement=>{const row=owned.get(statement);if(!row)throw Error("wallet_cycle_foreign_statement");return row;}));
      if(rows.length!==4||rows.some((r,i)=>r.sql!==cachedFinishSql[i]))return failure("wallet_cycle_batch_unsupported");return publish(request.ids.finish,rows,true);
    }} as unknown as D1Database;
    const settings={db,walletEnabled:request.walletEnabled,walletDailyLimit:request.walletDailyLimit,rpcDailyLimit:request.rpcDailyLimit,marketDailyLimit:request.marketDailyLimit,rpcUrl:"https://offline.invalid",marketEnabled:false,transport:async()=>failure("wallet_cycle_transport_forbidden")} as WalletSettings;
    phase="cycle";const result=await runWalletCycle(settings,request.address,new Date(request.now));if(unsupported)throw Error("wallet_cycle_unsupported_path");return {state:"completed" as const,result,cycle:cycle as WalletCycleContext|null,publications,...inactive()};
  }catch(error){return {state:"held" as const,phase,reason:error instanceof Error&&/^[a-z0-9_]{1,80}$/.test(error.message)?error.message:"wallet_cycle_not_certified",cycle,publications,...inactive()};}
}
