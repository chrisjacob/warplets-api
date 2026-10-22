import { z } from "zod";
import { GMGN_USE_AUTHORITY } from "./gmgn-model";
import { gmgnActivityTarget,runGmgnReview,type GmgnSettings } from "./gmgn";
import { readAttentionQueue } from "./attention-queue";
import type { AttentionQueueResult } from "./attention-queue-model";
import { attentionTradersFresh } from "./attention-trader-model";
import { attentionActivityFresh } from "./attention-activity-model";
import { normalizeAttentionActivity,attentionActivityIssue } from "./attention-activity";
import { readSourceReceiptWithRequest,type SourceFetcher } from "./source-collection-transport";
import { hashJson } from "./solana";

export async function attentionActivityId(at:Date) {
  const h=await hashJson({attention_activity_hour:at.toISOString().slice(0,13),version:1});
  return `${h.slice(0,8)}-${h.slice(8,12)}-4${h.slice(13,16)}-8${h.slice(17,20)}-${h.slice(20,32)}`;
}
export function attentionActivitySource(queue:AttentionQueueResult,now:Date,attempts:{address:string;last_attempt:string}[]=[]) {
  const last=(address:string)=>attempts.find(a=>a.address===address)?.last_attempt??"";
  const source=(address:string)=>queue.trader_reviews.find(t=>t.address===address&&attentionTradersFresh(t,now));
  const row=queue.rows.filter(r=>r.checks!=="adverse"&&r.attention_families>0).slice(0,20).filter(r=>r.chain==="solana"&&r.market_crosschecked&&
    (source(r.address)?.sample.reported_combined_flow_usd??0)>0&&
    !queue.activity_reviews.some(a=>a.address===r.address&&attentionActivityFresh(a,now))).sort((a,b)=>last(a.address).localeCompare(last(b.address)))[0];
  return row?source(row.address)?.request_id??null:null;
}
export async function collectAttentionActivity(settings:GmgnSettings,raw:unknown,fetcher:SourceFetcher,clock=()=>new Date()) {
  z.object({reason:z.string().min(3).max(300)}).strict().parse(raw);
  if(!settings.apiKey||settings.permissionReference!==GMGN_USE_AUTHORITY)return{state:"held",reason:"gmgn_configuration_required",provider_requests:0};
  const at=clock(),id=await attentionActivityId(at);
  if(await settings.db.prepare("SELECT id FROM tenx_source_reservations WHERE id=?1").bind(id).first())return{state:"held",reason:"activity_hour_already_reserved",provider_requests:0};
  const queue=await readAttentionQueue(settings.db,at,"review"),since=new Date(at.getTime()-86400000).toISOString();
  const attempts=await settings.db.prepare(`SELECT json_extract(request,'$.address') AS address,MAX(reserved_at) AS last_attempt FROM tenx_source_reservations
    WHERE day>=?1 AND reserved_at>=?2 AND reserved_at<=?3 AND json_extract(request,'$.kind')='gmgn_wallet_activity'
    AND json_extract(request,'$.selection_id') GLOB 'attention-traders-*'
    GROUP BY json_extract(request,'$.address') ORDER BY last_attempt DESC LIMIT 25`).bind(since.slice(0,10),since,at.toISOString()).all<{address:string;last_attempt:string}>();
  const sourceId=attentionActivitySource(queue,at,attempts.results);
  if(!sourceId)return{state:"held",reason:"no_fresh_shortlist_trader_source",provider_requests:0};
  const target=await gmgnActivityTarget(settings.db,sourceId,at);
  if(target.state!=="ready")return target;
  // The existing controller checks source hash, selected wallet and mint again
  // before reservation. It retains all shared admission/transport controls.
  const result=await runGmgnReview(settings,{reason:"Focused hourly shortlist wallet-event review",request_id:id,mode:"retained_research",request:target.request},fetcher,clock);
  const saved=await readSourceReceiptWithRequest(settings.db,id),source=saved&&saved.receipt.error===null?await readSourceReceiptWithRequest(settings.db,sourceId):null;
  return{...result,request_id:id,selection_history_truncated:queue.history_truncated,
    review:saved&&source&&saved.receipt.error===null?await normalizeAttentionActivity(id,saved,source):null,
    issue:saved&&saved.receipt.error!==null?attentionActivityIssue(id,saved):null,scoring_effect:"none",evidence_gates_changed:false};
}
