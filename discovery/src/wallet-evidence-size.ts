// The preflight is only a lower bound. The complete, parsed evidence must still
// pass the same byte limit before analysis or publication. Never trim sources.
export const WALLET_EVIDENCE_MAX_BYTES = 1_800_000;
export function walletEvidenceJson(value: unknown): string {
  const payload = JSON.stringify(value);
  if (new TextEncoder().encode(payload).byteLength > WALLET_EVIDENCE_MAX_BYTES)
    throw new Error("wallet_evidence_size_limit");
  return payload;
}
