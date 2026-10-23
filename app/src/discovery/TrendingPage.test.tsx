import { expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { buildAttentionQueue } from "../../../discovery/src/attention-queue";
import { normalizeAttention } from "../../../discovery/src/attention-feed-contract";
import { gmgnTokenHref, trendingTokenImageHref, tokenLaunchAge, trendingRows, TrendingLeaderboard } from "./TrendingPage";

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
it("uses exact-chain public image fallbacks for missing feed artwork and rejects malformed addresses", () => {
  const html=renderToStaticMarkup(<TrendingLeaderboard report={report()} onRefresh={()=>{}}/>);
  expect(html).toContain(`src="https://dd.dexscreener.com/ds-data/tokens/base/${address(2)}.png"`);
  expect(html).toContain(`src="https://dd.dexscreener.com/ds-data/tokens/bsc/${address(1)}.png"`);
  expect(trendingTokenImageHref("base","../../private")).toBeNull();
  expect(trendingTokenImageHref("solana","not-a-mint")).toBeNull();
});
it("keeps loading, missing coverage and a failed refresh distinct without clearing the last saved list", () => {
  expect(renderToStaticMarkup(<TrendingLeaderboard report={null} busy onRefresh={() => {}}/>)).toContain("Loading trending tokens…");
  const value = report(); value.rows = [];
  expect(renderToStaticMarkup(<TrendingLeaderboard report={value} onRefresh={() => {}}/>)).toContain("No fresh trending tokens");
  const html = renderToStaticMarkup(<TrendingLeaderboard report={report()} error="Saved snapshot could not refresh" onRefresh={() => {}}/>);
  expect(html).toContain('role="alert"'); expect(html).toContain("Saved snapshot could not refresh"); expect(html).toContain(">HOT<");
});
it("shows token age from the reported launch timestamp, without replacing unknown launch time with pool age", () => {
  const value=report(),row=value.rows.find(r=>r.symbol==="HOT")!;
  row.reported_open_seconds=at.getTime()/1000-2*86400;
  expect(tokenLaunchAge(row,value.as_of)).toEqual({label:"2d",launchedAt:"2026-10-22T00:00:00.000Z"});
  const html=renderToStaticMarkup(<TrendingLeaderboard report={value} onRefresh={()=>{}}/>);
  expect(html).toContain('>Age</th>');expect(html).toContain('dateTime="2026-10-22T00:00:00.000Z"');expect(html).toContain('>2d</time>');
  row.sources.forEach(s=>s.fresh=false);
  expect(tokenLaunchAge(row,value.as_of).label).toBe("—");
  row.sources=[{provider:"geckoterminal",window:"24h",received_at:value.as_of,rank:1,previous_rank:null,search_interest:null,fresh:true}];
  expect(tokenLaunchAge(row,value.as_of).label).toBe("—");
});
it("keeps missing, zero and future launch timestamps unknown and formats recent launches compactly", () => {
  const value=report(),row=value.rows.find(r=>r.symbol==="HOT")!;
  for(const seconds of[null,0,at.getTime()/1000+1]){row.reported_open_seconds=seconds;expect(tokenLaunchAge(row,value.as_of).label).toBe("—");}
  for(const [elapsed,label]of[[30,"30s"],[90,"1m"],[7200,"2h"]]as const){row.reported_open_seconds=at.getTime()/1000-elapsed;expect(tokenLaunchAge(row,value.as_of).label).toBe(label);}
});
