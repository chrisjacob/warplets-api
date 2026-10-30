import { useEffect, useState } from "react";
import { api } from "./client";
import type { TradingMetrics, TradingWindow } from "../shared/trading";
import type { LocalState } from "./LocalRounds";
type Board = {
  id: string;
  asOf: number;
  mode: string;
  stale: boolean;
  cohort: number;
  items: (TradingMetrics & { rank: number })[];
};
const dollars = (n: string) =>
  new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  }).format(Number(n));
export default function LeadersPanel({ data }: { data: LocalState | null }) {
  const [kind, setKind] = useState("Rewards"),
    [window, setWindow] = useState<TradingWindow>("24h"),
    [board, setBoard] = useState<Board | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<string | null>(null),
    [revision, setRevision] = useState(0);
  useEffect(() => {
    if (kind !== "Trading") return;
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
  }, [kind, window, revision]);
  return (
    <section className="card" aria-label="Leaderboards">
      <h2>Top 100</h2>
      <div className="market-controls" aria-label="Leaderboard type">
        {["Rewards", "Trading"].map((k) => (
          <button key={k} aria-pressed={kind === k} onClick={() => setKind(k)}>
            {k}
          </button>
        ))}
      </div>
      {kind === "Rewards" ? (
        <>
          <p className="fine">
            {data?.settlement?.state === "finalized" ? "Final" : "Provisional"}{" "}
            reward points · this round
          </p>
          {data?.leaderboard?.length ? (
            <ol className="leaderboard">
              {data.leaderboard.slice(0, 100).map((r) => (
                <li key={r.fid}>
                  <span>
                    #{r.rank} · FID {r.fid}
                  </span>
                  <strong>{r.points} pts</strong>
                </li>
              ))}
            </ol>
          ) : (
            <p>No reward rankings yet.</p>
          )}
        </>
      ) : (
        <>
          <div className="market-controls">
            <label>
              Period{" "}
              <select
                value={window}
                onChange={(e) => setWindow(e.target.value as TradingWindow)}
              >
                <option value="24h">24 hours</option>
                <option value="30d">30 days</option>
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
              <ol className="leaderboard">
                {board.items.map((r) => (
                  <li key={r.fid}>
                    <div>
                      <strong>
                        #{r.rank} · FID {r.fid}
                      </strong>
                      <p className="fine">
                        {r.sells} sales · ROI{" "}
                        {r.roiPercent === null
                          ? "—"
                          : Number(r.roiPercent).toFixed(2) + "%"}
                      </p>
                    </div>
                    <strong>{dollars(r.pnlUsd)}</strong>
                  </li>
                ))}
              </ol>
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
