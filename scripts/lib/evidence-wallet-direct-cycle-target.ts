// Original explicit-mint direct/recovery turns; isolated target/recorded RPC only.
import {z} from "zod";
import {isDeepStrictEqual} from "node:util";
import {createHash} from "node:crypto";
import {Address,Signature,CandidateSchema,type Candidate} from "../../discovery/src/model";
import {fundingRecoveryCandidates,type FundingRecovery} from "../../discovery/src/funding-recovery";
import {priorWalletEvidence} from "../../discovery/src/wallet-work";
import {runWalletCycle,type WalletSettings} from "../../discovery/src/wallet-cycle";
import {walletPlan} from "../../discovery/src/wallet-plan";
import {readEvidenceWalletMetadata,readEvidenceWalletRecoveryMetadata,readEvidenceWalletCycleMetadata,readEvidenceCandidateMetadata,checkEvidenceWalletDirectDispatch} from "../discovery-evidence-publication.mjs";
import {readWalletReplayReceipt} from "./evidence-wallet-replay-target";
import type {ScratchOptions} from "../discovery-evidence-scratch.mjs";
import {ProducerStatements,type ProducerStatement} from "./evidence-producer-plan";
import {publishEvidenceWalletCycleBatch,publishEvidenceWalletDirectBatch,publishEvidenceWalletCollectionBatch,publishEvidenceWalletQuotaBatch,publishEvidenceWalletRecoveryBatch,type WalletCycleContext,type ProducerPublication,type ProducerJournal,type ProducerGrant,type ProducerPublicationOutcome} from "./evidence-producer-publication";
import {recoveryClaimSql,recoveryFinishSql} from "../evidence-wallet-recovery-sql.mjs";
import {walletLeaseSql,walletSpacingSql,walletReleaseSql,walletFailureSql,walletFailureRunSql,walletAttemptSql} from "../evidence-wallet-cycle-sql.mjs";
import {walletQuotaSql,rpcQuotaSql} from "../evidence-wallet-quota-sql.mjs";
import {collectionTransactionSql,collectionCheckpointSql,collectionRepairSql} from "../evidence-wallet-collection-sql.mjs";
import {directCatchupSql,directBackoffSql,directWorkSql,directFinishSql,directUnsupportedSql} from "../evidence-wallet-direct-sql.mjs";
import {readEvidenceWalletSnapshotReviews,checkEvidenceWalletSnapshotDispatch,writeEvidenceCandidateCohorts} from "../discovery-evidence-publication.mjs";
import {publishEvidenceWalletSnapshotBatch} from "./evidence-producer-publication";
import {readHolderSnapshotReceipt} from "./evidence-wallet-snapshot-input";
import {snapshotReviewsSql} from "../evidence-wallet-snapshot-sql.mjs";

const Id=z.string().uuid(),Limit=z.number().int().safe().positive();
const Reply=z.object({method:z.enum(["getGenesisHash","getSignaturesForAddress","getTransaction"]),params:z.unknown().array().max(4),body:z.string().max(3000000),status:z.number().int().min(200).max(599),retryAfter:z.string().max(100).optional(),walletPublicationId:Id,rpcPublicationId:Id}).strict();
const Ids=z.object({lease:Id,spacing:Id,release:Id,catchup:Id,backoff:Id,work:Id,finish:Id,failure_run:Id,failure_release:Id,failure_attempt:Id}).strict();
const Request=z.object({address:Address,now:z.string().datetime(),walletEnabled:z.boolean(),walletDailyLimit:Limit,rpcDailyLimit:Limit,marketDailyLimit:Limit,ids:Ids,writeIds:Id.array().max(128),replies:Reply.array().max(18)}).strict();
export type WalletDirectCycleTargetInput=z.infer<typeof Request>;
const RecoveryIdentity=z.object({signature:Signature,claimId:Id,finishId:Id,errorFinishId:Id}).strict(),RecoveryRequest=Request.extend({recoveries:RecoveryIdentity.array().max(2)});
export type WalletRecoveryCycleTargetInput=z.infer<typeof RecoveryRequest>;
const SnapshotRequest=Request.extend({stageId:Id});
export type WalletSnapshotCycleTargetInput=z.infer<typeof SnapshotRequest>;
const inactive=()=>({provider_requests:0,source_authorized:false,runtime_activated:false,action_authority:false,evidence_qualified:false,free_acceptance:false} as const);

export function runRecordedDirectWalletCycleOnEvidenceTarget(source:ScratchOptions,publication:ProducerPublication,journal:ProducerJournal,grant:ProducerGrant,input:WalletDirectCycleTargetInput){return runRecordedWalletCycleOnEvidenceTarget(source,publication,journal,grant,input,"direct_funding");}
export function runRecordedRecoveryWalletCycleOnEvidenceTarget(source:ScratchOptions,publication:ProducerPublication,journal:ProducerJournal,grant:ProducerGrant,input:WalletRecoveryCycleTargetInput){return runRecordedWalletCycleOnEvidenceTarget(source,publication,journal,grant,input,"reader_recovery");}
export function runRecordedSnapshotWalletCycleOnEvidenceTarget(source:ScratchOptions,publication:ProducerPublication,journal:ProducerJournal,grant:ProducerGrant,input:WalletSnapshotCycleTargetInput){return runRecordedWalletCycleOnEvidenceTarget(source,publication,journal,grant,input,"snapshot");}
async function runRecordedWalletCycleOnEvidenceTarget(source:ScratchOptions,publication:ProducerPublication,journal:ProducerJournal,grant:ProducerGrant,input:WalletDirectCycleTargetInput|WalletRecoveryCycleTargetInput|WalletSnapshotCycleTargetInput,expectedStage:"direct_funding"|"reader_recovery"|"snapshot"){
  const publications:ProducerPublicationOutcome[]=[];let cycle:WalletCycleContext|null=null,phase="preflight",recordedResponses=0,writeIndex=0,producer:ProducerPublicationOutcome|undefined,cohort:"not_started"|"unconfirmed"|"completed"="not_started";
  try{
    const saved=structuredClone({source,publication,journal,grant,input}),request=expectedStage==="snapshot"?SnapshotRequest.parse(saved.input):expectedStage==="reader_recovery"?RecoveryRequest.parse(saved.input):Request.parse(saved.input),recoveries=RecoveryIdentity.array().max(2).parse("recoveries" in request?request.recoveries:[]),ids=[...Object.values(request.ids),...request.writeIds,...request.replies.flatMap(r=>[r.walletPublicationId,r.rpcPublicationId]),...recoveries.flatMap(r=>[r.claimId,r.finishId,r.errorFinishId]),...("stageId" in request?[request.stageId]:[])];
    if(new Set(ids).size!==ids.length)throw Error("wallet_direct_identity_duplicate");
    if(new Set(recoveries.map(r=>r.signature)).size!==recoveries.length)throw Error("wallet_recovery_signature_duplicate");
    if(request.replies.some(r=>Buffer.byteLength(r.body)>3000000)||request.replies.reduce((n,r)=>n+Buffer.byteLength(r.body)+Buffer.byteLength(JSON.stringify(r.params)),0)>16*1024**2)throw Error("wallet_direct_response_bound");
    const owned=new WeakMap<object,ProducerStatement>(),used=new Set<string>(),limits={wallet:request.walletDailyLimit,rpc:request.rpcDailyLimit};let selectedIndex:Candidate|null=null,sourceHash:string|null=null,candidateHash:string|null=null,unsupported=false,quotaIndex=0,quotaStep:"wallet"|"rpc"="wallet";
    const claims=new Map<string,{row:FundingRecovery;identity:z.infer<typeof RecoveryIdentity>;finishes:number}>();
    const fail=(code:string):never=>{unsupported=true;throw Error(code);};
    async function dispatchCheck(){if(!cycle)throw Error("wallet_direct_context_required");if(expectedStage==="snapshot"&&candidateHash)return checkEvidenceWalletSnapshotDispatch(saved.publication,saved.grant,{cycle,source_hash:sourceHash,candidate_hash:candidateHash,at:new Date().toISOString()});if(!sourceHash)throw Error("wallet_direct_context_required");return checkEvidenceWalletDirectDispatch(saved.publication,saved.grant,{cycle,source_hash:sourceHash,at:new Date().toISOString()});}
    async function publish(id:string|undefined,rows:ProducerStatement[],kind:"control"|"direct"|"collection"){
      if(!id||!cycle||expectedStage!=="snapshot"&&!sourceHash||used.has(id))throw Error("wallet_direct_publication_identity");used.add(id);
      const outcome=await(kind==="control"?publishEvidenceWalletCycleBatch(saved.publication,saved.journal,saved.grant,{publicationId:id,cycle,statements:rows}):kind==="collection"?publishEvidenceWalletCollectionBatch(saved.publication,saved.journal,saved.grant,{publicationId:id,statements:rows}):expectedStage==="snapshot"?publishEvidenceWalletSnapshotBatch(saved.publication,saved.journal,saved.grant,{publicationId:id,cycle,sourceHash,candidateHash:candidateHash!,limits,statements:rows}):publishEvidenceWalletDirectBatch(saved.publication,saved.journal,saved.grant,{publicationId:id,cycle,sourceHash:sourceHash!,limits,statements:rows}));publications.push(outcome);if(outcome.state!=="committed")throw Error("wallet_direct_publication_unconfirmed");return outcome.results;
    }
    async function publishRecovery(id:string,row:FundingRecovery,claimId:string,statements:ProducerStatement[]){
      if(!cycle||!sourceHash||used.has(id))throw Error("wallet_recovery_publication_identity");used.add(id);
      const outcome=await publishEvidenceWalletRecoveryBatch(saved.publication,saved.journal,saved.grant,{publicationId:id,claimId,cycle,sourceHash,row,statements});publications.push(outcome);if(outcome.state!=="committed")throw Error("wallet_recovery_publication_unconfirmed");return outcome.results;
    }
    function prepare(sql:string,bindings:unknown[]=[]):D1PreparedStatement{
      const statement={bind:(...values:unknown[])=>prepare(sql,[...values]),async first(column?:string):Promise<unknown>{
        if(column!==undefined)return fail("wallet_direct_column_unsupported");
        if(sql===walletLeaseSql&&bindings.length===4){
          phase="admission";const retained=selectedIndex?null:(await readEvidenceCandidateMetadata(saved.publication,saved.grant,{kind:"candidate",address:request.address})).row;
          const candidate=selectedIndex??(retained?.payload?CandidateSchema.parse(JSON.parse(retained.payload)):null);
          if(!candidate||expectedStage!=="snapshot"&&!candidate.wallet_analysis)throw Error("wallet_direct_candidate_required");
          const plan=await walletPlan(db,candidate,new Date(request.now));if(unsupported||!(expectedStage==="snapshot"?["new_snapshot","refresh_required"].includes(plan.stage):plan.stage===expectedStage))throw Error("wallet_direct_path_required");sourceHash=candidate.wallet_analysis?.evidence_hash??null;
          if(expectedStage==="snapshot"){
            const current=(await readEvidenceCandidateMetadata(saved.publication,saved.grant,{kind:"candidate",address:request.address})).row;
            if(!current||typeof current.payload!=="string"||!isDeepStrictEqual(CandidateSchema.parse(JSON.parse(current.payload)),candidate))throw Error("wallet_snapshot_candidate_changed");candidateHash=createHash("sha256").update(current.payload).digest("hex");
            if(candidate.holders?.payload_hash)await readHolderSnapshotReceipt(saved.source,saved.publication,saved.grant,candidate.holders.payload_hash);
          }
          if(expectedStage==="reader_recovery"){
            const prior=await priorWalletEvidence(db,candidate);if(!prior)throw Error("wallet_recovery_receipt_required");const rows=await fundingRecoveryCandidates(db,candidate,prior,new Date(request.now));if(!rows.length||rows.some(row=>!recoveries.some(identity=>identity.signature===row.signature)))throw Error("wallet_recovery_identity_required");
          }
          cycle={lease_id:request.ids.lease,job:String(bindings[0]),until:String(bindings[1]),at:new Date(request.now).toISOString(),rapid:bindings[3] as 0|1,address:request.address};phase="lease";
          return (await publish(request.ids.lease,ProducerStatements.parse([{sql,bindings}]),"control"))[0]!.results[0]??null;
        }
        const recoveryHop=Object.keys(recoveryClaimSql).find(hop=>sql===recoveryClaimSql[hop]);
        if(recoveryHop){
          phase="claim";if(expectedStage!=="reader_recovery"||bindings.length!==15)throw Error("wallet_recovery_claim_unsupported");const signature=String(bindings[0]),identity=recoveries.find(r=>r.signature===signature);if(!identity||claims.has(signature))throw Error("wallet_recovery_identity_required");
          const row:FundingRecovery={signature,slot:bindings[2] as number,blockTime:bindings[14] as number,hop:recoveryHop as "direct"|"second",wallet:String(bindings[7]),anchor_key:String(bindings[8]),checkpoint_hash:String(bindings[9])};claims.set(signature,{row,identity,finishes:0});return (await publishRecovery(identity.claimId,row,identity.claimId,ProducerStatements.parse([{sql,bindings}])))[0]!.results[0]??null;
        }
        if(sql===directCatchupSql){phase="catchup";return (await publish(request.ids.catchup,ProducerStatements.parse([{sql,bindings}]),"direct"))[0]!.results[0]??null;}
        if(sql===walletQuotaSql||sql===rpcQuotaSql){
          phase="quota";if(sql!==(quotaStep==="wallet"?walletQuotaSql:rpcQuotaSql))throw Error("wallet_direct_quota_order");await dispatchCheck();const reply=request.replies[quotaIndex];if(!reply)throw Error("wallet_direct_recording_required");
          const outcome=await publishEvidenceWalletQuotaBatch(saved.publication,saved.journal,saved.grant,{publicationId:quotaStep==="wallet"?reply.walletPublicationId:reply.rpcPublicationId,reservation:{wallet:reply.walletPublicationId,rpc:reply.rpcPublicationId,day:request.now.slice(0,10),wallet_limit:limits.wallet,rpc_limit:limits.rpc},statements:[{sql,bindings}]});publications.push(outcome);
          if(outcome.state!=="committed")throw Error("wallet_direct_quota_unconfirmed");if(outcome.reconciled)throw Error("wallet_direct_replayed_reservation");
          const returned=outcome.results[0]!.results[0]??null;if(returned){if(quotaStep==="rpc"){quotaIndex++;quotaStep="wallet";}else quotaStep="rpc";}return returned;
        }
        if(sql==="SELECT * FROM tenx_control WHERE id=1")return (await readEvidenceWalletCycleMetadata(saved.publication,saved.grant,{kind:"control"})).row;
        if(sql==="SELECT used FROM tenx_usage WHERE provider='wallet_catchup' AND day=?1"&&bindings.length===1)return (await readEvidenceWalletCycleMetadata(saved.publication,saved.grant,{kind:"catchup",day:bindings[0]})).row;
        if(sql==="SELECT used FROM tenx_wallet_usage WHERE day=?1"&&bindings.length===1)return (await readEvidenceWalletCycleMetadata(saved.publication,saved.grant,{kind:"wallet_usage",day:bindings[0]})).row;
        if(sql==="SELECT payload FROM tenx_candidates WHERE mode='live' AND address=?1"&&bindings.length===1)return (await readEvidenceCandidateMetadata(saved.publication,saved.grant,{kind:"candidate",address:bindings[0]})).row;
        if(sql==="SELECT payload_hash,address,payload,observed_at FROM tenx_wallet_evidence WHERE payload_hash=?1 AND address=?2"&&bindings.length===2)return readWalletReplayReceipt(saved.source,saved.publication,saved.grant,String(bindings[0]),String(bindings[1]));
        if(expectedStage==="snapshot"&&sql==="SELECT payload_hash,address,slot,payload,observed_at FROM tenx_holder_evidence WHERE payload_hash=?1"&&bindings.length===1)return readHolderSnapshotReceipt(saved.source,saved.publication,saved.grant,String(bindings[0]));
        if(["SELECT payload,payload_hash,fetched_at FROM tenx_wallet_transactions WHERE signature=?1","SELECT payload,payload_hash,fetched_at FROM tenx_wallet_transactions WHERE signature=?"].includes(sql)&&bindings.length===1)return (await readEvidenceWalletMetadata(saved.publication,saved.grant,{kind:"transaction",signature:bindings[0]})).row;
        if(sql==="SELECT COUNT(*) AS n FROM tenx_funding_reads WHERE is_recovery=1 AND started_at>=?"&&bindings.length===1)return (await readEvidenceWalletRecoveryMetadata(saved.publication,saved.grant,{kind:"count",since:bindings[0]})).row;
        if(sql==="SELECT 1 FROM tenx_funding_reads WHERE signature=? AND reader_version=?"&&bindings.length===2)return (await readEvidenceWalletRecoveryMetadata(saved.publication,saved.grant,{kind:"seen",signature:bindings[0],reader:bindings[1]})).row;
        for(const [hop,table] of [["direct","tenx_funding_scans"],["second","tenx_second_hop_scans"]]){
          if(sql===`SELECT payload,payload_hash FROM ${table} WHERE address=?1 AND wallet=?2 AND anchor_signature=?3`&&bindings.length===3)return (await readEvidenceWalletMetadata(saved.publication,saved.grant,{kind:"checkpoint",hop,address:bindings[0],wallet:bindings[1],anchor_signature:bindings[2]})).row;
          if(sql===`SELECT anchor_signature FROM ${table} WHERE address=? AND wallet=? AND anchor_signature IN (?,?) ORDER BY CASE WHEN anchor_signature=? THEN 0 ELSE 1 END LIMIT 1`&&bindings.length===5&&bindings[2]===bindings[4])return (await readEvidenceWalletMetadata(saved.publication,saved.grant,{kind:"checkpoint_key",hop,address:bindings[0],wallet:bindings[1],preferred:bindings[2],legacy:bindings[3]})).row;
          if(sql===`SELECT anchor_signature FROM ${table} WHERE address=? AND wallet=? AND anchor_signature IN (?,?) AND payload_hash=? ORDER BY CASE WHEN anchor_signature=? THEN 0 ELSE 1 END LIMIT 1`&&bindings.length===6&&bindings[2]===bindings[5])return (await readEvidenceWalletRecoveryMetadata(saved.publication,saved.grant,{kind:"key",hop,address:bindings[0],wallet:bindings[1],preferred:bindings[2],legacy:bindings[3],hash:bindings[4]})).row;
        }
        return fail("wallet_direct_read_unsupported");
      },async all(){
        if(expectedStage==="snapshot"&&sql===snapshotReviewsSql&&bindings.length===1)return {success:true,results:(await readEvidenceWalletSnapshotReviews(saved.publication,saved.grant,{since:bindings[0]})).rows};
        if(sql==="SELECT payload FROM tenx_active_candidates WHERE mode=?1 ORDER BY checked_at DESC,address LIMIT 500"&&bindings.length===1&&bindings[0]==="live"){const rows=(await readEvidenceWalletMetadata(saved.publication,saved.grant,{kind:"candidates"})).rows;selectedIndex=rows.map(r=>CandidateSchema.parse(JSON.parse(r.payload))).find(c=>c.address===request.address)??null;return {success:true,results:rows};}
        if(sql==="SELECT address,attempted_at,next_attempt_at FROM tenx_wallet_attempts"&&bindings.length===0)return {success:true,results:(await readEvidenceWalletCycleMetadata(saved.publication,saved.grant,{kind:"attempts"})).rows};
        if(sql==="SELECT w.payload FROM tenx_wallet_work w JOIN tenx_candidates c ON c.address=w.address AND c.mode='live' WHERE w.source_evidence_hash=json_extract(c.payload,'$.wallet_analysis.evidence_hash') ORDER BY w.attempted_at DESC LIMIT 20"&&bindings.length===0)return {success:true,results:(await readEvidenceWalletCycleMetadata(saved.publication,saved.grant,{kind:"work"})).rows};
        return fail("wallet_direct_index_unsupported");
      },async run(){
        phase="write";const rows=ProducerStatements.parse([{sql,bindings}]);
        if(sql===collectionTransactionSql||[...Object.values(collectionCheckpointSql),...Object.values(collectionRepairSql)].includes(sql))return (await publish(request.writeIds[writeIndex++],rows,"collection"))[0];
        if(sql===directUnsupportedSql)return (await publish(request.writeIds[writeIndex++],rows,"direct"))[0];
        const control=sql===walletSpacingSql?request.ids.spacing:sql===walletReleaseSql?request.ids.release:sql===walletFailureSql?request.ids.failure_release:sql===walletAttemptSql?request.ids.failure_attempt:null;
        if(control)return (await publish(control,rows,"control"))[0];
        const direct=sql===directWorkSql?request.ids.work:sql===directBackoffSql?request.ids.backoff:sql===walletFailureRunSql?request.ids.failure_run:null;
        if(direct)return (await publish(direct,rows,"direct"))[0];return fail("wallet_direct_write_unsupported");
      }};owned.set(statement,{sql,bindings:bindings as ProducerStatement["bindings"]});return statement as unknown as D1PreparedStatement;
    }
    const db={prepare,async batch(statements:D1PreparedStatement[]){
      phase="completion";const rows=ProducerStatements.parse(statements.map(s=>{const row=owned.get(s);if(!row)throw Error("wallet_direct_foreign_statement");return row;})),last=rows.at(-1)!;
      if(expectedStage==="snapshot"){
        if(!producer){
          if(!cycle||!candidateHash||!("stageId" in request))throw Error("wallet_snapshot_context_required");
          producer=await publishEvidenceWalletSnapshotBatch(saved.publication,saved.journal,saved.grant,{publicationId:request.ids.finish,stageId:Id.parse(request.stageId),cycle,sourceHash,candidateHash,limits,statements:rows});publications.push(producer);
          if(producer.state!=="committed")throw Error("wallet_snapshot_publication_unconfirmed");return producer.results;
        }
        if(producer.state!=="committed"||cohort!=="not_started")return fail("wallet_snapshot_cohort_order");cohort="unconfirmed";
        const records=rows.map(({sql,bindings:b})=>{
          if(sql==="INSERT OR IGNORE INTO tenx_cohorts(day,address,selected_at,recommended,input_hash,payload) VALUES(?1,?2,?3,?4,?5,?6)"&&b.length===6)return {kind:"cohort",day:b[0],address:b[1],selected_at:b[2],recommended:b[3],input_hash:b[4],payload:b[5]};
          for(const [table,kind] of [["tenx_wallet_cohorts","wallet"],["tenx_selections","selection"]])if(sql===`INSERT OR IGNORE INTO ${table}(day,address,selected_at,input_hash,payload) VALUES(?1,?2,?3,?4,?5)`&&b.length===5)return {kind,day:b[0],address:b[1],selected_at:b[2],input_hash:b[3],payload:b[4]};
          return fail("wallet_snapshot_cohort_unsupported");
        });
        const result=await writeEvidenceCandidateCohorts(saved.publication,saved.grant,{publication_id:request.ids.finish,rows:records});cohort="completed";return result.results;
      }
      if(Object.values(recoveryFinishSql).includes(last.sql)){
        phase="recovery_finish";const claim=claims.get(String(last.bindings[0]));if(expectedStage!=="reader_recovery"||!claim||claim.finishes>=2)throw Error("wallet_recovery_finish_identity_required");const id=claim.finishes++===0?claim.identity.finishId:claim.identity.errorFinishId;return publishRecovery(id,claim.row,claim.identity.claimId,rows);
      }
      if(rows.length!==3||rows[0]!.sql!==walletFailureRunSql||rows[1]!.sql!==walletAttemptSql||rows[2]!.sql!==directFinishSql)return fail("wallet_direct_batch_unsupported");return publish(request.ids.finish,rows,"direct");
    }} as unknown as D1Database;
    const transport:typeof fetch=async(url,init)=>{
      phase="recorded_response";await dispatchCheck();const envelope=JSON.parse(String(init?.body)),reply=request.replies[recordedResponses];
      if(String(url)!=="https://offline.invalid"||init?.method!=="POST"||quotaStep!=="wallet"||quotaIndex!==recordedResponses+1||!reply||envelope.id!==recordedResponses+1||envelope.method!==reply.method||!isDeepStrictEqual(envelope.params,reply.params))throw Error("wallet_direct_recording_mismatch");
      recordedResponses++;return new Response(reply.body,{status:reply.status,headers:reply.retryAfter?{"retry-after":reply.retryAfter}:{}});
    };
    const settings={db,walletEnabled:request.walletEnabled,walletDailyLimit:limits.wallet,rpcDailyLimit:limits.rpc,marketDailyLimit:request.marketDailyLimit,rpcUrl:"https://offline.invalid",marketEnabled:false,transport} as WalletSettings;
    phase="cycle";const result=await runWalletCycle(settings,request.address,new Date(request.now));if(unsupported)throw Error("wallet_direct_unsupported_path");return {state:"completed" as const,result,cycle:cycle as WalletCycleContext|null,recorded_responses:recordedResponses,write_positions:writeIndex,publications,producer,cohort,post_commit:producer?.state==="committed"?String(cohort)==="completed"?"completed":"failed":"not_started",...inactive()};
  }catch(error){return {state:"held" as const,phase,reason:error instanceof Error&&/^[a-z0-9_]{1,80}$/.test(error.message)?error.message:"wallet_direct_not_certified",cycle,recorded_responses:recordedResponses,write_positions:writeIndex,publications,producer,cohort,post_commit:producer?.state==="committed"?"failed":"not_started",...inactive()};}
}
