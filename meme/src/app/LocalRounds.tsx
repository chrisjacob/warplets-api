import { useCallback, useEffect, useRef, useState } from "react";
import { api, type Identity } from "./client";
import { latestRequest } from "./latestRequest";
export interface RoundView {
  id: string;
  state: string;
  attribute: string | null;
  ownershipMode?: string;
  opens_at: number;
  closes_at: number;
  selected_candidate: string | null;
  selected_name?: string | null;
  outcome_reason: string | null;
  candidates: {
    id: string;
    name: string;
    symbol: string;
    uniqueVoters: number;
    weightedVotes?: string;
  }[];
}
export interface LocalState {
  identity: Identity;
  settlement?: {
    state: string;
    inputHash: string;
    resultHash: string;
    mode: string;
    progress: {
      frozen: number;
      voters: number;
      entitlements: number;
      expectedEntitlements: number;
    };
  } | null;
  round: RoundView | null;
  holdingComplete?: boolean;
  myVote?: {
    candidate_id: string;
    first_valid_at: number;
    reward_wallet: string;
  } | null;
  history: RoundView[];
  boost?: {
    total: string;
    warplet: string;
    holding: string;
    streak: string;
    points: string;
    finality: string;
    holdingStatus?: string;
  };
  leaderboard?: { fid: number; points: string; rank: number }[];
  entitlements?: {
    edition_id: string;
    amount: string;
    release_at: number;
    state: string;
    reward_wallet: string;
    mode: string;
    symbol: string;
    decimals: number;
  }[];
}
const isVisible = () => document.visibilityState !== "hidden";
export function useLocalState(enabled = true) {
  const [data, setData] = useState<LocalState | null>(null),
    [identity, setIdentity] = useState<Identity | null>(null),
    [error, setError] = useState<string | null>(null);
  const requests = useRef(latestRequest()),
    timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined),
    mounted = useRef(false),
    refreshId = useRef(0);
  const refresh = useCallback(async () => {
    const current = ++refreshId.current;
    clearTimeout(timer.current);
    if (!enabled || !mounted.current || !isVisible()) return;
    await requests.current.run(
      (signal) =>
        api("/api/meme/state", undefined, "GET", signal) as Promise<
          LocalState & { identity: Identity }
        >,
      (next) => {
        setData(next);
        setIdentity(next.identity);
        setError(null);
      },
      () => setError("Couldn’t refresh. Try again."),
    );
    if (
      current === refreshId.current &&
      mounted.current &&
      enabled &&
      isVisible()
    )
      timer.current = setTimeout(() => void refresh(), 15000);
  }, [enabled]);
  const onIdentity = useCallback(
    (next: Identity) => {
      requests.current.cancel();
      setData((previous) =>
        previous?.identity.farcasterFid === next.farcasterFid ? previous : null,
      );
      setIdentity(next);
      setError(null);
      void refresh();
    },
    [refresh],
  );
  useEffect(() => {
    mounted.current = true;
    const visibility = () => {
      refreshId.current++;
      clearTimeout(timer.current);
      requests.current.cancel();
      if (document.visibilityState !== "hidden") void refresh();
    };
    void refresh();
    document.addEventListener("visibilitychange", visibility);
    return () => {
      mounted.current = false;
      refreshId.current++;
      clearTimeout(timer.current);
      requests.current.cancel();
      document.removeEventListener("visibilitychange", visibility);
    };
  }, [refresh]);
  return { data, identity, error, refresh, onIdentity };
}
export function LocalRounds({
  data,
  identity,
  refresh,
  onConnect,
  stale = false,
}: {
  data: LocalState | null;
  identity: Identity | null;
  refresh: () => Promise<void>;
  onConnect: () => void;
  stale?: boolean;
}) {
  const [error, setError] = useState<string | null>(null),
    [busy, setBusy] = useState(false);
  const r = data?.round,
    eligible = !!identity?.farcasterFid && !!identity.solanaWallet;
  async function cast(candidateId: string) {
    if (!r || busy || stale) return;
    setBusy(true);
    setError(null);
    try {
      await api("/api/meme/rounds/" + encodeURIComponent(r.id) + "/vote", {
        candidateId,
        key: crypto.randomUUID(),
      });
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Vote failed. Try again.");
    } finally {
      setBusy(false);
    }
  }
  if (!r)
    return (
      <section className="card" aria-live="polite">
        <h2>{data ? "No round today" : "Loading today’s round…"}</h2>
        {data && <p>Check back for the next vote.</p>}
      </section>
    );
  const upcoming = r.state === "prepared" || r.state === "frozen";
  const boundary = upcoming ? r.opens_at : r.closes_at;
  const live = r.state === "open",
    final = data?.settlement?.state === "finalized";
  const label =
    (
      {
        prepared: "Upcoming",
        frozen: "Upcoming",
        open: "Voting open",
        closed: "Voting closed",
        selected: "Selected",
        skipped: "Skipped",
      } as Record<string, string>
    )[r.state] ?? r.state;
  return (
    <section aria-label="Today’s round" className="round-content">
      <div className="round-heading">
        <div>
          <p className="eyebrow">Today’s attribute</p>
          <h2>
            {r.attribute
              ? r.attribute.charAt(0).toUpperCase() + r.attribute.slice(1)
              : "Reveals at opening"}
          </h2>
        </div>
        <span className="pill">{label}</span>
      </div>
      <p className="fine">
        {upcoming ? "Opens " : live ? "Closes " : "Closed "}
        <time
          dateTime={new Date(boundary).toISOString()}
          title={new Date(boundary).toUTCString()}
        >
          {new Date(boundary).toLocaleString(undefined, {
            month: "short",
            day: "numeric",
            hour: "numeric",
            minute: "2-digit",
          })}
        </time>
        {r.ownershipMode === "simulated" ? " · Simulated round" : ""}
      </p>
      {data?.boost && (
        <article className="card compact-boost">
          <div>
            <span className="eyebrow">
              Your {final ? "final" : "estimated"} boost
            </span>
            <strong>{data.boost.total}×</strong>
          </div>
          <p>{data.boost.points} points</p>
          <details>
            <summary>Boost breakdown</summary>
            <p>
              Base 1× · Warplet +{data.boost.warplet} · Holding{" "}
              {data.boost.holding === "pending"
                ? "pending"
                : "+" + data.boost.holding}{" "}
              · Streak +{data.boost.streak}
            </p>
          </details>
        </article>
      )}
      {!eligible && live && (
        <div className="connect-prompt">
          <p>
            {identity?.farcasterFid
              ? "Add your Solana reward wallet."
              : "Connect Farcaster to vote."}
          </p>
          <button className="primary" onClick={onConnect}>
            {identity?.farcasterFid ? "Verify wallet" : "Connect to vote"}
          </button>
        </div>
      )}
      {data?.holdingComplete === false && !final && (
        <p className="fine" role="status">
          Holding data pending. Scores may change.
        </p>
      )}
      <div className="candidates">
        {r.candidates.map((c) => (
          <article className="card candidate" key={c.id}>
            <div className="candidate-title">
              <h3>{c.name}</h3>
              <span className="token-symbol">$ {c.symbol}</span>
            </div>
            <p>
              {c.uniqueVoters} voters · {c.weightedVotes ?? "0"} weighted
            </p>
            <button
              className={
                data?.myVote?.candidate_id === c.id ? "selected-vote" : ""
              }
              disabled={!eligible || busy || !live || stale}
              aria-pressed={data?.myVote?.candidate_id === c.id}
              onClick={() => void cast(c.id)}
            >
              {busy
                ? "Saving…"
                : data?.myVote?.candidate_id === c.id
                  ? "✓ Voted"
                  : "Vote"}
            </button>
          </article>
        ))}
      </div>
      {error && <p role="alert">{error}</p>}
      <p className="fine">
        {data?.myVote
          ? live
            ? "Vote saved. You can change it until close."
            : "Vote recorded."
          : "One vote per account. 10X makes the final pick."}
      </p>
      {(r.state === "selected" ||
        r.state === "skipped" ||
        r.state === "closed") && (
        <article className="card">
          <h3>
            {r.state === "skipped"
              ? "No launch today"
              : r.selected_candidate
                ? "Selected: " +
                  (r.candidates.find((c) => c.id === r.selected_candidate)
                    ?.name ?? r.selected_candidate)
                : "Selection pending"}
          </h3>
          {r.outcome_reason && <p>{r.outcome_reason}</p>}
        </article>
      )}
      {!!data?.leaderboard?.length && (
        <details className="card">
          <summary>{final ? "Final" : "Estimated"} leaderboard</summary>
          <ol className="leaderboard">
            {data.leaderboard.map((row) => (
              <li key={row.fid}>
                <span>FID {row.fid}</span>
                <strong>{row.points} points</strong>
              </li>
            ))}
          </ol>
        </details>
      )}
      {data?.settlement && (
        <details className="receipt-details">
          <summary>{final ? "Scores finalized" : "Finalizing scores…"}</summary>
          <p>
            <a
              href={"/api/meme/settlements/" + encodeURIComponent(r.id)}
              target="_blank"
              rel="noreferrer"
            >
              View settlement receipt ↗
            </a>
          </p>
        </details>
      )}
    </section>
  );
}
export function OperatorPanel() {
  const [token, setToken] = useState(""),
    [route, setRoute] = useState("/api/meme/operator/rounds"),
    [body, setBody] = useState("{}"),
    [result, setResult] = useState("");
  async function submit() {
    try {
      const parsed = JSON.parse(body);
      if (!route.startsWith("/api/meme/operator/"))
        throw Error("Operator route required");
      const response = await fetch(route, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: "Bearer " + token,
        },
        body: JSON.stringify(parsed),
      });
      setResult(JSON.stringify(await response.json(), null, 2));
    } catch (e) {
      setResult(e instanceof Error ? e.message : "Request failed");
    }
  }
  return (
    <section className="card">
      <h2>Local operator</h2>
      <p>Authenticated local controls. The token stays in memory.</p>
      <label>
        Operator token
        <input
          type="password"
          autoComplete="off"
          value={token}
          onChange={(e) => setToken(e.target.value)}
        />
      </label>
      <label>
        API route
        <input value={route} onChange={(e) => setRoute(e.target.value)} />
      </label>
      <label>
        Request JSON
        <textarea
          rows={12}
          value={body}
          onChange={(e) => setBody(e.target.value)}
        />
      </label>
      <button onClick={() => void submit()}>Submit operator action</button>
      <pre>{result}</pre>
    </section>
  );
}
