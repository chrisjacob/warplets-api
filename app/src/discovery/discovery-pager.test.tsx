import { beforeAll, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createDiscoveryPager, DiscoveryPageError, fetchDiscoveryPage, type DiscoveryPageData } from "./discovery-pager";
import { DiscoveryPagination } from "./DiscoveryPagination";
import { discoveryCandidatesUrl, discoveryView } from "./DiscoveryWorkspace";
import { fixtureCandidates } from "../../../discovery/src/fixtures";
import { candidateCard, type CandidateCard } from "../../../discovery/src/candidate-card";
import { assess, DEFAULT_POLICY } from "../../../discovery/src/model";
import { toBase58 } from "../../../discovery/src/solana";

const at = "2026-10-21T01:00:00.000Z", url = discoveryCandidatesUrl(discoveryView("?mode=fixture&age=all"));
let base: CandidateCard;
beforeAll(async () => { base = candidateCard(assess((await fixtureCandidates(new Date(at)))[0]!, DEFAULT_POLICY, new Date(at))); });
function page(index = 0, total = 205, cutoff = at): DiscoveryPageData {
  return {
    api_version: "10x-discovery-v1", trace_id: "synthetic", as_of: cutoff, served_at: cutoff, policy_version: "synthetic",
    source_freshness: { last_harvest: cutoff, last_success: cutoff, stale: false },
    coverage: { exhaustive: false, scope: "synthetic", history_limit: 3000, quote_support: "WSOL", holder_classification: "synthetic", market_enabled: false },
    data: { mode: "fixture", sort: "score", scored_at: cutoff, observed: total,
      counts: { eligible: base.eligibility === "eligible" ? total : 0, provisional: base.eligibility === "provisional" ? total : 0, excluded: base.eligibility === "excluded" ? total : 0 },
      scope: { inventory: "current_evaluation", stored: total, retained_total: total, ranked: total, matched: total, available: total, maximum: 500, truncated: false, search_before_limit: true },
      candidates: Array.from({ length: Math.max(0, Math.min(100, total - index * 100)) }, (_, i) => ({ ...base, address: toBase58(new Uint8Array(32).fill(index * 100 + i + 1)), discovery_rank: index * 100 + i + 1 })),
    }, next_cursor: (index + 1) * 100 < total ? `synthetic-cursor-${index + 1}` : null,
  };
}
function deferred() { let resolve!: (value: unknown) => void; const promise = new Promise<unknown>(done => { resolve = done; }); return { promise, resolve }; }

it("browses 205 mints, caches previous pages and pauses background refresh after page one", async () => {
  const load = vi.fn().mockResolvedValueOnce(page()).mockResolvedValueOnce(page(1)).mockResolvedValueOnce(page(2)).mockResolvedValueOnce(page(0, 205, "2026-10-21T01:01:00.000Z"));
  const pager = createDiscoveryPager(url, load); await pager.start(); await pager.next(); await pager.poll();
  expect(load).toHaveBeenCalledTimes(2); expect(pager.getState().index).toBe(1);
  await pager.next(); expect(pager.getState().pages.flatMap(p => p.data.candidates)).toHaveLength(205);
  pager.previous(); await pager.next(); expect(load).toHaveBeenCalledTimes(3);
  pager.previous(); pager.previous(); await pager.poll();
  expect(pager.getState().pages).toHaveLength(1); expect(pager.getState().pages[0].data.scored_at).toBe("2026-10-21T01:01:00.000Z");
  expect(load.mock.calls[1][0]).toContain("&cursor=synthetic-cursor-1"); pager.dispose();
});

it("holds expired/changed snapshots with old data visible until an explicit successful refresh", async () => {
  const load = vi.fn().mockResolvedValueOnce(page()).mockRejectedValueOnce(new DiscoveryPageError("expired")).mockResolvedValueOnce(page());
  const pager = createDiscoveryPager(url, load); await pager.start(); const original = pager.getState().pages[0]; await pager.next();
  expect(pager.getState()).toMatchObject({ index: 0, refresh_required: true, busy: false });
  expect(pager.getState().pages[0]).toBe(original); await pager.next(); await pager.poll(); expect(load).toHaveBeenCalledTimes(2);
  await pager.refresh(); expect(pager.getState().refresh_required).toBe(false); expect(pager.getState().error).toBe(""); pager.dispose();
});

it("retries temporary failures without discarding the last successful page", async () => {
  const load = vi.fn().mockResolvedValueOnce(page()).mockRejectedValueOnce(new DiscoveryPageError("unavailable")).mockResolvedValueOnce(page(1)).mockRejectedValueOnce(Error("offline"));
  const pager = createDiscoveryPager(url, load); await pager.start(); await pager.next();
  expect(pager.getState().refresh_required).toBe(false); expect(pager.getState().pages).toHaveLength(1);
  await pager.next(); await pager.refresh(); expect(pager.getState().index).toBe(1); expect(pager.getState().pages).toHaveLength(2); pager.dispose();
});

it("rejects wrong modes/cutoffs/scopes, duplicate identities, short pages and looping cursors without appending", async () => {
  const corruptions: ((value: DiscoveryPageData) => void)[] = [
    p => { p.data.mode = "live"; }, p => { p.data.scored_at = "2026-10-21T01:02:00.000Z"; },
    p => { p.data.scope!.stored++; }, p => { p.data.counts.eligible++; },
    p => { p.data.candidates[0].address = page().data.candidates[0].address; }, p => { p.data.candidates.pop(); },
    p => { p.next_cursor = page().next_cursor; }, p => { p.data.candidates[0].mode = "live"; },
  ];
  for (const corrupt of corruptions) {
    const bad = page(1); corrupt(bad); const load = vi.fn().mockResolvedValueOnce(page()).mockResolvedValueOnce(bad);
    const pager = createDiscoveryPager(url, load); await pager.start(); await pager.next();
    expect(pager.getState().refresh_required).toBe(true); expect(pager.getState().pages).toHaveLength(1); pager.dispose();
  }
});

it("aborts old requests on refresh/disposal and supports React's setup-cleanup-setup cycle without late publication", async () => {
  const old = deferred(), fresh = deferred(), load = vi.fn().mockReturnValueOnce(old.promise).mockReturnValueOnce(fresh.promise);
  const pager = createDiscoveryPager(url, load), first = pager.start(); pager.dispose(); const second = pager.start();
  expect(load.mock.calls[0][1].aborted).toBe(true);
  fresh.resolve(page(0, 205, "2026-10-21T01:02:00.000Z")); await second;
  old.resolve(page()); await first;
  expect(pager.getState().pages[0].data.scored_at).toBe("2026-10-21T01:02:00.000Z");
  pager.dispose(); const before = load.mock.calls.length; await pager.next(); await pager.refresh(); expect(load).toHaveBeenCalledTimes(before);
});

it("discards a disposed query's delayed response instead of contaminating a new mode/filter session", async () => {
  const pending = deferred(), old = createDiscoveryPager(url, () => pending.promise), requested = old.start(); old.dispose();
  const next = createDiscoveryPager(url + "&q=other", async () => page(0, 0)); await next.start(); pending.resolve(page()); await requested;
  expect(old.getState().pages).toHaveLength(0); expect(next.getState().pages[0].data.candidates).toHaveLength(0); next.dispose();
});

it("shows page ranges, snapshot dates, refresh recovery and accessible bounded navigation", () => {
  const state = { pages: [page(), page(1)], index: 1, busy: false, error: "", refresh_required: false };
  const html = renderToStaticMarkup(<DiscoveryPagination state={state} onNext={()=>{}} onPrevious={()=>{}} onRefresh={()=>{}}/>);
  expect(html).toContain("Page 2 of 3"); expect(html).toContain("101–200 of 205 available matches"); expect(html).toContain("Later pages stay frozen");
  expect(html).toContain('aria-label="Discovery result pages"'); expect(html).toContain("Refresh list · return to page 1");
  const held = renderToStaticMarkup(<DiscoveryPagination state={{ ...state, refresh_required: true }} onNext={()=>{}} onPrevious={()=>{}} onRefresh={()=>{}}/>);
  expect(held).toMatch(/disabled=""[^>]*>Next page/);
  const footer = renderToStaticMarkup(<DiscoveryPagination footer state={state} onNext={()=>{}} onPrevious={()=>{}} onRefresh={()=>{}}/>);
  expect(footer).toContain('aria-label="More Discovery result pages"'); expect(footer).not.toContain("Later pages stay frozen");
});

it("classifies HTTP expiry without parsing server error bodies or making provider requests", async () => {
  const network = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("private error", { status: 409 }));
  try { await expect(fetchDiscoveryPage(url, new AbortController().signal)).rejects.toMatchObject({ kind: "expired" }); expect(network.mock.calls[0][1]).toMatchObject({ cache: "no-store" }); }
  finally { network.mockRestore(); }
});

it("bounds a stalled page request so later-page navigation cannot remain busy indefinitely", async () => {
  const realTimeout = AbortSignal.timeout.bind(AbortSignal);
  const timeout = vi.spyOn(AbortSignal, "timeout").mockImplementation(() => realTimeout(5));
  const network = vi.spyOn(globalThis, "fetch").mockImplementation((_url, init) => new Promise((_resolve, reject) => {
    const signal = init!.signal!;
    if (signal.aborted) reject(signal.reason);
    else signal.addEventListener("abort", () => reject(signal.reason), { once: true });
  }));
  try { await expect(fetchDiscoveryPage(url, new AbortController().signal)).rejects.toMatchObject({ name: "TimeoutError" }); expect(timeout).toHaveBeenCalledWith(30_000); }
  finally { network.mockRestore(); timeout.mockRestore(); }
});
