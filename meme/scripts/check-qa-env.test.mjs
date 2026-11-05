import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

for (const [name, value, accepted] of [
  ["missing", "", false],
  ["malformed", "invalid", false],
  ["public identifier", "0".repeat(32), true],
]) {
  test(`supervised QA build preflight checks ${name}`, () => {
    const result = spawnSync(
      process.execPath,
      [fileURLToPath(new URL("./check-qa-env.mjs", import.meta.url))],
      {
        env: { ...process.env, VITE_WALLETCONNECT_PROJECT_ID: value },
        encoding: "utf8",
        windowsHide: true,
        timeout: 15000,
      },
    );
    assert.ifError(result.error);
    assert.equal(result.status, accepted ? 0 : 1);
    if (!accepted)
      assert.match(result.stderr, /QA requires VITE_WALLETCONNECT_PROJECT_ID/);
  });
}
