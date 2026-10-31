import { useEffect, useState } from "react";
import { api } from "./client";
import { qaName } from "./qaMode";
import { direction } from "./display";
import SocialShare from "./SocialShare";
import TraderProfile from "./TraderProfile";
import type { TradingMetrics, TradingWindow } from "../shared/trading";
import type { LocalState } from "./LocalRounds";
type Board = {
  id: string;
  asOf: number;
  mode: string;
  stale: boolean;
  cohort: number;
  sourceHash: string;
  items: (TradingMetrics & { rank: number })[];
};
const dollars = (n: string) =>
  new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  }).format(Number(n));
export default function LeadersPanel({
  data,
  onToday,
}: {
  data: LocalState | null;
  onToday?: () => void;
}) {
  const [profileFid, setProfileFid] = useState<number | null>(() => {
      const raw = new URLSearchParams(location.search).get("trader");
      return raw &&
        /^[1-9]\d{0,15}$/.test(raw) &&
        Number.isSafeInteger(Number(raw))
        ? Number(raw)
        : null;
    }),
    [lookup, setLookup] = useState(""),
    [lookupError, setLookupError] = useState("");
  const [kind, setKind] = useState(() =>
      profileFid ||
      new URLSearchParams(location.search).get("ranking") === "trading"
        ? "Trading"
        : "Rewards",
    ),
    [window, setWindow] = useState<TradingWindow>(() => {
      const w = new URLSearchParams(location.search).get("window");
      return w === "30d" || w === "all" ? w : "24h";
    }),
    [board, setBoard] = useState<Board | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<string | null>(null),
    [revision, setRevision] = useState(0),
    [visibleRewards, setVisibleRewards] = useState(20),
    [visibleTrades, setVisibleTrades] = useState(20);
  useEffect(() => {
    if (kind !== "Trading" || profileFid) return;
    const controller = new AbortController();
    setBusy(true);
    setBoard(null);
    setError(null);
    void api(
      "/api/meme/trading?window=" + window,
      undefined,
      "GET",
      controller.signal,
    )
      .then((v) => {
        if (!controller.signal.aborted)
          setBoard((v as { board: Board | null }).board);
      })
      .catch((e) => {
        if (!controller.signal.aborted)
          setError(e instanceof Error ? e.message : "Rankings unavailable");
      })
      .finally(() => {
        if (!controller.signal.aborted) setBusy(false);
      });
    return () => controller.abort();
  }, [kind, window, revision, profileFid]);
  const ownReward = data?.leaderboard
    ?.slice(0, 100)
    .find((r) => r.fid === data.identity?.farcasterFid);
  function showBoard(nextKind = "Trading") {
    setKind(nextKind);
    setProfileFid(null);
    const url = new URL(location.href);
    url.searchParams.delete("trader");
    url.searchParams.delete("board");
    if (nextKind === "Trading") url.searchParams.set("ranking", "trading");
    else url.searchParams.delete("ranking");
    url.searchParams.set("window", window);
    history.replaceState(null, "", url);
  }
  function openProfile(fid: number) {
    setProfileFid(fid);
    const url = new URL(location.href);
    url.searchParams.set("ranking", "trading");
    url.searchParams.set("trader", String(fid));
    url.searchParams.set("window", window);
    if (board?.id) url.searchParams.set("board", board.id);
    else url.searchParams.delete("board");
    history.replaceState(null, "", url);
  }
  return (
    <section className="card" aria-label="Leaderboards">
      <h2>Top 100</h2>
      <div
        className="market-controls leaderboard-types"
        aria-label="Leaderboard type"
      >
        {["Rewards", "Trading"].map((k) => (
          <button
            key={k}
            aria-pressed={kind === k}
            onClick={() => showBoard(k)}
          >
            {k}
          </button>
        ))}
      </div>
      {kind === "Trading" && profileFid ? (
        <TraderProfile
          fid={profileFid}
          window={window}
          onBack={() => showBoard()}
        />
      ) : kind === "Rewards" ? (
        <>
          <p className="fine">
            {data?.settlement?.state === "finalized" ? "Final" : "Provisional"}{" "}
            reward points · this round
          </p>
          {ownReward && (
            <p className="rewards-note">
              Your rank: #{ownReward.rank} · {ownReward.points} pts
            </p>
          )}
          {data?.leaderboard?.length ? (
            <ol className="leaderboard">
              {data.leaderboard.slice(0, visibleRewards).map((r) => (
                <li
                  key={r.fid}
                  className={
                    r.fid === data?.identity?.farcasterFid ? "is-you" : ""
                  }
                >
                  <span>
                    #{r.rank} · {qaName(r.fid)}
                  </span>
                  <strong>{r.points} pts</strong>
                </li>
              ))}
            </ol>
          ) : (
            <>
              <p>No reward rankings yet.</p>
              {onToday && (
                <button className="secondary" onClick={onToday}>
                  Go to today’s vote →
                </button>
              )}
            </>
          )}
          {Math.min(100, data?.leaderboard?.length ?? 0) > visibleRewards && (
            <button
              onClick={() => setVisibleRewards((n) => Math.min(100, n + 20))}
            >
              Show more reward ranks
            </button>
          )}
        </>
      ) : (
        <>
          <div className="market-controls">
            <label>
              Period{" "}
              <select
                value={window}
                onChange={(e) => {
                  setWindow(e.target.value as TradingWindow);
                  setVisibleTrades(20);
                  const url = new URL(location.href);
                  url.searchParams.set("window", e.target.value);
                  url.searchParams.set("ranking", "trading");
                  url.searchParams.delete("board");
                  history.replaceState(null, "", url);
                }}
              >
                <option value="24h">24h</option>
                <option value="30d">30d</option>
                <option value="all">All time</option>
              </select>
            </label>
            <button disabled={busy} onClick={() => setRevision((r) => r + 1)}>
              Refresh ranks
            </button>
          </div>
          <p className="fine">
            Realized net USD P&amp;L · ATTN only · fees included. All verified
            traders are public.
          </p>
          <details className="trader-lookup">
            <summary>Find a trader</summary>
            <form
              className="market-controls"
              onSubmit={(e) => {
                e.preventDefault();
                if (
                  !/^[1-9]\d{0,15}$/.test(lookup) ||
                  !Number.isSafeInteger(Number(lookup))
                ) {
                  setLookupError("Enter a valid Farcaster ID.");
                  return;
                }
                setLookupError("");
                openProfile(Number(lookup));
              }}
            >
              <label>
                Farcaster ID{" "}
                <input
                  inputMode="numeric"
                  value={lookup}
                  onChange={(e) => setLookup(e.target.value)}
                  maxLength={16}
                />
              </label>
              <button type="submit">View trader</button>
            </form>
          </details>
          {lookupError && <p role="alert">{lookupError}</p>}
          {busy && <p role="status">Loading ranks…</p>}
          {error && <p role="alert">{error}</p>}
          {!busy && !board && !error && (
            <p>No verified trading snapshot yet.</p>
          )}
          {board && (
            <>
              <p className="fine">
                {board.mode === "simulated" ? "Simulated trades · " : ""}
                {board.stale ? "Stale · " : ""}
                {board.cohort} verified traders ·{" "}
                {new Date(board.asOf).toLocaleString()}
              </p>
              {!!data?.identity?.farcasterFid && (
                <button
                  className="text-button"
                  onClick={() => {
                    const fid = data.identity.farcasterFid;
                    if (fid) openProfile(fid);
                  }}
                >
                  View my trading profile →
                </button>
              )}
              <ol className="leaderboard trading-leaderboard">
                {board.items.slice(0, visibleTrades).map((r) => (
                  <li
                    key={r.fid}
                    className={
                      r.fid === data?.identity?.farcasterFid ? "is-you" : ""
                    }
                  >
                    <div>
                      <strong>
                        <button
                          className="text-button"
                          onClick={() => openProfile(r.fid)}
                        >
                          #{r.rank} · {qaName(r.fid)}
                        </button>
                      </strong>
                      <p className="fine">
                        {r.sells} sales · ROI{" "}
                        {r.roiPercent === null
                          ? "—"
                          : Number(r.roiPercent).toFixed(2) + "%"}
                      </p>
                    </div>
                    <strong className={direction(r.pnlUsd)}>
                      {dollars(r.pnlUsd)}
                    </strong>
                    {!!r.ogGains.length && (
                      <details>
                        <summary>OG gains</summary>
                        {r.ogGains.map((g) => (
                          <p className="fine" key={g.mint}>
                            {Number(g.amount) > 0 ? "+" : ""}
                            {Number(g.amount).toLocaleString(undefined, {
                              maximumFractionDigits: 6,
                            })}{" "}
                            · {g.mint.slice(0, 4)}…{g.mint.slice(-4)}
                          </p>
                        ))}
                      </details>
                    )}
                    <SocialShare
                      kind="pnl"
                      subject="trading"
                      window={window}
                      fid={r.fid}
                      sourceHash={board.sourceHash}
                      compact
                    />
                  </li>
                ))}
              </ol>
              {board.items.length > visibleTrades && (
                <button onClick={() => setVisibleTrades((n) => n + 20)}>
                  Show more trading ranks
                </button>
              )}
              {!board.items.length && (
                <p>No completed trades in this period.</p>
              )}
              <details>
                <summary>How P&amp;L works</summary>
                <p>
                  Moving average purchase cost, including fees. Only realized
                  sales count. Rewards and deposits do not create trading
                  profit. Missing history blocks publication. Each OG token is
                  counted separately.
                </p>
              </details>
            </>
          )}
        </>
      )}
    </section>
  );
}
