import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
const require = createRequire(import.meta.url),
  fromSPL = createRequire(require.resolve("@solana/spl-token")),
  fromLayout = createRequire(fromSPL.resolve("@solana/buffer-layout-utils")),
  path = fromLayout.resolve("bigint-buffer");
test("the SDK buffer conversion graph cannot load the vulnerable native addon", () => {
  const source = readFileSync(path, "utf8"),
    buffer = fromLayout("bigint-buffer");
  assert(source.includes("const converter = undefined;"));
  assert(!source.includes("require('bindings')"));
  for (const width of [0, 1, 8, 32, 64]) {
    const bytes = Buffer.alloc(width, 255),
      value = width ? 2n ** BigInt(width * 8) - 1n : 0n;
    assert.equal(buffer.toBigIntLE(bytes), value);
    assert.equal(buffer.toBigIntBE(bytes), value);
    assert.deepEqual(buffer.toBufferLE(value, width), bytes);
    assert.deepEqual(buffer.toBufferBE(value, width), bytes);
  }
  assert.throws(() => buffer.toBufferLE(256n, 1), RangeError);
  assert.throws(() => buffer.toBufferBE(-1n, 8), RangeError);
  assert.throws(() => buffer.toBufferLE(1n, 1.5), RangeError);
  assert.equal(buffer.toBigIntLE(Buffer.alloc(4096)), 0n);
});
