import { decode58 } from "./base58";
import { natural } from "./holding";
import type { MarketDefinition } from "./markets";
export interface SwapQuote {
  version: 1;
  network: "solana-local" | "solana-mainnet";
  marketId: string;
  wallet: string;
  side: "buy-attn" | "sell-attn" | "buy-og";
  inputMint: string;
  outputMint: string;
  inputAmount: string;
  expectedOutput: string;
  minimumOutput: string;
  inputDecimals: number;
  outputDecimals: number;
  slippageBps: number;
  quotedAt: number;
  expiresAt: number;
  contextSlot: number;
  sourceHash: string;
  route: "meteora-damm-v2" | "host-solana" | "simulated";
  pool: string | null;
  fees: {
    networkLamports: string;
    accountRentLamports: string;
    inputFeeUnits: string;
    inputFeeIncluded: true;
  };
}
export interface SwapRisk {
  maximumSlippageBps: number;
  maximumNetworkLamports: string;
  maximumRentLamports: string;
  fundingMints: readonly string[];
  mintDecimals: Readonly<Record<string, number>>;
}
/** A review contract, never financial authorization. Amounts are raw mint units. */
export function reviewSwapQuote(
  q: SwapQuote,
  market: MarketDefinition,
  wallet: string,
  risk: SwapRisk,
  now = Date.now(),
) {
  if (
    !q ||
    q.version !== 1 ||
    q.marketId !== market.id ||
    q.wallet !== wallet ||
    q.network !==
      (market.mode === "simulated" ? "solana-local" : "solana-mainnet")
  )
    throw Error("Quote does not match the connected wallet/market/network");
  for (const address of [wallet, q.inputMint, q.outputMint])
    decode58(address, 32);
  if (
    q.inputMint === q.outputMint ||
    !Number.isSafeInteger(risk.maximumSlippageBps) ||
    risk.maximumSlippageBps < 0 ||
    risk.maximumSlippageBps >= 10000 ||
    !Number.isSafeInteger(q.slippageBps) ||
    q.slippageBps < 0 ||
    q.slippageBps > risk.maximumSlippageBps
  )
    throw Error("Invalid swap risk limits");
  const amount = natural(q.inputAmount, true),
    expected = natural(q.expectedOutput, true),
    minimum = natural(q.minimumOutput, true);
  if (
    amount > 2n ** 64n - 1n ||
    expected > 2n ** 64n - 1n ||
    !Number.isSafeInteger(q.inputDecimals) ||
    !Number.isSafeInteger(q.outputDecimals) ||
    q.inputDecimals < 0 ||
    q.inputDecimals > 18 ||
    q.outputDecimals < 0 ||
    q.outputDecimals > 18 ||
    risk.mintDecimals[q.inputMint] !== q.inputDecimals ||
    risk.mintDecimals[q.outputMint] !== q.outputDecimals
  )
    throw Error("Quote units do not match verified mint metadata");
  if (
    minimum > expected ||
    minimum < (expected * BigInt(10000 - q.slippageBps)) / 10000n
  )
    throw Error("Minimum output weakens the reviewed slippage protection");
  if (
    !Number.isSafeInteger(q.quotedAt) ||
    q.quotedAt > now + 1000 ||
    now - q.quotedAt > 30000 ||
    !Number.isSafeInteger(q.expiresAt) ||
    q.expiresAt <= now ||
    q.expiresAt > q.quotedAt + 60000 ||
    !Number.isSafeInteger(q.contextSlot) ||
    q.contextSlot < 1 ||
    !/^[a-f0-9]{64}$/.test(q.sourceHash)
  )
    throw Error("Quote is stale or lacks chain provenance");
  if (q.side === "buy-attn") {
    if (
      !market.attnMint ||
      market.launchedAt === null ||
      now < market.launchedAt ||
      q.inputMint !== market.ogMint ||
      q.outputMint !== market.attnMint
    )
      throw Error("ATTN buy route does not match the launched pair");
  } else if (q.side === "sell-attn") {
    if (q.inputMint !== market.attnMint || q.outputMint !== market.ogMint)
      throw Error("ATTN sell route does not match the pair");
  } else if (q.side === "buy-og") {
    if (
      q.outputMint !== market.ogMint ||
      !risk.fundingMints.includes(q.inputMint)
    )
      throw Error("Unapproved OG funding asset");
  } else throw Error("Unsupported trade direction");
  if (
    !["meteora-damm-v2", "host-solana", "simulated"].includes(q.route) ||
    (q.route === "simulated" && market.mode !== "simulated")
  )
    throw Error("Unsupported swap route");
  if (
    q.route === "meteora-damm-v2" &&
    (q.pool !== market.pool || q.pool === null || q.side === "buy-og")
  )
    throw Error("Direct route does not match the verified pool");
  if (
    q.fees?.inputFeeIncluded !== true ||
    natural(q.fees.inputFeeUnits) > amount ||
    natural(q.fees.networkLamports) > natural(risk.maximumNetworkLamports) ||
    natural(q.fees.accountRentLamports) > natural(risk.maximumRentLamports)
  )
    throw Error("Quote exceeds the explicit fee/rent budget");
  return {
    quote: q,
    reviewOnly: true,
    signingEnabled: false,
    mainnetEnabled: false,
    requiresUserConfirmation: true,
  };
}
