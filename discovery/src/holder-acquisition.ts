import { z } from "zod";
import { HolderAcquisitionInputSchema, HolderAcquisitionReportSchema, AcquisitionIntervalSchema, HOLDER_ACQUISITION_LIMITS as L } from "./holder-acquisition-model";
import { reviewHolderHistoryData, replayHolderHistorySnapshot } from "./holder-history";
import { WalletEvidenceSchema, analyzeWalletEvidence, type WalletEvidence } from "./wallet-analysis";
import type { WalletAnalysis, VerifiedTrade } from "./wallet-model";
import { canonicalPool } from "./pump";
import { hashJson } from "./solana";
import type { HolderHistoryReport } from "./holder-history-model";

export class HolderAcquisitionError extends Error {}
function bound(raw: unknown, bytes: number) {
  if(new TextEncoder().encode(JSON.stringify(raw)).length>bytes)throw new HolderAcquisitionError("holder_acquisition_byte_limit");
}
type Snapshot = Awaited<ReturnType<typeof replayHolderHistorySnapshot>>;
export function finalizedAcquisitionTrade(trade: Pick<VerifiedTrade,"signature"|"slot"|"block_time">, wallet: WalletEvidence, cutoff: number) {
  const record=wallet.records.find(row=>row.signature===trade.signature);
  if(!record || !record.transaction || record.status!=="available" || Date.parse(record.fetched_at)>cutoff)return false;
  const histories=[...wallet.histories,...(wallet.funding_scans??[]).flatMap(scan=>scan.pages),...(wallet.second_hop_scans??[]).flatMap(scan=>scan.pages)];
  const matches=histories.flatMap(history=>history.rows.filter(row=>row.signature===trade.signature).map(row=>({row,at:Date.parse(history.fetched_at)})));
  return matches.length>0 && matches.every(({row,at})=>at<=cutoff && row.err===null && row.confirmationStatus==="finalized" && row.slot===trade.slot &&
    row.blockTime!==null && row.blockTime*1000===Date.parse(trade.block_time));
}
function interval(delta: NonNullable<HolderHistoryReport["since_first"]>, start: Snapshot, end: Snapshot,
  wallet: WalletEvidence|null, analysis: WalletAnalysis|null, unavailable: string|null, cutoff: number) {
  const exclusions={missing_finalized_history:0,two_sided_or_round_trip:0,mixed_or_nonpositive_transaction_flow:0,quote_flow_unknown:0,endpoint_balance_below_sampled_acquisition:0};
  const gaps:string[]=[];
  if(delta.status!=="measured")gaps.push("holder_inventory_comparison_held");
  if(unavailable)gaps.push(unavailable);
  if(analysis?.gaps.includes("trade_output_limit"))gaps.push("wallet_trade_output_limit");
  const trades=(analysis?.trades??[]).filter(t=>t.slot>start.public.context_slot && t.slot<=end.public.context_slot &&
    Date.parse(t.block_time)>=Date.parse(delta.start_at) && Date.parse(t.block_time)<=Date.parse(delta.end_at));
  const witnessed=wallet?trades.filter(t=>finalizedAcquisitionTrade(t,wallet,cutoff)):[];
  let supported=0;
  const entrants=[...end.balances.keys()].filter(owner=>!start.balances.has(owner));
  if(!gaps.length && wallet){
    for(const owner of entrants){
      const own=trades.filter(t=>t.wallet===owner);if(!own.some(t=>t.side==="buy"))continue;
      if(own.some(t=>!finalizedAcquisitionTrade(t,wallet,cutoff))){exclusions.missing_finalized_history++;continue;}
      if(own.some(t=>t.side==="sell")){exclusions.two_sided_or_round_trip++;continue;}
      if(own.some(t=>t.quote_amount_raw===null || BigInt(t.quote_amount_raw)<=0n)){exclusions.quote_flow_unknown++;continue;}
      const groups=new Map<string,VerifiedTrade[]>();
      for(const t of own)groups.set(t.signature,[...(groups.get(t.signature)??[]),t]);
      // Transaction-wide net balances appear on every instruction: count the
      // net only once and reject unrelated transfers mixed into the same tx.
      let acquired=0n, inconsistent=false;
      for(const group of groups.values()){
        const net=BigInt(group[0]!.net_wallet_base_raw),bought=group.reduce((sum,t)=>sum+BigInt(t.base_amount_raw),0n);
        if(net<=0n || group.some(t=>BigInt(t.net_wallet_base_raw)!==net) || bought!==net)inconsistent=true;
        acquired+=net;
      }
      if(inconsistent){exclusions.mixed_or_nonpositive_transaction_flow++;continue;}
      if((end.balances.get(owner)??0n)<acquired){exclusions.endpoint_balance_below_sampled_acquisition++;continue;}
      supported++;
    }
  }
  gaps.push("sample_is_not_population_coverage","unmatched_entrants_are_unknown_not_dust_proven","signed_buy_not_beneficial_independence_or_organic_proof","endpoint_balance_not_continuous_retention");
  const held=delta.status!=="measured" || unavailable!==null || analysis?.gaps.includes("trade_output_limit")===true;
  return AcquisitionIntervalSchema.parse({status:held?"held":"measured_sample",start_hash:delta.start_hash,end_hash:delta.end_hash,start_at:delta.start_at,end_at:delta.end_at,
    raw_entrants:delta.entrants,supported_net_buy_entrants:held?null:supported,acquisition_unknown_entrants:delta.entrants===null?null:held?delta.entrants:delta.entrants-supported,
    interval_sampled_trades:trades.length,finalized_matched_transactions:new Set(witnessed.map(t=>t.signature)).size,exclusions,gaps:[...new Set(gaps)]});
}
export async function reviewHolderAcquisitionData(raw: unknown) {
  bound(raw,L.input_bytes);const input=HolderAcquisitionInputSchema.parse(raw),{report:history,snapshots}=await reviewHolderHistoryData(input.history),cutoff=Date.parse(history.cutoff_at);
  const index=input.wallet_index, gaps:string[]=[];
  for(let i=0;i<index.length;i++){
    const row=index[i]!,at=Date.parse(row.observed_at);
    if(row.address!==history.address || at>cutoff || at<Date.parse(history.requested_start) || i>0 && at>Date.parse(index[i-1]!.observed_at) || i>0 && row.evidence_hash===index[i-1]!.evidence_hash)
      throw new HolderAcquisitionError("holder_acquisition_wallet_index_mismatch");
  }
  const conflict=index.length>1 && Date.parse(index[0]!.observed_at)===Date.parse(index[1]!.observed_at);
  let unavailable:string|null=!index.length?"cached_wallet_evidence_missing":conflict?"wallet_receipt_timestamp_conflict":null;
  if(unavailable ? input.wallet!==null : !input.wallet || input.wallet.evidence_hash!==index[0]!.evidence_hash)throw new HolderAcquisitionError("holder_acquisition_wallet_selection_mismatch");
  let wallet:WalletEvidence|null=null,analysis:WalletAnalysis|null=null;
  if(input.wallet){
    bound(input.wallet.evidence,L.wallet_bytes);
    if(await hashJson(input.wallet.evidence)!==input.wallet.raw_hash)throw new HolderAcquisitionError("holder_acquisition_raw_hash_mismatch");
    wallet=WalletEvidenceSchema.parse(input.wallet.evidence);
    if(await hashJson(wallet)!==input.wallet.evidence_hash)throw new HolderAcquisitionError("holder_acquisition_evidence_hash_mismatch");
    if(wallet.observed_at!==index[0]!.observed_at || wallet.asset.address!==history.address || wallet.asset.pool!==(await canonicalPool(history.address)).pool ||
      history.snapshots.some(row=>row.pool!==wallet!.asset.pool || row.program!==wallet!.asset.token_program))throw new HolderAcquisitionError("holder_acquisition_scope_mismatch");
    if([...wallet.histories,...(wallet.funding_scans??[]).flatMap(scan=>scan.pages),...(wallet.second_hop_scans??[]).flatMap(scan=>scan.pages)]
      .some(row=>Date.parse(row.fetched_at)>Date.parse(wallet!.observed_at)))throw new HolderAcquisitionError("holder_acquisition_history_from_future");
    analysis=await analyzeWalletEvidence(wallet);
    if(analysis.evidence_hash!==input.wallet.evidence_hash)throw new HolderAcquisitionError("holder_acquisition_replay_mismatch");
    if(analysis.gaps.includes("trade_output_limit"))unavailable="wallet_trade_output_limit";
  }
  const compare=(delta:HolderHistoryReport["since_first"])=>delta?interval(delta,snapshots.find(row=>row.public.payload_hash===delta.start_hash)!,snapshots.find(row=>row.public.payload_hash===delta.end_hash)!,wallet,analysis,unavailable,cutoff):null;
  const walletStale=!wallet || cutoff-Date.parse(wallet.observed_at)>3_600_000;
  if(unavailable)gaps.push(unavailable);if(walletStale)gaps.push("wallet_sample_stale_or_missing");
  gaps.push("latest_cached_wallet_sample_only","population_trade_coverage_unknown","economic_balance_rules_not_calibrated","source_receipts_not_independent_finality_attestation");
  const report={version:"holder-acquisition-v1" as const,history,selection:input.selection,wallet_evidence_hash:input.wallet?.evidence_hash??null,wallet_raw_hash:input.wallet?.raw_hash??null,
    wallet_observed_at:wallet?.observed_at??null,wallet_stale:walletStale,wallet_records:wallet?.records.length??0,since_first:compare(history.since_first),recent:compare(history.recent),gaps,
    meaningful_holder_growth:null,organic_demand_certified:false,beneficial_independence_verified:false,population_trade_coverage:"unknown",scoring_effect:"none",evidence_gates_changed:false,
    provider_requests:0,database_writes:0,input_hash:await hashJson(input)};
  return {report:HolderAcquisitionReportSchema.parse({...report,report_hash:await hashJson(report)}),input,history,snapshots,wallet,analysis,unavailable};
}
// Preserve the original public/exported report, including its exact v1 hash.
export async function reviewHolderAcquisition(raw:unknown){return (await reviewHolderAcquisitionData(raw)).report;}
export async function replayHolderAcquisitionRecord(raw: unknown){
  bound(raw,L.input_bytes+100_000);const record=z.object({inputs:HolderAcquisitionInputSchema,report:HolderAcquisitionReportSchema}).strict().parse(raw);
  const actual=await reviewHolderAcquisition(record.inputs);
  if(await hashJson(actual)!==await hashJson(record.report))throw new HolderAcquisitionError("holder_acquisition_report_mismatch");return actual;
}
