import {z} from "zod";
import {MarketSchema,type Candidate} from "./model";
import {hashJson} from "./solana";
import {readSourceReceipt} from "./source-collection-transport";
import {GmgnRequestSchema} from "./gmgn-request";
import {normalizeGmgn} from "./gmgn-normalize";
import {GMGN_USE_AUTHORITY} from "./gmgn-model";
import {assembleGmgnWindowData} from "./gmgn-window";
import {reviewRecentActivity,unavailableRecentActivity} from "./recent-activity";
import {holderHistory} from "./holder-history-store";
import {holderParticipation} from "./holder-participation-store";
import {unavailableHolderParticipation} from "./holder-participation";
import {unavailableTradeSample} from "./trade-sample";
import {GmgnWalletActivitySchema} from "./gmgn-wallet-activity";
import {gmgnSavedReview} from "./gmgn";
import {gmgnActivitySelection} from "./gmgn-activity-selection";
import {activityObservation,activityFreshness,type ActivityObservation,type ActivityRef} from "./activity-observation";

type Metric=ActivityObservation["metric"];
const Receipt=z.object({received_at:z.string().datetime(),error:z.string().nullable(),response:z.unknown(),access_probe:z.boolean().optional(),access_accepted:z.boolean().optional(),research_permission_reference:z.string().nullable().optional(),semantic_validation:z.string().optional()});
const rolling=(seconds:number):ActivityObservation["window"]=>({kind:"reported_rolling",start_at:null,end_at:null,duration_seconds:seconds});
const coverage=(denominator:string,observed:number|null=null,expected:number|null=null,status:ActivityObservation["coverage"]["status"]="unknown",denominatorValue:number|null=null):ActivityObservation["coverage"]=>({status,observed,expected,denominator,denominator_value:denominatorValue});
const scope=(kind:ActivityObservation["scope"]["kind"],address:string|null):ActivityObservation["scope"]=>({kind,address,canonical_pool_verified:false});
export async function commonActivityBundle(db:D1Database,candidate:Candidate,at:Date){
  const address=candidate.address,cutoff_at=at.toISOString(),records:ActivityObservation[]=[];
  let recent=await unavailableRecentActivity(address,at,candidate.mode==="fixture"?"simulation":"missing",candidate.mode==="fixture"?"synthetic_source_not_collected":"no_retained_candle_window");
  let participation=await unavailableHolderParticipation(address,at,candidate.mode==="fixture"?"simulation":"missing",candidate.mode==="fixture"?"synthetic_source_not_collected":"holder_history_unavailable");
  let trades=await unavailableTradeSample(address,at,candidate.mode==="fixture"?"simulation":"missing",candidate.mode==="fixture"?"synthetic_source_not_collected":"wallet_source_unavailable");
  const make=(metric:Metric,source:ActivityObservation["source"],unit:ActivityObservation["unit"],patch:Partial<ActivityObservation>={})=>activityObservation({address,cutoff_at,metric,source,unit},patch);
  const issue=(metrics:[Metric,ActivityObservation["unit"]][],source:ActivityObservation["source"],gap:string,qualification:ActivityObservation["qualification"]="rejected",references:ActivityRef[]=[],patch:Partial<ActivityObservation>={})=>metrics.map(([metric,unit])=>make(metric,source,unit,{qualification,references,gaps:[gap],...patch}));
  const infoMetrics:[Metric,ActivityObservation["unit"]][]=[["token_reported_volume_24h","USD"],["token_reported_volume_1h","USD"],["token_reported_holders","owners"]];
  const candleMetrics:[Metric,ActivityObservation["unit"]][]=[["candle_window_volume","USD"],["candle_max_adjacent_move","percent"],["candle_longest_rising_run","count"]];
  const walletMetrics:[Metric,ActivityObservation["unit"]][]=[["wallet_reported_buy_usd","USD"],["wallet_reported_sell_usd","USD"]];
  // Fixed metric inventory: absent/rejected sources are records, never omitted.
  if(candidate.mode==="fixture"){
    const market=candidate.market;
    records.push(make("pool_reported_volume_24h","simulation","USD",{value:market?.volume_24h_usd??null,qualification:market?.volume_24h_usd==null?"missing":"reported_only",window:rolling(86400),gaps:["synthetic_example_not_live_evidence"]}));
    records.push(...issue([...infoMetrics,...candleMetrics,["raw_owner_net_change","owners"],...walletMetrics],"simulation","synthetic_source_not_collected","missing"));
  }else{
    try{
      const market=candidate.market;
      const row=market?await db.prepare("SELECT CASE WHEN length(CAST(payload AS BLOB))<=16000 THEN payload ELSE NULL END AS payload FROM tenx_market_history WHERE address=?1 AND fetched_at=?2 AND fetched_at<=?3").bind(address,market.fetched_at,cutoff_at).first<{payload:string|null}>():null;
      if(!market||!row)records.push(make("pool_reported_volume_24h",market?.source??"unavailable","USD",{scope:scope("pool",candidate.pool),window:rolling(86400),gaps:["market_history_snapshot_unavailable"]}));
      else{
        if(!row.payload)throw Error("market_snapshot_size");const raw:unknown=JSON.parse(row.payload),saved=MarketSchema.parse(raw);
        if(saved.fetched_at!==market.fetched_at||saved.source!==market.source||await hashJson(saved)!==await hashJson(market))throw Error("market_snapshot_mismatch");
        const future=saved.observed_at!==null&&Date.parse(saved.observed_at)>at.getTime();
        records.push(make("pool_reported_volume_24h",saved.source,"USD",{scope:scope("pool",candidate.pool),value:future?null:saved.volume_24h_usd,qualification:future?"held":saved.volume_24h_usd===null?"missing":"reported_only",window:rolling(86400),fetched_at:saved.fetched_at,provider_observed_at:saved.observed_at,
          freshness:future?"unknown":activityFreshness(cutoff_at,saved.fetched_at,saved.observed_at),coverage:coverage("reported_pool_trades",null,null,"reported"),references:[{kind:"market_history_snapshot",id:address+":"+saved.fetched_at,hash:await hashJson(raw),integrity:"content_hash_only"}],gaps:["organic_share_unknown","pool_report_not_token_total",...future?["provider_observation_from_future"]:[],"provider_window_end_unknown"]}));
      }
    }catch{records.push(...issue([["pool_reported_volume_24h","USD"]],candidate.market?.source??"unavailable","market_snapshot_integrity_or_schema_failed"));}
    try{
      const latest=await latestGmgn(db,address,"gmgn_token_info",at);
      if(latest.state!=="available")records.push(...issue(infoMetrics,"gmgn",latest.gap,latest.state,latest.reference?[latest.reference]:[],{fetched_at:latest.fetched_at??null,freshness:activityFreshness(cutoff_at,latest.fetched_at??null)}));
      else{
        const report=normalizeGmgn(latest.request,latest.receipt.response,latest.receipt.received_at);
        const metrics=z.object({reported_holder_count:z.number().nullable(),reported_volume_usd:z.object({volume_24h:z.number().nullable(),volume_1h:z.number().nullable()}).nullable()}).parse(report.metrics);
        const values=[metrics.reported_volume_usd?.volume_24h??null,metrics.reported_volume_usd?.volume_1h??null,metrics.reported_holder_count];
        for(let i=0;i<infoMetrics.length;i++){const[metric,unit]=infoMetrics[i]!,value=values[i]??null;records.push(make(metric,"gmgn",unit,{value,qualification:value===null?"missing":"reported_only",window:i<2?rolling(i===0?86400:3600):{kind:"point",start_at:null,end_at:null,duration_seconds:null},fetched_at:latest.receipt.received_at,freshness:activityFreshness(cutoff_at,latest.receipt.received_at),coverage:coverage("provider_token_population_unknown",null,null,"reported"),references:[latest.reference],gaps:["provider_measurement_time_unknown","token_pool_population_coverage_unknown","organic_share_unknown",...i===2?["positive_balance_count_not_dust_filtered"]:[]]}));}
      }
    }catch{records.push(...issue(infoMetrics,"gmgn","gmgn_info_integrity_or_schema_failed"));}
    try{
      const data=await candleWindowAt(db,address,at),report=data?.report;
      if(!report||!data)records.push(...issue(candleMetrics,"gmgn","no_retained_candle_window","missing"));
      else{
        try{recent=await reviewRecentActivity(data,at,candidate.creation?.block_time??null);}
        catch{recent=await unavailableRecentActivity(address,at,"rejected","recent_activity_measurement_failed");}
        const references:ActivityRef[]=report.receipt_refs.filter(r=>r.receipt_hash!==null).map(r=>({kind:"gmgn_receipt",id:r.request_id,hash:r.receipt_hash!,integrity:"archived_hash_verified"}));
        const shared={scope:scope("token",address),window:{kind:"requested_candles" as const,start_at:report.window_start,end_at:report.window_end,duration_seconds:21600},fetched_at:report.received_at,freshness:activityFreshness(cutoff_at,report.received_at,report.window_end),references,gaps:[...report.gaps,"candle_patterns_do_not_establish_wash_trading"]};
        records.push(make("candle_window_volume","gmgn","USD",{...shared,value:report.reported_window_volume_usd,qualification:report.reported_window_volume_usd===null?"held":"reported_only",coverage:coverage("closed_one_minute_bars",report.candle_count,360,report.complete_window?"complete_requested_window":"partial")}));
        for(const[metric,value]of [["candle_max_adjacent_move",report.activity?.max_adjacent_close_move_pct??null],["candle_longest_rising_run",report.activity?.longest_rising_run_pairs??null]] as const)records.push(make(metric,"gmgn",metric==="candle_max_adjacent_move"?"percent":"count",{...shared,value,qualification:value===null?"held":"supported_sample",coverage:coverage("observed_adjacent_closed_minutes",report.activity?.adjacent_pairs??0,359,report.complete_window?"complete_requested_window":"partial",report.activity?.adjacent_pairs??null)}));
      }
    }catch{records.push(...issue(candleMetrics,"gmgn","candle_window_integrity_or_schema_failed"));recent=await unavailableRecentActivity(address,at,"rejected","candle_window_integrity_or_schema_failed");}
    try{
      const {report,inputs}=await holderHistory(db,address,at),delta=report.since_first,poolMismatch=report.snapshots.some(s=>s.pool!==candidate.pool);
      try{
        if(poolMismatch){participation=await unavailableHolderParticipation(address,at,"rejected","holder_pool_differs_from_candidate");trades=await unavailableTradeSample(address,at,"rejected","holder_pool_differs_from_candidate");}
        else{const bundle=await holderParticipation(db,address,at,inputs);participation=bundle.report;trades=bundle.trades;}
      }
      catch{participation=await unavailableHolderParticipation(address,at,"rejected","holder_acquisition_integrity_or_schema_failed");trades=await unavailableTradeSample(address,at,"rejected","wallet_acquisition_integrity_or_schema_failed");}
      const refs:ActivityRef[]=report.snapshots.map(s=>({kind:"holder_inventory",id:s.payload_hash,hash:s.payload_hash,integrity:"archived_hash_verified"}));
      records.push(make("raw_owner_net_change","solana-finalized-rpc","owners",{value:delta?.status==="measured"&&!poolMismatch?delta.net_change:null,qualification:delta?.status==="measured"&&!poolMismatch?"supported_sample":report.snapshots.length?"held":"missing",window:delta?{kind:"observed_interval",start_at:delta.start_at,end_at:delta.end_at,duration_seconds:delta.duration_seconds}:{kind:"unavailable",start_at:null,end_at:null,duration_seconds:null},fetched_at:delta?.end_at??report.snapshots.at(-1)?.observed_at??null,freshness:activityFreshness(cutoff_at,delta?.end_at??null,null,1800),coverage:coverage("raw_positive_balance_starting_owners",report.snapshots.length,null,report.status==="available"?"partial":"unknown",delta?.starting_owners??null),references:refs,gaps:[...report.gaps,...delta?.gaps??[],"raw_owner_changes_not_qualified_holder_growth","observed_interval_not_trailing_24h",...poolMismatch?["holder_pool_differs_from_candidate"]:[]]}));
    }catch{records.push(...issue([["raw_owner_net_change","owners"]],"solana-finalized-rpc","holder_history_integrity_or_schema_failed"));participation=await unavailableHolderParticipation(address,at,"rejected","holder_history_integrity_or_schema_failed");trades=await unavailableTradeSample(address,at,"rejected","holder_history_integrity_or_schema_failed");}
    try{
      const latest=await latestGmgn(db,address,"gmgn_wallet_activity",at);
      if(latest.state!=="available")records.push(...issue(walletMetrics,"gmgn",latest.gap,latest.state,latest.reference?[latest.reference]:[],{fetched_at:latest.fetched_at??null,freshness:activityFreshness(cutoff_at,latest.fetched_at??null)}));
      else{
        if(latest.request.kind!=="gmgn_wallet_activity")throw Error("activity_kind");
        const saved=await gmgnSavedReview(db,latest.id);if(!saved||!("activity_replay"in saved)||!saved.activity_replay)throw Error("activity_replay_missing");
        const selected=await gmgnActivitySelection(saved.activity_replay.selection_record,new Date(latest.receipt.received_at));
        if(selected.wallet!==latest.request.wallet||selected.address!==address||selected.selection_hash!==latest.request.selection_hash)throw Error("wallet_selection_mismatch");
        const activity=GmgnWalletActivitySchema.parse(normalizeGmgn(latest.request,latest.receipt.response,latest.receipt.received_at).metrics);
        const refs:ActivityRef[]=[latest.reference,{kind:"gmgn_receipt",id:activity.source_request_id,hash:activity.source_receipt_hash,integrity:"archived_hash_verified"}];
        for(const[metric,value]of [["wallet_reported_buy_usd",activity.reported_buy_usd],["wallet_reported_sell_usd",activity.reported_sell_usd]] as const)records.push(make(metric,"gmgn","USD",{scope:scope("wallet",latest.request.wallet),value,qualification:value===null?"held":"reported_only",window:{kind:"observed_interval",start_at:activity.first_trade_at,end_at:activity.last_trade_at,duration_seconds:activity.trade_span_seconds},fetched_at:latest.receipt.received_at,freshness:activityFreshness(cutoff_at,latest.receipt.received_at,activity.last_trade_at),coverage:coverage("selected_wallet_max_20_events",activity.returned_events,20,"partial",activity.buy_events+activity.sell_events),references:refs,gaps:["selected_wallet_not_token_volume","event_timestamps_not_full_query_window","pagination_and_population_incomplete","historical_usd_not_independently_verified","organic_share_unknown",...activity.unknown_time_events?["event_times_incomplete"]:[]]}));
      }
    }catch{records.push(...issue(walletMetrics,"gmgn","wallet_activity_integrity_or_selection_failed"));}
  }
  for(const[metric,unit,gap]of [["organic_volume_24h","USD","organic_volume_qualification_not_established"],["meaningful_holder_growth_24h","owners","acquisition_and_retention_qualification_not_established"],["attention_momentum","index","cross_token_attention_qualification_not_established"]] as const)records.push(make(metric,"unavailable",unit,{qualification:"held",gaps:[gap,"no_score_adoption"]}));
  return {records,recent,participation,trades};
}
export async function commonActivity(db:D1Database,candidate:Candidate,at:Date){return (await commonActivityBundle(db,candidate,at)).records;}

async function latestGmgn(db:D1Database,address:string,kind:"gmgn_token_info"|"gmgn_wallet_activity",at:Date){
  const row=await db.prepare(`SELECT id,request FROM tenx_source_reservations WHERE day>=?1 AND reserved_at<=?2 AND json_extract(request,'$.address')=?3 AND json_extract(request,'$.kind')=?4 ORDER BY reserved_at DESC,id DESC LIMIT 1`)
    .bind(new Date(at.getTime()-6*86400000).toISOString().slice(0,10),at.toISOString(),address,kind).first<{id:string;request:string}>();
  if(!row)return{state:"missing" as const,gap:"no_retained_"+kind};
  const request=GmgnRequestSchema.parse(JSON.parse(row.request));if(request.address!==address||request.kind!==kind)throw Error("gmgn_request_identity");
  const saved=await readSourceReceipt(db,row.id);if(!saved)return{state:"held" as const,gap:"source_attempt_pending_at_cutoff"};
  const receipt=Receipt.parse(saved.receipt);if(Date.parse(receipt.received_at)>at.getTime())return{state:"held" as const,gap:"source_receipt_after_cutoff"};
  const reference:ActivityRef={kind:"gmgn_receipt",id:row.id,hash:await hashJson(saved.receipt),integrity:"archived_hash_verified"};
  if(receipt.error!==null)return{state:"rejected" as const,gap:"latest_source_attempt_failed_no_clean_fallback",reference,fetched_at:receipt.received_at};
  if(receipt.access_probe||receipt.response===null)return{state:"missing" as const,gap:"no_retained_token_data"};
  if(receipt.research_permission_reference!==GMGN_USE_AUTHORITY||!receipt.access_accepted)throw Error("source_use_authority");
  return{state:"available" as const,id:row.id,request,receipt,reference};
}
async function candleWindowAt(db:D1Database,address:string,at:Date){
  const cutoff=at.toISOString(),day=new Date(at.getTime()-6*86400000).toISOString().slice(0,10);
  const latest=await db.prepare(`SELECT json_extract(request,'$.series.id') id FROM tenx_source_reservations WHERE day>=?1 AND reserved_at<=?2 AND json_extract(request,'$.address')=?3 AND json_extract(request,'$.series.id') IS NOT NULL AND json_extract(request,'$.series.end_at')<=?2 ORDER BY json_extract(request,'$.series.end_at') DESC,reserved_at DESC,id DESC LIMIT 1`).bind(day,cutoff,address).first<{id:string}>();
  if(!latest)return null;
  const rows=await db.prepare("SELECT id,request,request_hash,state FROM tenx_source_reservations WHERE json_extract(request,'$.series.id')=?1 AND reserved_at<=?2 ORDER BY reserved_at,id LIMIT 5").bind(latest.id,cutoff).all<{id:string;request:string;request_hash:string;state:"reserved"|"fetching"|"succeeded"|"failed"}>();
  if(rows.results.length>4)throw Error("candle_duplicate_parts");
  const entries=[];
  for(const row of rows.results){
    const request=GmgnRequestSchema.parse(JSON.parse(row.request));if(request.kind!=="gmgn_token_candles"||request.address!==address||await hashJson(request)!==row.request_hash)throw Error("candle_request_identity");
    const saved=await readSourceReceipt(db,row.id),receipt=saved?Receipt.parse(saved.receipt):null;
    const known=receipt&&Date.parse(receipt.received_at)<=at.getTime();
    if(known&&receipt.research_permission_reference!==GMGN_USE_AUTHORITY)throw Error("candle_use_authority");
    const usable=known&&receipt.error===null&&!receipt.access_probe&&receipt.access_accepted&&receipt.semantic_validation==="gmgn_selected_fields_v2";
    entries.push({id:row.id,request,state:!known?"reserved" as const:usable?"succeeded" as const:"failed" as const,received_at:known?receipt.received_at:null,receipt_hash:known?await hashJson(saved!.receipt):null,response:usable?receipt.response:null});
  }
  return assembleGmgnWindowData(entries);
}
