import test from "node:test";
import assert from "node:assert/strict";
import { pollDelay } from "./polling";
test("outages back off to two minutes without an unbounded exponent or changing the successful cadence", () => {
  assert.equal(pollDelay(0), 15000);
  assert.equal(pollDelay(1), 30000);
  assert.equal(pollDelay(3), 120000);
  assert.equal(pollDelay(100000000), 120000);
  assert.throws(() => pollDelay(-1));
});
