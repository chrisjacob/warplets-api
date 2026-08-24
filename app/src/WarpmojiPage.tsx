import { useCallback, useEffect, useMemo, useRef, useState } from "react";

type Candidate = {
  token_id: number;
  score: number;
  exact_score: number;
  fts_score: number;
  semantic_score: number;
  hint_score: number;
  conflict_penalty: number;
  reasons_json: string;
  status: "suggested" | "approved" | "rejected";
  assignment: "primary" | "secondary";
  primary_emoji?: string | null;
  jpg_url?: string | null;
  x10_rank?: number | null;
};
type Group = {
  canonical_emoji: string;
  cldr_name: string;
  reviewed_at: string | null;
  candidate_count: number;
  approved_count: number;
  popularity_rank: number;
  candidates: Candidate[];
};

export type WarpmojiPickerResult = {
  id: number;
  rank: number | null;
  description: string;
  jpgUrl: string;
};

type WarpmojiPageProps = {
  sessionToken?: string | null;
  searchWarplets?: (query: string) => Promise<WarpmojiPickerResult[]>;
};

type PendingReview = {
  emoji: string;
  tokenIds: number[];
  removedTokenIds: number[];
};

const FILTERS = ["unreviewed", "confirmed", "approved", "removed", "no-candidates"] as const;

function initialReviewTokenIds(group: Group): number[] {
  const approved = group.candidates.filter((candidate) => candidate.status === "approved").map((candidate) => candidate.token_id);
  if (approved.length > 0) return approved;
  const winner = group.candidates.find((candidate) => candidate.status !== "rejected");
  return winner ? [winner.token_id] : [];
}

function beginPendingReview(group: Group, tokenId: number): PendingReview {
  const initial = initialReviewTokenIds(group);
  const selected = new Set(initial);
  const removed = new Set<number>();
  const acceptingDefaultWinner = !group.reviewed_at && initial.length === 1 && initial[0] === tokenId;
  if (!acceptingDefaultWinner) {
    if (selected.has(tokenId)) {
      selected.delete(tokenId);
      removed.add(tokenId);
    } else {
      selected.add(tokenId);
    }
  }
  return { emoji: group.canonical_emoji, tokenIds: [...selected], removedTokenIds: [...removed] };
}

async function readJson(response: Response): Promise<Record<string, unknown>> {
  const payload = await response.json().catch(() => null) as Record<string, unknown> | null;
  if (!response.ok || !payload) throw new Error(String(payload?.error ?? `Request failed (${response.status})`));
  return payload;
}

function ManualWarpletSearch({
  emoji,
  disabled,
  searchWarplets,
  selectedTokenIds,
  removedTokenIds,
  onSelect,
}: {
  emoji: string;
  disabled: boolean;
  searchWarplets?: WarpmojiPageProps["searchWarplets"];
  selectedTokenIds: ReadonlySet<number>;
  removedTokenIds: ReadonlySet<number>;
  onSelect: (tokenId: number) => void;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<WarpmojiPickerResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState("");

  useEffect(() => {
    const trimmed = query.trim();
    if (!trimmed || !searchWarplets) {
      setResults([]);
      setSearching(false);
      setSearchError("");
      return;
    }
    let cancelled = false;
    setSearching(true);
    setSearchError("");
    const timer = window.setTimeout(() => {
      void searchWarplets(trimmed).then((next) => {
        if (!cancelled) setResults(next.slice(0, 8));
      }).catch((error) => {
        if (!cancelled) setSearchError(error instanceof Error ? error.message : "Warplet search failed.");
      }).finally(() => {
        if (!cancelled) setSearching(false);
      });
    }, 250);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [query, searchWarplets]);

  return (
    <div className="relative mt-4 rounded-xl border border-[#FFFF00]/35 bg-black/70 p-3">
      <label className="block text-xs font-bold uppercase text-[#FFFF00]" htmlFor={`warpmoji-search-${emoji}`}>Find a Warplet manually</label>
      <input
        id={`warpmoji-search-${emoji}`}
        value={query}
        disabled={disabled || !searchWarplets}
        onChange={(event) => setQuery(event.target.value)}
        placeholder="Search descriptions, traits, keywords or #token"
        className="mt-2 w-full rounded-lg border border-[#00FF00]/40 bg-black px-3 py-2 text-sm text-white outline-none focus:border-[#00FF00] disabled:opacity-50"
        autoComplete="off"
      />
      {(searching || searchError || (query.trim() && results.length === 0)) && (
        <p className={`mt-2 text-xs ${searchError ? "text-red-400" : "text-[#8bbf8b]"}`}>
          {searching ? "Searching Warplets…" : searchError || "No matching Warplets."}
        </p>
      )}
      {results.length > 0 && (
        <div className="mt-2 grid grid-cols-3 gap-2 rounded-lg border border-[#00FF00]/30 bg-[#001000] p-2 shadow-xl">
          {results.map((result) => {
            const isSelected = selectedTokenIds.has(result.id);
            const isRemoved = removedTokenIds.has(result.id) && !isSelected;
            const stateLabel = isSelected ? "selected" : isRemoved ? "removed" : "available";
            return <button
              key={result.id}
              type="button"
              disabled={disabled}
              onClick={() => onSelect(result.id)}
              aria-label={`Warplet #${result.id}, ${stateLabel}`}
              aria-pressed={isSelected}
              title={`Warplet #${result.id}`}
              className={`aspect-square cursor-pointer overflow-hidden rounded-lg border-4 transition-colors disabled:cursor-wait disabled:opacity-60 ${isSelected ? "border-[#00FF00] shadow-[0_0_14px_rgba(0,255,0,.18)]" : isRemoved ? "border-red-500 opacity-60" : "border-transparent hover:border-[#00FF00]/45"}`}
            >
              <img src={result.jpgUrl} alt="" className="h-full w-full object-cover" loading="lazy" />
            </button>;
          })}
        </div>
      )}
    </div>
  );
}

export default function WarpmojiPage({ sessionToken = null, searchWarplets }: WarpmojiPageProps) {
  const [section, setSection] = useState<"review" | "status" | "activity" | "settings">("review");
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>("unreviewed");
  const [query, setQuery] = useState("");
  const [groups, setGroups] = useState<Group[]>([]);
  const [status, setStatus] = useState<Record<string, unknown> | null>(null);
  const [csrf, setCsrf] = useState("");
  const [message, setMessage] = useState("Loading Warpmoji…");
  const [busy, setBusy] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [pendingReview, setPendingReview] = useState<PendingReview | null>(null);
  const loadMoreSentinelRef = useRef<HTMLDivElement | null>(null);
  const reviewRequestVersionRef = useRef(0);
  const authorizationHeaders = useMemo<Record<string, string>>(() => {
    const headers: Record<string, string> = {};
    if (sessionToken) headers.authorization = `Bearer ${sessionToken}`;
    return headers;
  }, [sessionToken]);

  const load = useCallback(async () => {
    const requestVersion = ++reviewRequestVersionRef.current;
    setBusy(true);
    setLoadingMore(false);
    try {
      if (section === "review") {
        const params = new URLSearchParams({ filter });
        if (query.trim()) params.set("q", query.trim());
        const payload = await readJson(await fetch(`/api/local/warpmoji/review?${params}`, { credentials: "same-origin", headers: authorizationHeaders }));
        if (requestVersion !== reviewRequestVersionRef.current) return;
        setGroups((payload.groups as Group[]) ?? []);
        setHasMore(payload.hasMore === true);
        setNextCursor(typeof payload.nextCursor === "string" ? payload.nextCursor : null);
        setCsrf(String(payload.csrfToken ?? ""));
        setMessage((payload.groups as unknown[])?.length ? "" : "No emoji groups match this filter.");
      } else {
        const payload = await readJson(await fetch("/api/local/warpmoji/status", { credentials: "same-origin", headers: authorizationHeaders }));
        if (requestVersion !== reviewRequestVersionRef.current) return;
        setStatus(payload);
        setHasMore(false);
        setNextCursor(null);
        setCsrf(String(payload.csrfToken ?? ""));
        setMessage("");
      }
    } catch (error) {
      if (requestVersion === reviewRequestVersionRef.current) setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      if (requestVersion === reviewRequestVersionRef.current) setBusy(false);
    }
  }, [authorizationHeaders, filter, query, section]);

  useEffect(() => { void load(); }, [load]);

  const loadMore = useCallback(async () => {
    if (section !== "review" || busy || loadingMore || !hasMore || !nextCursor) return;
    const requestVersion = reviewRequestVersionRef.current;
    setLoadingMore(true);
    try {
      const params = new URLSearchParams({ filter, cursor: nextCursor });
      if (query.trim()) params.set("q", query.trim());
      const payload = await readJson(await fetch(`/api/local/warpmoji/review?${params}`, { credentials: "same-origin", headers: authorizationHeaders }));
      if (requestVersion !== reviewRequestVersionRef.current) return;
      const incoming = (payload.groups as Group[]) ?? [];
      setGroups((current) => {
        const seen = new Set(current.map((group) => group.canonical_emoji));
        return [...current, ...incoming.filter((group) => !seen.has(group.canonical_emoji))];
      });
      setHasMore(payload.hasMore === true);
      setNextCursor(typeof payload.nextCursor === "string" ? payload.nextCursor : null);
      setCsrf(String(payload.csrfToken ?? csrf));
    } catch (error) {
      if (requestVersion === reviewRequestVersionRef.current) setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      if (requestVersion === reviewRequestVersionRef.current) setLoadingMore(false);
    }
  }, [authorizationHeaders, busy, csrf, filter, hasMore, loadingMore, nextCursor, query, section]);

  useEffect(() => {
    const sentinel = loadMoreSentinelRef.current;
    if (!sentinel || section !== "review" || !hasMore) return;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) void loadMore();
    }, { rootMargin: "600px 0px" });
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [hasMore, loadMore, section]);

  const mutate = async (path: string, method: "PATCH" | "POST", body?: unknown) => {
    setBusy(true);
    try {
      await readJson(await fetch(path, {
        method,
        credentials: "same-origin",
        headers: { ...authorizationHeaders, "content-type": "application/json", "x-warpmoji-csrf": csrf },
        body: JSON.stringify(body ?? {}),
      }));
      await load();
    } catch (error) { setMessage(error instanceof Error ? error.message : String(error)); setBusy(false); }
  };

  const submitReview = useCallback(async (review: PendingReview) => {
    await readJson(await fetch("/api/local/warpmoji/groups/review", {
      method: "POST",
      credentials: "same-origin",
      headers: { ...authorizationHeaders, "content-type": "application/json", "x-warpmoji-csrf": csrf },
      body: JSON.stringify({ emoji: review.emoji, tokenIds: review.tokenIds, removedTokenIds: review.removedTokenIds }),
    }));
  }, [authorizationHeaders, csrf]);

  const applySubmittedReview = useCallback((review: PendingReview) => {
    const selected = new Set(review.tokenIds);
    const removed = new Set(review.removedTokenIds);
    setGroups((current) => current.flatMap((group) => {
      if (group.canonical_emoji !== review.emoji) return [group];
      const candidates = group.candidates.map((candidate) => ({
        ...candidate,
        status: selected.has(candidate.token_id)
          ? "approved" as const
          : removed.has(candidate.token_id)
            ? "rejected" as const
            : candidate.status === "approved"
              ? "suggested" as const
              : candidate.status,
      }));
      if (filter === "unreviewed" || filter === "no-candidates") return [];
      if (filter === "removed" && !candidates.some((candidate) => candidate.status === "rejected")) return [];
      return [{
        ...group,
        reviewed_at: new Date().toISOString(),
        approved_count: selected.size,
        candidate_count: candidates.filter((candidate) => candidate.status !== "rejected").length,
        candidates,
      }];
    }));
  }, [filter]);

  const selectCandidate = useCallback(async (group: Group, tokenId: number) => {
    if (busy) return;
    if (pendingReview?.emoji === group.canonical_emoji) {
      const selected = new Set(pendingReview.tokenIds);
      const removed = new Set(pendingReview.removedTokenIds);
      if (selected.has(tokenId)) {
        selected.delete(tokenId);
        removed.add(tokenId);
      } else {
        selected.add(tokenId);
        removed.delete(tokenId);
      }
      setPendingReview({ emoji: group.canonical_emoji, tokenIds: [...selected], removedTokenIds: [...removed] });
      setMessage("");
      return;
    }

    const nextPending = beginPendingReview(group, tokenId);
    if (!pendingReview) {
      setPendingReview(nextPending);
      setMessage("");
      return;
    }

    setBusy(true);
    try {
      await submitReview(pendingReview);
      applySubmittedReview(pendingReview);
      setPendingReview(nextPending);
      setMessage("");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }, [applySubmittedReview, busy, pendingReview, submitReview]);

  const confirmPendingNow = useCallback(async () => {
    if (!pendingReview || busy) return;
    setBusy(true);
    try {
      await submitReview(pendingReview);
      applySubmittedReview(pendingReview);
      setPendingReview(null);
      setMessage("");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }, [applySubmittedReview, busy, pendingReview, submitReview]);

  const updateSettings = async (mode: string) => mutate("/api/local/warpmoji/settings", "PATCH", { mode });
  const updateLimit = async (key: string, value: string) => mutate("/api/local/warpmoji/settings", "PATCH", { [key]: Number.parseInt(value, 10) });
  const settings = status?.settings as Record<string, unknown> | undefined;

  return (
    <main className="mx-auto w-full max-w-[960px] px-4 py-5 text-white">
      <div className="mb-4 rounded-2xl border border-[#00FF00]/40 bg-black/85 p-4">
        <h1 className="text-2xl font-black uppercase text-[#00FF00]">Warpmoji</h1>
        <p className="mt-1 text-sm text-[#9fca9f]">Curate Unicode Emoji 17 matches and monitor @warpmoji.eth. Local and authorized-FID access only.</p>
      </div>
      <nav className="mb-4 grid grid-cols-4 overflow-hidden rounded-xl border border-[#00FF00]/35" aria-label="Warpmoji sections">
        {(["review", "status", "activity", "settings"] as const).map((item) => (
          <button key={item} type="button" onClick={() => setSection(item)} className={`h-10 border-r border-[#00FF00]/25 text-xs font-bold capitalize last:border-r-0 ${section === item ? "bg-[#00FF00] text-black" : "bg-[#001500] text-[#00FF00]"}`}>{item}</button>
        ))}
      </nav>

      {section === "review" ? (
        <>
          <div className="mb-4 flex flex-wrap gap-2">
            <input value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void load(); }} placeholder="Emoji, CLDR name, keyword or token ID" className="min-w-0 flex-1 rounded-lg border border-[#00FF00]/35 bg-black px-3 py-2 text-sm outline-none focus:border-[#00FF00]" />
            <button type="button" onClick={() => void load()} className="rounded-lg border border-[#00FF00] bg-[#002800] px-4 text-sm font-bold text-[#00FF00]">Search</button>
            <button type="button" onClick={() => void mutate("/api/local/warpmoji/cleanup", "POST")} className="rounded-lg border border-[#FFFF00] bg-[#282800] px-4 text-sm font-bold text-[#FFFF00]">Clean up</button>
          </div>
          <div className="mb-5 flex flex-wrap gap-2">
            {FILTERS.map((item) => <button key={item} type="button" onClick={() => setFilter(item)} className={`rounded-full border px-3 py-1 text-xs capitalize ${filter === item ? "border-[#00FF00] bg-[#00FF00] text-black" : "border-[#00FF00]/35 text-[#9fca9f]"}`}>{item.replace("-", " ")}</button>)}
          </div>
          {pendingReview && (
            <div className="sticky top-2 z-20 mb-5 flex items-center justify-between gap-3 rounded-xl border border-[#FFFF00] bg-black/95 px-3 py-2 shadow-[0_0_18px_rgba(255,255,0,.16)]">
              <p className="min-w-0 text-sm font-bold text-[#FFFF00]">
                <span className="mr-2 text-xl" aria-hidden="true">{pendingReview.emoji}</span>
                Pending confirmation · {pendingReview.tokenIds.length} selected
              </p>
              <button
                type="button"
                disabled={busy}
                onClick={() => void confirmPendingNow()}
                className="shrink-0 rounded-lg border border-[#FFFF00] bg-[#282800] px-3 py-2 text-xs font-bold text-[#FFFF00] disabled:cursor-not-allowed disabled:opacity-40"
              >
                Confirm now
              </button>
            </div>
          )}
          <div className="space-y-5">
            {groups.map((group) => {
              const groupPending = pendingReview?.emoji === group.canonical_emoji ? pendingReview : null;
              const selectedTokenIds = new Set(groupPending?.tokenIds ?? initialReviewTokenIds(group));
              const removedTokenIds = new Set(groupPending?.removedTokenIds ?? group.candidates.filter((candidate) => candidate.status === "rejected").map((candidate) => candidate.token_id));
              const selectedCount = selectedTokenIds.size;
              return <section key={group.canonical_emoji} className="rounded-2xl border border-[#00FF00]/30 bg-[radial-gradient(circle_at_top_left,rgba(0,255,0,.09),transparent_45%)] p-4">
                <div className="mb-4 flex items-start justify-between gap-3">
                  <div><h2 className="text-3xl">{group.canonical_emoji}</h2><p className="font-bold text-[#00FF00]">{group.cldr_name}</p><p className="text-xs text-[#8bbf8b]">Popularity #{group.popularity_rank < 1_000_000 ? group.popularity_rank : "unranked"} · {selectedCount} selected</p></div>
                  {groupPending ? (
                    <span className="rounded-lg border border-[#FFFF00]/60 bg-[#282800] px-3 py-2 text-xs font-bold text-[#FFFF00]">Pending confirmation</span>
                  ) : group.reviewed_at ? (
                    <span className="rounded-lg border border-[#00FF00]/45 bg-[#002800] px-3 py-2 text-xs font-bold text-[#00FF00]">Confirmed</span>
                  ) : null}
                </div>
                {group.candidates.length > 0 && <div className="grid grid-cols-3 gap-2">
                  {group.candidates.map((candidate) => {
                    const isSelected = selectedTokenIds.has(candidate.token_id);
                    const isRemoved = removedTokenIds.has(candidate.token_id) && !isSelected;
                    const stateLabel = isSelected ? "selected" : isRemoved ? "removed" : "available";
                    return <button
                      key={candidate.token_id}
                      type="button"
                      disabled={busy}
                      onClick={() => void selectCandidate(group, candidate.token_id)}
                      aria-label={`Warplet #${candidate.token_id}, ${stateLabel}`}
                      aria-pressed={isSelected}
                      title={`Warplet #${candidate.token_id}`}
                      className={`aspect-square overflow-hidden rounded-lg border-4 transition-colors disabled:cursor-wait disabled:opacity-60 ${isSelected ? "border-[#00FF00] shadow-[0_0_14px_rgba(0,255,0,.18)]" : isRemoved ? "border-red-500 opacity-60" : "border-transparent hover:border-[#00FF00]/45"}`}
                    >
                      <img src={candidate.jpg_url || `https://warplets.10x.meme/${candidate.token_id}.jpg`} alt="" className="h-full w-full object-cover" loading="lazy" />
                    </button>;
                  })}
                </div>}
                {group.candidates.filter((candidate) => candidate.status !== "rejected").length === 0 && (
                  <ManualWarpletSearch
                    emoji={group.canonical_emoji}
                    disabled={busy}
                    searchWarplets={searchWarplets}
                    selectedTokenIds={selectedTokenIds}
                    removedTokenIds={removedTokenIds}
                    onSelect={(tokenId) => void selectCandidate(group, tokenId)}
                  />
                )}
              </section>;
            })}
          </div>
          {hasMore && (
            <div ref={loadMoreSentinelRef} className="flex min-h-20 items-center justify-center py-5" aria-live="polite">
              <span className="text-sm font-bold text-[#00FF00]">{loadingMore ? "Loading more emoji…" : "Scroll for more"}</span>
            </div>
          )}
        </>
      ) : section === "settings" ? (
        <section className="rounded-2xl border border-[#00FF00]/35 p-4">
          <h2 className="font-black uppercase text-[#00FF00]">Bot mode</h2>
          <div className="my-4 flex gap-2">{["disabled", "shadow", "live"].map((mode) => <button key={mode} type="button" onClick={() => void updateSettings(mode)} className={`rounded-lg border px-4 py-2 text-sm font-bold capitalize ${settings?.mode === mode ? "border-[#00FF00] bg-[#00FF00] text-black" : "border-[#00FF00]/35 text-[#00FF00]"}`}>{mode}</button>)}</div>
          <p className="text-sm text-[#9fca9f]">Organic: {String(settings?.organic_user_24h ?? 1)}/user and {String(settings?.organic_daily ?? 200)}/day. Mentions: {String(settings?.mention_user_24h ?? 10)}/user and {String(settings?.mention_daily ?? 300)}/day. Combined: {String(settings?.combined_daily ?? 500)}/day (hard ceiling 900).</p>
          <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-5">
            {[
              ["organicUser24h", "Organic/user", settings?.organic_user_24h ?? 1],
              ["organicDaily", "Organic/day", settings?.organic_daily ?? 200],
              ["mentionUser24h", "Mentions/user", settings?.mention_user_24h ?? 10],
              ["mentionDaily", "Mentions/day", settings?.mention_daily ?? 300],
              ["combinedDaily", "Combined/day", settings?.combined_daily ?? 500],
            ].map(([key, label, value]) => <label key={String(key)} className="text-xs text-[#9fca9f]">{String(label)}<input key={`${String(key)}:${String(value)}`} defaultValue={String(value)} min="0" max="900" type="number" onBlur={(event) => void updateLimit(String(key), event.currentTarget.value)} className="mt-1 w-full rounded-lg border border-[#00FF00]/35 bg-black px-2 py-2 text-white" /></label>)}
          </div>
          <p className="mt-2 text-xs text-[#FFFF00]">Projected maximum: {Number(settings?.combined_daily ?? 500) * 160} Neynar compute units/day.</p>
          <button type="button" onClick={() => void mutate("/api/local/warpmoji/shards/generate", "POST")} className="mt-4 rounded-lg border border-[#00FF00] bg-[#002800] px-4 py-2 text-sm font-bold text-[#00FF00]">Generate webhook shards</button>
        </section>
      ) : (
        <pre className="max-h-[70vh] overflow-auto whitespace-pre-wrap rounded-2xl border border-[#00FF00]/35 bg-black p-4 text-xs text-[#9fca9f]">{JSON.stringify(status, null, 2)}</pre>
      )}
      {(busy || message) && <p className="mt-4 text-center text-sm text-[#FFFF00]">{busy ? "Updating Warpmoji…" : message}</p>}
    </main>
  );
}
