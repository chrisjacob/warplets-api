import { useEffect, useRef, useState, lazy, Suspense } from "react";
import { qaEnabled, qaContext } from "./qaMode";
const QATrade = import.meta.env.DEV
  ? lazy(() => import("./QAInteractions"))
  : null;
import type {
  MarketDefinition,
  MarketView,
  MarketWindow,
} from "../shared/markets";
import { api } from "./client";
import SocialShare from "./SocialShare";
import PerformanceChart from "./PerformanceChart";
import { percentage as percent, direction } from "./display";
export default function MarketsPanel() {
  const [items, setItems] = useState<MarketDefinition[]>([]),
    [cursor, setCursor] = useState<string | null>(null),
    [market, setMarket] = useState(
      () =>
        new URLSearchParams(location.search).get("market") ??
        (qaEnabled ? (qaContext?.latestMarket ?? "") : ""),
    ),
    [window, setWindow] = useState<MarketWindow>("24h"),
    [view, setView] = useState<MarketView | null>(null),
    [error, setError] = useState<string | null>(null),
    [busy, setBusy] = useState(false),
    [revision, setRevision] = useState(0),
    [listError, setListError] = useState<string | null>(null),
    [listBusy, setListBusy] = useState(false);
  const listRequest = useRef<AbortController | null>(null);
  async function list(after = "") {
    listRequest.current?.abort();
    const controller = new AbortController();
    listRequest.current = controller;
    setListBusy(true);
    setListError(null);
    try {
      const p = (await api(
        "/api/meme/markets" +
          (after ? "?after=" + encodeURIComponent(after) : ""),
        undefined,
        "GET",
        controller.signal,
      )) as { items: MarketDefinition[]; nextCursor: string | null };
      if (controller.signal.aborted) return;
      setItems((old) =>
        after
          ? [...old, ...p.items.filter((i) => !old.some((o) => o.id === i.id))]
          : p.items,
      );
      setCursor(p.nextCursor);
      setMarket((old) => old || p.items[0]?.id || "");
    } catch (e) {
      if (!controller.signal.aborted)
        setListError(e instanceof Error ? e.message : "Markets unavailable");
    } finally {
      if (!controller.signal.aborted) setListBusy(false);
    }
  }
  useEffect(() => {
    void list();
    return () => listRequest.current?.abort();
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    setView(null);
    setError(null);
    if (!market) return;
    setBusy(true);
    void api(
      "/api/meme/markets/" + encodeURIComponent(market) + "?window=" + window,
      undefined,
      "GET",
      controller.signal,
    )
      .then((v) => {
        if (!controller.signal.aborted) setView(v as MarketView);
      })
      .catch((e) => {
        if (!controller.signal.aborted)
          setError(e instanceof Error ? e.message : "Prices unavailable");
      })
      .finally(() => {
        if (!controller.signal.aborted) setBusy(false);
      });
    return () => controller.abort();
  }, [market, window, revision]);
  return (
    <section
      className="card market-panel"
      aria-label="Token performance"
      aria-busy={busy || listBusy}
    >
      <div className="list-heading">
        <h2>ATTN vs OG</h2>
        <button
          className="text-button"
          disabled={busy || listBusy}
          onClick={() => {
            if (!items.length) void list();
            setRevision((r) => r + 1);
          }}
        >
          Refresh prices
        </button>
      </div>
      <div className="market-controls">
        <label>
          Pair{" "}
          <select
            disabled={!items.length}
            value={market}
            onChange={(e) => setMarket(e.target.value)}
          >
            <option value="">Choose a pair</option>
            {view && !items.some((m) => m.id === view.market.id) && (
              <option value={view.market.id}>
                {view.market.symbol} / {view.market.ogSymbol}
              </option>
            )}
            {items.map((m) => (
              <option key={m.id} value={m.id}>
                {m.symbol} / {m.ogSymbol}
                {m.mode === "simulated" ? " · simulated" : ""}
              </option>
            ))}
          </select>
        </label>
        <label>
          Period{" "}
          <select
            disabled={!market}
            value={window}
            onChange={(e) => setWindow(e.target.value as MarketWindow)}
          >
            <option value="24h">24h</option>
            <option value="30d">30d</option>
            <option value="all">All time</option>
          </select>
        </label>
      </div>
      {listError && (
        <p role="alert">
          {listError} <button onClick={() => void list()}>Retry markets</button>
        </p>
      )}
      {cursor && (
        <button disabled={listBusy} onClick={() => void list(cursor)}>
          More pairs
        </button>
      )}
      {!items.length && !listBusy && !listError && (
        <p>No published markets yet.</p>
      )}
      {busy && <p role="status">Loading prices…</p>}
      {error && <p role="alert">{error}</p>}
      {view && (
        <>
          <p className="fine">
            {view.market.mode === "simulated"
              ? "Simulated prices"
              : "Observed prices"}
            {view.coverage.stale ? " · stale" : ""}
            {view.coverage.state === "partial" ? " · partial coverage" : ""}
            {view.coverage.limited ? " · limited history" : ""}
          </p>
          <PerformanceChart key={view.inputHash + view.window} view={view} />
          {view.coverage.fromAt !== null && (
            <p className="fine">
              Compared from {new Date(view.coverage.fromAt).toLocaleString()}.
              Both prices use that same start.
            </p>
          )}
          <SocialShare
            kind={view.market.attnMint ? "performance" : "candidate"}
            subject={view.market.id}
            window={window}
            sourceHash={view.inputHash}
          />
          <dl className="market-returns">
            <div>
              <dt>ATTN · USD</dt>
              <dd className={direction(view.returns.attn)}>
                {percent(view.returns.attn)}
              </dd>
            </div>
            <div>
              <dt>OG · USD</dt>
              <dd className={direction(view.returns.og)}>
                {percent(view.returns.og)}
              </dd>
            </div>
            <div>
              <dt>ATTN / OG</dt>
              <dd className={direction(view.returns.pair)}>
                {percent(view.returns.pair)}
              </dd>
            </div>
          </dl>
          {view.returns.differencePp !== null && (
            <p className="performance-comparison">
              {Number(view.returns.differencePp) > 0
                ? "ATTN ahead by "
                : Number(view.returns.differencePp) < 0
                  ? "OG ahead by "
                  : "Matched: "}
              {Math.abs(Number(view.returns.differencePp)).toLocaleString(
                undefined,
                { maximumFractionDigits: 2 },
              )}{" "}
              percentage points.
            </p>
          )}
          <p className="fine">
            Price change, before trading fees. Greater volatility can amplify
            losses.{" "}
            {view.asOf !== null && (
              <>
                As of{" "}
                <time dateTime={new Date(view.asOf).toISOString()}>
                  {new Date(view.asOf).toLocaleString()}
                </time>
                .
              </>
            )}
          </p>
          {qaEnabled && QATrade && (
            <Suspense fallback={<p>Loading demo trading…</p>}>
              <QATrade
                key={view.market.id}
                marketId={view.market.id}
                symbol={view.market.symbol}
              />
            </Suspense>
          )}
          <details>
            <summary>Price history &amp; coverage</summary>
            <p>
              {view.coverage.gaps} gaps. Lines stop at missing observations.
            </p>
            <div className="table-scroll">
              <table>
                <caption>Matched price observations</caption>
                <thead>
                  <tr>
                    <th>Time</th>
                    <th>OG · USD</th>
                    <th>ATTN · USD</th>
                    <th>ATTN / OG</th>
                  </tr>
                </thead>
                <tbody>
                  {view.points.slice(-50).map((p) => (
                    <tr key={p.at}>
                      <td>{new Date(p.at).toLocaleString()}</td>
                      <td>{p.ogUsd}</td>
                      <td>{p.attnUsd ?? "Unknown"}</td>
                      <td>{p.attnOg ?? "Unknown"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="fine">
              Latest 50 observations. Chart uses up to 500.
            </p>
          </details>
          <details>
            <summary>
              Buy {view.market.symbol} or {view.market.ogSymbol}
            </summary>
            <p>
              Use your Solana wallet. Review the route, minimum received, fees
              and rent before signing.
            </p>
            <button disabled>Quotes unavailable · trading disabled</button>
          </details>
        </>
      )}
    </section>
  );
}
