import type { z } from "zod";
import { CardListResponse } from "./client";

export type DiscoveryPageData = z.infer<typeof CardListResponse>;
export type DiscoveryPagerState = { pages: DiscoveryPageData[]; index: number; busy: boolean; error: string; refresh_required: boolean };
export class DiscoveryPageError extends Error {
  constructor(public readonly kind: "expired" | "invalid" | "unavailable") { super(kind); }
}
export async function fetchDiscoveryPage(url: string, signal: AbortSignal): Promise<unknown> {
  const response = await fetch(url, { signal: AbortSignal.any([signal, AbortSignal.timeout(30_000)]), cache: "no-store" });
  if (!response.ok) throw new DiscoveryPageError(response.status === 409 ? "expired" : response.status === 400 ? "invalid" : "unavailable");
  return response.json();
}

// One bounded, browser-memory paging session. Never persist cursors/observations
// or merge a response from a changed query, mode, cutoff or inventory snapshot.
export function createDiscoveryPager(url: string, load = fetchDiscoveryPage) {
  let state: DiscoveryPagerState = { pages: [], index: 0, busy: false, error: "", refresh_required: false };
  let generation = 0, disposed = false, controller: AbortController | undefined;
  const listeners = new Set<() => void>();
  const query = new URL(url, "http://local").searchParams;
  const publish = (patch: Partial<DiscoveryPagerState>) => {
    if (disposed) return;
    state = { ...state, ...patch }; listeners.forEach(listener => listener());
  };
  function verify(raw: unknown, first: boolean): DiscoveryPageData {
    const parsed = CardListResponse.safeParse(raw);
    if (!parsed.success) throw new DiscoveryPageError("invalid");
    const page = parsed.data, data = page.data, scope = data.scope;
    const expectedMode = query.get("mode") ?? "live", expectedSort = query.get("sort") ?? "score";
    const earlier = first ? [] : state.pages;
    const loaded = earlier.reduce((n, saved) => n + saved.data.candidates.length, 0);
    if (!scope || scope.maximum !== 500 || !data.scored_at || data.mode !== expectedMode || data.sort !== expectedSort ||
        scope.inventory !== (query.get("age") === "24h" ? "active_verified_first_day" : "retained") ||
        scope.available !== Math.min(scope.matched, 500) || scope.matched > scope.ranked || scope.ranked > scope.stored ||
        scope.truncated !== (scope.matched > scope.available) || earlier.length >= 5 ||
        data.candidates.length !== Math.min(100, Math.max(0, scope.available - loaded)) ||
        (page.next_cursor !== null) !== (loaded + data.candidates.length < scope.available) ||
        (page.next_cursor !== null && (!page.next_cursor.length || page.next_cursor.length > 512))) throw new DiscoveryPageError("invalid");
    if (!first) {
      const baseline = earlier[0]!.data;
      if (data.scored_at !== baseline.scored_at || JSON.stringify(scope) !== JSON.stringify(baseline.scope) ||
          JSON.stringify(data.counts) !== JSON.stringify(baseline.counts) || data.observed !== baseline.observed ||
          (page.next_cursor !== null && earlier.some(saved => saved.next_cursor === page.next_cursor))) throw new DiscoveryPageError("invalid");
    }
    const seen = new Set(earlier.flatMap(saved => saved.data.candidates.map(candidate => candidate.address)));
    for (const candidate of data.candidates) {
      if (candidate.mode !== expectedMode || seen.has(candidate.address)) throw new DiscoveryPageError("invalid");
      seen.add(candidate.address);
    }
    return page;
  }
  async function request(first: boolean) {
    if (disposed || (!first && (state.busy || state.refresh_required))) return;
    const cursor = first ? null : state.pages[state.index]?.next_cursor;
    if (!first && !cursor) return;
    controller?.abort(); const active = new AbortController(); controller = active; const epoch = ++generation;
    publish({ busy: true, error: "" });
    try {
      const raw = await load(first ? url : `${url}&cursor=${encodeURIComponent(cursor!)}`, active.signal);
      if (disposed || active.signal.aborted || epoch !== generation) return;
      const page = verify(raw, first);
      publish({ pages: first ? [page] : [...state.pages, page], index: first ? 0 : state.pages.length, refresh_required: false });
    } catch (error) {
      if (disposed || active.signal.aborted || epoch !== generation) return;
      const held = error instanceof DiscoveryPageError && error.kind !== "unavailable";
      publish({ refresh_required: held || state.refresh_required,
        error: held ? "This paging snapshot changed, expired or could not be verified. Refresh the list to continue; loaded observations remain visible."
          : "Discovery could not refresh. Previously loaded observations remain visible." });
    } finally { if (!disposed && epoch === generation) publish({ busy: false }); }
  }
  return {
    getState: () => state,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    start() { disposed = false; return request(true); },
    refresh: () => request(true),
    async next() {
      if (disposed || state.busy || state.refresh_required) return;
      if (state.index + 1 < state.pages.length) { publish({ index: state.index + 1 }); return; }
      await request(false);
    },
    previous() { if (!disposed && !state.busy && state.index > 0) publish({ index: state.index - 1 }); },
    poll() { if (!disposed && !state.busy && state.index === 0 && !state.refresh_required) return request(true); },
    dispose() { disposed = true; generation++; controller?.abort(); listeners.clear(); },
  };
}
