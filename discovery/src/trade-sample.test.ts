import { expect, it } from "vitest";
import { acquisitionInput, acquisitionWallet } from "./holder-acquisition-fixtures.test-helper";
import { holderHistoryFixture } from "./holder-history-fixtures.test-helper";
import { participationTrade } from "./holder-participation-fixtures.test-helper";
import { trade, key, walletInput } from "./wallet-fixtures.test-helper";
import { reviewTradeSample, reviewTradeSampleContext, replayTradeSampleRecord } from "./trade-sample";
import { reviewHolderAcquisitionData } from "./holder-acquisition";
import { verifyTradeSample, TRADE_SAMPLE_POLICY, TradeSample } from "./trade-sample-model";
import { hashJson } from "./solana";
import type { WalletTransaction } from "./wallet-rpc";

const input = async (transactions: WalletTransaction[]) => acquisitionInput(await holderHistoryFixture(), await acquisitionWallet(transactions));
it("measures recent signed instruction flow, breadth, known equal sizes and buy/sell overlap without an organic verdict", async () => {
  const raw = await input([
    await participationTrade({ owner: key(5), quote: 20000000n, time: "2026-10-21T08:59:00Z", sig: 74, slot: 31009 }),
    await participationTrade({ quote: 20000000n, time: "2026-10-21T09:00:00Z" }),
    await participationTrade({ owner: key(4), quote: 20000000n, time: "2026-10-21T09:00:30Z", sig: 72, slot: 31011 }),
    await participationTrade({ side: "sell", quote: 10000000n, time: "2026-10-21T09:01:00Z", sig: 73, slot: 31012 }),
    await participationTrade({ owner: key(6), quote: 500000n, time: "2026-10-21T08:00:00Z", sig: 75, slot: 31000 })
  ]), before = structuredClone(raw), report = await reviewTradeSample(raw);
  expect(report.periods[0]).toMatchObject({ status: "measured_sample", candidate_trades: 4, finalized_trades: 4, metrics: { buys: 3, sells: 1, buyers: 3, sellers: 1,
    buy_sell_wallets: 1, sized_buyers: 3, buy_quote_raw: "60000000", sell_quote_raw: "10000000", largest_known_equal_quote_trades: 3, largest_known_equal_quote_wallets: 3 } });
  expect(report.periods[2]!.metrics!.buys).toBe(4); expect(report.organic_volume_usd).toBeNull(); expect(report.wash_trading_verdict).toBe("not_established");
  expect(report.scoring_effect).toBe("none"); expect(raw).toEqual(before); expect(await verifyTradeSample(report)).toEqual(report);
  expect(await replayTradeSampleRecord({ inputs: raw, report })).toEqual(report);
});
it("withholds unknown buy totals and sized-buyer counts while retaining known sell quantities", async () => {
  const unknown = await trade(key(4), 31011, "buy", 72); unknown.blockTime = Date.parse("2026-10-21T09:00:00Z") / 1000;
  const report = await reviewTradeSample(await input([unknown, await participationTrade({ side: "sell", quote: 10000000n, time: "2026-10-21T09:01:00Z" })]));
  expect(report.periods[0]!.metrics).toMatchObject({ buyers: 1, buy_quote_raw: null, sized_buyers: null, unknown_buy_quote_trades: 1, sell_quote_raw: "10000000" });
});
it("preserves exact raw quantities above JavaScript's safe integer range", async () => {
  const amount = 9007199254740993n;
  const report = await reviewTradeSample(await input([await participationTrade({ quote: amount, time: "2026-10-21T09:00:00Z" }), await participationTrade({ quote: amount, time: "2026-10-21T09:01:00Z", sig: 72, slot: 31011 })]));
  expect(report.periods[0]!.metrics!.buy_quote_raw).toBe((amount * 2n).toString());
});
it("separates absent wallets from an empty saved sample and rejects conflicting/altered source receipts", async () => {
  const missing = await reviewTradeSample(await acquisitionInput(await holderHistoryFixture(), null)); expect(missing.state).toBe("missing"); expect(missing.periods).toEqual([]);
  const raw = await input([]), report = await reviewTradeSample(raw); expect(report.periods[0]!.metrics).toMatchObject({ buys: 0, buyers: 0, buy_quote_raw: "0" });
  expect(report.periods[0]!.gaps).toContain("empty_saved_sample_not_zero_market_activity");
  const bad = structuredClone(raw); bad.wallet!.raw_hash = "f".repeat(64); await expect(reviewTradeSample(bad)).rejects.toThrow("raw_hash_mismatch");
  const changed = structuredClone(report); changed.policy_hash = "f".repeat(64); await expect(verifyTradeSample(changed)).rejects.toThrow("hash_or_policy");
  expect(TradeSample.safeParse({ ...report, independent_participants: 0 }).success).toBe(false);
  expect(await hashJson(TRADE_SAMPLE_POLICY)).toBe(report.policy_hash);
});
it("holds intervals with unmatched finality and rejects duplicate transaction records", async () => {
  const tx = await participationTrade({ time: "2026-10-21T09:00:00Z" }), wallet = await acquisitionWallet([tx]); wallet.histories = [];
  const report = await reviewTradeSample(await acquisitionInput(await holderHistoryFixture(), wallet));
  expect(report.periods[0]).toMatchObject({ status: "held", metrics: null, candidate_trades: 1, finalized_trades: 0 });
  await expect(reviewTradeSample(await input([tx, tx]))).rejects.toThrow("duplicate_wallet_transaction");
});
it("applies fixed clipping, stale, future and truncation controls to a replayed-context policy fixture", async () => {
  const context = await reviewHolderAcquisitionData(await input([await participationTrade({ time: "2026-10-21T09:00:00Z" })]));
  const proof = (await walletInput()).asset.creation!;
  context.wallet!.asset.creation = { ...proof, block_time: "2026-10-21T09:00:00.000Z" };
  const clipped = await reviewTradeSampleContext(context);
  expect(clipped.periods[0]).toMatchObject({ clipped_to_creation: true, start_at: "2026-10-21T09:00:00.000Z", status: "measured_sample" });
  context.history.cutoff_at = "2026-10-21T11:00:00.000Z"; expect((await reviewTradeSampleContext(context)).freshness).toBe("stale");
  context.analysis!.trades = Array.from({ length: 100 }, () => context.analysis!.trades[0]!);
  expect((await reviewTradeSampleContext(context)).periods.every(p => p.status === "held" && p.metrics === null)).toBe(true);
  context.analysis!.trades = [{ ...context.analysis!.trades[0]!, block_time: "2026-10-21T10:00:00.000Z" }];
  expect((await reviewTradeSampleContext(context)).periods[0]!.gaps).toContain("trade_after_wallet_endpoint");
});
