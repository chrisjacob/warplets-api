import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
test("committed root discovery assets are bounded actual PNGs with exact icon/Farcaster/OG ratios", () => {
  for (const [name, width, height] of [
    ["icon", 512, 512],
    ["social-mini", 1200, 800],
    ["social-og", 1200, 630],
  ]) {
    const bytes = readFileSync(
      new URL("../public/" + name + ".png", import.meta.url),
    );
    assert.equal(bytes.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
    assert.equal(bytes.readUInt32BE(16), width);
    assert.equal(bytes.readUInt32BE(20), height);
    assert(bytes.length < 100000);
  }
});
