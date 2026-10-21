import { z } from "zod";
import { reviewHolderAcquisitionData, finalizedAcquisitionTrade } from "./holder-acquisition";
import { HolderAcquisitionInputSchema, HOLDER_ACQUISITION_LIMITS } from "./holder-acquisition-model";
import { TradeSample, TradeSamplePeriod, TRADE_SAMPLE_POLICY as P, freezeTradeSample } from "./trade-sample-model";
import { hashJson } from "./solana";
import type { VerifiedTrade } from "./wallet-model";

type Context = Awaited<ReturnType<typeof reviewHolderAcquisitionData>>;
const countWallets = (trades: VerifiedTrade[]) => new Set(trades.map(t => t.wallet)).size;
const boundary = ["bounded_trade_sample_not_population_volume", "known_links_and_beneficial_independence_unqualified", "quote_transfers_not_total_wallet_cost", "repeated_sizes_or_buy_sell_overlap_not_wash_proof"];
export async function unavailableTradeSample(address: string, at: Date, state: "missing" | "rejected" | "simulation", gap: string) {
  return freezeTradeSample({ version: "trade-sample-v1", address, cutoff_at: at.toISOString(), state, anchor_at: null, freshness: "unknown",
    policy: P.version, policy_hash: await hashJson(P), input_hash: null, wallet_hash: null, source_records: 0, source_trades: 0, periods: [], gaps: [gap, ...boundary],
    population_trade_coverage: "unknown", organic_volume_usd: null, independent_participants: null, wash_trading_verdict: "not_established", total_wallet_cost_verified: false,
    source_finality_independently_attested: false, scoring_effect: "none", evidence_gates_changed: false, provider_requests: 0, database_writes: 0 });
}
function period(context: Context, minutes: 5 | 60 | 360): TradeSamplePeriod {
  const { wallet, analysis, history, unavailable } = context, anchor = Date.parse(wallet!.observed_at), requested = anchor - minutes * 60000;
  const created = wallet!.asset.creation ? Date.parse(wallet!.asset.creation.block_time) : null;
  const start = created === null ? requested : Math.max(requested, created);
  const trades = analysis!.trades.filter(t => Date.parse(t.block_time) >= start && Date.parse(t.block_time) <= anchor);
  const finalized = trades.filter(t => finalizedAcquisitionTrade(t, wallet!, Date.parse(history.cutoff_at)));
  const gaps = [...unavailable ? [unavailable] : [], ...analysis!.trades.length >= 100 ? ["trade_output_at_bound"] : [],
    ...analysis!.trades.some(t => Date.parse(t.block_time) > anchor) ? ["trade_after_wallet_endpoint"] : [],
    ...created !== null && analysis!.trades.some(t => Date.parse(t.block_time) < created) ? ["trade_before_verified_creation"] : [],
    ...finalized.length !== trades.length ? ["sampled_trade_finality_unmatched"] : [], ...created !== null && created > anchor ? ["creation_after_wallet_endpoint"] : []];
  const base = { minutes, start_at: new Date(Math.min(start, anchor)).toISOString(), end_at: wallet!.observed_at,
    clipped_to_creation: created !== null && created > requested, candidate_trades: trades.length, finalized_trades: finalized.length };
  if (gaps.length) return TradeSamplePeriod.parse({ ...base, status: "held", metrics: null, gaps });
  const buys = trades.filter(t => t.side === "buy"), sells = trades.filter(t => t.side === "sell");
  const unknownBuy = buys.filter(t => t.quote_amount_raw === null).length, unknownSell = sells.filter(t => t.quote_amount_raw === null).length;
  const total = (rows: VerifiedTrade[]) => rows.reduce((sum, t) => sum + BigInt(t.quote_amount_raw!), 0n).toString();
  const groups = new Map<string, VerifiedTrade[]>();
  for (const t of trades) if (t.quote_amount_raw !== null) {
    const key = `${t.side}:${BigInt(t.quote_amount_raw)}`; groups.set(key, [...groups.get(key) ?? [], t]);
  }
  const ordered = [...groups.values()].sort((a, b) => b.length - a.length || countWallets(b) - countWallets(a));
  const m = { buys: buys.length, sells: sells.length, buyers: countWallets(buys), sellers: countWallets(sells),
    buy_sell_wallets: new Set(buys.filter(t => sells.some(s => s.wallet === t.wallet)).map(t => t.wallet)).size,
    sized_buyers: unknownBuy ? null : countWallets(buys.filter(t => BigInt(t.quote_amount_raw!) >= BigInt(P.minimum_single_buy_quote_raw))),
    buy_quote_raw: unknownBuy ? null : total(buys), sell_quote_raw: unknownSell ? null : total(sells), unknown_buy_quote_trades: unknownBuy, unknown_sell_quote_trades: unknownSell,
    largest_known_equal_quote_trades: ordered[0]?.length ?? 0, largest_known_equal_quote_wallets: ordered[0] ? countWallets(ordered[0]) : 0 };
  return TradeSamplePeriod.parse({ ...base, status: "measured_sample", metrics: m, gaps: ["sample_not_continuous_window_coverage", ...created === null ? ["verified_creation_baseline_unavailable"] : [],
    ...trades.length === 0 ? ["empty_saved_sample_not_zero_market_activity"] : [], ...unknownBuy + unknownSell ? ["unknown_quote_totals_withheld"] : []] });
}
export async function reviewTradeSampleContext(context: Context): Promise<TradeSample> {
  const { wallet, analysis, report, history } = context, at = new Date(history.cutoff_at);
  if (!wallet || !analysis) return unavailableTradeSample(history.address, at, context.unavailable === "wallet_receipt_timestamp_conflict" ? "rejected" : "missing", context.unavailable ?? "cached_wallet_evidence_missing");
  return freezeTradeSample({ version: "trade-sample-v1", address: history.address, cutoff_at: history.cutoff_at, state: "available", anchor_at: wallet.observed_at,
    freshness: at.getTime() - Date.parse(wallet.observed_at) <= P.freshness_seconds * 1000 ? "fresh" : "stale", policy: P.version, policy_hash: await hashJson(P),
    input_hash: report.input_hash, wallet_hash: report.wallet_evidence_hash, source_records: wallet.records.length, source_trades: analysis.trades.length,
    periods: ([5, 60, 360] as const).map(minutes => period(context, minutes)), gaps: [...boundary, "source_finality_not_independently_attested", "experimental_size_threshold_not_calibrated",
      ...analysis.scope.unsupported_or_missing_transactions ? ["sample_transactions_missing_or_unsupported"] : []],
    population_trade_coverage: "unknown", organic_volume_usd: null, independent_participants: null, wash_trading_verdict: "not_established", total_wallet_cost_verified: false,
    source_finality_independently_attested: false, scoring_effect: "none", evidence_gates_changed: false, provider_requests: 0, database_writes: 0 });
}
export async function reviewTradeSample(raw: unknown) { return reviewTradeSampleContext(await reviewHolderAcquisitionData(raw)); }
export async function replayTradeSampleRecord(raw: unknown) {
  if (new TextEncoder().encode(JSON.stringify(raw)).length > HOLDER_ACQUISITION_LIMITS.input_bytes + 100000) throw Error("trade_sample_byte_limit");
  const record = z.object({ inputs: HolderAcquisitionInputSchema, report: TradeSample }).strict().parse(raw), actual = await reviewTradeSample(record.inputs);
  if (await hashJson(actual) !== await hashJson(record.report)) throw Error("trade_sample_replay_mismatch"); return actual;
}
