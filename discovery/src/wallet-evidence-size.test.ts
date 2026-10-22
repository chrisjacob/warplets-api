import { describe, expect, it } from "vitest";
import { walletEvidenceJson, WALLET_EVIDENCE_MAX_BYTES } from "./wallet-evidence-size";

describe("wallet evidence UTF-8 byte ceiling", () => {
  it("accepts exactly the original byte ceiling and rejects one extra byte", () => {
    const exact = { holders: "x".repeat(WALLET_EVIDENCE_MAX_BYTES - 14) };
    expect(new TextEncoder().encode(JSON.stringify(exact)).length).toBe(WALLET_EVIDENCE_MAX_BYTES);
    expect(() => walletEvidenceJson(exact)).not.toThrow();
    expect(() => walletEvidenceJson({ holders: exact.holders + "x" })).toThrow("wallet_evidence_size_limit");
  });
  it("counts multibyte UTF-8 and retains the final whole-envelope check", () => {
    const holders = "é".repeat(500_000);
    expect(() => walletEvidenceJson({ holders })).not.toThrow();
    expect(() => walletEvidenceJson({ holders, records: holders })).toThrow("wallet_evidence_size_limit");
  });
});
