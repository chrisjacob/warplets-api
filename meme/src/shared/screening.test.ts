import test from "node:test";
import assert from "node:assert/strict";
import { screenCandidate } from "./screening";
test("screening never treats missing authority, liquidity or coverage as a passing safety check", () => {
  const report = screenCandidate(
    {
      ogMint: "11111111111111111111111111111111",
      asOf: 1000,
      observedAt: 1000,
      sourceHash: "a".repeat(64),
      mintProgram: null,
      mintAuthority: undefined,
      freezeAuthority: undefined,
      poolProgram: null,
      liquidityUsd: null,
      topTenPercent: null,
      complete: false,
    },
    4000000,
  );
  assert(report.issues.includes("mint-authority-needs-review"));
  assert(report.issues.includes("coverage-incomplete"));
  assert(report.issues.includes("stale-evidence"));
  assert.equal(report.financialReady, false);
  assert.equal(report.automaticallySelected, false);
});
