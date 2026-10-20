import { ActivitySchema } from "./activity-model";
import type { Candidate, Market } from "./model";
import { analyzeWalletEvidence, WalletEvidenceSchema, type WalletEvidence } from "./wallet-analysis";
import { hashJson } from "./solana";
import { tradingFeeSummary } from "./trading-fees";

// Diagnostics only: no volume/organic classification or eligibility override.
export async function activitySummary(candidate: Candidate, raw: WalletEvidence | null, points: Market[], now: Date) {
  const gaps = new Set(["organic_activity_unverified", "non_exhaustive_trade_sample"]);
  let fees: { network_fee_lamports_raw: string | null; transactions: number; trades: number; distinct_payers: number; largest_payer_transaction_pct: number | null } = { network_fee_lamports_raw:null,transactions:0,trades:0,distinct_payers:0,largest_payer_transaction_pct:null };
  let tradingFees=await tradingFeeSummary(null,[]);
  let wallets = null, walletAt: string | null = null, walletHash: string | null = null;
  if (raw) {
    const input = WalletEvidenceSchema.parse(raw);
    if (Date.parse(input.observed_at)>now.getTime()) throw new Error("activity_wallet_evidence_from_future");
    walletHash = await hashJson(input);
    if (walletHash !== candidate.wallet_analysis?.evidence_hash || input.asset.address !== candidate.address || input.asset.pool !== candidate.pool) throw new Error("activity_wallet_evidence_mismatch");
    const analysis = await analyzeWalletEvidence(input), signatures = new Set(analysis.trades.map(t=>t.signature));
    tradingFees=await tradingFeeSummary(input,analysis.trades);
    const transactions = input.records.filter(r=>r.status==="available" && r.transaction && signatures.has(r.signature));
    const payers = new Map<string,number>(); let total = 0n;
    for (const record of transactions) {
      const tx=record.transaction!; total+=BigInt(tx.meta!.fee);
      const payer=tx.transaction.message.accountKeys[0]!; payers.set(payer,(payers.get(payer)??0)+1);
    }
    fees={...fees,network_fee_lamports_raw:transactions.length?total.toString():null,transactions:transactions.length,trades:analysis.trades.length,distinct_payers:payers.size,largest_payer_transaction_pct:transactions.length?Math.max(...payers.values())/transactions.length*100:null};
    wallets={buyers:analysis.metrics.distinct_buyers,sellers:new Set(analysis.trades.filter(t=>t.side==="sell").map(t=>t.wallet)).size,round_trips:analysis.metrics.round_trip_wallets,shared_funder_buyers:analysis.metrics.shared_funder_buyers};
    walletAt=input.observed_at;
    if (now.getTime()-Date.parse(walletAt)>3600000) gaps.add("wallet_sample_stale");
    if (analysis.gaps.some(g=>g.includes("funding")||g.includes("sample_limit"))) gaps.add("wallet_sample_coverage_partial");
    if (!transactions.length) gaps.add("verified_trade_fees_unavailable");
  } else gaps.add("wallet_evidence_unavailable");
  if(tradingFees.status!=="verified_sample")gaps.add(tradingFees.status==="unavailable"?"trading_fees_unavailable":"trading_fee_coverage_partial");
  const ordered=[...points].filter(p=>Date.parse(p.fetched_at)<=now.getTime()).sort((a,b)=>a.fetched_at.localeCompare(b.fetched_at));
  const prices={samples:0,upward_steps:0,downward_steps:0,unchanged_steps:0,gaps:0,largest_step_pct:null as number|null,continuous_return_pct:null as number|null,first_at:null as string|null,last_at:null as string|null};
  let previous:Market|null=null,first:Market|null=null;
  const times=new Set<string>();
  for (const point of ordered) {
    if (times.has(point.fetched_at)) { prices.gaps++;previous=null;continue; } times.add(point.fetched_at);
    if (point.price_usd===null || point.price_usd<=0) { prices.gaps++;previous=null;continue; }
    prices.samples++;first??=point;prices.first_at??=point.fetched_at;prices.last_at=point.fetched_at;
    if (previous) {
      if (point.source!==previous.source || Date.parse(point.fetched_at)-Date.parse(previous.fetched_at)>1800000) prices.gaps++;
      else {
        const change=(point.price_usd/previous.price_usd!-1)*100;
        if (!Number.isFinite(change)) {prices.gaps++;previous=point;continue;}
        if (change>0) prices.upward_steps++;else if(change<0) prices.downward_steps++;else prices.unchanged_steps++;
        prices.largest_step_pct=Math.max(prices.largest_step_pct??0,Math.abs(change));
      }
    }
    previous=point;
  }
  if (first && previous && prices.samples>=2 && prices.gaps===0) {const change=(previous.price_usd!/first.price_usd!-1)*100;if(Number.isFinite(change))prices.continuous_return_pct=change;}
  if (prices.samples<2) gaps.add("price_history_insufficient");
  if (prices.gaps) gaps.add("price_history_discontinuous");
  if (!prices.last_at || now.getTime()-Date.parse(prices.last_at)>180000) gaps.add("price_observation_stale");
  return ActivitySchema.parse({address:candidate.address,observed_at:now.toISOString(),scope:"cached_bounded_observations",organic_trading:"unverified",volume_authenticity:"unverified",wallet_evidence_hash:walletHash,wallet_observed_at:walletAt,fees,trading_fees:tradingFees,wallets,prices,gaps:[...gaps]});
}
