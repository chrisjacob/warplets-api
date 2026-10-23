import type { AttentionQueueResult } from "./attention-queue-model";

export const LIGHTWEIGHT_ATTENTION_POLICY = {
  version: "attention-lightweight-v1", fresh_seconds: 7200, minimum_liquidity_usd: 10000,
  required: ["fresh_attention", "no_reported_adverse_flag", "fresh_dex_crosscheck", "reported_liquidity", "two_sided_trading"],
  unknown_security_is_not_a_pass: true, score_effect: "none", launch_gates_changed: false,
} as const;
type Row = AttentionQueueResult["rows"][number];
export function lightweightAttention(row: Row) {
  const gaps: string[] = [];
  if (row.attention_families <= 0) gaps.push("attention_stale");
  if (row.checks === "adverse") gaps.push("provider_adverse_flag");
  if (!row.market_crosschecked) gaps.push("fresh_dex_crosscheck_needed");
  if (row.liquidity_usd === null || row.liquidity_usd < LIGHTWEIGHT_ATTENTION_POLICY.minimum_liquidity_usd) gaps.push("liquidity_low_or_unknown");
  if (!row.buys || !row.sells) gaps.push("two_sided_trading_unresolved");
  return { reviewable: gaps.length === 0, gaps, security_verified: false as const, launch_eligible: false as const };
}
// Preserve provider-reported order without adding consensus, structural-score,
// candle or token-age bonuses. GMGN 24h Hot leads; Gecko-only leads follow.
export function providerAttentionOrder(queue: AttentionQueueResult) {
  const source = (r: Row) => r.sources.find(s => s.provider === "gmgn" && s.window === "24h" && s.fresh)
    ?? r.sources.find(s => s.provider === "gmgn" && s.fresh) ?? r.sources.find(s => s.provider === "geckoterminal" && s.fresh);
  return queue.rows.filter(r => source(r)).sort((a, b) => {
    const x = source(a)!, y = source(b)!;
    return Number(y.provider === "gmgn") - Number(x.provider === "gmgn")
      || (y.search_interest ?? -1) - (x.search_interest ?? -1) || (x.rank ?? 100000) - (y.rank ?? 100000)
      || `${a.chain}:${a.address}`.localeCompare(`${b.chain}:${b.address}`);
  });
}
