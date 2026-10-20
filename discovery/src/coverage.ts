import { assess, type Candidate, type Policy } from "./model";
import { createdWithinWindow } from "./priority";
import { CoverageSchema } from "./coverage-model";
export function discoveryCoverage(all: Candidate[], policy: Policy, now: Date) {
  const recent = all.filter(c => createdWithinWindow(c, now)), rows = recent.map(c => assess(c, policy, now));
  const eligible = rows.filter(c => c.eligibility === "eligible").length, reasons = new Map<string, number>();
  for (const c of rows) for (const reason of c.reasons) reasons.set(reason, (reasons.get(reason) ?? 0) + 1);
  return CoverageSchema.parse({ target: 10, observed: all.length, created_24h: recent.length, creation_unknown: all.filter(c => !c.creation).length, eligible, remaining: Math.max(0, 10 - eligible),
    market_floor_met: recent.filter(c => c.market && c.market.market_cap_usd !== null && c.market.market_cap_usd >= policy.min_market_cap_usd && c.market.liquidity_usd !== null && c.market.liquidity_usd >= policy.min_liquidity_usd && now.getTime() - Date.parse(c.market.fetched_at) <= policy.max_market_age_seconds * 1000).length,
    // A diagnostic stage count, never an alternate eligibility policy or rank.
    holder_checks_met: recent.filter(c => assess(c, { ...policy, require_wallet_analysis: false }, now).eligibility === "eligible").length,
    blockers: [...reasons].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 12).map(([code, count]) => ({ code, count })), at: now.toISOString(), scope: "stored_candidates_not_exhaustive",
  });
}
