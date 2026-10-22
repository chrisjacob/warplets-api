import { expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { AttentionHolderParticipation, AttentionHolderParticipationValues, bindAttentionHolderParticipation } from "./AttentionHolderParticipation";
import { participationFixture } from "../../../discovery/src/holder-participation-fixtures.test-helper";
import { reviewHolderParticipation, unavailableHolderParticipation } from "../../../discovery/src/holder-participation";
import { key } from "../../../discovery/src/wallet-fixtures.test-helper";

it("renders collapsed and unsupported chains without reading providers or archives", () => {
  const fetcher = vi.spyOn(globalThis, "fetch");
  try {
    const html = renderToStaticMarkup(<AttentionHolderParticipation chain="solana" address={key(3)} cutoff="2026-10-21T10:00:00.000Z"/>);
    expect(html).toContain("Acquired and retained holder evidence"); expect(html).not.toContain("Checking saved holder evidence"); expect(html).not.toContain("<table");
    const unsupported = renderToStaticMarkup(<AttentionHolderParticipation chain="base" address="0x0000000000000000000000000000000000001234" cutoff="2026-10-21T10:00:00.000Z"/>);
    expect(unsupported).toContain("not connected for this chain"); expect(unsupported).not.toContain("<details"); expect(fetcher).not.toHaveBeenCalled();
  } finally { fetcher.mockRestore(); }
});
it("verifies report/policy hashes and binds exactly to the Solana mint and fixed cutoff", async () => {
  const report = await reviewHolderParticipation(await participationFixture());
  expect(await bindAttentionHolderParticipation(report, report.address, report.cutoff_at)).toEqual(report);
  await expect(bindAttentionHolderParticipation({ ...report, report_hash: "0".repeat(64) }, report.address, report.cutoff_at)).rejects.toThrow();
  await expect(bindAttentionHolderParticipation({ ...report, policy_hash: "0".repeat(64) }, report.address, report.cutoff_at)).rejects.toThrow();
  await expect(bindAttentionHolderParticipation(report, key(19), report.cutoff_at)).rejects.toThrow("binding_mismatch");
  await expect(bindAttentionHolderParticipation(report, report.address, new Date(Date.parse(report.cutoff_at) + 1).toISOString())).rejects.toThrow("binding_mismatch");
  const simulation = await unavailableHolderParticipation(report.address, new Date(report.cutoff_at), "simulation", "synthetic");
  await expect(bindAttentionHolderParticipation(simulation, report.address, report.cutoff_at)).rejects.toThrow("binding_mismatch");
});
it("shows sample qualification, dates and boundaries without adding 24h organic-growth credit", async () => {
  const report = await reviewHolderParticipation(await participationFixture());
  const html = renderToStaticMarkup(<AttentionHolderParticipationValues report={report}/>);
  for (const text of ["screened retained · sample", "0 screened retained", "attention snapshot cutoff", "0.01 SOL", "30 minutes", "Meaningful 24h holder growth remains unknown", "No score credit", "not included in the saved personal review snapshot", "Report checksum"]) expect(html).toContain(text);
});
it.each(["missing", "rejected"] as const)("preserves unknown values for %s evidence", async state => {
  const report = await unavailableHolderParticipation(key(3), new Date("2026-10-21T10:00:00.000Z"), state, "missing_saved_source");
  const html = renderToStaticMarkup(<AttentionHolderParticipationValues report={report}/>);
  expect(html).toContain("Unknown"); expect(html).not.toContain("0 screened retained"); expect(html).toContain("missing saved source");
});
