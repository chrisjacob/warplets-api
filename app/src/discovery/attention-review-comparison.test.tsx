import { expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { buildAttentionQueue } from "../../../discovery/src/attention-queue";
import { normalizeAttention } from "../../../discovery/src/attention-feed-contract";
import { compareAttentionReview } from "./attention-review-comparison";
import { AttentionReviewComparison, AttentionReviewComparisonValues } from "./AttentionReviewComparison";
import { appendAttentionReview, captureAttentionReview, parseAttentionReviews, type ReviewLabels } from "./attention-review-store";
import { attentionReviewProgress } from "./attention-review-progress";

const at = new Date("2026-10-20T12:00:00.000Z"), later = new Date(at.getTime() + 86_400_000), address = "0x0000000000000000000000000000000000001234";
function queue(date = at, chain = "base") {
  return buildAttentionQueue([normalizeAttention({ kind: "gmgn_hot_searches" }, { code: 0, data: [{ chain, interval: "24h", tokens: [{ address, symbol: "MEME", visiting_count: 10 }] }] }, date.toISOString())], date);
}
const saved = () => captureAttentionReview(queue(), address, "base");
it("compares cloned exact-identity snapshots with zero IO, preserving unknown and zero separately", () => {
  const fetcher = vi.spyOn(globalThis, "fetch");
  try {
    const original = saved(), loaded = queue(later); loaded.rows[0]!.volume_24h_usd = 0;
    const before = JSON.stringify([original, loaded]), result = compareAttentionReview(original, loaded, later);
    expect(result.state).toBe("ready"); if (result.state !== "ready") throw Error("ready");
    expect(result).toMatchObject({ provider_requests: 0, scoring_effect: "none", evidence_gates_changed: false });
    const html = renderToStaticMarkup(<AttentionReviewComparisonValues result={result}/>);
    for (const text of ["Unknown", "$0.00", "Received", "does not freshen source timestamps", "Reported 24h volume"]) expect(html).toContain(text);
    result.current.token.symbol = "Changed copy"; result.original.token.symbol = "Changed copy";
    expect(JSON.stringify([original, loaded])).toBe(before); expect(fetcher).not.toHaveBeenCalled();
  } finally { fetcher.mockRestore(); }
});
it("does not confuse identical contracts on different chains or absence with an adverse outcome", () => {
  const loaded = queue(later, "bsc"); loaded.history_truncated = true;
  const result = compareAttentionReview(saved(), loaded, later);
  expect(result).toMatchObject({ state: "absent", truncated: true });
  const html = renderToStaticMarkup(<AttentionReviewComparisonValues result={result}/>);
  expect(html).toContain("Absence does not prove attention faded"); expect(html).toContain("coverage bound");
});
it.each([at, new Date(at.getTime() - 1)])("withholds adoption for a same/older list cutoff %s", date => {
  expect(compareAttentionReview(saved(), queue(date), later).state).toBe("not_newer");
});
it.each([new Date("invalid"), new Date(at.getTime() - 1)])("holds an invalid or backwards device clock %s", date => {
  expect(() => compareAttentionReview(saved(), queue(later), date)).toThrow("review_comparison_clock");
});
it("holds a future loaded report and ambiguous same-chain identity", () => {
  expect(() => compareAttentionReview(saved(), queue(later), at)).toThrow("review_comparison_clock");
  const loaded = queue(later); loaded.rows.push(structuredClone(loaded.rows[0]!));
  expect(() => compareAttentionReview(saved(), loaded, later)).toThrow("review_comparison_identity");
});
it("validates source times and preserves existing report admission flags", () => {
  const loaded = queue(later); loaded.rows[0]!.sources[0]!.received_at = new Date(later.getTime() + 1).toISOString();
  expect(() => compareAttentionReview(saved(), loaded, later)).toThrow();
  expect(() => compareAttentionReview(saved(), { ...queue(later), provider_requests: 1 } as never, later)).toThrow();
});
it("keeps older source times explicit in a later list and freezes the comparison across refreshes", () => {
  const loaded = queue(later); loaded.rows[0]!.sources[0]!.received_at = at.toISOString();
  const result = compareAttentionReview(saved(), loaded, later);
  expect(result.state).toBe("ready"); if (result.state !== "ready") throw Error("ready");
  loaded.rows[0]!.sources[0]!.received_at = later.toISOString();
  expect(result.current.token.sources[0]!.received_at).toBe(at.toISOString());
});
it("rejects oversized review inputs and list inputs before schema projection", () => {
  expect(() => compareAttentionReview({ ...saved(), gaps: ["x".repeat(2_000_000)] }, queue(later), later)).toThrow("review_comparison_bound");
  expect(() => compareAttentionReview(saved(), { ...queue(later), gaps: ["x".repeat(8_000_000)] }, later)).toThrow("review_comparison_bound");
});
it("appends an adopted context through the original ledger without changing its first cohort or earlier record", async () => {
  const labels: ReviewLabels = { decision: "needs_evidence", relevance: "uncertain", catalyst: "", concerns: "", rationale: "Synthetic assessment only", outcome: "not_followed_up", outcome_note: "" };
  const original = await appendAttentionReview(await parseAttentionReviews(null), saved(), labels, at), prefix = JSON.stringify(original.records[0]);
  const result = compareAttentionReview(saved(), queue(later), later); if (result.state !== "ready") throw Error("ready");
  const next = await appendAttentionReview(original, result.current, labels, later), progress = await attentionReviewProgress(next, later);
  expect(JSON.stringify(next.records[0])).toBe(prefix); expect(next.records[1]!.labels).toEqual(labels);
  expect(next.records[1]!.previous_review_hash).toBe(original.records[0]!.hash); expect(next.records[1]!.context.as_of).toBe(later.toISOString());
  expect(progress).toMatchObject({ tokens: 1, revisions: 2, due: 1, reported: 0 }); expect(progress.rows[0]!.first.recorded_at).toBe(at.toISOString());
});
it("renders an explicit disabled comparison without IO or automatic adoption", () => {
  const adopt = vi.fn(), fetcher = vi.spyOn(globalThis, "fetch");
  try {
    const html = renderToStaticMarkup(<AttentionReviewComparison context={saved()} loadedReport={queue(later)} disabled onAdopt={adopt}/>);
    expect(html).toContain('type="button"'); expect(html).toContain('disabled=""'); expect(html).not.toContain("Loaded snapshot");
    expect(adopt).not.toHaveBeenCalled(); expect(fetcher).not.toHaveBeenCalled();
  } finally { fetcher.mockRestore(); }
});
