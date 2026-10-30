import { existsSync, readFileSync } from "node:fs";
const file = process.argv[2];
const results = file ? JSON.parse(readFileSync(file, "utf8")) : [];
const valid = new Set(["passed", "failed", "blocked", "not-run"]);
for (const r of results)
  if (
    !valid.has(r.status) ||
    !r.name ||
    !["local", "live-read", "mainnet", "physical-device"].includes(r.layer) ||
    !r.build ||
    !r.evidence
  )
    throw Error("Invalid QA evidence");
console.log(
  JSON.stringify(
    {
      version: 1,
      generatedAt: new Date().toISOString(),
      results,
      pending: [
        "Dedicated Farcaster holder/non-holder identities",
        "Real extension and Base smart-account signing",
        "Physical iOS/Android handoffs",
        "Approved provider allowance and live history reconciliation",
        "Approved launch economics and actual multisig addresses",
        "Itemized simulated cost packet and human mainnet confirmation",
      ],
      mainnetExecuted: results.some(
        (r) => r.layer === "mainnet" && r.status === "passed",
      ),
      productionReady: false,
    },
    null,
    2,
  ),
);
