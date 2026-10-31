import { useCallback, useEffect, useRef, useState } from "react";
import { api, ApiError, type Identity } from "./client";
import { latestRequest } from "./latestRequest";
import { useRoundClock } from "./useRoundClock";
import { pollDelay } from "./polling";
import { qaPath } from "./qaMode";
import { metric } from "./display";
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
  serverTime?: number;
  participationPaused?: boolean;
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
  scoreSnapshot?: { state: string; asOf: number | null };
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
    fundingState?: "unfunded" | "funded";
    releaseState?: "scheduled" | "vesting" | "released";
    claimState?: "unclaimed" | "claimed";
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
    refreshId = useRef(0),
    failures = useRef(0),
    authBlocked = useRef(false);
  const refresh = useCallback(async () => {
    const current = ++refreshId.current;
    clearTimeout(timer.current);
    if (!enabled || !mounted.current || !isVisible()) return;
    if (!navigator.onLine) {
      setError("Offline. Reconnect to refresh.");
      return;
    }
    await requests.current.run(
      (signal) =>
        api("/api/meme/state?view=today", undefined, "GET", signal) as Promise<
          LocalState & { identity: Identity }
        >,
      (next) => {
        failures.current = 0;
        authBlocked.current = false;
        setData(next);
        setIdentity(next.identity);
        setError(null);
      },
      (error) => {
        failures.current = Math.min(3, failures.current + 1);
        if (error instanceof ApiError && [401, 403].includes(error.status)) {
          authBlocked.current = true;
          setData(null);
          setIdentity(null);
          setError("Sign in again to continue.");
        } else setError("Couldn’t refresh. Try again.");
      },
    );
    if (
      current === refreshId.current &&
      mounted.current &&
      enabled &&
      !authBlocked.current &&
      navigator.onLine &&
      isVisible()
    )
      timer.current = setTimeout(
        () => void refresh(),
        pollDelay(failures.current),
      );
  }, [enabled]);
  const onIdentity = useCallback(
    (next: Identity) => {
      failures.current = 0;
      authBlocked.current = false;
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
    window.addEventListener("online", visibility);
    window.addEventListener("offline", visibility);
    return () => {
      mounted.current = false;
      refreshId.current++;
      clearTimeout(timer.current);
      requests.current.cancel();
      document.removeEventListener("visibilitychange", visibility);
      window.removeEventListener("online", visibility);
      window.removeEventListener("offline", visibility);
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
    [busy, setBusy] = useState(false),
    [pendingCandidate, setPendingCandidate] = useState<string | null>(null);
  const r = data?.round,
    eligible = !!identity?.farcasterFid && !!identity.solanaWallet;
  const now = useRoundClock(data?.serverTime, r?.opens_at, r?.closes_at);
  async function cast(candidateId: string) {
    if (
      !r ||
      busy ||
      stale ||
      data?.participationPaused ||
      r.state !== "open" ||
      now < r.opens_at ||
      now >= r.closes_at
    )
      return;
    setBusy(true);
    setPendingCandidate(candidateId);
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
      setPendingCandidate(null);
    }
  }
  if (!r)
    return (
      <section className="card" aria-live="polite">
        <h2>{data ? "No round today" : "Loading today’s round…"}</h2>
        {data && <p>Check back for the next vote.</p>}
      </section>
    );
  const waiting = r.state === "prepared" || r.state === "frozen",
    upcoming = now < r.opens_at,
    delayed = waiting && !upcoming && now < r.closes_at;
  const boundary = upcoming || delayed ? r.opens_at : r.closes_at;
  const minutesLeft = Math.max(1, Math.ceil((r.closes_at - now) / 60000));
  const live = r.state === "open" && now >= r.opens_at && now < r.closes_at,
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
  const displayLabel = delayed
    ? "Opening delayed"
    : waiting && now >= r.closes_at
      ? "Voting closed"
      : r.state === "open" && !live
        ? now < r.opens_at
          ? "Upcoming"
          : "Voting closed"
        : label;
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
        <span className="pill">
          {data?.participationPaused && live ? "Voting paused" : displayLabel}
        </span>
      </div>
      <p className="fine round-deadline">
        {delayed
          ? "Scheduled opening "
          : upcoming
            ? "Opens "
            : live
              ? "Closes "
              : "Closed "}
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
        {live && (
          <strong className="time-left">
            {minutesLeft >= 60
              ? Math.floor(minutesLeft / 60) +
                "h " +
                (minutesLeft % 60) +
                "m left"
              : minutesLeft + "m left"}
          </strong>
        )}
      </p>
      {data?.boost && (
        <article className="card compact-boost">
          <div>
            <span className="eyebrow">
              Your {final ? "final" : "estimated"} boost
            </span>
            <strong title={data.boost.total + "×"}>
              {metric(data.boost.total)}×
            </strong>
          </div>
          <p>
            {data.myVote ? (
              <>
                <strong>{metric(data.boost.points)}</strong> points
              </>
            ) : (
              "Vote to earn points"
            )}
          </p>
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
      {!eligible && live && !data?.participationPaused && (
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
      {data?.scoreSnapshot?.state === "pending" && !final ? (
        <p className="fine" role="status">
          Scores updating.
        </p>
      ) : (
        data?.holdingComplete === false &&
        !final && (
          <p className="fine" role="status">
            Holding data pending. Scores may change.
          </p>
        )
      )}
      <div className="shortlist-heading">
        <h3>{live ? "Choose today’s OG" : "Today’s shortlist"}</h3>
        <span>
          {r.candidates
            .reduce((n, c) => n + c.uniqueVoters, 0)
            .toLocaleString()}{" "}
          votes
        </span>
      </div>
      <div className="candidates">
        {r.candidates.map((c, index) => (
          <article
            className={
              "card candidate " +
              (data?.myVote?.candidate_id === c.id ? "is-voted" : "")
            }
            key={c.id}
          >
            <span
              className={"token-avatar token-" + (index % 3)}
              aria-hidden="true"
            >
              {c.symbol.slice(0, 2)}
            </span>
            <div className="candidate-title">
              <h3 id={"candidate-name-" + index}>{c.name}</h3>
              <span className="token-symbol">$ {c.symbol}</span>
            </div>
            <p className="candidate-votes">
              {c.uniqueVoters.toLocaleString()} voters{" "}
              <span title={(c.weightedVotes ?? "0") + " weighted votes"}>
                · {metric(c.weightedVotes ?? "0", 1)} weighted
              </span>
            </p>
            <button
              className={
                data?.myVote?.candidate_id === c.id ? "selected-vote" : ""
              }
              disabled={
                !eligible ||
                busy ||
                !live ||
                stale ||
                data?.participationPaused ||
                data?.myVote?.candidate_id === c.id
              }
              aria-pressed={data?.myVote?.candidate_id === c.id}
              aria-describedby={"candidate-name-" + index}
              onClick={() => void cast(c.id)}
            >
              {busy && pendingCandidate === c.id
                ? "Saving…"
                : data?.myVote?.candidate_id === c.id
                  ? "✓ Voted"
                  : "Vote"}
            </button>
          </article>
        ))}
      </div>
      {error && <p role="alert">{error}</p>}
      <p
        className={"fine vote-status " + (data?.myVote ? "has-vote" : "")}
        role="status"
      >
        {data?.myVote
          ? live
            ? data?.participationPaused
              ? "Vote saved."
              : "Vote saved. You can change it until close."
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
              href={qaPath("/api/meme/settlements/" + encodeURIComponent(r.id))}
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
