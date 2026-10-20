import type { Candidate } from "./model";

export const NEW_TOKEN_CAP_REVIEW_USD = 10_000_000;
const DAY_MS = 86_400_000;

// A review heuristic using retained observations, never an eligibility or ranking rule.
// A reported cap is not independently verified circulating supply or capital invested.
export function reportedCapReview(c: { market: Candidate["market"]; creation: Pick<NonNullable<Candidate["creation"]>, "block_time"> | null }, now: Date, maxMarketAgeSeconds: number) {
  if (!c.creation || !c.market) return null;
  const age = now.getTime() - Date.parse(c.creation.block_time), cap = c.market.market_cap_usd;
  if (!Number.isFinite(age) || age < 0 || age > DAY_MS || cap === null || !Number.isFinite(cap) || cap <= NEW_TOKEN_CAP_REVIEW_USD) return null;
  const marketAge = now.getTime() - Date.parse(c.market.fetched_at);
  const liquidity = c.market.liquidity_usd;
  return {
    market_cap_usd: cap, age_hours: age / 3_600_000, fetched_at: c.market.fetched_at,
    market_stale: !Number.isFinite(marketAge) || marketAge < 0 || marketAge > maxMarketAgeSeconds * 1000,
    liquidity_to_cap_pct: liquidity !== null && Number.isFinite(liquidity) && liquidity >= 0 ? liquidity / cap * 100 : null,
  };
}
