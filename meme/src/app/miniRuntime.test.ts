import test from "node:test";
import assert from "node:assert/strict";
import { nativeAccount, nativeSignature } from "./miniRuntime";
import { decode58 } from "../shared/base58";
import {
  detectMiniAppContext,
  onboardingComplete,
  completeOnboarding,
} from "@10x/connect/miniAppContext";
test("native host message proof preserves exact 64-byte signature and rejects malformed responses", async () => {
  const bytes = new Uint8Array(64).fill(7),
    encoded = Buffer.from(bytes).toString("base64");
  assert.deepEqual(decode58(nativeSignature(encoded), 64), bytes);
  for (const value of [
    encoded + "!",
    encoded.slice(1),
    "A".repeat(88),
    Buffer.alloc(63).toString("base64"),
  ])
    assert.throws(() => nativeSignature(value));
  assert.equal(
    await nativeAccount({
      request: async () => ({ publicKey: "11111111111111111111111111111111" }),
      signMessage: async () => ({ signature: encoded }),
    }),
    "11111111111111111111111111111111",
  );
  await assert.rejects(
    nativeAccount({
      request: async () => ({ publicKey: "wrong-chain" }),
      signMessage: async () => ({ signature: encoded }),
    }),
  );
});
test("host detection handles late attachment and failures; blocked storage does not break onboarding", async () => {
  let count = 0;
  assert.equal(
    await detectMiniAppContext(async () => ++count === 2, 50, 1),
    true,
  );
  assert.equal(
    await detectMiniAppContext(
      async () => {
        throw Error("unsupported");
      },
      50,
      1,
    ),
    false,
  );
  const denied = {
    getItem: () => {
      throw Error("denied");
    },
    setItem: () => {
      throw Error("denied");
    },
  };
  assert.equal(onboardingComplete(denied, "k"), false);
  assert.doesNotThrow(() => completeOnboarding(denied, "k"));
});
