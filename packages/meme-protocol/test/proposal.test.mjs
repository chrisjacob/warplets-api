import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildLaunchProof, feeSchedule, supplySplit } from "../src/meteora.mjs";
import { fixture } from "../src/fixture.mjs";

test("draft pilot fees decode to 3%→1% in exact six-second steps without granting execution authority", async () => {
  const proposal = JSON.parse(
    readFileSync(
      new URL("../../../docs/10x/proposals/pilot-v1.json", import.meta.url),
      "utf8",
    ),
  );
  assert.equal(proposal.status, "draft-for-owner-review");
  assert.equal(proposal.executionAllowed, false);
  assert.equal(proposal.actualCustodyAddresses, null);
  assert.equal(proposal.valuationProposal.selectedOgMint, null);
  const fees = feeSchedule(proposal.fees);
  assert.equal(fees.at(0).toString(), "30000000");
  assert.equal(fees.at(5).toString(), "30000000");
  assert.equal(fees.at(6).toString(), "29800000");
  assert.equal(fees.at(300).toString(), "20000000");
  assert.equal(fees.at(600).toString(), "10000000");
  assert.equal(fees.at(3600).toString(), "10000000");
  const split = supplySplit(proposal.edition.totalSupplyRaw);
  assert.equal(split.liquidity, "900000000000000000");
  assert.equal(split.daily, "10000000000000000");
  // Illustrative OG/USD=1 only: a conversion example, not a live price observation.
  const proof = await buildLaunchProof({
    ...fixture,
    totalSupply: proposal.edition.totalSupplyRaw,
    fees: proposal.fees,
    minimumOgPrice: "0.00001",
    maximumOgPrice: "0.001",
  });
  assert.equal(proof.minimumQuoteDepositRaw, "1");
  assert.equal(proof.strictZeroQuoteSupported, false);
  assert.equal(
    proof.instructions.filter((i) => i.decoded).at(-1).decoded.name,
    "permanent_lock_position",
  );
});
