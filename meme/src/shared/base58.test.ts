import test from "node:test";
import assert from "node:assert/strict";
import { encode58, decode58 } from "./base58";
test("base58 key encoding preserves zero prefixes and rejects malformed keys", () => {
  assert.equal(encode58(new Uint8Array(32)), "1".repeat(32));
  for (const bytes of [
    new Uint8Array([0, 0, 255]),
    crypto.getRandomValues(new Uint8Array(32)),
  ])
    assert.deepEqual(decode58(encode58(bytes), bytes.length), bytes);
  for (const input of ["0", "O", "I", "l", "1".repeat(129)])
    assert.throws(() => decode58(input));
  assert.throws(() => decode58("1", 32));
});
