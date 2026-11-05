import { buildLaunchProof, feeSchedule } from "./meteora.mjs";
import { evaluateJito } from "./distributor.mjs";
import { fixture } from "./fixture.mjs";
import { planLockedJito, JITO_POLICY } from "./jito-locked.mjs";
const proof = await buildLaunchProof(fixture),
  fees = feeSchedule(fixture.fees);
const locked = planLockedJito({
  simulated: true,
  state: "finalized_unfunded",
  allocationId: "fixture:release:1",
  inputHash: "a".repeat(64),
  resultHash: "b".repeat(64),
  version: "1",
  mint: fixture.editionMint,
  admin: fixture.creator,
  receiverOwner: fixture.creator,
  launchedAtMs: 1800000000000,
  releaseIndex: 1,
  preparedAt: 1800000100,
  expectedAmount: "100",
  recipients: [{ wallet: fixture.ogMint, amount: "100" }],
});
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
        amountUnlocked: "0",
        releaseAt: locked.expected.startVestingAt,
        startVestingAt: locked.expected.startVestingAt,
        endVestingAt: locked.expected.endVestingAt,
        clawbackAt: locked.expected.clawbackAt,
        requireNoExpiry: false,
      }),
      lockedPolicy: {
        policy: JITO_POLICY,
        expected: locked.expected,
        initializationBytes: locked.creation.data.length,
        policyApproved: locked.policyApproved,
      },
      executionProof: false,
      productionApproved: false,
    },
    null,
    2,
  ),
);
