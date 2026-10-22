import{z}from"zod";
import{gmgnSavedReview}from"./gmgn";
import{planGmgnEventSample,reviewGmgnEventSample}from"./gmgn-event-sample";
import{GMGN_CORROBORATION_CACHE_BYTES}from"./gmgn-corroboration-model";
import{hashJson}from"./solana";

// Read saved evidence only. No source transport, quota reservation, writes or
// fallback to another receipt/selection. A held plan never reads RPC bodies.
export async function gmgnEventSample(db:D1Database,id:string,now=new Date()){
  z.uuid().parse(id);const saved=await gmgnSavedReview(db,id);
  if(!saved||!("activity_replay"in saved)||!saved.activity_replay||!saved.observation||z.object({version:z.string()}).parse(saved.observation.metrics).version!=="gmgn-wallet-activity-v2")return null;
  const cutoff=now.toISOString(),plan=await planGmgnEventSample(id,saved.activity_replay,cutoff),transactions=[];let bytes=0;
  if(plan.state==="ready")for(const{signature}of plan.selected){
    const row=await db.prepare(`SELECT payload,payload_hash,fetched_at,length(CAST(payload AS BLOB)) AS bytes FROM tenx_wallet_transactions
      WHERE signature=?1 AND fetched_at<=?2`).bind(signature,cutoff).first<{payload:string;payload_hash:string;fetched_at:string;bytes:number}>();
    if(!row)continue;bytes+=row.bytes;
    if(!Number.isSafeInteger(row.bytes)||row.bytes<0||bytes>GMGN_CORROBORATION_CACHE_BYTES)throw Error("gmgn_sample_cache_bytes");
    const transaction:unknown=JSON.parse(row.payload);
    transactions.push({signature,payload_hash:row.payload_hash,raw_hash:await hashJson(transaction),fetched_at:row.fetched_at,transaction});
  }
  const inputs={version:"gmgn-event-sample-input-v1"as const,activity_id:id,cutoff_at:cutoff,activity_record:saved.activity_replay,plan,transactions};
  return{inputs,report:await reviewGmgnEventSample(inputs)};
}
