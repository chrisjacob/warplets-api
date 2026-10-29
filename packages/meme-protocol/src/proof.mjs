import { buildLaunchProof, feeSchedule } from "./meteora.mjs";
import { evaluateJito } from "./distributor.mjs";
import { fixture } from "./fixture.mjs";
const proof = await buildLaunchProof(fixture),
  fees = feeSchedule(fixture.fees);
console.log(
  JSON.stringify(
    {
      mode: "offline-unsigned",
      sdk: proof.sdk,
      program: proof.program,
      instructionHash: proof.instructionHash,
      pool: proof.pool,
      supply: {
        liquidity: proof.liquidity,
        rewards: proof.rewards,
        daily: proof.daily,
      },
      instructions: proof.instructions
        .filter((i) => i.decoded)
        .map((i) => i.decoded.name),
      feeNumerators: [0, 300, 600, 601].map((seconds) => ({
        seconds,
        numerator: fees.at(seconds).toString(),
      })),
      distributor: evaluateJito({
        amountUnlocked: "100",
        releaseAt: 1800086400,
        startVestingAt: 1800086400,
        endVestingAt: 1800086401,
        clawbackAt: 1800172801,
        requireNoExpiry: true,
      }),
      executionProof: false,
      productionApproved: false,
    },
    null,
    2,
  ),
);
