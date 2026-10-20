import { expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { WalletCoveragePlan } from "./WalletCoveragePlan";
import { WalletPlansResponseSchema } from "../../../discovery/src/wallet-plan-model";

it("distinguishes zero-RPC saved work from completed coverage and keeps the fresh-snapshot requirement", () => {
  const data = WalletPlansResponseSchema.shape.data.parse({ at: "2026-10-21T00:00:00.000Z", scope: "up_to_20_current_contenders", capped: false,
    plans: [{ address: "So11111111111111111111111111111111111111112", symbol: "TEST", source_evidence_hash: "a".repeat(64), snapshot_at: "2026-10-20T23:00:00.000Z",
      stage: "cached_funding", windows: 2, examined_windows: 0, blocked_windows: 1, pending_bodies: 1, cached_pending_bodies: 1, minimum_rpc_calls: 0, gaps: ["provider_history_ended_before_window_boundary"] }],
    yield: { since: "2026-10-20T00:00:00.000Z", turns: 0, rpc_calls: 0, completed_windows: 0, new_buyer_observations: 0, snapshots: 0, failed_turns: 0, rpc_per_completed_window: null }, provider_requests: 0, evidence_gates_changed: false });
  const html = renderToStaticMarkup(<WalletCoveragePlan data={data} error="" />);
  expect(html).toContain("Apply verified saved evidence");
  expect(html).toContain("No RPC calls · saved evidence only");
  expect(html).toContain("0 / 2");
  expect(html).toContain("1 source-limited");
  expect(html).toContain("a fresh wallet snapshot and every existing gate are still required");
  expect(html).not.toContain("At least 0 RPC calls");
});
