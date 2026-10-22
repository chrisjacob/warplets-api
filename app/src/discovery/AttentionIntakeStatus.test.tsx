import { expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { AttentionIntakeStatus, AttentionIntakeStatusValues, bindMintIntakeStatus } from "./AttentionIntakeStatus";
import { MintIntakeStatus } from "../../../discovery/src/mint-intake-status-model";
import { key } from "../../../discovery/src/wallet-fixtures.test-helper";
export const intakeStatusFixture = () => MintIntakeStatus.parse({ version: "mint-intake-status-v1", chain: "solana", address: key(31), at: "2026-10-23T00:00:00.000Z", scope: "bounded_pump_fun_wsol_migration_review",
  review: { state: "scanning", queued_at: "2026-10-22T23:00:00.000Z", updated_at: "2026-10-22T23:30:00.000Z", pages: 1, bodies_checked: 2, last_error: null },
  candidate_saved: false, migration_lead_saved: false, control: { paused: false, retry_after: null, next_refresh_at: null, reserved_today: 3 },
  provider_requests: 0, database_writes: 0, scoring_effect: "none", evidence_gates_changed: false });
it("renders collapsed and unsupported chains without a request or collection action", () => {
  const fetcher = vi.spyOn(globalThis, "fetch");
  try {
    const report = intakeStatusFixture(), html = renderToStaticMarkup(<AttentionIntakeStatus chain="solana" address={report.address}/>);
    expect(html).toContain("Migration intake · saved workflow status"); expect(html).not.toContain("Reading saved migration intake"); expect(html).not.toContain("Scanning migration history");
    expect(renderToStaticMarkup(<AttentionIntakeStatus chain="base" address="0x123"/>)).toContain("not connected for this chain"); expect(fetcher).not.toHaveBeenCalled();
  } finally { fetcher.mockRestore(); }
});
it("rejects foreign identities, changed scope, extra fields, future updates and action credit", () => {
  const report = intakeStatusFixture(); expect(bindMintIntakeStatus(report, report.address)).toEqual(report);
  for (const raw of [{ ...report, chain: "base" }, { ...report, scope: "all_tokens" }, { ...report, eligible: true }, { ...report, provider_requests: 1 }, { ...report, review: { ...report.review, updated_at: "2026-10-24T00:00:00.000Z" } }]) expect(() => bindMintIntakeStatus(raw, report.address)).toThrow();
  expect(() => bindMintIntakeStatus(report, key(32))).toThrow("intake_status_identity_mismatch");
});
it.each(["queued", "scanning", "admitted", "unsupported_quote", "not_found", "expired"] as const)("explains %s as workflow progress without a safety verdict", state => {
  const report = intakeStatusFixture(); report.review!.state = state;
  const html = renderToStaticMarkup(<AttentionIntakeStatusValues report={report}/>);
  for (const text of ["1 of 3 signature pages saved", "2 transaction bodies checked", "separate from the fixed attention snapshot", "does not establish a scam", "no score or launch credit", "not included in the saved personal review snapshot", "24-hour migration window"]) expect(html).toContain(text);
  expect(html).not.toContain("Record presence verifies");
});
it("distinguishes no request, saved records, pause and shared backoff from qualification", () => {
  const report = intakeStatusFixture(); report.review = null; report.candidate_saved = true; report.migration_lead_saved = true;
  report.control = { paused: true, reserved_today: 20, retry_after: "2026-10-23T00:01:00.000Z", next_refresh_at: "2026-10-23T00:02:00.000Z" };
  const html = renderToStaticMarkup(<AttentionIntakeStatusValues report={report}/>);
  for (const text of ["No migration review requested", "Record presence does not verify its evidence", "collection is paused", "Shared source backoff", "20 of 20", "not a completion forecast"]) expect(html).toContain(text);
});
