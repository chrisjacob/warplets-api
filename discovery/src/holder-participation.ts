import {z} from "zod";
import {reviewHolderAcquisitionData,finalizedAcquisitionTrade} from "./holder-acquisition";
import {HolderAcquisitionInputSchema,HOLDER_ACQUISITION_LIMITS} from "./holder-acquisition-model";
import {HolderEvidenceSchema} from "./holders";
import {HolderParticipation,HolderParticipationInterval,HOLDER_PARTICIPATION_POLICY as P,HOLDER_PARTITIONS,freezeHolderParticipation} from "./holder-participation-model";
import {hashJson} from "./solana";
import type {HolderHistoryReport} from "./holder-history-model";
import type {VerifiedTrade} from "./wallet-model";

type Context=Awaited<ReturnType<typeof reviewHolderAcquisitionData>>;
const boundaryGaps=["sample_not_population_or_organic_lower_bound","beneficial_independence_and_unseen_links_unknown","endpoint_balance_not_continuous_retention","native_quote_not_usd_or_total_wallet_cost","experimental_size_and_retention_thresholds_not_calibrated"];
export async function unavailableHolderParticipation(address:string,at:Date,state:"missing"|"rejected"|"simulation",gap:string){
  return freezeHolderParticipation({version:"holder-participation-v1",address,cutoff_at:at.toISOString(),state,policy:P.version,policy_hash:await hashJson(P),history_hash:null,acquisition_hash:null,input_hash:null,
    wallet_hash:null,wallet_observed_at:null,latest_inventory_at:null,freshness:"unknown",since_first:null,recent:null,inventory_hashes:[],gaps:[gap,...boundaryGaps],meaningful_holder_growth_24h:null,
    beneficial_independence_verified:false,continuous_retention_verified:false,organic_demand_certified:false,population_trade_coverage:"unknown",scoring_effect:"none",evidence_gates_changed:false,provider_requests:0,database_writes:0});
}
function observedLinks(context:Context,trades:VerifiedTrade[],endSlot:number,endTime:number){
  const {wallet,analysis,input}=context,excluded=new Set<string>();if(!wallet||!analysis)return excluded;
  const creators=new Set(input.history.samples.map(s=>HolderEvidenceSchema.parse(s.evidence).creator).filter((v):v is string=>v!==null));
  for(const profile of analysis.wallets)if(profile.roles.includes("creation_user")||profile.roles.includes("declared_creator"))creators.add(profile.wallet);
  for(const creator of creators)excluded.add(creator);
  const buys=trades.filter(t=>t.side==="buy"),buyers=new Set(buys.map(t=>t.wallet));
  // A sponsor/shared payer is a screening exclusion, never a fraud label.
  const fee=new Map<string,Set<string>>(),transactions=new Map<string,Set<string>>();
  for(const t of buys){if(t.fee_payer!==t.wallet)excluded.add(t.wallet);fee.set(t.fee_payer,new Set([...(fee.get(t.fee_payer)??[]),t.wallet]));transactions.set(t.signature,new Set([...(transactions.get(t.signature)??[]),t.wallet]));}
  for(const group of [...fee.values(),...transactions.values()])if(group.size>1)for(const owner of group)excluded.add(owner);
  const eligible=(t:Parameters<typeof finalizedAcquisitionTrade>[0])=>t.slot<=endSlot&&Date.parse(t.block_time)<=endTime&&finalizedAcquisitionTrade(t,wallet,Date.parse(context.history.cutoff_at));
  const bySource=new Map<string,Set<string>>();
  for(const f of analysis.funding.filter(f=>f.before_sampled_buy&&buyers.has(f.to)&&eligible(f))){
    if(creators.has(f.from))excluded.add(f.to);
    bySource.set(f.from,new Set([...(bySource.get(f.from)??[]),f.to]));
  }
  for(const group of bySource.values())if(group.size>1)for(const owner of group)excluded.add(owner);
  const paths=analysis.second_hop?.paths.filter(p=>eligible(p.upstream)&&eligible(p.downstream))??[];
  const sourcesToCreator=new Set(paths.filter(p=>p.target_role==="signed_creation"&&creators.has(p.target)).map(p=>p.source));
  const byUpstream=new Map<string,Set<string>>();
  for(const p of paths.filter(p=>p.target_role==="early_buyer"&&buyers.has(p.target))){if(creators.has(p.source)||sourcesToCreator.has(p.source))excluded.add(p.target);byUpstream.set(p.source,new Set([...(byUpstream.get(p.source)??[]),p.target]));}
  for(const group of byUpstream.values())if(group.size>1)for(const owner of group)excluded.add(owner);
  return excluded;
}
function interval(context:Context,delta:NonNullable<HolderHistoryReport["since_first"]>):HolderParticipationInterval{
  const {history,snapshots,wallet,analysis,unavailable}=context,start=snapshots.find(s=>s.public.payload_hash===delta.start_hash)!,end=snapshots.find(s=>s.public.payload_hash===delta.end_hash)!,gaps:string[]=[];
  if(delta.status!=="measured")gaps.push("holder_inventory_comparison_held",...delta.gaps);if(unavailable)gaps.push(unavailable);
  if(analysis?.gaps.some(g=>["trade_output_limit","funding_output_limit","funding_wallet_limit"].includes(g))||analysis?.funding.length===100||analysis?.second_hop?.gaps.some(g=>g.endsWith("_limit")))gaps.push("trade_or_link_output_truncated_or_at_bound");
  if(!wallet||!analysis)gaps.push("cached_wallet_evidence_missing");
  const base={start_at:delta.start_at,end_at:delta.end_at,start_hash:delta.start_hash,end_hash:delta.end_hash,raw_entrants:delta.entrants};
  if(gaps.length)return HolderParticipationInterval.parse({...base,status:"held",signed_net_buy_entrants:null,screened_retained_entrants:null,partitions:null,gaps:[...new Set(gaps)]});
  const cutoff=Date.parse(history.cutoff_at),trades=analysis!.trades.filter(t=>t.slot>start.public.context_slot&&t.slot<=end.public.context_slot&&Date.parse(t.block_time)>=Date.parse(delta.start_at)&&Date.parse(t.block_time)<=Date.parse(delta.end_at));
  const links=observedLinks(context,trades,end.public.context_slot,Date.parse(delta.end_at));
  const partitions=Object.fromEntries(HOLDER_PARTITIONS.map(k=>[k,0])) as Record<typeof HOLDER_PARTITIONS[number],number>;
  let signed=0;
  for(const owner of end.balances.keys()){
    if(start.balances.has(owner))continue;const own=trades.filter(t=>t.wallet===owner);
    if(!own.some(t=>t.side==="buy")){partitions.no_sampled_buy++;continue;}
    if(own.some(t=>!finalizedAcquisitionTrade(t,wallet!,cutoff))){partitions.missing_finalized_history++;continue;}
    if(own.some(t=>t.side==="sell")){partitions.sampled_sell++;continue;}
    if(own.some(t=>t.quote_amount_raw===null||BigInt(t.quote_amount_raw)<=0n)){partitions.unknown_quote++;continue;}
    const groups=new Map<string,VerifiedTrade[]>();for(const t of own)groups.set(t.signature,[...(groups.get(t.signature)??[]),t]);
    let acquired=0n,quote=0n,inconsistent=false;
    for(const group of groups.values()){
      const net=BigInt(group[0]!.net_wallet_base_raw),bought=group.reduce((sum,t)=>sum+BigInt(t.base_amount_raw),0n);
      if(net<=0n||group.some(t=>BigInt(t.net_wallet_base_raw)!==net)||bought!==net)inconsistent=true;
      acquired+=net;quote+=group.reduce((sum,t)=>sum+BigInt(t.quote_amount_raw!),0n);
    }
    if(inconsistent){partitions.mixed_net_flow++;continue;}
    if((end.balances.get(owner)??0n)<acquired){partitions.insufficient_endpoint_balance++;continue;}
    signed++;
    if(links.has(owner)){partitions.observed_creator_or_link++;continue;}
    if(quote<BigInt(P.minimum_quote_raw)){partitions.below_native_size++;continue;}
    const latest=Math.max(...own.map(t=>Date.parse(t.block_time)));
    if(Date.parse(delta.end_at)-latest<P.minimum_retention_seconds*1000){partitions.retention_not_mature++;continue;}
    partitions.supported++;
  }
  return HolderParticipationInterval.parse({...base,status:"measured_sample",signed_net_buy_entrants:signed,screened_retained_entrants:partitions.supported,partitions,gaps:["unmatched_entrants_are_unknown_not_dust_proven","absence_of_observed_links_not_independence",...boundaryGaps]});
}
export async function reviewHolderParticipation(raw:unknown){
  return reviewHolderParticipationContext(await reviewHolderAcquisitionData(raw));
}
export async function reviewHolderParticipationContext(context:Context){
  const {report,history}=context,cutoff=Date.parse(history.cutoff_at),latest=history.snapshots.at(-1)?.observed_at??null;
  const fresh=latest&&report.wallet_observed_at&&cutoff-Date.parse(latest)<=P.inventory_fresh_seconds*1000&&cutoff-Date.parse(report.wallet_observed_at)<=P.wallet_fresh_seconds*1000;
  const sourceGaps=context.analysis?.gaps.filter(g=>["transactions_missing_or_unsupported","transaction_not_certified_for_trade_analysis","trade_user_not_transaction_signer","native_quote_amount_unmeasured","amm_quote_transfer_unverified","noncanonical_trade_accounts","trade_token_owner_unverified","buyer_funding_histories_not_all_sampled","pre_buy_funding_coverage_partial","second_hop_coverage_partial","creation_wallets_unverified"].includes(g))??[];
  return freezeHolderParticipation({version:"holder-participation-v1",address:history.address,cutoff_at:history.cutoff_at,state:"available",policy:P.version,policy_hash:await hashJson(P),history_hash:history.report_hash,acquisition_hash:report.report_hash,input_hash:report.input_hash,
    wallet_hash:report.wallet_evidence_hash,wallet_observed_at:report.wallet_observed_at,latest_inventory_at:latest,freshness:fresh?"fresh":latest||report.wallet_observed_at?"stale":"unknown",
    since_first:history.since_first?interval(context,history.since_first):null,recent:history.recent?interval(context,history.recent):null,inventory_hashes:history.snapshots.map(s=>s.payload_hash),
    gaps:[...boundaryGaps,...sourceGaps,...report.wallet_stale?["wallet_sample_stale_or_missing"]:[],...!history.since_first?["comparable_inventory_baseline_missing"]:[],"actual_interval_not_trailing_24h","source_finality_not_independently_attested"],
    meaningful_holder_growth_24h:null,beneficial_independence_verified:false,continuous_retention_verified:false,organic_demand_certified:false,population_trade_coverage:"unknown",scoring_effect:"none",evidence_gates_changed:false,provider_requests:0,database_writes:0});
}
export async function replayHolderParticipationRecord(raw:unknown){
  if(new TextEncoder().encode(JSON.stringify(raw)).length>HOLDER_ACQUISITION_LIMITS.input_bytes+100000)throw Error("holder_participation_byte_limit");
  const record=z.object({inputs:HolderAcquisitionInputSchema,report:HolderParticipation}).strict().parse(raw),actual=await reviewHolderParticipation(record.inputs);
  if(await hashJson(actual)!==await hashJson(record.report))throw Error("holder_participation_replay_mismatch");return actual;
}
