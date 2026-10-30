import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { reservePublicRead } from "../src/public-read-budget.mjs";
test("read allowance persists attempts before I/O, cannot reset on restart, and excludes writes/credentials", () => {
  const dir = mkdtempSync(join(tmpdir(), "meme-read-budget-")),
    path = join(dir, "budget.json");
  try {
    for (let i = 0; i < 3; i++)
      assert.equal(
        reservePublicRead("https://mainnet.base.org", "eth_chainId", [], {
          path,
          limit: 3,
        }).used,
        i + 1,
      );
    assert.throws(
      () =>
        reservePublicRead("https://mainnet.base.org", "eth_chainId", [], {
          path,
          limit: 3,
        }),
      /exhausted/,
    );
    assert.throws(
      () =>
        reservePublicRead("https://mainnet.base.org", "eth_chainId", [], {
          path,
          limit: 4,
        }),
      /refusing reset/,
    );
    for (const [url, method] of [
      ["https://mainnet.base.org", "eth_sendRawTransaction"],
      ["https://api.mainnet-beta.solana.com", "sendTransaction"],
      ["https://mainnet.base.org/?api-key=private", "eth_call"],
      ["https://other.invalid", "getAccountInfo"],
    ])
      assert.throws(
        () => reservePublicRead(url, method, [], { path, limit: 3 }),
        /Unapproved/,
      );
    assert.equal(JSON.parse(readFileSync(path, "utf8")).used, 3);
    writeFileSync(path, "{}");
    assert.throws(
      () =>
        reservePublicRead("https://mainnet.base.org", "eth_chainId", [], {
          path,
          limit: 3,
        }),
      /refusing reset/,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
