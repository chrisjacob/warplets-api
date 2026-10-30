import type { TransactionPlan } from "./transactions";
import type { SwapQuote } from "./swapQuote";
import { decode58 } from "./base58";
export type SwapPlan = Omit<TransactionPlan, "operation"> & {
  operation: "swap";
};
export const METEORA_SWAP_PROGRAM =
  "cpamdpZCGKUy5JxQXB4dcpGPiikHawvSWAd6mEn1sGG";
const TOKEN = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
  COMPUTE = "ComputeBudget111111111111111111111111111111";
export interface SwapContext {
  pool: string;
  tokenAMint: string;
  tokenBMint: string;
  tokenAVault: string;
  tokenBVault: string;
  inputAccount: string;
  outputAccount: string;
  eventAuthority: string;
  sourceHash: string;
  contextSlot: number;
}
/** Narrow reviewed path: one exact-in DAMM-v2 legacy swap, existing standard SPL accounts, no referrals/wrapping/transfer hooks. */
export function bindSwapInstructions(
  plan: SwapPlan,
  q: SwapQuote,
  context: SwapContext,
) {
  if (
    plan.operation !== "swap" ||
    plan.version !== 1 ||
    plan.network !== q.network ||
    plan.simulated !== (q.network === "solana-local") ||
    plan.signers.length !== 1 ||
    plan.signers[0] !== q.wallet ||
    plan.costUnit !== "lamports" ||
    plan.maximumCost !== q.fees.networkLamports ||
    plan.expiresAt !== q.expiresAt ||
    !Number.isSafeInteger(plan.notBefore) ||
    plan.notBefore > q.quotedAt ||
    q.fees.accountRentLamports !== "0" ||
    q.route !== "meteora-damm-v2" ||
    context.pool !== q.pool ||
    context.sourceHash !== q.sourceHash ||
    context.contextSlot !== q.contextSlot
  )
    throw Error("Swap plan differs from the reviewed quote/context");
  const pair = new Set([q.inputMint, q.outputMint]);
  if (
    pair.size !== 2 ||
    context.tokenAMint === context.tokenBMint ||
    !pair.has(context.tokenAMint) ||
    !pair.has(context.tokenBMint)
  )
    throw Error("Swap mints differ from the verified pool");
  for (const address of [
    context.pool,
    context.tokenAMint,
    context.tokenBMint,
    context.tokenAVault,
    context.tokenBVault,
    context.inputAccount,
    context.outputAccount,
    context.eventAuthority,
  ])
    decode58(address, 32);
  if (
    context.inputAccount === context.outputAccount ||
    context.tokenAVault === context.tokenBVault ||
    [context.tokenAVault, context.tokenBVault].includes(context.inputAccount) ||
    [context.tokenAVault, context.tokenBVault].includes(context.outputAccount)
  )
    throw Error("Distinct user/pool token accounts required");
  if (
    !Array.isArray(plan.instructions) ||
    plan.instructions.length < 1 ||
    plan.instructions.length > 3
  )
    throw Error("Unsupported swap instruction sequence");
  let swapped = false,
    limit = 200000n,
    price = 0n,
    seenLimit = false,
    seenPrice = false;
  for (const ix of plan.instructions) {
    if (typeof ix.data !== "string" || !/^(?:[a-f0-9]{2})+$/.test(ix.data))
      throw Error("Invalid instruction bytes");
    const bytes = Uint8Array.from(ix.data.match(/../g)!, (h) =>
        parseInt(h, 16),
      ),
      view = new DataView(bytes.buffer);
    if (ix.program === COMPUTE && !swapped && ix.accounts.length === 0) {
      if (bytes.length === 5 && bytes[0] === 2 && !seenLimit) {
        seenLimit = true;
        limit = BigInt(view.getUint32(1, true));
        if (limit < 1n || limit > 1400000n)
          throw Error("Invalid compute limit");
      } else if (bytes.length === 9 && bytes[0] === 3 && !seenPrice) {
        seenPrice = true;
        price = view.getBigUint64(1, true);
      } else throw Error("Duplicate or unsupported compute budget");
      continue;
    }
    if (
      swapped ||
      ix.program !== METEORA_SWAP_PROGRAM ||
      bytes.length !== 24 ||
      ix.data.slice(0, 16) !== "f8c69e91e17587c8" ||
      view.getBigUint64(8, true).toString() !== q.inputAmount ||
      view.getBigUint64(16, true).toString() !== q.minimumOutput ||
      ix.accounts.length !== 14
    )
      throw Error("Swap amount, minimum or program differs");
    const expected = [
      "HLnpSz9h2S4hiLQ43rnSD9XkcUThA7B8hQMKmDaiTLcC",
      q.pool,
      context.inputAccount,
      context.outputAccount,
      context.tokenAVault,
      context.tokenBVault,
      context.tokenAMint,
      context.tokenBMint,
      q.wallet,
      TOKEN,
      TOKEN,
      METEORA_SWAP_PROGRAM,
      context.eventAuthority,
      METEORA_SWAP_PROGRAM,
    ];
    ix.accounts.forEach((a, i) => {
      if (
        a.address !== expected[i] ||
        a.signer !== (i === 8) ||
        a.writable !== [1, 2, 3, 4, 5].includes(i)
      )
        throw Error("Swap account privileges differ from the pinned layout");
    });
    swapped = true;
  }
  // One signature. Additional priority budget is explicit and cannot exceed the review.
  if (
    !swapped ||
    5000n + (limit * price + 999999n) / 1000000n >
      BigInt(q.fees.networkLamports)
  )
    throw Error("Swap compute/signature fee exceeds the review");
  return {
    inputMint: q.inputMint,
    outputMint: q.outputMint,
    inputAmount: q.inputAmount,
    minimumOutput: q.minimumOutput,
    wallet: q.wallet,
  };
}
