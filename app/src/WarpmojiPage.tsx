import { useCallback, useEffect, useMemo, useState } from "react";

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

const FILTERS = ["unreviewed", "confirmed", "approved", "removed", "no-candidates"] as const;

async function readJson(response: Response): Promise<Record<string, unknown>> {
  const payload = await response.json().catch(() => null) as Record<string, unknown> | null;
  if (!response.ok || !payload) throw new Error(String(payload?.error ?? `Request failed (${response.status})`));
  return payload;
}

function ManualWarpletSearch({
  emoji,
  disabled,
  searchWarplets,
  onSelect,
}: {
  emoji: string;
  disabled: boolean;
  searchWarplets?: WarpmojiPageProps["searchWarplets"];
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
        <div className="mt-2 overflow-hidden rounded-lg border border-[#00FF00]/30 bg-[#001000] shadow-xl">
          {results.map((result) => (
            <button
              key={result.id}
              type="button"
              disabled={disabled}
              onClick={() => onSelect(result.id)}
              className="flex w-full cursor-pointer items-center gap-3 border-b border-[#00FF00]/15 px-2 py-2 text-left last:border-b-0 hover:bg-[#003000] disabled:cursor-wait disabled:opacity-60"
            >
              <img src={result.jpgUrl} alt="" className="h-12 w-12 shrink-0 object-cover" loading="lazy" />
              <span className="min-w-0">
                <span className="block text-sm font-black text-[#00FF00]">#{result.id} <span className="font-normal text-[#9fca9f]">· rank {result.rank ?? "—"}</span></span>
                <span className="block truncate text-xs text-white">{result.description || "10X Warplet"}</span>
              </span>
            </button>
          ))}
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
  const authorizationHeaders = useMemo<Record<string, string>>(() => {
    const headers: Record<string, string> = {};
    if (sessionToken) headers.authorization = `Bearer ${sessionToken}`;
    return headers;
  }, [sessionToken]);

  const load = useCallback(async () => {
    setBusy(true);
    try {
      if (section === "review") {
        const params = new URLSearchParams({ filter });
        if (query.trim()) params.set("q", query.trim());
        const payload = await readJson(await fetch(`/api/local/warpmoji/review?${params}`, { credentials: "same-origin", headers: authorizationHeaders }));
        setGroups((payload.groups as Group[]) ?? []);
        setCsrf(String(payload.csrfToken ?? ""));
        setMessage((payload.groups as unknown[])?.length ? "" : "No emoji groups match this filter.");
      } else {
        const payload = await readJson(await fetch("/api/local/warpmoji/status", { credentials: "same-origin", headers: authorizationHeaders }));
        setStatus(payload);
        setCsrf(String(payload.csrfToken ?? ""));
        setMessage("");
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally { setBusy(false); }
  }, [authorizationHeaders, filter, query, section]);

  useEffect(() => { void load(); }, [load]);

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
          <div className="space-y-5">
            {groups.map((group) => {
              const eligible = group.candidates.filter((candidate) => candidate.status !== "rejected");
              const approved = eligible.filter((candidate) => candidate.status === "approved");
              const defaultCandidate = approved[0] ?? eligible[0] ?? null;
              const selectedCount = approved.length || (defaultCandidate ? 1 : 0);
              return <section key={group.canonical_emoji} className="rounded-2xl border border-[#00FF00]/30 bg-[radial-gradient(circle_at_top_left,rgba(0,255,0,.09),transparent_45%)] p-4">
                <div className="mb-4 flex items-start justify-between gap-3">
                  <div><h2 className="text-3xl">{group.canonical_emoji}</h2><p className="font-bold text-[#00FF00]">{group.cldr_name}</p><p className="text-xs text-[#8bbf8b]">Popularity #{group.popularity_rank < 1_000_000 ? group.popularity_rank : "unranked"} · {selectedCount} selected</p></div>
                  {group.reviewed_at ? (
                    <span className="rounded-lg border border-[#00FF00]/45 bg-[#002800] px-3 py-2 text-xs font-bold text-[#00FF00]">Confirmed</span>
                  ) : defaultCandidate ? (
                    <button type="button" disabled={busy} onClick={() => void mutate("/api/local/warpmoji/groups/review", "POST", { emoji: group.canonical_emoji })} className="rounded-lg border border-[#00FF00] bg-[#002800] px-3 py-2 text-xs font-bold text-[#00FF00] disabled:opacity-40">Confirm #{defaultCandidate.token_id}</button>
                  ) : null}
                </div>
                {group.candidates.length > 0 && <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-5">
                  {group.candidates.map((candidate) => {
                    const isApproved = candidate.status === "approved";
                    const isDefault = defaultCandidate?.token_id === candidate.token_id;
                    const action = isApproved ? "remove" : "add";
                    return <article key={candidate.token_id} className={`overflow-hidden rounded-xl border ${candidate.status === "rejected" ? "border-red-500/50 opacity-55" : isApproved ? "border-[#00FF00] shadow-[0_0_14px_rgba(0,255,0,.16)]" : isDefault ? "border-[#FFFF00]" : "border-[#00FF00]/35"}`}>
                      <button type="button" disabled={busy} onClick={() => void mutate("/api/local/warpmoji/matches", "PATCH", { emoji: group.canonical_emoji, tokenId: candidate.token_id, action })} className="block w-full cursor-pointer disabled:cursor-wait">
                        <img src={candidate.jpg_url || `https://warplets.10x.meme/${candidate.token_id}.jpg`} alt={`Warplet #${candidate.token_id}`} className="aspect-square w-full object-cover" loading="lazy" />
                      </button>
                      <div className="space-y-1 p-2 text-[11px]"><p className="font-black text-white">#{candidate.token_id} · rank {candidate.x10_rank ?? "—"}</p><p className="text-[#00FF00]">Score {(candidate.score * 100).toFixed(1)}%</p><p className={isApproved ? "text-[#00FF00]" : isDefault ? "text-[#FFFF00]" : "text-[#8bbf8b]"}>{isApproved ? "Selected" : isDefault ? "Default winner" : "Candidate"}</p><p className="truncate text-[#8bbf8b]" title={candidate.reasons_json}>{candidate.assignment} · {candidate.reasons_json}</p>
                        <button type="button" disabled={busy} onClick={() => void mutate("/api/local/warpmoji/matches", "PATCH", { emoji: group.canonical_emoji, tokenId: candidate.token_id, action })} className={`mt-1 w-full rounded-md border py-1 font-bold ${isApproved ? "border-red-500 text-red-400" : "border-[#00FF00] text-[#00FF00]"}`}>{isApproved ? "Remove" : "Add"}</button>
                      </div>
                    </article>;
                  })}
                </div>}
                {eligible.length === 0 && (
                  <ManualWarpletSearch
                    emoji={group.canonical_emoji}
                    disabled={busy}
                    searchWarplets={searchWarplets}
                    onSelect={(tokenId) => void mutate("/api/local/warpmoji/matches", "PATCH", { emoji: group.canonical_emoji, tokenId, action: "add" })}
                  />
                )}
              </section>;
            })}
          </div>
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
