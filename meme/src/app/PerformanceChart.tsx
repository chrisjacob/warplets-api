import { useMemo, useState, useId, type PointerEvent } from "react";
import type { MarketView } from "../shared/markets";
import { percentage } from "./display";

/** Shared-time comparison only: no interpolation across missing observations. */
export default function PerformanceChart({ view }: { view: MarketView }) {
  const [selected, setSelected] = useState<number | null>(null),
    hint = useId();
  const plot = useMemo(() => {
    const points = view.points.filter(
      (p) =>
        Number.isFinite(p.at) &&
        Number.isFinite(Number(p.ogIndex)) &&
        (p.attnIndex === null || Number.isFinite(Number(p.attnIndex))),
    );
    const values = points.flatMap((p) =>
      p.attnIndex === null
        ? [Number(p.ogIndex)]
        : [Number(p.ogIndex), Number(p.attnIndex)],
    );
    const min = Math.min(100, ...values),
      max = Math.max(100, ...values),
      padding = (max - min || 8) * 0.12,
      lo = Math.max(0, min - padding),
      hi = max + padding,
      from = points[0]?.at ?? 0,
      span = (points.at(-1)?.at ?? 0) - from || 1;
    const x = (at: number) => 42 + ((at - from) / span) * 304,
      y = (n: number) => 158 - ((n - lo) / (hi - lo)) * 138;
    function paths(key: "ogIndex" | "attnIndex") {
      const out: string[] = [];
      let path = "";
      for (const p of points) {
        if (p[key] === null || p.breakBefore) {
          if (path) out.push(path);
          path = "";
        }
        if (p[key] !== null)
          path +=
            (path ? " L" : "M") +
            x(p.at).toFixed(2) +
            "," +
            y(Number(p[key])).toFixed(2);
      }
      if (path) out.push(path);
      return out;
    }
    return {
      points,
      x,
      y,
      lo,
      hi,
      from,
      to: points.at(-1)?.at ?? from,
      og: paths("ogIndex"),
      attn: paths("attnIndex"),
    };
  }, [view]);
  if (plot.points.length < 2)
    return <p className="empty-copy">Not enough matching price history yet.</p>;
  const index =
      selected === null
        ? plot.points.length - 1
        : Math.min(selected, plot.points.length - 1),
    point = plot.points[index];
  function inspect(event: PointerEvent<SVGSVGElement>) {
    const box = event.currentTarget.getBoundingClientRect(),
      x = Math.max(
        42,
        Math.min(346, ((event.clientX - box.left) / box.width) * 360),
      );
    let nearest = 0;
    for (let i = 1; i < plot.points.length; i++)
      if (
        Math.abs(plot.x(plot.points[i].at) - x) <
        Math.abs(plot.x(plot.points[nearest].at) - x)
      )
        nearest = i;
    setSelected(nearest);
  }
  const axis = (n: number) => {
    const v = n - 100;
    return (
      (v > 0 ? "+" : "") +
      v.toLocaleString(undefined, {
        maximumFractionDigits: 1,
        notation: Math.abs(v) >= 1000 ? "compact" : "standard",
      }) +
      "%"
    );
  };
  const change = (n: string | null) =>
    n === null ? "Unknown" : percentage(String(Number(n) - 100));
  const endpoint = (at: number) =>
    plot.to - plot.from <= 86400000
      ? new Date(at).toLocaleTimeString(undefined, {
          hour: "numeric",
          minute: "2-digit",
        })
      : new Date(at).toLocaleDateString(undefined, {
          month: "short",
          day: "numeric",
        });
  return (
    <div
      className="chart-explorer"
      tabIndex={0}
      role="group"
      aria-label="Explore matched prices"
      aria-describedby={hint}
      onKeyDown={(event) => {
        let next: number | undefined;
        if (event.key === "ArrowLeft") next = Math.max(0, index - 1);
        if (event.key === "ArrowRight")
          next = Math.min(plot.points.length - 1, index + 1);
        if (event.key === "Home") next = 0;
        if (event.key === "End") next = plot.points.length - 1;
        if (next !== undefined) {
          event.preventDefault();
          setSelected(next);
        }
      }}
    >
      <div className="chart-legend">
        <span>
          <i className="legend-attn" />
          ATTN
        </span>
        <span>
          <i className="legend-og" />
          OG
        </span>
        <span>Same start = 100</span>
      </div>
      <svg
        className="performance-chart"
        viewBox="0 0 360 188"
        role="img"
        aria-label="Matched price performance, indexed to 100 at the same start time"
        onPointerMove={inspect}
        onPointerDown={inspect}
        onPointerLeave={(event) => {
          if (event.pointerType === "mouse") setSelected(null);
        }}
      >
        {[plot.hi, (plot.hi + plot.lo) / 2, plot.lo].map((n, i) => (
          <g key={i}>
            <line
              x1="42"
              x2="346"
              y1={plot.y(n)}
              y2={plot.y(n)}
              className="chart-grid"
            />
            <text
              x="35"
              y={plot.y(n) + 4}
              textAnchor="end"
              className="chart-label"
            >
              {axis(n)}
            </text>
          </g>
        ))}
        <line
          x1="42"
          x2="346"
          y1={plot.y(100)}
          y2={plot.y(100)}
          className="chart-baseline"
        />
        {plot.og.map((d, i) => (
          <path key={"og" + i} d={d} className="chart-og" />
        ))}
        {plot.attn.map((d, i) => (
          <path key={"attn" + i} d={d} className="chart-attn" />
        ))}
        {selected !== null && (
          <g>
            <line
              x1={plot.x(point.at)}
              x2={plot.x(point.at)}
              y1="15"
              y2="162"
              className="chart-crosshair"
            />
            <circle
              cx={plot.x(point.at)}
              cy={plot.y(Number(point.ogIndex))}
              r="4"
              className="chart-dot-og"
            />
            {point.attnIndex !== null && (
              <circle
                cx={plot.x(point.at)}
                cy={plot.y(Number(point.attnIndex))}
                r="4"
                className="chart-dot-attn"
              />
            )}
          </g>
        )}
        <text x="42" y="181" className="chart-label">
          <title>{new Date(plot.from).toLocaleString()}</title>
          {endpoint(plot.from)}
        </text>
        <text x="346" y="181" textAnchor="end" className="chart-label">
          <title>{new Date(plot.to).toLocaleString()}</title>
          {endpoint(plot.to)}
        </text>
      </svg>
      <span id={hint} className="sr-only">
        Use left and right arrows to inspect matching observations. Home and End
        jump to the start and end. Lines stop at missing prices.
      </span>
      {selected === null ? (
        <p className="chart-hint">Touch a point to compare</p>
      ) : (
        <div className="chart-readout" role="status">
          <time dateTime={new Date(point.at).toISOString()}>
            {new Date(point.at).toLocaleString(undefined, {
              month: "short",
              day: "numeric",
              hour: "numeric",
              minute: "2-digit",
            })}
          </time>
          <span>ATTN {change(point.attnIndex)}</span>
          <span>OG {change(point.ogIndex)}</span>
        </div>
      )}
    </div>
  );
}
