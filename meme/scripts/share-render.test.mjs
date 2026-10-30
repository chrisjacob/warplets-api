import test from "node:test";
import assert from "node:assert/strict";
import { renderCard } from "./render-share.mjs";
test("real offline share PNGs use both required ratios and render adversarial text as text", async () => {
  const saved = globalThis.fetch;
  globalThis.fetch = async () => {
    throw Error("No network during PNG rendering");
  };
  try {
    for (const height of [800, 630]) {
      const png = await renderCard(
        {
          version: 1,
          title: 'ATTN vs OG <script>alert("x")</script>',
          lines: ["ATTN -10.00% · OG +2.00%", "Partial history · before fees"],
          asOf: 1793400000000,
          mode: "simulated",
          sourceHash: "a".repeat(64),
        },
        height,
      );
      assert.equal(png.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
      assert.equal(png.readUInt32BE(16), 1200);
      assert.equal(png.readUInt32BE(20), height);
      assert(png.length < 200000);
    }
  } finally {
    globalThis.fetch = saved;
  }
});
