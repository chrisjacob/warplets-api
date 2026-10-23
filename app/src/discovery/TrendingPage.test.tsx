import { expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { buildAttentionQueue } from "../../../discovery/src/attention-queue";
import { normalizeAttention } from "../../../discovery/src/attention-feed-contract";
import { gmgnTokenHref, trendingRows, TrendingLeaderboard } from "./TrendingPage";

const at = new Date("2026-10-24T00:00:00.000Z"), address = (n: number) => `0x${n.toString(16).padStart(40, "0")}`;
function report() {
  return buildAttentionQueue([normalizeAttention({ kind: "gmgn_hot_searches" }, { code: 0, data: [
    { chain: "base", interval: "24h", tokens: [
      { address: address(1), symbol: "LOW", visiting_count: 10 },
      { address: address(2), symbol: "HOT", visiting_count: 100, fdv: 990000000, volume: 0, liquidity: 20000 },
      { address: address(3), symbol: "ADVERSE", visiting_count: 1000, is_honeypot: true },
    ] }, { chain: "bsc", interval: "24h", tokens: [{ address: address(1), symbol: "OTHER", visiting_count: 20 }] },
  ] }, at.toISOString())], at);
}
it("keeps provider heat order, separates chain identities and hides adverse or stale leads without introducing a score", () => {
  const value = report(); value.rows.find(r => r.symbol === "ADVERSE")!.checks = "adverse";
  expect(trendingRows(value).map(r => r.symbol)).toEqual(["HOT", "OTHER", "LOW"]);
  expect(trendingRows(value, "base").map(r => r.symbol)).toEqual(["HOT", "LOW"]);
  const stale = value.rows.find(r => r.symbol === "HOT")!; stale.sources.forEach(s => s.fresh = false); stale.attention_families = 0;
  expect(trendingRows(value).map(r => r.symbol)).toEqual(["OTHER", "LOW"]);
});
it("renders a compact accessible leaderboard with direct GMGN links, unknown cap rather than FDV, and real zero volume", () => {
  const value = report(); value.rows.find(r => r.symbol === "ADVERSE")!.checks = "adverse";
  const fetcher = vi.spyOn(globalThis, "fetch"), html = renderToStaticMarkup(<TrendingLeaderboard report={value} onRefresh={() => {}}/>);
  expect(html).toContain('scope="col"'); expect(html).toContain('scope="row"');
  expect(html.indexOf(">HOT<")).toBeLessThan(html.indexOf(">LOW<"));
  expect(html).toContain('href="https://gmgn.ai/base/token/' + address(2) + '"');
  expect(html).toContain('href="https://gmgn.ai/bsc/token/' + address(1) + '"');
  expect(html).toContain('target="_blank" rel="noopener noreferrer"');
  expect(html).toContain("View on GMGN"); expect(html).toContain("<td>—</td><td>$0</td>");
  for (const hidden of ["ADVERSE", "$990M", "View evidence", "Optional v4", "<details", "<form"]) expect(html).not.toContain(hidden);
  expect(fetcher).not.toHaveBeenCalled(); fetcher.mockRestore();
});
it("links Solana to GMGN's sol namespace and uses the exact encoded token identity", () => {
  const mint = "So11111111111111111111111111111111111111112";
  expect(gmgnTokenHref("solana", mint)).toBe(`https://gmgn.ai/sol/token/${mint}`);
  expect(gmgnTokenHref("base", "a/b?c")).toBe("https://gmgn.ai/base/token/a%2Fb%3Fc");
});
it("keeps loading, missing coverage and a failed refresh distinct without clearing the last saved list", () => {
  expect(renderToStaticMarkup(<TrendingLeaderboard report={null} busy onRefresh={() => {}}/>)).toContain("Loading trending tokens…");
  const value = report(); value.rows = [];
  expect(renderToStaticMarkup(<TrendingLeaderboard report={value} onRefresh={() => {}}/>)).toContain("No fresh trending tokens");
  const html = renderToStaticMarkup(<TrendingLeaderboard report={report()} error="Saved snapshot could not refresh" onRefresh={() => {}}/>);
  expect(html).toContain('role="alert"'); expect(html).toContain("Saved snapshot could not refresh"); expect(html).toContain(">HOT<");
});
