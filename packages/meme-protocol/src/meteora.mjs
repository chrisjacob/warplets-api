import BN from "bn.js";
import { Connection, PublicKey } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { createHash } from "node:crypto";
import {
  CpAmm,
  CP_AMM_PROGRAM_ID,
  CollectFeeMode,
  ActivationType,
  BaseFeeMode,
  CURRENT_POOL_VERSION,
  getFeeTimeSchedulerParams,
  decodeFeeTimeSchedulerParams,
  getFeeTimeBaseFeeNumerator,
  getSqrtPriceFromPrice,
  cpAmmCoder,
  validateFeeTimeScheduler,
} from "@meteora-ag/cp-amm-sdk";

export const SDK_VERSION = "1.5.1";
// Test-only lab exports; the application boundary forbids this package.
export { CpAmm, cpAmmCoder, BN };
export const offlineConnection = new Connection("http://127.0.0.1:8899", {
  fetch: async () => {
    throw Error("Protocol lab forbids network access");
  },
});
const natural = (v) => {
  if (typeof v !== "string" || !/^[1-9][0-9]*$/.test(v))
    throw Error("Positive integer string required");
  return BigInt(v);
};
export function supplySplit(raw) {
  const supply = natural(raw);
  if (supply > 2n ** 64n - 1n || supply % 100n !== 0n)
    throw Error("SPL supply must fit u64 and divide exactly by 100");
  return {
    liquidity: ((supply * 90n) / 100n).toString(),
    rewards: (supply / 10n).toString(),
    daily: (supply / 100n).toString(),
  };
}
export function feeSchedule({
  openingBps,
  ongoingBps,
  durationSeconds,
  periods,
}) {
  if (
    ![openingBps, ongoingBps, durationSeconds, periods].every(
      Number.isSafeInteger,
    ) ||
    durationSeconds !== 600 ||
    ongoingBps !== 100 ||
    openingBps < ongoingBps ||
    openingBps >= 10000 ||
    periods < 1 ||
    durationSeconds % periods !== 0
  )
    throw Error(
      "Explicit ten-minute fee configuration required; 100% opening fees are unsupported",
    );
  const baseFee = getFeeTimeSchedulerParams(
    openingBps,
    ongoingBps,
    BaseFeeMode.FeeTimeSchedulerLinear,
    openingBps === ongoingBps ? 0 : periods,
    openingBps === ongoingBps ? 0 : durationSeconds,
  );
  const decoded = decodeFeeTimeSchedulerParams(Buffer.from(baseFee.data));
  validateFeeTimeScheduler(
    decoded.numberOfPeriod,
    decoded.periodFrequency,
    decoded.reductionFactor,
    decoded.cliffFeeNumerator,
    decoded.baseFeeMode,
    CURRENT_POOL_VERSION,
  );
  const at = (seconds) =>
    getFeeTimeBaseFeeNumerator(
      decoded.cliffFeeNumerator,
      decoded.numberOfPeriod,
      decoded.periodFrequency,
      decoded.reductionFactor,
      decoded.baseFeeMode,
      new BN(1700000000 + seconds),
      new BN(1700000000),
    );
  // SDK integer division can leave a residual above the requested floor. Reject it explicitly.
  if (!at(600).eq(new BN(10000000)))
    throw Error("Fee settings do not decay to exactly 1%");
  return { baseFee, at, decoded };
}
/** Build unsigned instructions only. This adapter has no signer, RPC send or funding path.
 * OG is explicitly quote B; mint order must never silently invert the pricing/fee policy. */
export async function buildLaunchProof(config) {
  if (config.simulated !== true)
    throw Error(
      "Only explicit non-production fixture configurations are accepted",
    );
  if (config.tokenProgram !== "spl-token" || config.permanentLock !== true)
    throw Error(
      "Only reviewed SPL Token and atomic permanent-lock construction is covered",
    );
  const { liquidity, rewards, daily } = supplySplit(config.totalSupply);
  for (const d of [config.editionDecimals, config.ogDecimals])
    if (!Number.isSafeInteger(d) || d < 0 || d > 9)
      throw Error("Unsupported mint decimals");
  const edition = new PublicKey(config.editionMint),
    og = new PublicKey(config.ogMint);
  if (edition.equals(og)) throw Error("Distinct edition and OG mints required");
  if (
    typeof config.minimumOgPrice !== "string" ||
    typeof config.maximumOgPrice !== "string"
  )
    throw Error("Explicit OG-denominated bounds required");
  const min = getSqrtPriceFromPrice(
      config.minimumOgPrice,
      config.editionDecimals,
      config.ogDecimals,
    ),
    max = getSqrtPriceFromPrice(
      config.maximumOgPrice,
      config.editionDecimals,
      config.ogDecimals,
    );
  if (min.gte(max)) throw Error("Invalid OG price range");
  const fees = feeSchedule(config.fees),
    amm = new CpAmm(offlineConnection),
    amount = new BN(liquidity);
  const delta = amm.preparePoolCreationSingleSide({
    tokenAAmount: amount,
    minSqrtPrice: min,
    maxSqrtPrice: max,
    initSqrtPrice: min,
    collectFeeMode: CollectFeeMode.OnlyB,
  });
  const result = await amm.createCustomPool({
    creator: new PublicKey(config.creator),
    payer: new PublicKey(config.payer),
    positionNft: new PublicKey(config.positionNft),
    tokenAMint: edition,
    tokenBMint: og,
    tokenAAmount: amount,
    // Owner approved the program's exact one-raw-unit proof-of-ownership minimum.
    // This is an explicit extra OG cost, not part of the edition supply split.
    tokenBAmount: new BN(1),
    sqrtMinPrice: min,
    sqrtMaxPrice: max,
    liquidityDelta: delta,
    initSqrtPrice: min,
    poolFees: {
      baseFee: fees.baseFee,
      compoundingFeeBps: 0,
      padding: 0,
      dynamicFee: null,
    },
    hasAlphaVault: false,
    activationType: ActivationType.Timestamp,
    collectFeeMode: CollectFeeMode.OnlyB,
    activationPoint: new BN(config.activationUnixSeconds),
    tokenAProgram: TOKEN_PROGRAM_ID,
    tokenBProgram: TOKEN_PROGRAM_ID,
    isLockLiquidity: true,
  });
  const instructions = result.tx.instructions.map((ix) => ({
    program: ix.programId.toBase58(),
    accounts: ix.keys.map((k) => ({
      pubkey: k.pubkey.toBase58(),
      signer: k.isSigner,
      writable: k.isWritable,
    })),
    data: ix.data.toString("hex"),
    decoded: ix.programId.equals(CP_AMM_PROGRAM_ID)
      ? cpAmmCoder.instruction.decode(ix.data)
      : null,
  }));
  const proof = {
    sdk: SDK_VERSION,
    program: CP_AMM_PROGRAM_ID.toBase58(),
    poolVersion: CURRENT_POOL_VERSION,
    pool: result.pool.toBase58(),
    position: result.position.toBase58(),
    liquidity,
    rewards,
    daily,
    liquidityDelta: delta.toString(),
    quote: og.toBase58(),
    // initialize_customizable_pool clamps both transfers to at least one raw unit.
    // A single-sided position is not a strict zero-quote initialization.
    minimumQuoteDepositRaw: "1",
    strictZeroQuoteSupported: false,
    instructions,
  };
  // Stable commitment uses raw instruction bytes/account metas, independent of BN JSON encoding.
  proof.instructionHash = createHash("sha256")
    .update(JSON.stringify(instructions.map(({ decoded, ...raw }) => raw)))
    .digest("hex");
  return proof;
}
