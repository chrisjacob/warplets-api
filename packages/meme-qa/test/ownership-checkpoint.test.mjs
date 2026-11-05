import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { hash } from "../src/safety.mjs";
import {
  startOwnershipCheckpoint,
  stepOwnershipCheckpoint,
  loadOwnershipCheckpoint,
  ownershipCoverage,
} from "../src/ownership-checkpoint.mjs";
const block = { number: "0x64", hash: "0x" + "a".repeat(64), timestamp: "0x1" };
test("ownership checkpoint pins one block, resumes after an outage and keeps partial coverage ineligible", async () => {
  const dir = mkdtempSync(join(tmpdir(), "meme-ownership-")),
    path = join(dir, "state.json");
  let calls = 0,
    failAt = 4;
  const request = async (_url, method, params) => {
    if (method === "eth_chainId") return "0x2105";
    if (method === "eth_getBlockByNumber") return block;
    assert.deepEqual(params[1], {
      blockHash: block.hash,
      requireCanonical: true,
    });
    if (++calls === failAt) throw Error("RPC outage");
    return "0x" + "0".repeat(24) + "1".repeat(40);
  };
  try {
    await startOwnershipCheckpoint(path, { request, now: () => 2000 });
    await assert.rejects(stepOwnershipCheckpoint(path, { request }), /outage/);
    assert.equal(loadOwnershipCheckpoint(path).records.length, 3);
    failAt = Infinity;
    await stepOwnershipCheckpoint(path, { request, limit: 2 });
    const state = loadOwnershipCheckpoint(path);
    assert.deepEqual(
      state.records.map((r) => r.tokenId),
      [1, 2, 3, 4, 5],
    );
    assert.equal(ownershipCoverage(state).unresolved, 9995);
    assert.equal(ownershipCoverage(state).financialFreezeEligible, false);
    await assert.rejects(
      stepOwnershipCheckpoint(path, {
        request: async () => ({ ...block, hash: "0x" + "b".repeat(64) }),
      }),
      /canonical/,
    );
    const synthetic = {
      ...state,
      records: Array.from({ length: 9999 }, (_, i) => ({
        tokenId: i + 1,
        wallet: "0x" + "1".repeat(40),
        callResult: "0x" + "0".repeat(24) + "1".repeat(40),
      })),
    };
    writeFileSync(
      path,
      JSON.stringify({
        state: synthetic,
        sha256: hash(JSON.stringify(synthetic)),
      }),
    );
    const complete = await stepOwnershipCheckpoint(path, { request, limit: 1 });
    assert.equal(complete.records.length, 10000);
    assert.equal(complete.chainSnapshotVerified, true);
    assert.equal(complete.financialFreezeEligible, false);
    assert.equal(
      ownershipCoverage(complete, [
        { tokenId: 1, wallet: "0x" + "2".repeat(40) },
      ]).mismatches.length,
      1,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
