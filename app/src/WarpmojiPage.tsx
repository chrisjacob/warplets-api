import { useCallback, useEffect, useState } from "react";

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
  candidates: Candidate[];
};

const FILTERS = ["unreviewed", "reviewed", "approved", "removed", "no-candidates"] as const;

async function readJson(response: Response): Promise<Record<string, unknown>> {
  const payload = await response.json().catch(() => null) as Record<string, unknown> | null;
  if (!response.ok || !payload) throw new Error(String(payload?.error ?? `Request failed (${response.status})`));
  return payload;
}

export default function WarpmojiPage() {
  const [section, setSection] = useState<"review" | "status" | "activity" | "settings">("review");
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>("unreviewed");
  const [query, setQuery] = useState("");
  const [groups, setGroups] = useState<Group[]>([]);
  const [status, setStatus] = useState<Record<string, unknown> | null>(null);
  const [csrf, setCsrf] = useState("");
  const [message, setMessage] = useState("Loading Warpmoji…");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setBusy(true);
    try {
      if (section === "review") {
        const params = new URLSearchParams({ filter });
        if (query.trim()) params.set("q", query.trim());
        const payload = await readJson(await fetch(`/api/local/warpmoji/review?${params}`, { credentials: "same-origin" }));
        setGroups((payload.groups as Group[]) ?? []);
        setCsrf(String(payload.csrfToken ?? ""));
        setMessage((payload.groups as unknown[])?.length ? "" : "No emoji groups match this filter.");
      } else {
        const payload = await readJson(await fetch("/api/local/warpmoji/status", { credentials: "same-origin" }));
        setStatus(payload);
        setCsrf(String(payload.csrfToken ?? ""));
        setMessage("");
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally { setBusy(false); }
  }, [filter, query, section]);

  useEffect(() => { void load(); }, [load]);

  const mutate = async (path: string, method: "PATCH" | "POST", body?: unknown) => {
    setBusy(true);
    try {
      await readJson(await fetch(path, {
        method,
        credentials: "same-origin",
        headers: { "content-type": "application/json", "x-warpmoji-csrf": csrf },
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
              const retained = group.candidates.filter((candidate) => candidate.status !== "rejected").length;
              return <section key={group.canonical_emoji} className="rounded-2xl border border-[#00FF00]/30 bg-[radial-gradient(circle_at_top_left,rgba(0,255,0,.09),transparent_45%)] p-4">
                <div className="mb-4 flex items-start justify-between gap-3">
                  <div><h2 className="text-3xl">{group.canonical_emoji}</h2><p className="font-bold text-[#00FF00]">{group.cldr_name}</p><p className="text-xs text-[#8bbf8b]">{retained} retained · {group.approved_count} approved</p></div>
                  <button type="button" disabled={retained > 10 || busy} onClick={() => void mutate("/api/local/warpmoji/groups/review", "POST", { emoji: group.canonical_emoji })} className="rounded-lg border border-[#00FF00] bg-[#002800] px-3 py-2 text-xs font-bold text-[#00FF00] disabled:opacity-40">Mark Reviewed</button>
                </div>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-5">
                  {group.candidates.map((candidate) => <article key={candidate.token_id} className={`overflow-hidden rounded-xl border ${candidate.status === "rejected" ? "border-red-500/50 opacity-55" : candidate.assignment === "primary" ? "border-[#FFFF00]/70" : "border-[#00FF00]/35"}`}>
                    <img src={candidate.jpg_url || `https://warplets.10x.meme/${candidate.token_id}.jpg`} alt={`Warplet #${candidate.token_id}`} className="aspect-square w-full object-cover" loading="lazy" />
                    <div className="space-y-1 p-2 text-[11px]"><p className="font-black text-white">#{candidate.token_id} · rank {candidate.x10_rank ?? "—"}</p><p className="text-[#00FF00]">Score {(candidate.score * 100).toFixed(1)}%</p><p className="text-[#FFFF00]">Primary: {candidate.primary_emoji ?? group.canonical_emoji}</p><p className="truncate text-[#8bbf8b]" title={candidate.reasons_json}>{candidate.assignment} · {candidate.reasons_json}</p>
                      <button type="button" disabled={busy} onClick={() => void mutate("/api/local/warpmoji/matches", "PATCH", { emoji: group.canonical_emoji, tokenId: candidate.token_id, action: candidate.status === "rejected" ? "add" : "remove" })} className={`mt-1 w-full rounded-md border py-1 font-bold ${candidate.status === "rejected" ? "border-[#00FF00] text-[#00FF00]" : "border-red-500 text-red-400"}`}>{candidate.status === "rejected" ? "Add" : "Remove"}</button>
                    </div>
                  </article>)}
                </div>
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
