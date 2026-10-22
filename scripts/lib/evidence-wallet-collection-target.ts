// Private recorded-transport experiment. No URL, fetch callback or live lane.
import {z} from "zod";
import {isDeepStrictEqual} from "node:util";
import {Address} from "../../discovery/src/model";
import {collectFundingHistories,FundingAnchorSchema} from "../../discovery/src/funding-history";
import {WalletTransactionSchema,walletTransaction} from "../../discovery/src/wallet-rpc";
import {RpcClient,SourceError} from "../../discovery/src/rpc";
import {hashJson} from "../../discovery/src/solana";
import {readEvidenceWalletMetadata} from "../discovery-evidence-publication.mjs";
import {collectionTransactionSql,collectionCheckpointSql,collectionRepairSql} from "../evidence-wallet-collection-sql.mjs";
import {publishEvidenceWalletCollectionBatch,type ProducerPublication,type ProducerJournal,type ProducerGrant,type ProducerPublicationOutcome} from "./evidence-producer-publication";
import {reserveWalletQuotaOnEvidenceTarget} from "./evidence-wallet-quota-target";
import {ProducerStatements} from "./evidence-producer-plan";

const Id=z.string().uuid(),Limit=z.number().int().safe().positive();
const Reply=z.object({method:z.enum(["getGenesisHash","getSignaturesForAddress","getTransaction"]),params:z.unknown().array().max(4),body:z.string().max(3000000),status:z.number().int().min(200).max(599),retryAfter:z.string().max(100).optional(),walletPublicationId:Id,rpcPublicationId:Id}).strict();
const Request=z.object({address:Address,anchors:FundingAnchorSchema.array().max(20),secondHop:z.boolean(),cacheRecovery:z.boolean(),directWalletLimit:z.union([z.literal(8),z.literal(20)]),now:z.string().datetime(),walletDailyLimit:Limit,rpcDailyLimit:Limit,writeIds:Id.array().max(128),replies:Reply.array().max(18)}).strict();
export type WalletCollectionTargetInput=z.infer<typeof Request>;
const inactive=()=>({provider_requests:0,source_authorized:false,runtime_activated:false,action_authority:false,evidence_qualified:false,free_acceptance:false} as const);

export async function collectRecordedFundingOnEvidenceTarget(publication:ProducerPublication,journal:ProducerJournal,grant:ProducerGrant,input:WalletCollectionTargetInput){
  const publications:ProducerPublicationOutcome[]=[];let phase="preflight",recordedResponses=0,rpc:RpcClient|undefined,writeIndex=0;
  try{
    const saved=structuredClone({publication,journal,grant,input}),request=Request.parse(saved.input),ids=[...request.writeIds,...request.replies.flatMap(reply=>[reply.walletPublicationId,reply.rpcPublicationId])];
    if(new Set(ids).size!==ids.length)throw Error("wallet_collection_identity_duplicate");
    if(request.secondHop&&request.anchors.some(anchor=>anchor.instruction_index===undefined))throw Error("wallet_collection_instruction_index_required");
    if(request.replies.reduce((n,r)=>n+Buffer.byteLength(r.body)+Buffer.byteLength(JSON.stringify(r.params)),0)>16*1024**2||request.replies.some(r=>Buffer.byteLength(r.body)>3000000))throw Error("wallet_collection_response_bound");
    async function reserve(){
      phase="quota";const reply=request.replies[rpc!.calls-1];if(!reply)throw Error("wallet_collection_recording_required");
      const outcome=await reserveWalletQuotaOnEvidenceTarget(saved.publication,saved.journal,saved.grant,{now:request.now,walletDailyLimit:request.walletDailyLimit,rpcDailyLimit:request.rpcDailyLimit,walletPublicationId:reply.walletPublicationId,rpcPublicationId:reply.rpcPublicationId});publications.push(...outcome.publications);
      if(outcome.state==="rejected")throw new SourceError(outcome.code,outcome.retry_after_seconds);
      if(outcome.state!=="reserved")throw Error("wallet_collection_quota_unconfirmed");
      if(outcome.publications.some(p=>p.state!=="committed"||p.reconciled))throw Error("wallet_collection_replayed_reservation");
    }
    const transport:typeof fetch=async(url,init)=>{
      phase="recorded_response";const envelope=JSON.parse(String(init?.body)),reply=request.replies[rpc!.calls-1];
      if(String(url)!=="https://offline.invalid"||init?.method!=="POST"||!reply||envelope.id!==rpc!.calls||envelope.method!==reply.method||!isDeepStrictEqual(envelope.params,reply.params))throw Error("wallet_collection_recording_mismatch");
      recordedResponses++;return new Response(reply.body,{status:reply.status,headers:reply.retryAfter?{"retry-after":reply.retryAfter}:{}});
    };
    rpc=new RpcClient("https://offline.invalid",reserve,transport,18);
    function prepare(sql:string,bindings:unknown[]=[]):D1PreparedStatement{
      return {bind:(...values:unknown[])=>prepare(sql,[...values]),async first(column?:string){
        if(column!==undefined)throw Error("wallet_collection_column_unsupported");
        if(sql==="SELECT payload,payload_hash,fetched_at FROM tenx_wallet_transactions WHERE signature=?1"&&bindings.length===1)return (await readEvidenceWalletMetadata(saved.publication,saved.grant,{kind:"transaction",signature:bindings[0]})).row;
        for(const [hop,table] of [["direct","tenx_funding_scans"],["second","tenx_second_hop_scans"]]){
          if(sql===`SELECT payload,payload_hash FROM ${table} WHERE address=?1 AND wallet=?2 AND anchor_signature=?3`&&bindings.length===3)return (await readEvidenceWalletMetadata(saved.publication,saved.grant,{kind:"checkpoint",hop,address:bindings[0],wallet:bindings[1],anchor_signature:bindings[2]})).row;
          if(sql===`SELECT anchor_signature FROM ${table} WHERE address=? AND wallet=? AND anchor_signature IN (?,?) ORDER BY CASE WHEN anchor_signature=? THEN 0 ELSE 1 END LIMIT 1`&&bindings.length===5&&bindings[2]===bindings[4])return (await readEvidenceWalletMetadata(saved.publication,saved.grant,{kind:"checkpoint_key",hop,address:bindings[0],wallet:bindings[1],preferred:bindings[2],legacy:bindings[3]})).row;
        }
        throw Error("wallet_collection_read_unsupported");
      },async run(){
        phase="write";if(sql!==collectionTransactionSql&&![...Object.values(collectionCheckpointSql),...Object.values(collectionRepairSql)].includes(sql))throw Error("wallet_collection_write_unsupported");
        const id=request.writeIds[writeIndex++];if(!id)throw Error("wallet_collection_write_identity_required");
        const outcome=await publishEvidenceWalletCollectionBatch(saved.publication,saved.journal,saved.grant,{publicationId:id,statements:ProducerStatements.parse([{sql,bindings}])});publications.push(outcome);
        if(outcome.state!=="committed")throw Error("wallet_collection_publication_unconfirmed");return outcome.results[0];
      }} as unknown as D1PreparedStatement;
    }
    const db={prepare} as unknown as D1Database;
    // This adapter supplies the read callback; the unmodified collector controls
    // paging, pending order, evidence bounds, terminal markers and persistence.
    const read:Parameters<typeof collectFundingHistories>[4]=async(signature,slot,status)=>{
      phase="transaction";const cached=await db.prepare("SELECT payload,payload_hash,fetched_at FROM tenx_wallet_transactions WHERE signature=?1").bind(signature).first<{payload:string;payload_hash:string;fetched_at:string}>();
      if(status&&!cached)return {transaction:null,status};
      const transaction=cached?WalletTransactionSchema.parse(JSON.parse(cached.payload)):await walletTransaction(rpc!,signature);
      if(transaction&&transaction.slot!==slot)throw Error("wallet_signature_slot_mismatch");
      if(transaction&&cached&&await hashJson(transaction)!==cached.payload_hash)throw Error("wallet_cache_hash_mismatch");
      if(transaction&&!cached){const payload=JSON.stringify(transaction);if(Buffer.byteLength(payload)>250000)throw Error("wallet_transaction_too_large");await db.prepare(collectionTransactionSql).bind(signature,await hashJson(transaction),payload,new Date().toISOString()).run();}
      return {transaction,status:transaction?"available":"missing"};
    };
    phase="cluster";await rpc.checkCluster();phase="collection";
    const scans=await collectFundingHistories(db,rpc,request.address,request.anchors,read,{secondHop:request.secondHop,cacheRecovery:request.cacheRecovery,directWalletLimit:request.directWalletLimit,rpcCeiling:18});
    return {state:"completed" as const,scans,rpc_calls:rpc.calls,recorded_responses:recordedResponses,write_positions:writeIndex,publications,...inactive()};
  }catch(error){return {state:"held" as const,phase,reason:error instanceof SourceError?error.code:error instanceof Error&&/^[a-z0-9_]{1,80}$/.test(error.message)?error.message:"wallet_collection_not_certified",retry_after_seconds:error instanceof SourceError?error.retryAfterSeconds:null,rpc_calls:rpc?.calls??0,recorded_responses:recordedResponses,write_positions:writeIndex,publications,...inactive()};}
}
