import{z}from"zod";
import{gmgnEventSample}from"./gmgn-event-sample-store";
import{gmgnSavedReview}from"./gmgn";
import{GmgnEventSamplePlanSchema}from"./gmgn-event-sample-model";
import{planGmgnEventSample}from"./gmgn-event-sample";
import{GMGN_CORROBORATION_CACHE_BYTES}from"./gmgn-corroboration-model";
import{WalletTransactionSchema,walletTransaction}from"./wallet-rpc";
import{reserveWalletQuota,type WalletSettings}from"./wallet-cycle";
import{RpcClient,SourceError,persistRpcBackoff}from"./rpc";
import{hashJson}from"./solana";

const jobId=(id:string)=>"gmgn-event-rpc-"+z.uuid().parse(id);
export async function gmgnEventCollection(db:D1Database,id:string){
  const job=jobId(id),row=await db.prepare(`SELECT j.state,j.started_at,j.finished_at,j.rpc_calls,j.processed,j.error_code,
    c.plan_hash,length(CAST(c.plan AS BLOB)) AS bytes,CASE WHEN length(CAST(c.plan AS BLOB))<=32000 THEN c.plan ELSE NULL END AS plan
    FROM tenx_jobs j LEFT JOIN tenx_gmgn_event_collections c ON c.job_id=j.id WHERE j.id=?1`).bind(job).first<{
    state:string;started_at:string;finished_at:string|null;rpc_calls:number;processed:number;error_code:string|null;plan_hash:string|null;bytes:number|null;plan:string|null
  }>();
  if(!row)return null;
  if(!row.plan||!row.bytes||row.bytes>32000)throw Error("gmgn_event_dispatch_plan_missing");
  const plan=GmgnEventSamplePlanSchema.parse(JSON.parse(row.plan)),saved=await gmgnSavedReview(db,id);
  if(!saved||!("activity_replay"in saved)||!saved.activity_replay)throw Error("gmgn_event_dispatch_source_missing");
  const replay=await planGmgnEventSample(id,saved.activity_replay,plan.cutoff_at);
  if(plan.activity_id!==id||plan.cutoff_at!==row.started_at||plan.plan_hash!==row.plan_hash||await hashJson(plan)!==await hashJson(replay))throw Error("gmgn_event_dispatch_plan_mismatch");
  return{version:"gmgn-event-collection-v1"as const,activity_id:id,job,state:row.state,started_at:row.started_at,finished_at:row.finished_at,
    rpc_calls:row.rpc_calls,new_cache_bodies:row.processed,error:row.error_code,dispatch_plan:plan,operator_only:true as const,maximum_rpc_calls:3 as const,scoring_effect:"none"as const};
}

// Explicit operator work only. Never scheduled or invoked by a report read.
// Plan + journal are committed before dispatch. A request ID is spent forever,
// including partial/error/lost-response jobs and jobs with missing plan history.
export async function collectGmgnEventSample(settings:WalletSettings,id:string,clock=()=>new Date()){
  const{db}=settings,job=jobId(id),now=clock(),at=now.toISOString(),day=at.slice(0,10);
  const held=(reason:string)=>({state:"held",reason,rpc_calls:0,scoring_effect:"none"});
  const prior=await db.prepare("SELECT state,rpc_calls FROM tenx_jobs WHERE id=?1").bind(job).first();
  if(prior)return{state:"already_attempted",job,previous:prior,rpc_calls:0,scoring_effect:"none"};
  const saved=await gmgnEventSample(db,id,now);if(!saved)return held("accepted_research_activity_required");
  const plan=saved.inputs.plan,age=now.getTime()-Date.parse(plan.activity_received_at);
  if(plan.state!=="ready"||age<0||age>86_400_000)return held("source_time_or_selection_bound");
  if(saved.report.cached_transactions===plan.selected.length)return{state:"cached",rpc_calls:0,scoring_effect:"none"};
  if(!settings.walletEnabled)return held("wallet_collection_disabled");
  if(settings.walletDailyLimit<=0||settings.rpcDailyLimit<=0)return held("rpc_collection_budget_disabled");
  const record=z.object({request:z.object({selection_id:z.string(),selection_hash:z.string()}),receipt:z.object({request_hash:z.string()})}).parse(saved.inputs.activity_record);
  const owner=crypto.randomUUID(),until=new Date(now.getTime()+90_000).toISOString(),serialized=JSON.stringify(plan);
  const admitted=await db.batch([
    db.prepare(`UPDATE tenx_wallet_control SET lease_owner=?1,lease_until=?2 WHERE id=1 AND (lease_until IS NULL OR lease_until<=?3)
      AND (next_refresh_at IS NULL OR next_refresh_at<=?3)
      AND EXISTS(SELECT 1 FROM tenx_control WHERE id=1 AND paused=0 AND (retry_after IS NULL OR retry_after<=?3))`).bind(owner,until,at),
    db.prepare(`INSERT OR IGNORE INTO tenx_jobs(id,kind,state,started_at) SELECT ?1,'gmgn_event_sample','running',?2
      WHERE EXISTS(SELECT 1 FROM tenx_wallet_control WHERE id=1 AND lease_owner=?3 AND lease_until>?2)`).bind(job,at,owner),
    db.prepare(`INSERT OR IGNORE INTO tenx_gmgn_event_collections(activity_id,job_id,plan_hash,plan,created_at)
      SELECT ?1,?2,?3,?4,?5 WHERE EXISTS(SELECT 1 FROM tenx_jobs WHERE id=?2 AND state='running' AND started_at=?5)
      AND EXISTS(SELECT 1 FROM tenx_wallet_control WHERE id=1 AND lease_owner=?6 AND lease_until>?5)`).bind(id,job,plan.plan_hash,serialized,at,owner)
  ]);
  if(admitted[1]!.meta.changes!==1||admitted[2]!.meta.changes!==1){
    if(admitted[1]!.meta.changes===1)await db.prepare("UPDATE tenx_jobs SET state='failed',finished_at=?2,error_code='gmgn_event_plan_not_retained' WHERE id=?1 AND state='running'").bind(job,at).run();
    await db.prepare("UPDATE tenx_wallet_control SET lease_owner=NULL,lease_until=NULL WHERE id=1 AND lease_owner=?1").bind(owner).run();return held("wallet_lease_pacing_or_existing_job");
  }
  let calls=0,stored=0,error:string|null=null,dispatchHeld=false;
  const owned=async()=>{
    const current=clock().toISOString();if(current.slice(0,10)!==day)return false;
    return Boolean(await db.prepare(`SELECT id FROM tenx_wallet_control WHERE id=1 AND lease_owner=?1 AND lease_until>?2
      AND (next_refresh_at IS NULL OR next_refresh_at<=?2)
      AND EXISTS(SELECT 1 FROM tenx_jobs WHERE id=?8 AND state='running')
      AND EXISTS(SELECT 1 FROM tenx_control WHERE id=1 AND paused=0 AND (retry_after IS NULL OR retry_after<=?2))
      AND EXISTS(SELECT 1 FROM tenx_source_reservations WHERE id=?3 AND state='succeeded' AND receipt_hash=?4 AND request_hash=?5)
      AND EXISTS(SELECT 1 FROM tenx_source_reservations WHERE id=?6 AND state='succeeded' AND receipt_hash=?7)`)
      .bind(owner,current,id,plan.source_receipt_hash,record.receipt.request_hash,record.request.selection_id,record.request.selection_hash,job).first());
  };
  const quota=reserveWalletQuota(db,settings,now),transport=settings.transport??fetch;
  try{
    const rpc=new RpcClient(settings.rpcUrl,async()=>{if(!await owned())throw new SourceError("gmgn_event_lease_source_or_pause");await quota();},async(input,init)=>{
      if(!await owned()){dispatchHeld=true;throw new SourceError("gmgn_event_lease_source_or_pause");}calls++;return transport(input,init);
    },3);
    await rpc.checkCluster();let bytes=saved.inputs.transactions.reduce((sum,row)=>sum+new TextEncoder().encode(JSON.stringify(row.transaction)).length,0);
    for(const{signature}of plan.selected){
      if(saved.inputs.transactions.some(row=>row.signature===signature))continue;
      const tx=await walletTransaction(rpc,signature);if(!tx)continue;
      if(tx.blockTime===null||tx.blockTime*1000>clock().getTime())throw new SourceError("gmgn_event_transaction_time");
      const payload=JSON.stringify(tx);bytes+=new TextEncoder().encode(payload).length;if(bytes>GMGN_CORROBORATION_CACHE_BYTES)throw new SourceError("gmgn_event_cache_bytes");
      const payloadHash=await hashJson(WalletTransactionSchema.parse(tx));
      if(!await owned())throw new SourceError("gmgn_event_lease_source_or_pause");
      const fetched=clock().toISOString(),result=await db.prepare(`INSERT OR IGNORE INTO tenx_wallet_transactions(signature,payload_hash,payload,fetched_at)
        SELECT ?1,?2,?3,?4 WHERE EXISTS(SELECT 1 FROM tenx_wallet_control WHERE id=1 AND lease_owner=?5 AND lease_until>?4 AND (next_refresh_at IS NULL OR next_refresh_at<=?4))
        AND substr(?4,1,10)=?6 AND EXISTS(SELECT 1 FROM tenx_jobs WHERE id=?7 AND state='running')
        AND EXISTS(SELECT 1 FROM tenx_control WHERE id=1 AND paused=0 AND (retry_after IS NULL OR retry_after<=?4))
        AND EXISTS(SELECT 1 FROM tenx_source_reservations WHERE id=?8 AND state='succeeded' AND receipt_hash=?9 AND request_hash=?10)
        AND EXISTS(SELECT 1 FROM tenx_source_reservations WHERE id=?11 AND state='succeeded' AND receipt_hash=?12)`)
        .bind(signature,payloadHash,payload,fetched,owner,day,job,id,plan.source_receipt_hash,record.receipt.request_hash,record.request.selection_id,record.request.selection_hash).run();
      if(result.meta.changes!==1&&!await owned())throw new SourceError("gmgn_event_lease_source_or_pause");stored+=result.meta.changes;
    }
  }catch(cause){error=dispatchHeld?"gmgn_event_lease_source_or_pause":cause instanceof SourceError?cause.code:"gmgn_event_collection_unusable";await persistRpcBackoff(db,cause,clock());}
  const finished=clock().toISOString();await db.batch([
    db.prepare(`UPDATE tenx_jobs SET state=CASE WHEN state='running' THEN ?2 ELSE state END,finished_at=COALESCE(finished_at,?3),
      rpc_calls=MAX(rpc_calls,?4),processed=MAX(processed,?5),error_code=COALESCE(error_code,?6) WHERE id=?1 AND kind='gmgn_event_sample'`)
      .bind(job,error?"failed":"succeeded",finished,calls,stored,error),
    db.prepare(`UPDATE tenx_wallet_control SET lease_owner=NULL,lease_until=NULL,next_refresh_at=CASE WHEN next_refresh_at>?2 THEN next_refresh_at ELSE ?2 END,last_error=?3 WHERE id=1 AND lease_owner=?1`)
      .bind(owner,new Date(clock().getTime()+300_000).toISOString(),error)
  ]);
  return{state:error?"failed":"collected",job,dispatch_plan_hash:plan.plan_hash,rpc_calls:calls,new_cache_bodies:stored,error,scoring_effect:"none"};
}
