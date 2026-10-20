import type { AssessedCandidate } from "../../../discovery/src/model";
import type { CandidateCard } from "../../../discovery/src/candidate-card";
import { DEFAULT_POLICY } from "../../../discovery/src/model";
import { readableReason, marketSource } from "./client";

export const tokenMoney = (value: number | null | undefined) => value == null ? "Unavailable" : value > 0 && value < 0.000001 ? `$${value.toExponential(3)}` : new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: value < 1 ? 6 : 0 }).format(value);
const compactMoney = (value: number | null | undefined) => value == null || value < 10_000 ? tokenMoney(value) : new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", notation: "compact", maximumFractionDigits: 2 }).format(value);
export function creationAge(at: string | null | undefined, now = Date.now()) {
  const elapsed = at ? now - Date.parse(at) : NaN;
  if (!Number.isFinite(elapsed) || elapsed < 0) return "Unknown";
  const minutes = Math.floor(elapsed / 60_000);
  return minutes < 60 ? `${minutes}m ago` : minutes < 1440 ? `${Math.floor(minutes / 60)}h ago` : `${Math.floor(minutes / 1440)}d ago`;
}
export function eligibilityMeaning(status: CandidateCard["eligibility"]) {
  return { eligible: "Required checks passed", provisional: "Checks incomplete", excluded: "Does not meet the current rules" }[status];
}
export function marketSnapshotStale(market: CandidateCard["market"], now = Date.now()) {
  const elapsed = market ? now - Date.parse(market.fetched_at) : NaN;
  return !Number.isFinite(elapsed) || elapsed < 0 || elapsed > DEFAULT_POLICY.max_market_age_seconds * 1000;
}
export function shortBlocker(code: string) {
  return ({ pre_buy_funding_coverage_partial: "Funding history is incomplete", wallet_sample_coverage_incomplete: "Wallet and funding coverage is incomplete", wallet_analysis_stale: "Wallet checks need refreshing", wallet_analysis_unavailable: "Wallet checks are pending", holder_concentration_unknown: "Holder checks are pending", holder_evidence_stale: "Holder checks need refreshing", market_data_stale: "Market data needs refreshing", risk_evidence_stale: "Onchain checks need refreshing" } as Record<string, string>)[code] ?? readableReason(code);
}
export function EligibilityOverview({ status, reasons }: { status: CandidateCard["eligibility"]; reasons: string[] }) {
  return <section className="tenx-panel tenx-check-summary" aria-label="Eligibility summary"><div className="tenx-row"><h2>{eligibilityMeaning(status)}</h2><span className={`tenx-badge tenx-badge--${status}`}>{status}</span></div>
    {status === "excluded" ? <ul>{reasons.map(reason => <li key={reason}>{shortBlocker(reason)}</li>)}</ul> : <>
      <p>{reasons.length ? [...new Set(reasons.map(shortBlocker))].slice(0, 2).join(". ") + "." : "This snapshot meets the discovery rules. Eligibility is not a safety rating."}</p>
      {!!reasons.length && <details><summary>View all missing checks ({reasons.length})</summary><ul>{reasons.map(reason => <li key={reason}>{readableReason(reason)}</li>)}</ul></details>}
    </>}
  </section>;
}
export function TokenMarketOverview({ candidate: c, now = Date.now() }: { candidate: Pick<CandidateCard, "market" | "creation">; now?: number }) {
  const market = c.market, stale = marketSnapshotStale(market, now);
  return <section className="tenx-market-overview" aria-label="Market summary"><dl>
    <div><dt>Price</dt><dd>{tokenMoney(market?.price_usd)}</dd></div><div><dt>Reported market cap</dt><dd title={market?.market_cap_usd == null ? undefined : tokenMoney(market.market_cap_usd)}>{compactMoney(market?.market_cap_usd)}</dd></div><div><dt>Liquidity</dt><dd title={market?.liquidity_usd == null ? undefined : tokenMoney(market.liquidity_usd)}>{compactMoney(market?.liquidity_usd)}</dd></div><div><dt>Created</dt><dd>{creationAge(c.creation?.block_time, now)}</dd></div>
    </dl><p>{market ? <>{marketSource(market.source)} · fetched {new Date(market.fetched_at).toLocaleString()}{stale && <strong className="tenx-market-warning"> · Stale or invalid timestamp</strong>}</> : "Market data unavailable"}</p></section>;
}
export function WalletRiskSummary({ candidate: c }: { candidate: AssessedCandidate }) {
  const w = c.wallet_analysis, signals = [...new Set(w?.signals.map(signal => readableReason(signal.code)) ?? [])];
  return <section className="tenx-panel" aria-label="Wallet risk summary"><h2>Wallet connections</h2>
    {signals.length ? <><p>Relationships to review; they do not prove common control.</p><ul>{signals.map(signal => <li key={signal}>{signal}</li>)}</ul></> : <p>{!w || w.status === "unavailable" ? "Wallet evidence is not available yet." : w.status === "signals_detected" ? "The saved wallet sample needs review." : "No supported connection signal in the saved sample. This is not a safety rating."}</p>}
    <a href="#wallet-analysis">View wallet & funding evidence →</a>
  </section>;
}
