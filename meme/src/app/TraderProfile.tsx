import { useEffect, useRef, useState } from "react";
import { qaEnabled, qaName } from "./qaMode";
import type { TradingProfile, TradingWindow } from "../shared/trading";
import { api } from "./client";
import SocialShare from "./SocialShare";
import { miniRuntime } from "./miniRuntime";
import { direction, percentage } from "./display";
export default function TraderProfile({
  fid,
  window,
  onBack,
}: {
  fid: number;
  window: TradingWindow;
  onBack: () => void;
}) {
  const [profile, setProfile] = useState<TradingProfile | null>(null),
    [error, setError] = useState<string | null>(null),
    [revision, setRevision] = useState(0),
    [host, setHost] = useState<Awaited<ReturnType<typeof miniRuntime>>>(null);
  const back = useRef(onBack);
  back.current = onBack;
  useEffect(() => {
    let active = true,
      runtime: Awaited<ReturnType<typeof miniRuntime>> = null;
    void miniRuntime().then((r) => {
      if (!active) return;
      runtime = r;
      setHost(r);
      if (r?.capabilities.includes("back")) {
        r.sdk.back.onback = () => back.current();
        void r.sdk.back.show().catch(() => {});
      }
    });
    return () => {
      active = false;
      if (runtime?.capabilities.includes("back")) {
        runtime.sdk.back.onback = () => {};
        void runtime.sdk.back.hide().catch(() => {});
      }
    };
  }, [fid]);
  useEffect(() => {
    const controller = new AbortController();
    setProfile(null);
    setError(null);
    const params = new URLSearchParams({ window }),
      board = new URLSearchParams(location.search).get("board");
    if (board && /^board:[a-f0-9]{64}$/.test(board)) params.set("board", board);
    void api(
      "/api/meme/trading/profiles/" + fid + "?" + params,
      undefined,
      "GET",
      controller.signal,
    )
      .then((p) => {
        if (!controller.signal.aborted) setProfile(p as TradingProfile);
      })
      .catch((e) => {
        if (!controller.signal.aborted)
          setError(e instanceof Error ? e.message : "Profile unavailable");
      });
    return () => controller.abort();
  }, [fid, window, revision]);
  const money = (s: string) =>
    new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: "USD",
      maximumFractionDigits: 2,
    }).format(Number(s));
  return (
    <section aria-label="Trader profile">
      <button className="text-button" onClick={onBack}>
        ← Back to leaders
      </button>
      <h3>{qaName(fid)}</h3>
      <p className="fine">
        {qaEnabled ? "Simulated trading" : "Public verified trading"} · {window}{" "}
        ·{" "}
        {!qaEnabled && (
          <a
            href={"https://farcaster.xyz/~/profiles/" + fid}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(event) => {
              if (host?.capabilities.includes("actions.viewProfile")) {
                event.preventDefault();
                void host.sdk.actions
                  .viewProfile({ fid })
                  .catch(() => setError("Couldn’t open Farcaster profile."));
              }
            }}
          >
            Farcaster profile ↗
          </a>
        )}
      </p>
      {!profile && !error && <p role="status">Loading profile…</p>}
      {error && (
        <p role="alert">
          {error}{" "}
          <button onClick={() => setRevision((n) => n + 1)}>
            Retry profile
          </button>
        </p>
      )}
      {profile && (
        <>
          <p className="fine">
            {profile.mode === "simulated" ? "Simulated · " : ""}
            {profile.historical
              ? "Saved snapshot · "
              : profile.stale
                ? "Stale · "
                : ""}
            {new Date(profile.asOf).toLocaleString()}
          </p>
          <dl className="market-returns">
            <div>
              <dt>Realized net P&amp;L</dt>
              <dd className={direction(profile.metrics.pnlUsd)}>
                {money(profile.metrics.pnlUsd)}
              </dd>
            </div>
            <div>
              <dt>Realized ROI</dt>
              <dd className={direction(profile.metrics.roiPercent)}>
                {percentage(profile.metrics.roiPercent)}
              </dd>
            </div>
          </dl>
          <p>
            {profile.metrics.sells} sales · {profile.metrics.wins} profitable ·{" "}
            {profile.rank === null
              ? "Outside the top 100"
              : "Rank #" + profile.rank}
          </p>
          <details>
            <summary>Cost &amp; OG gains</summary>
            <p>
              Disposed purchase cost: {money(profile.metrics.costUsd)} · net
              proceeds: {money(profile.metrics.proceedsUsd)}
            </p>
            {profile.metrics.ogGains.map((g) => (
              <p className="fine" key={g.mint}>
                {g.amount} OG units · <code>{g.mint}</code>
              </p>
            ))}
            <p className="fine">
              Each OG mint is separate. Rewards, deposits and self-transfers are
              excluded from trading profit.
            </p>
          </details>
          <SocialShare
            kind="pnl"
            subject="trading"
            window={window}
            fid={fid}
            sourceHash={profile.sourceHash}
          />
        </>
      )}
    </section>
  );
}
