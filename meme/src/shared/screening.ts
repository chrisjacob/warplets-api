/** Supporting operator evidence, never an automatic investment/safety verdict. */
import { decode58 } from "./base58";
import { Exact } from "./exact";
export interface ScreeningEvidence {
  ogMint: string;
  observedAt: number;
  asOf: number;
  sourceHash: string;
  mintProgram: string | null;
  mintAuthority: string | null | undefined;
  freezeAuthority: string | null | undefined;
  poolProgram: string | null;
  liquidityUsd: string | null;
  topTenPercent: string | null;
  complete: boolean;
}
export function screenCandidate(e: ScreeningEvidence, now = Date.now()) {
  if (
    !e ||
    !Number.isSafeInteger(e.asOf) ||
    !Number.isSafeInteger(e.observedAt) ||
    e.asOf < 0 ||
    e.observedAt < e.asOf ||
    e.observedAt > now + 60000 ||
    !/^[a-f0-9]{64}$/.test(e.sourceHash)
  )
    throw Error("Screening provenance required");
  decode58(e.ogMint, 32);
  if (typeof e.complete !== "boolean")
    throw Error("Explicit screening coverage required");
  if (e.liquidityUsd !== null && Exact.decimal(e.liquidityUsd).n < 0n)
    throw Error("Invalid liquidity");
  if (e.topTenPercent !== null) {
    const percent = Exact.decimal(e.topTenPercent);
    if (percent.n < 0n || percent.compare(new Exact(100n)) > 0)
      throw Error("Invalid concentration");
  }
  const stale = now - e.asOf > 3600000;
  const issues: string[] = [];
  if (e.mintProgram !== "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA")
    issues.push("unsupported-or-unknown-mint-program");
  if (e.mintAuthority !== null) issues.push("mint-authority-needs-review");
  if (e.freezeAuthority !== null) issues.push("freeze-authority-needs-review");
  if (e.poolProgram !== "cpamdpZCGKUy5JxQXB4dcpGPiikHawvSWAd6mEn1sGG")
    issues.push("pool-route-needs-review");
  if (e.liquidityUsd === null) issues.push("liquidity-unavailable");
  if (e.topTenPercent === null) issues.push("concentration-unavailable");
  if (!e.complete) issues.push("coverage-incomplete");
  if (stale) issues.push("stale-evidence");
  return {
    version: 1,
    ogMint: e.ogMint,
    asOf: e.asOf,
    observedAt: e.observedAt,
    sourceHash: e.sourceHash,
    issues,
    operatorReviewRequired: true,
    automaticallySelected: false,
    financialReady: false,
  };
}
