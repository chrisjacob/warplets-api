import { useEffect, useRef, useState } from "react";
import type {
  MarketDefinition,
  MarketView,
  MarketWindow,
} from "../shared/markets";
import { api } from "./client";
import SocialShare from "./SocialShare";
const percent = (value: string | null) =>
  value === null
    ? "—"
    : (Number(value) > 0 ? "+" : "") +
      Number(value).toLocaleString(undefined, { maximumFractionDigits: 2 }) +
      "%";
function Chart({ view }: { view: MarketView }) {
  const finite = view.points.filter(
    (p) =>
      Number.isFinite(Number(p.ogIndex)) &&
      (p.attnIndex === null || Number.isFinite(Number(p.attnIndex))),
  );
  if (finite.length < 2) return <p>Not enough matching price history yet.</p>;
  const values = finite.flatMap((p) =>
      p.attnIndex === null
        ? [Number(p.ogIndex)]
        : [Number(p.ogIndex), Number(p.attnIndex)],
    ),
    lo = Math.min(100, ...values),
    hi = Math.max(100, ...values),
    range = hi - lo || 1,
    from = finite[0].at,
    span = finite.at(-1)!.at - from || 1;
  const paths = (key: "ogIndex" | "attnIndex") => {
    const out: string[] = [];
    let path = "";
    for (const p of finite) {
      if (p[key] === null || p.breakBefore) {
        if (path) out.push(path);
        path = "";
      }
      if (p[key] !== null) {
        path +=
          (path ? " L" : "M") +
          (20 + ((p.at - from) / span) * 600).toFixed(2) +
          "," +
          (180 - ((Number(p[key]) - lo) / range) * 150).toFixed(2);
      }
    }
    if (path) out.push(path);
    return out;
  };
  return (
    <>
      <svg
        className="performance-chart"
        viewBox="0 0 640 210"
        role="img"
        aria-label="Matched price performance, indexed to 100 at the same start time"
      >
        <line
          x1="20"
          x2="620"
          y1={180 - ((100 - lo) / range) * 150}
          y2={180 - ((100 - lo) / range) * 150}
          stroke="currentColor"
          strokeDasharray="4 4"
          opacity=".25"
        />
        {paths("ogIndex").map((d, i) => (
          <path
            key={"og" + i}
            d={d}
            fill="none"
            stroke="#9b9ba8"
            strokeWidth="3"
          />
        ))}
        {paths("attnIndex").map((d, i) => (
          <path
            key={"attn" + i}
            d={d}
            fill="none"
            stroke="#d6fd72"
            strokeWidth="3"
            strokeDasharray="8 3"
          />
        ))}
        <text x="20" y="205" fill="currentColor" fontSize="13">
          {new Date(from).toLocaleDateString()}
        </text>
        <text
          x="620"
          y="205"
          textAnchor="end"
          fill="currentColor"
          fontSize="13"
        >
          {new Date(finite.at(-1)!.at).toLocaleDateString()}
        </text>
      </svg>
      <p className="fine">● OG · dashed ATTN · same start = 100</p>
    </>
  );
}
export default function MarketsPanel() {
  const [items, setItems] = useState<MarketDefinition[]>([]),
    [cursor, setCursor] = useState<string | null>(null),
    [market, setMarket] = useState(
      () => new URLSearchParams(location.search).get("market") ?? "",
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
          disabled={busy}
          onClick={() => setRevision((r) => r + 1)}
        >
          Refresh prices
        </button>
      </div>
      <div className="market-controls">
        <label>
          Pair{" "}
          <select value={market} onChange={(e) => setMarket(e.target.value)}>
            <option value="">Choose a pair</option>
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
            value={window}
            onChange={(e) => setWindow(e.target.value as MarketWindow)}
          >
            <option value="24h">24 hours</option>
            <option value="30d">30 days</option>
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
          <Chart view={view} />
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
          />
          <dl className="market-returns">
            <div>
              <dt>{view.market.symbol} · USD</dt>
              <dd>{percent(view.returns.attn)}</dd>
            </div>
            <div>
              <dt>{view.market.ogSymbol} · USD</dt>
              <dd>{percent(view.returns.og)}</dd>
            </div>
            <div>
              <dt>ATTN / OG</dt>
              <dd>{percent(view.returns.pair)}</dd>
            </div>
          </dl>
          {view.returns.differencePp !== null && (
            <p>
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
