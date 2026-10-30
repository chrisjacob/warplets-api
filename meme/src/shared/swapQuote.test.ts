import test from "node:test";
import assert from "node:assert/strict";
import { reviewSwapQuote, type SwapQuote, type SwapRisk } from "./swapQuote";
import type { MarketDefinition } from "./markets";
const market: MarketDefinition = {
  id: "fixture",
  symbol: "ATTN",
  ogSymbol: "OG",
  ogMint: "11111111111111111111111111111111",
  attnMint: "So11111111111111111111111111111111111111112",
  pool: "So11111111111111111111111111111111111111112",
  launchedAt: 1000,
  mode: "simulated",
};
const risk: SwapRisk = {
  maximumSlippageBps: 100,
  maximumNetworkLamports: "10000",
  maximumRentLamports: "2000000",
  fundingMints: [market.attnMint!],
  mintDecimals: { [market.ogMint]: 9, [market.attnMint!]: 9 },
};
const quote: SwapQuote = {
  version: 1,
  network: "solana-local",
  marketId: market.id,
  wallet: market.ogMint,
  side: "buy-attn",
  inputMint: market.ogMint,
  outputMint: market.attnMint!,
  inputAmount: "100",
  expectedOutput: "1000",
  minimumOutput: "990",
  inputDecimals: 9,
  outputDecimals: 9,
  slippageBps: 100,
  quotedAt: 10000,
  expiresAt: 30000,
  contextSlot: 42,
  sourceHash: "a".repeat(64),
  route: "meteora-damm-v2",
  pool: market.pool,
  fees: {
    networkLamports: "5000",
    accountRentLamports: "0",
    inputFeeUnits: "1",
    inputFeeIncluded: true,
    outputFeeUnits: "0",
    outputFeeIncluded: true,
  },
};
test("quote review preserves explicit fees and slippage without enabling any signing", () => {
  const review = reviewSwapQuote(quote, market, quote.wallet, risk, 11000);
  assert.equal(review.signingEnabled, false);
  assert.equal(review.mainnetEnabled, false);
  for (const change of [
    { minimumOutput: "980" },
    { wallet: market.attnMint! },
    { inputMint: market.attnMint! },
    { network: "solana-mainnet" },
    { pool: null },
    { expiresAt: 10000 },
    { quotedAt: -40000 },
    { fees: { ...quote.fees, networkLamports: "10001" } },
  ])
    assert.throws(() =>
      reviewSwapQuote(
        { ...quote, ...change } as SwapQuote,
        market,
        quote.wallet,
        risk,
        11000,
      ),
    );
});
