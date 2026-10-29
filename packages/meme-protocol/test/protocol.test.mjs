import test from "node:test";
import assert from "node:assert/strict";
import { buildLaunchProof, feeSchedule, supplySplit } from "../src/meteora.mjs";
import { evaluateJito } from "../src/distributor.mjs";
import { fixture } from "../src/fixture.mjs";
import { CpAmmIdl } from "@meteora-ag/cp-amm-sdk";
test("pinned SDK constructs OG-only fees, single-sided liquidity and an atomic permanent lock without network access", async () => {
  const a = await buildLaunchProof(fixture),
    b = await buildLaunchProof(fixture);
  assert.equal(a.instructionHash, b.instructionHash);
  const protocol = a.instructions.filter((i) => i.decoded);
  assert.deepEqual(
    protocol.map((i) => i.decoded.name),
    ["initialize_customizable_pool", "permanent_lock_position"],
  );
  const init = protocol[0].decoded.data.params;
  const definition = CpAmmIdl.instructions.find(
    (i) => i.name === protocol[0].decoded.name,
  );
  const named = Object.fromEntries(
    definition.accounts.map((account, i) => [
      account.name,
      protocol[0].accounts[i],
    ]),
  );
  assert.equal(named.token_a_mint.pubkey, fixture.editionMint);
  assert.equal(named.token_b_mint.pubkey, fixture.ogMint);
  assert.equal(named.creator.pubkey, fixture.creator);
  assert.equal(named.payer.pubkey, fixture.payer);
  assert.equal(named.position_nft_mint.pubkey, fixture.positionNft);
  assert.equal(named.position_nft_mint.signer, true);
  assert.equal(named.payer.signer, true);
  assert.equal(init.collect_fee_mode, 1);
  assert.equal(init.activation_type, 1);
  assert.equal(
    init.activation_point.toString(),
    String(fixture.activationUnixSeconds),
  );
  assert.equal(init.sqrt_price.toString(), init.sqrt_min_price.toString());
  assert.equal(
    protocol[1].decoded.data.permanent_lock_liquidity.toString(),
    a.liquidityDelta,
  );
  assert.equal(a.rewards, "100000000000000000");
  assert.equal(a.liquidity, "900000000000000000");
  await assert.rejects(
    buildLaunchProof({ ...fixture, simulated: false }),
    /non-production/,
  );
  await assert.rejects(
    buildLaunchProof({ ...fixture, permanentLock: false }),
    /permanent-lock/,
  );
});
test("SDK linear schedule reaches exactly 1% at 600 seconds; invalid residuals and archived settings are rejected", () => {
  const schedule = feeSchedule(fixture.fees);
  assert.equal(schedule.at(0).toString(), "100000000");
  assert.equal(schedule.at(300).toString(), "55000000");
  assert.equal(schedule.at(600).toString(), "10000000");
  assert.equal(schedule.at(601).toString(), "10000000");
  assert.throws(
    () => feeSchedule({ ...fixture.fees, openingBps: 10000 }),
    /unsupported/,
  );
  assert.throws(
    () => feeSchedule({ ...fixture.fees, openingBps: 1001 }),
    /exactly/,
  );
  assert.throws(() => supplySplit("18446744073709551616"), /u64/);
});
test("distributor evaluation rejects early unlocked claims and does not approve an expiry/custody model silently", () => {
  const settings = {
    amountUnlocked: "100",
    releaseAt: 100000,
    startVestingAt: 100000,
    endVestingAt: 100001,
    clawbackAt: 186401,
    requireNoExpiry: true,
  };
  const rejected = evaluateJito(settings);
  assert.equal(rejected.supported, false);
  assert(rejected.gaps.some((g) => g.includes("without enforcing")));
  assert(rejected.gaps.some((g) => g.includes("clawback")));
  const narrowed = evaluateJito({
    ...settings,
    amountUnlocked: "0",
    requireNoExpiry: false,
  });
  assert.equal(narrowed.supported, true);
  assert.equal(narrowed.productionApproved, false);
  assert.equal(narrowed.executionProof, false);
});
