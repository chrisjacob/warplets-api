import{z}from"zod";
import{gmgnSavedReview}from"./gmgn";
import{activityForCorroboration,reviewGmgnCorroboration,GMGN_CORROBORATION_CACHE_BYTES}from"./gmgn-corroboration";
import{WalletTransactionSchema,walletTransaction}from"./wallet-rpc";
import{reserveWalletQuota,type WalletSettings}from"./wallet-cycle";
import{RpcClient,SourceError,persistRpcBackoff}from"./rpc";
import{hashJson}from"./solana";

export async function gmgnCorroboration(db:D1Database,id:string,now=new Date()){
  z.uuid().parse(id);const saved=await gmgnSavedReview(db,id);
  if(!saved||!("activity_replay"in saved)||!saved.activity_replay)return null;
  if(saved.observation&&z.object({version:z.string()}).parse(saved.observation.metrics).version!=="gmgn-wallet-activity-v1")return null;
  const source=await activityForCorroboration(saved.activity_replay),transactions=[];let bytes=0;
  if(source.signatures.length<=2)for(const signature of source.signatures){
    const row=await db.prepare(`SELECT payload,payload_hash,fetched_at,length(CAST(payload AS BLOB)) AS bytes FROM tenx_wallet_transactions
      WHERE signature=?1 AND fetched_at<=?2`).bind(signature,now.toISOString()).first<{payload:string;payload_hash:string;fetched_at:string;bytes:number}>();
    if(!row)continue;bytes+=row.bytes;if(bytes>GMGN_CORROBORATION_CACHE_BYTES)throw Error("gmgn_rpc_cache_bytes");const transaction:unknown=JSON.parse(row.payload);
    transactions.push({signature,payload_hash:row.payload_hash,raw_hash:await hashJson(transaction),fetched_at:row.fetched_at,transaction});
  }
  const inputs={version:"gmgn-rpc-input-v1" as const,activity_id:id,cutoff_at:now.toISOString(),activity_record:saved.activity_replay,transactions};
  return{inputs,report:await reviewGmgnCorroboration(inputs)};
}

// Explicit operator work only, in the existing wallet lease and RPC subset.
// The immutable source hash defines a one-attempt job; a lost response is never
// permission to repeat calls. Existing cache bodies are never overwritten.
export async function collectGmgnCorroboration(settings:WalletSettings,id:string,clock=()=>new Date()){
  const{db}=settings,now=clock(),at=now.toISOString(),day=at.slice(0,10),saved=await gmgnCorroboration(db,id,now);
  const held=(reason:string)=>({state:"held",reason,rpc_calls:0,scoring_effect:"none"});
  if(!saved)return held("accepted_activity_required");
  const source=await activityForCorroboration(saved.inputs.activity_record),age=now.getTime()-Date.parse(source.receipt.received_at);
  if(age<0||age>86_400_000||!source.signatures.length||source.signatures.length>2)return held("source_time_or_signature_bound");
  if(saved.report.cached_transactions===source.signatures.length)return{state:"cached",rpc_calls:0,scoring_effect:"none"};
  if(!settings.walletEnabled)return held("wallet_collection_disabled");
  if(settings.walletDailyLimit<=0||settings.rpcDailyLimit<=0)return held("rpc_collection_budget_disabled");
  const job="gmgn-rpc-"+await hashJson({id,source_hash:source.report_hash}),prior=await db.prepare("SELECT state,rpc_calls FROM tenx_jobs WHERE id=?1").bind(job).first();
  if(prior)return{state:"already_attempted",job,previous:prior,rpc_calls:0,scoring_effect:"none"};
  const owner=crypto.randomUUID(),until=new Date(now.getTime()+90_000).toISOString();
  const admitted=await db.batch([
    db.prepare(`UPDATE tenx_wallet_control SET lease_owner=?1,lease_until=?2 WHERE id=1 AND (lease_until IS NULL OR lease_until<=?3)
      AND (next_refresh_at IS NULL OR next_refresh_at<=?3)
      AND EXISTS(SELECT 1 FROM tenx_control WHERE id=1 AND paused=0 AND (retry_after IS NULL OR retry_after<=?3))`).bind(owner,until,at),
    db.prepare(`INSERT OR IGNORE INTO tenx_jobs(id,kind,state,started_at) SELECT ?1,'gmgn_rpc_corroboration','running',?2
      WHERE EXISTS(SELECT 1 FROM tenx_wallet_control WHERE id=1 AND lease_owner=?3 AND lease_until>?2)`).bind(job,at,owner)
  ]);
  if(admitted[1]!.meta.changes!==1){await db.prepare("UPDATE tenx_wallet_control SET lease_owner=NULL,lease_until=NULL WHERE id=1 AND lease_owner=?1").bind(owner).run();return held("wallet_lease_pacing_or_existing_job");}
  let calls=0,stored=0,error:string|null=null;
  const owned=async()=>Boolean(clock().toISOString().slice(0,10)===day&&await db.prepare(`SELECT id FROM tenx_wallet_control WHERE id=1 AND lease_owner=?1 AND lease_until>?2
    AND EXISTS(SELECT 1 FROM tenx_control WHERE id=1 AND paused=0 AND (retry_after IS NULL OR retry_after<=?2))`).bind(owner,clock().toISOString()).first());
  const quota=reserveWalletQuota(db,settings,now),transport=settings.transport??fetch;
  try{
    const rpc=new RpcClient(settings.rpcUrl,async()=>{if(!await owned())throw new SourceError("gmgn_rpc_lease_or_pause");await quota();},async(input,init)=>{calls++;return transport(input,init);},3);
    await rpc.checkCluster();let bytes=saved.inputs.transactions.reduce((sum,row)=>sum+new TextEncoder().encode(JSON.stringify(row.transaction)).length,0);
    for(const signature of source.signatures){
      if(saved.inputs.transactions.some(row=>row.signature===signature))continue;
      const tx=await walletTransaction(rpc,signature);if(!tx)continue;
      if(tx.blockTime===null||tx.blockTime*1000>clock().getTime())throw new SourceError("gmgn_rpc_transaction_time");
      const payload=JSON.stringify(tx);bytes+=new TextEncoder().encode(payload).length;if(bytes>GMGN_CORROBORATION_CACHE_BYTES)throw new SourceError("gmgn_rpc_cache_bytes");
      if(!await owned())throw new SourceError("gmgn_rpc_lease_or_pause");
      const result=await db.prepare(`INSERT OR IGNORE INTO tenx_wallet_transactions(signature,payload_hash,payload,fetched_at)
        SELECT ?1,?2,?3,?4 WHERE EXISTS(SELECT 1 FROM tenx_wallet_control WHERE id=1 AND lease_owner=?5 AND lease_until>?4)
        AND EXISTS(SELECT 1 FROM tenx_control WHERE id=1 AND paused=0 AND (retry_after IS NULL OR retry_after<=?4))`)
        .bind(signature,await hashJson(WalletTransactionSchema.parse(tx)),payload,clock().toISOString(),owner).run();
      stored+=result.meta.changes;
    }
  }catch(cause){error=cause instanceof SourceError?cause.code:"gmgn_rpc_corroboration_unusable";await persistRpcBackoff(db,cause,clock());}
  const finished=clock().toISOString();
  await db.batch([
    db.prepare("UPDATE tenx_jobs SET state=?2,finished_at=?3,rpc_calls=?4,processed=?5,error_code=?6 WHERE id=?1 AND state='running'").bind(job,error?"failed":"succeeded",finished,calls,stored,error),
    db.prepare("UPDATE tenx_wallet_control SET lease_owner=NULL,lease_until=NULL,next_refresh_at=?2,last_error=?3 WHERE id=1 AND lease_owner=?1")
      .bind(owner,new Date(clock().getTime()+300_000).toISOString(),error)
  ]);
  return{state:error?"failed":"collected",job,rpc_calls:calls,new_cache_bodies:stored,error,scoring_effect:"none"};
}
