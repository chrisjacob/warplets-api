import test from "node:test";
import assert from "node:assert/strict";
import { allocate, releaseAt, releasesFor } from "./settlement";
import { DAY_MS } from "./rules";
const people = (n: number) =>
  Array.from({ length: n }, (_, i) => ({
    fid: i + 1,
    rank: i + 1,
    pointUnits: "110000",
    rewardWallet: "wallet-" + i,
  }));
test("largest remainders preserve every token unit, use rank for ties, and share among fewer than 100", () => {
  const a = allocate(10n, people(3));
  assert.deepEqual(
    a.recipients.map((r) => r.amount),
    ["4", "3", "3"],
  );
  assert.equal(a.reserve, "0");
  assert.equal(a.allocated, "10");
  const b = allocate(1000000000000000000000000000001n, [
    { ...people(1)[0], pointUnits: "1000000" },
    { ...people(2)[1], pointUnits: "110000" },
  ]);
  assert.equal(
    b.recipients.reduce((n, r) => n + BigInt(r.amount), 0n),
    1000000000000000000000000000001n,
  );
  assert.equal(allocate(100n, []).reserve, "100");
  assert.throws(() => allocate(10n, people(101)), /Invalid/);
  assert.deepEqual(
    allocate(1n, people(3)).recipients.map((r) => r.amount),
    ["1", "0", "0"],
  );
});
test("ten exact 1% releases start at actual launch +24h; delayed launches shift their own schedule", () => {
  const launch = 1000000000;
  assert.equal(releaseAt(launch, 1), launch + DAY_MS);
  assert.equal(releaseAt(launch, 10), launch + 10 * DAY_MS);
  assert.deepEqual(releasesFor(launch, launch + DAY_MS - 1800000), [1]);
  assert.deepEqual(releasesFor(launch, launch + DAY_MS), [2]);
  assert.deepEqual(releasesFor(launch, launch - 1), []);
  assert.deepEqual(releasesFor(launch + 7200000, launch + DAY_MS - 1800000), [
    1,
  ]);
});
