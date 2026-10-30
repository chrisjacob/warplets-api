import test from "node:test";
import assert from "node:assert/strict";
import { miniAppSuccess, connectionSuccessEffects } from "./connectionEffects";

test("success haptics require a confirmed Mini App and its notification capability; Safari does not load the bridge", async () => {
  const calls: string[] = [];
  let mini = true,
    caps: readonly string[] = ["haptics.notificationOccurred"];
  const load = async () => {
    calls.push("load");
    return {
      isInMiniApp: async () => {
        calls.push("detect");
        return mini;
      },
      getCapabilities: async () => {
        calls.push("capabilities");
        return caps;
      },
      haptics: {
        notificationOccurred: async (type: "success") => {
          calls.push(type);
        },
      },
    };
  };
  await miniAppSuccess(load, false);
  assert.deepEqual(calls, []);
  await miniAppSuccess(load, true);
  assert.deepEqual(calls, ["load", "detect", "capabilities", "success"]);
  calls.length = 0;
  mini = false;
  await miniAppSuccess(load, true);
  assert.deepEqual(calls, ["load", "detect"]);
  calls.length = 0;
  mini = true;
  caps = [];
  await miniAppSuccess(load, true);
  assert.deepEqual(calls, ["load", "detect", "capabilities"]);
  await assert.doesNotReject(
    miniAppSuccess(async () => {
      throw Error("Host unavailable");
    }, true),
  );
});
test("reduced-motion success never downloads confetti and optional feedback failures never fail authentication", async () => {
  let loaded = 0,
    haptics = 0;
  const effects = {
    reducedMotion: () => true,
    loadConfetti: async () => {
      loaded++;
      return () => {
        throw Error("Rendering unavailable");
      };
    },
    haptic: async () => {
      haptics++;
      throw Error("Unsupported host");
    },
  };
  await assert.doesNotReject(connectionSuccessEffects(effects));
  assert.equal(loaded, 0);
  assert.equal(haptics, 1);
  await assert.doesNotReject(
    connectionSuccessEffects({ ...effects, reducedMotion: () => false }),
  );
  assert.equal(loaded, 1);
  assert.equal(haptics, 2);
});
