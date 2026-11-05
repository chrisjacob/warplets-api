import test from "node:test";
import assert from "node:assert/strict";
import { tokenAmount, rewardTotals, rewardStatus } from "./rewards";
test("token totals retain exact decimals and separate frozen destinations and evidence modes", () => {
  assert.equal(
    tokenAmount("12345678901234567890123456789", 9),
    "12,345,678,901,234,567,890.123456789",
  );
  assert.equal(tokenAmount("1", 9), "0.000000001");
  assert.equal(tokenAmount("1000000000", 9), "1");
  assert.equal(tokenAmount("0", 0), "0");
  const base = {
    edition_id: "a",
    symbol: "A",
    decimals: 9,
    amount: "999999999999999999",
    release_at: 1,
    state: "finalized_unfunded",
    reward_wallet: "one",
    mode: "observed",
  };
  const totals = rewardTotals([
    base,
    { ...base, amount: "1", release_at: 2 },
    { ...base, reward_wallet: "two" },
    { ...base, mode: "simulated" },
  ]);
  assert.equal(totals.length, 3);
  assert.equal(totals[0].amount, "1000000000000000000");
  assert.equal(totals[0].release_at, 2);
  assert.equal(base.amount, "999999999999999999");
});
test("funded, scheduled and claimed amounts never become one misleading reward total", () => {
  const row = {
    edition_id: "a",
    symbol: "A",
    decimals: 0,
    amount: "100",
    release_at: 1,
    state: "finalized_unfunded",
    reward_wallet: "one",
    mode: "simulated",
  };
  const totals = rewardTotals([
    row,
    { ...row, fundingState: "funded", releaseState: "scheduled" },
    { ...row, fundingState: "funded", releaseState: "released" },
    {
      ...row,
      fundingState: "funded",
      releaseState: "released",
      claimState: "claimed",
    },
  ]);
  assert.equal(totals.length, 4);
  assert.deepEqual(totals.map(rewardStatus), [
    "Unfunded",
    "Scheduled",
    "Released",
    "Claimed",
  ]);
});
