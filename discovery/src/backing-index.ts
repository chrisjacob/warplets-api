import { z } from "zod";
import { BackingOpening } from "./backing-model";
import { WindowState, FinalityObservation } from "./backing-window-model";
import { trackedWallets, boundaryReached, expectedWindowRows, windowCoverage } from "./backing-window";
import { control } from "./store";
import { reserveWalletQuota } from "./wallet-cycle";
import { RpcClient, SourceError, SignatureRows, MAINNET_GENESIS, persistRpcBackoff } from "./rpc";
import { walletTransaction, WalletTransactionSchema, keys } from "./wallet-rpc";
import { hashJson } from "./solana";
import type { Settings } from "./ingest";

export const backingIndexLimit=(walletLimit:number)=>Math.min(160,Math.floor(walletLimit/5));
type IndexRow={run_id:string;payload:string;reserved_calls:number;last_error:string|null};
/** Only prospective windows, only their signed members, only existing free wallet/global quotas. */
export async function runBackingIndex(settings:Settings,clock:()=>Date=()=>new Date()) {
  const db=settings.db,at=clock().toISOString();
  if(!settings.walletEnabled||!settings.walletDailyLimit)return {state:"disabled",rpc_calls:0};
  const shared=await control(db);
  if(shared.paused)return {state:"paused",rpc_calls:0};
  if(shared.retry_after&&shared.retry_after>at&&shared.last_error?.startsWith("rpc_"))return {state:"backoff",rpc_calls:0};
  const found=await db.prepare("SELECT id,opening,opening_hash,deadline FROM tenx_backing_runs WHERE state='open' AND ends_at<=? AND deadline>? AND json_extract(opening,'$.source_evidence_version')='wallet-window-v1' ORDER BY created_at LIMIT 1")
    .bind(at,at).first<{id:string;opening:string;opening_hash:string;deadline:string}>();
  if(!found)return {state:"waiting",rpc_calls:0};
  const run=found;
  const opening=BackingOpening.parse(JSON.parse(run.opening));
  if(await hashJson(opening)!==run.opening_hash)throw new Error("backing_index_opening_hash_mismatch");
  const owner=crypto.randomUUID();
  const leased=await db.prepare("UPDATE tenx_backing_window_index SET lease_owner=?,lease_until=? WHERE run_id=? AND (lease_until IS NULL OR lease_until<=?) AND (next_attempt_at IS NULL OR next_attempt_at<=?) RETURNING *")
    .bind(owner,new Date(clock().getTime()+90000).toISOString(),run.id,at,at).first<IndexRow>();
  if(!leased)return {state:"waiting",rpc_calls:0};
  let state=WindowState.parse(JSON.parse(leased.payload)),errorCode:string|null=null;
  const nextWallet=()=>trackedWallets(opening).find(address=>{
    const pages=state.pages.filter(p=>p.address===address);
    return !boundaryReached(opening,pages)&&(!pages.length||pages.at(-1)!.rows.length>0);
  });
  let next=new Date(clock().getTime()+60000).toISOString();
  async function fence(){
    const time=clock().toISOString(),root=await control(db);
    if(root.paused)throw new SourceError("collection_paused");
    if(root.retry_after&&root.retry_after>time&&root.last_error?.startsWith("rpc_"))throw new SourceError("shared_rpc_backoff");
    const active=await db.prepare("SELECT 1 AS ok FROM tenx_backing_window_index i JOIN tenx_backing_runs r ON r.id=i.run_id WHERE i.run_id=? AND i.lease_owner=? AND i.lease_until>? AND r.state='open' AND r.deadline>?").bind(run.id,owner,time,time).first();
    if(!active)throw new SourceError(time>=run.deadline?"source_deadline_passed":"index_lease_lost");
  }
  const rpc=new RpcClient(settings.rpcUrl,async()=>{
    await fence();const date=clock(),day=date.toISOString().slice(0,10),limit=backingIndexLimit(settings.walletDailyLimit!);
    if(limit<1)throw new SourceError("backing_daily_budget_exhausted");
    // Conservative reservations: denied later quotas may consume these counters, never create extra allowance.
    const daily=await db.prepare("INSERT INTO tenx_backing_index_usage(day,used) VALUES(?,1) ON CONFLICT(day) DO UPDATE SET used=used+1 WHERE used<? RETURNING used").bind(day,limit).first();
    if(!daily)throw new SourceError("backing_daily_budget_exhausted");
    const local=await db.prepare("UPDATE tenx_backing_window_index SET reserved_calls=reserved_calls+1 WHERE run_id=? AND lease_owner=? AND reserved_calls<64 RETURNING reserved_calls").bind(run.id,owner).first();
    if(!local)throw new SourceError("backing_run_budget_exhausted");
    await reserveWalletQuota(db,{...settings,walletEnabled:true,walletDailyLimit:settings.walletDailyLimit!},date)();
  },settings.transport,4);
  let checked=false;
  async function cluster(){if(!checked){await rpc.checkCluster();checked=true;}}
  async function save(extra:D1PreparedStatement[]=[]){
    await fence();const normalized=WindowState.parse(state),payload=JSON.stringify(normalized);
    if(new TextEncoder().encode(payload).length>240000)throw new SourceError("index_state_size_limit");
    await windowCoverage(opening,{...normalized,reserved_calls:0,last_error:null},[]);
    const saved=await db.batch([...extra,db.prepare("UPDATE tenx_backing_window_index SET payload=? WHERE run_id=? AND lease_owner=? AND lease_until>? AND EXISTS(SELECT 1 FROM tenx_backing_runs WHERE id=? AND state='open' AND deadline>?)").bind(payload,run.id,owner,clock().toISOString(),run.id,clock().toISOString())]);
    if(saved.at(-1)!.meta.changes!==1)throw new SourceError("index_lease_lost");
    state=normalized;
  }
  try {
    if(!opening.members.length){next=run.deadline;return {state:"no_linked_wallets",rpc_calls:0};}
    if(state.finality&&state.finality.source_hash!==await hashJson(settings.rpcUrl))throw new SourceError("rpc_source_changed_within_window");
    if(!state.finality){
      await cluster();const slot=z.number().int().safe().nonnegative().parse(await rpc.call("getSlot",[{commitment:"finalized"}]));
      const block=z.number().int().nonnegative().nullable().parse(await rpc.call("getBlockTime",[slot]));
      await fence();
      if(block===null||block*1000<Date.parse(opening.ends_at))throw new SourceError("finalized_cutoff_not_reached");
      state.finality=FinalityObservation.parse({genesis:MAINNET_GENESIS,commitment:"finalized",slot,block_time:block,fetched_at:clock().toISOString(),source_hash:await hashJson(settings.rpcUrl)});
      await save();return {state:"finalized_slot_observed",rpc_calls:rpc.calls};
    }
    for(let step=0;step<2;step++){
      const expected=expectedWindowRows(opening,state.pages);
      if(expected.length>100||(state.pages.length>=16&&nextWallet()))state.capacity_limited=true;
      const pending=state.processed.length<100?expected.slice(0,100).find(r=>r.confirmationStatus==="finalized"&&r.slot<=state.finality!.slot&&!state.processed.includes(r.signature)):undefined;
      if(pending){
        const cached=await db.prepare("SELECT payload,payload_hash,fetched_at FROM tenx_wallet_transactions WHERE signature=?").bind(pending.signature).first<{payload:string;payload_hash:string;fetched_at:string}>();
        let tx,fetched=clock().toISOString();
        try{
          if(cached){tx=WalletTransactionSchema.parse(JSON.parse(cached.payload));fetched=cached.fetched_at;if(await hashJson(tx)!==cached.payload_hash)throw new SourceError("indexed_cache_hash_mismatch");}
          else {await cluster();tx=await walletTransaction(rpc,pending.signature);fetched=clock().toISOString();}
        }catch(error){
          if(error instanceof SourceError&&["unsupported_transaction_version","wallet_transaction_layout_unsupported"].includes(error.code)){
            state.unavailable.push({signature:pending.signature,reason:"unsupported"});state.processed.push(pending.signature);await save();continue;
          }throw error;
        }
        await fence();
        if(!tx){state.unavailable.push({signature:pending.signature,reason:"missing"});state.processed.push(pending.signature);await save();continue;}
        if(tx.slot!==pending.slot||tx.blockTime!==pending.blockTime||tx.transaction.signatures[0]!==pending.signature||tx.meta?.err!==null||Date.parse(fetched)<Date.parse(opening.starts_at)||Date.parse(fetched)>Date.parse(run.deadline)||tx.blockTime!*1000>Date.parse(fetched))throw new SourceError("indexed_transaction_mismatch");
        if(state.pages.some(p=>p.rows.some(r=>r.signature===pending.signature)&&!keys(tx!).includes(p.address)))throw new SourceError("indexed_wallet_not_referenced");
        const payload=JSON.stringify(tx),hash=await hashJson(tx);
        if(new TextEncoder().encode(payload).length>250000){state.unavailable.push({signature:pending.signature,reason:"oversized"});state.processed.push(pending.signature);await save();continue;}
        state.processed.push(pending.signature);
        await save(cached?[]:[db.prepare("INSERT OR IGNORE INTO tenx_wallet_transactions(signature,payload_hash,payload,fetched_at) SELECT ?,?,?,? WHERE EXISTS(SELECT 1 FROM tenx_backing_window_index i JOIN tenx_backing_runs r ON r.id=i.run_id WHERE i.run_id=? AND i.lease_owner=? AND i.lease_until>? AND r.state='open' AND r.deadline>?)").bind(pending.signature,hash,payload,fetched,run.id,owner,clock().toISOString(),clock().toISOString())]);
        continue;
      }
      const address=nextWallet();
      if(!address||state.pages.length>=16){await save();next=run.deadline;return {state:"bounded_index_finished",rpc_calls:rpc.calls};}
      const before=state.pages.filter(p=>p.address===address).at(-1)?.rows.at(-1)?.signature??null;
      await cluster();const rows=SignatureRows.max(50).parse(await rpc.call("getSignaturesForAddress",[address,{commitment:"finalized",minContextSlot:state.finality.slot,limit:50,...before?{before}:{}}]));
      await fence();state.pages.push({address,before,limit:50,min_context_slot:state.finality.slot,fetched_at:clock().toISOString(),rows,rows_hash:await hashJson(rows)});await save();
    }
    return {state:"progress",rpc_calls:rpc.calls};
  }catch(error){
    errorCode=error instanceof SourceError?error.code:"backing_index_unavailable";
    await persistRpcBackoff(db,error,clock());
    next=new Date(clock().getTime()+(error instanceof SourceError?Math.max(60,error.retryAfterSeconds):120)*1000).toISOString();
    return {state:"held",error:errorCode,rpc_calls:rpc.calls};
  }finally{
    await db.prepare("UPDATE tenx_backing_window_index SET lease_owner=NULL,lease_until=NULL,next_attempt_at=?,last_error=? WHERE run_id=? AND lease_owner=?").bind(next,errorCode,run.id,owner).run();
  }
}
