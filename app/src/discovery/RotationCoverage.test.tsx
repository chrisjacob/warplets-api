import { expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { RotationCoveragePanel } from "./RotationCoverage";
import { RotationCoverage, type RotationCoverageReport } from "../../../discovery/src/rotation-coverage-model";

const empty = { attempted: 0, recorded_succeeded: 0, failed: 0, pending: 0, configured_weight: 0 };
function fixture(): RotationCoverageReport {
  return RotationCoverage.parse({ version: "gmgn-rotation-coverage-v1", cutoff: "2026-10-22T12:00:00.000Z", window_days: 14, scope: "retained_selection_and_attempt_metadata",
    days: Array.from({ length: 14 }, (_, i) => ({ day: new Date(Date.UTC(2026, 9, 22 - i)).toISOString().slice(0, 10), manifest_cutoff: null, manifest_hash: null, all_core_attempts: 0, scheduled_baseline_remaining: 21, inventory: 0, regression_fixtures: 0, targets: [], counts: empty })),
    counts: empty, distinct_selected: 0, distinct_attempted: 0, newly_investigated: 0, new_investigation_days: 0,
    target: { mints: 30, utc_days: 3, data_quality_pass: null }, receipt_payloads_replayed: false, provider_requests: 0, database_writes: 0, scoring_effect: "none", evidence_gates_changed: false });
}
it("shows honest zero counts, unfrozen days, UTC scope and no automatic quality pass", () => {
  const html = renderToStaticMarkup(<RotationCoveragePanel data={fixture()} error="" />);
  for (const text of ["Broad token coverage", "14 UTC days", "Not frozen", "not token-quality results", "30", "3 UTC days", "no provider requests", "No automatic scoring promotion", "New-to-GMGN", "Recorded successes", "V4"]) expect(html).toContain(text);
  expect(html).not.toContain("target achieved"); expect(html).not.toContain("<button");
});
it("keeps failed and missing endpoint records distinct and discloses repeat investigations", () => {
  const data = fixture(), counts = { attempted: 1, recorded_succeeded: 0, failed: 1, pending: 0, configured_weight: 2 };
  data.days[0] = { day: "2026-10-22", manifest_cutoff: "2026-10-22T01:00:00.000Z", manifest_hash: "b".repeat(64), all_core_attempts: 34, scheduled_baseline_remaining: 0, inventory: 100, regression_fixtures: 3, counts,
    targets: [{ address: "So11111111111111111111111111111111111111112", first_selection: false, prior_gmgn_attempts: 5, newly_investigated: false,
      kinds: ["gmgn_token_info", "gmgn_token_security", "gmgn_token_pool", "gmgn_token_candles"].map(kind => ({ kind: kind as RotationCoverageReport["days"][number]["targets"][number]["kinds"][number]["kind"], counts: kind === "gmgn_token_candles" ? counts : empty })) }] };
  const html = renderToStaticMarkup(<RotationCoveragePanel data={data} error="temporary" />);
  for (const text of ["last successful view", "100 (3 regression fixtures)", "Previously selected", "5 prior GMGN attempts", "candles: 0 recorded successes, 1 failed, 0 pending", "info: Not attempted", "Manifest checksum:"]) expect(html).toContain(text);
  expect(html).toContain('href="/token/solana/So11111111111111111111111111111111111111112"');
});
it("offers loading and unavailable states without inventing an empty cohort", () => {
  expect(renderToStaticMarkup(<RotationCoveragePanel data={null} error="" />)).toContain('role="status"');
  const html = renderToStaticMarkup(<RotationCoveragePanel data={null} error="unavailable" />);
  expect(html).toContain('role="alert"'); expect(html).not.toContain("Distinct selected mints");
});
