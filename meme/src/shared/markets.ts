import { Exact } from "./exact";
export type MarketWindow = "24h" | "30d" | "all";
export interface MarketDefinition {
  id: string;
  symbol: string;
  ogSymbol: string;
  ogMint: string;
  attnMint: string | null;
  pool: string | null;
  launchedAt: number | null;
  mode: "simulated" | "observed";
}
export interface MarketObservation {
  at: number;
  observedAt: number;
  ogUsd: string;
  attnOg: string | null;
  intervalMs: number;
  source: string;
  evidenceHash: string;
}
export interface MarketView {
  version: 1;
  market: MarketDefinition;
  window: MarketWindow;
  asOf: number | null;
  generatedAt: number;
  inputHash: string;
  freshnessMs: number;
  coverage: {
    state: "available" | "partial";
    fromAt: number | null;
    throughAt: number | null;
    gaps: number;
    limited: boolean;
    stale: boolean;
  };
  points: {
    at: number;
    ogUsd: string;
    attnUsd: string | null;
    attnOg: string | null;
    ogIndex: string;
    attnIndex: string | null;
    breakBefore: boolean;
  }[];
  returns: {
    og: string | null;
    attn: string | null;
    differencePp: string | null;
    pair: string | null;
  };
  financialEvidence: false;
}
export function comparison(
  market: MarketDefinition,
  observations: MarketObservation[],
  window: MarketWindow,
  now: number,
  inputHash: string,
  limited = false,
): MarketView {
  const requestedFrom =
    window === "all" ? 0 : now - (window === "24h" ? 86400000 : 30 * 86400000);
  const ordered = observations
    .filter((p) => p.at >= requestedFrom && p.at <= now)
    .sort(
      (a, b) => a.at - b.at || a.evidenceHash.localeCompare(b.evidenceHash),
    );
  const unique = new Map<number, MarketObservation>();
  for (const p of ordered) unique.set(p.at, p);
  const all = [...unique.values()];
  // ATTN comparisons start at the first genuine common observation, never before launch.
  const firstCommon = market.attnMint
    ? all.find(
        (p) =>
          p.attnOg !== null &&
          market.launchedAt !== null &&
          p.at >= market.launchedAt,
      )
    : undefined;
  const rows = market.attnMint
    ? firstCommon
      ? all.filter((p) => p.at >= firstCommon.at)
      : []
    : all;
  const baseline = rows[0],
    last = rows.at(-1),
    hundred = new Exact(100n);
  const initialOg = baseline ? Exact.decimal(baseline.ogUsd) : null;
  const initialAttn = baseline?.attnOg
    ? Exact.decimal(baseline.attnOg).mul(initialOg!)
    : null;
  let gaps = 0;
  const points = rows.map((p, i) => {
    const og = Exact.decimal(p.ogUsd),
      attn = p.attnOg === null ? null : og.mul(Exact.decimal(p.attnOg));
    const gap =
      i > 0 &&
      (p.at - rows[i - 1].at >
        Math.max(p.intervalMs, rows[i - 1].intervalMs) * 2 ||
        (market.attnMint !== null && p.attnOg === null));
    if (gap) gaps++;
    return {
      at: p.at,
      ogUsd: p.ogUsd,
      attnUsd: attn?.decimal(24) ?? null,
      attnOg: p.attnOg,
      ogIndex: og.div(initialOg!).mul(hundred).decimal(8),
      attnIndex:
        attn && initialAttn
          ? attn.div(initialAttn).mul(hundred).decimal(8)
          : null,
      breakBefore: gap,
    };
  });
  const ogReturn =
    last && initialOg
      ? Exact.decimal(last.ogUsd).div(initialOg).sub(new Exact(1n)).mul(hundred)
      : null;
  const attnReturn =
    last?.attnOg && initialAttn
      ? Exact.decimal(last.ogUsd)
          .mul(Exact.decimal(last.attnOg))
          .div(initialAttn)
          .sub(new Exact(1n))
          .mul(hundred)
      : null;
  const pairReturn =
    last?.attnOg && baseline?.attnOg
      ? Exact.decimal(last.attnOg)
          .div(Exact.decimal(baseline.attnOg))
          .sub(new Exact(1n))
          .mul(hundred)
      : null;
  const freshnessMs = Math.max((last?.intervalMs ?? 0) * 2, 900000);
  const stale = !last || now - last.at > freshnessMs;
  const partial =
    limited ||
    gaps > 0 ||
    stale ||
    !baseline ||
    (window !== "all" && baseline.at > requestedFrom + baseline.intervalMs);
  // Keep endpoints and evenly distributed observations; source gaps remain explicit.
  const indices = new Set(
    Array.from({ length: Math.min(500, points.length) }, (_, i) =>
      Math.floor(
        (i * (points.length - 1)) /
          Math.max(1, Math.min(500, points.length) - 1),
      ),
    ),
  );
  const chosen: typeof points = [];
  let pendingBreak = false;
  for (let i = 0; i < points.length; i++) {
    pendingBreak ||= points[i].breakBefore;
    if (indices.has(i)) {
      chosen.push({ ...points[i], breakBefore: pendingBreak });
      pendingBreak = false;
    }
  }
  return {
    version: 1,
    market,
    window,
    asOf: last?.at ?? null,
    generatedAt: now,
    inputHash,
    freshnessMs,
    coverage: {
      state: partial ? "partial" : "available",
      fromAt: baseline?.at ?? null,
      throughAt: last?.at ?? null,
      gaps,
      limited,
      stale,
    },
    points: chosen,
    returns: {
      og: ogReturn?.decimal(8) ?? null,
      attn: attnReturn?.decimal(8) ?? null,
      differencePp:
        attnReturn && ogReturn ? attnReturn.sub(ogReturn).decimal(8) : null,
      pair: pairReturn?.decimal(8) ?? null,
    },
    financialEvidence: false,
  };
}
