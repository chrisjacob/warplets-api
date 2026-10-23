import { useEffect, useMemo, useSyncExternalStore } from "react";
import { createDiscoveryPager, type DiscoveryPagerState } from "./discovery-pager";

export function useDiscoveryPages(url: string, enabled = true) {
  const pager = useMemo(() => createDiscoveryPager(url), [url, enabled]);
  const state = useSyncExternalStore(pager.subscribe, pager.getState, pager.getState);
  useEffect(() => {
    if (!enabled) return () => pager.dispose();
    void pager.start();
    const interval = window.setInterval(() => { if (document.visibilityState === "visible") void pager.poll(); }, 60_000);
    return () => { window.clearInterval(interval); pager.dispose(); };
  }, [pager, enabled]);
  return { state, data: state.pages[state.index] ?? null, next: pager.next, previous: pager.previous, refresh: pager.refresh };
}

export function DiscoveryPagination({ state, onNext, onPrevious, onRefresh, footer = false }: {
  state: DiscoveryPagerState; onNext: () => void; onPrevious: () => void; onRefresh: () => void; footer?: boolean;
}) {
  const page = state.pages[state.index], total = page?.data.scope?.available ?? 0;
  const start = state.pages.slice(0, state.index).reduce((n, item) => n + item.data.candidates.length, 0);
  const hasNext = state.index + 1 < state.pages.length || !!page?.next_cursor;
  return <nav className="tenx-pagination" aria-label={footer ? "More Discovery result pages" : "Discovery result pages"}>
    {page && <p>Page {state.index + 1} of {Math.max(1, Math.ceil(total / 100))} · {total ? start + 1 : 0}–{start + page.data.candidates.length} of {total} available matches.</p>}
    <div className="tenx-shortlist-actions"><button type="button" className="tenx-button tenx-button--quiet" disabled={state.busy || state.index === 0} onClick={onPrevious}>Previous page</button>
      <button type="button" className="tenx-button tenx-button--quiet" disabled={state.busy || !hasNext || state.refresh_required} onClick={onNext}>Next page</button>
      <button type="button" className="tenx-button" disabled={state.busy} onClick={onRefresh}>{state.busy ? "Reading saved observations…" : "Refresh list · return to page 1"}</button></div>
    {page && !footer && <details className="tenx-page-help"><summary>How paging & refresh work</summary><p className="tenx-footnote">Browse cutoff {new Date(page.data.scored_at!).toLocaleString()}. Scores and table freshness refer to this cutoff. Later pages stay frozen until you refresh; page 1 refreshes automatically every minute while visible. Page links expire after five minutes or a saved-inventory change.</p></details>}
  </nav>;
}
