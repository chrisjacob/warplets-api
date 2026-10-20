import type { Candidate, Policy } from "./model";

export function createdWithinWindow(c: Candidate, now: Date): boolean {
  const age = c.creation ? now.getTime() - Date.parse(c.creation.block_time) : null;
  return age !== null && age >= 0 && age <= 86400000;
}
export function knownRiskFailure(c: Candidate, p: Policy): boolean {
  return c.verification === "rejected" || c.risk.mint_authority === "active" || c.risk.freeze_authority === "active" ||
    Boolean(c.holders && ((c.holders.top1_pct ?? 0) > p.max_top1_pct || (c.holders.top10_pct ?? 0) > p.max_top10_pct || (c.holders.creator_pct ?? 0) > p.max_creator_pct || c.holders.status === "verified" && c.holders.holder_count < p.min_holders)) ||
    Boolean(c.wallet_analysis && ((c.wallet_analysis.metrics.dev_funded_supply_pct ?? 0) > p.max_dev_funded_supply_pct || (c.wallet_analysis.metrics.dev_sold_supply_pct ?? 0) > p.max_dev_sold_supply_pct));
}
export function potential(c: Candidate, p: Policy, now: Date): boolean {
  return createdWithinWindow(c, now) && c.verification === "verified" && Boolean(c.graduation) && !knownRiskFailure(c, p) &&
    (c.market?.liquidity_usd ?? 0) >= p.min_liquidity_usd && (c.market?.market_cap_usd === null || c.market?.market_cap_usd === undefined || c.market.market_cap_usd >= p.min_market_cap_usd);
}
export function comparePotential(a: Candidate, b: Candidate, p: Policy, now: Date): number {
  const tier = (c: Candidate) => potential(c, p, now) ? 0 : createdWithinWindow(c, now) && !knownRiskFailure(c, p) ? 1 : !c.creation ? 2 : 3;
  return tier(a) - tier(b) || (b.market?.liquidity_usd ?? 0) - (a.market?.liquidity_usd ?? 0) || a.address.localeCompare(b.address);
}
// Collection scheduling only. These gaps still block the unchanged policy;
// the current bounded source cannot finish them by repeating the same reads.
export const fundingSourceLimited = (gaps: string[]) => gaps.some(g => ["provider_history_ended_before_window_boundary", "funding_page_limit", "funding_transaction_limit", "funding_window_exceeds_transaction_bound", "funding_transaction_missing_or_unsupported", "funding_signature_time_unknown", "funding_signature_not_finalized", "wallet_transaction_sample_limit"].includes(g));
export function compareCollectionPotential(a: Candidate, b: Candidate, p: Policy, now: Date): number {
  const limited = (c: Candidate) => potential(c,p,now) && c.wallet_analysis?.funding_coverage?.some(f=>fundingSourceLimited(f.gaps)) ? 1 : 0;
  if(potential(a,p,now)&&potential(b,p,now))return limited(a)-limited(b)||comparePotential(a,b,p,now);
  return comparePotential(a,b,p,now);
}
