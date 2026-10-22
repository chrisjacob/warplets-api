// Offline counter semantics only. Never permission to issue a provider request.
import {z} from "zod";
import {reserveWalletQuota,type WalletSettings} from "../../discovery/src/wallet-cycle";
import {SourceError} from "../../discovery/src/rpc";
import {walletQuotaSql,rpcQuotaSql} from "../evidence-wallet-quota-sql.mjs";
import {publishEvidenceWalletQuotaBatch,type ProducerPublication,type ProducerJournal,type ProducerGrant,type ProducerPublicationOutcome} from "./evidence-producer-publication";

const Id=z.string().uuid(),Limit=z.number().int().safe().positive(),Request=z.object({now:z.string().datetime(),walletDailyLimit:Limit,rpcDailyLimit:Limit,walletPublicationId:Id,rpcPublicationId:Id}).strict();
export type WalletQuotaTargetInput=z.infer<typeof Request>;
const inactive=()=>({provider_requests:0,source_authorized:false,runtime_activated:false,action_authority:false,evidence_qualified:false,free_acceptance:false} as const);

export async function reserveWalletQuotaOnEvidenceTarget(publication:ProducerPublication,journal:ProducerJournal,grant:ProducerGrant,input:WalletQuotaTargetInput){
  const publications:ProducerPublicationOutcome[]=[];let phase:"preflight"|"wallet"|"rpc"="preflight";
  try{
    const saved=structuredClone({publication,journal,grant,input}),request=Request.parse(saved.input);if(request.walletPublicationId===request.rpcPublicationId)throw Error("wallet_quota_identity_duplicate");
    let calls=0;const reservation={wallet:request.walletPublicationId,rpc:request.rpcPublicationId,day:new Date(request.now).toISOString().slice(0,10),wallet_limit:request.walletDailyLimit,rpc_limit:request.rpcDailyLimit};
    const db={prepare(sql:string){return {bind(...bindings:unknown[]){return {async first(column?:string){
      if(column!==undefined||calls>1||sql!==(calls===0?walletQuotaSql:rpcQuotaSql))throw Error("wallet_quota_operation_order");
      phase=calls++===0?"wallet":"rpc";const id=phase==="wallet"?request.walletPublicationId:request.rpcPublicationId;
      const outcome=await publishEvidenceWalletQuotaBatch(saved.publication,saved.journal,saved.grant,{publicationId:id,reservation,statements:[{sql,bindings}]});publications.push(outcome);
      if(outcome.state!=="committed")throw Error("wallet_quota_publication_unconfirmed");return outcome.results[0]!.results[0]??null;
    }};}};}} as unknown as D1Database;
    const settings={walletDailyLimit:request.walletDailyLimit,rpcDailyLimit:request.rpcDailyLimit,marketDailyLimit:0} as WalletSettings;
    await reserveWalletQuota(db,settings,new Date(request.now))();
    return {state:"reserved" as const,publications,...inactive()};
  }catch(error){
    if(error instanceof SourceError)return {state:"rejected" as const,phase,code:error.code,retry_after_seconds:error.retryAfterSeconds,publications,...inactive()};
    return {state:"held" as const,phase,code:"wallet_quota_target_held",publications,...inactive()};
  }
}
