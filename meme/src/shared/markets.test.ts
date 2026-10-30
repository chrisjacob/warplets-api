import test from "node:test";
import assert from "node:assert/strict";
import { Exact } from "./exact";
import {
  comparison,
  type MarketDefinition,
  type MarketObservation,
} from "./markets";
const market: MarketDefinition = {
  id: "demo",
  symbol: "ATTN",
  ogSymbol: "OG",
  ogMint: "11111111111111111111111111111111",
  attnMint: "So11111111111111111111111111111111111111112",
  pool: null,
  launchedAt: 1000,
  mode: "simulated",
};
const point = (
  at: number,
  ogUsd: string,
  attnOg: string | null,
): MarketObservation => ({
  at,
  observedAt: at,
  ogUsd,
  attnOg,
  intervalMs: 1000,
  source: "fixture",
  evidenceHash: "a".repeat(64),
});
test("two-price returns share a real baseline and preserve amplified gains and losses exactly", () => {
  const up = comparison(
    market,
    [point(1000, "1", "1"), point(2000, "1.5", "1.5")],
    "all",
    2000,
    "h",
  );
  assert.equal(up.returns.og, "50");
  assert.equal(up.returns.attn, "125");
  assert.equal(up.returns.differencePp, "75");
  assert.equal(up.returns.pair, "50");
  const down = comparison(
    market,
    [point(1000, "1", "1"), point(2000, "0.5", "0.5")],
    "all",
    2000,
    "h",
  );
  assert.equal(down.returns.attn, "-75");
  assert.equal(down.financialEvidence, false);
  const candidate = comparison(
    { ...market, attnMint: null, launchedAt: null },
    [point(1000, "1", null), point(2000, "2", null)],
    "all",
    2000,
    "h",
  );
  assert.equal(candidate.returns.og, "100");
  assert.equal(candidate.returns.attn, null);
});
test("history never invents a pre-launch ATTN curve; downsampling retains endpoints and source gaps", () => {
  const observations = [
    point(0, "1", null),
    ...Array.from({ length: 1200 }, (_, i) =>
      point(1000 + i * 1000 + (i > 600 ? 10000 : 0), "0.0000000000001", "0.5"),
    ),
  ];
  const view = comparison(market, observations, "all", 2000000, "h");
  assert.equal(view.points[0].at, 1000);
  assert(view.points.length <= 500);
  assert.equal(view.points.at(-1)!.at, 1210000);
  assert(view.points.some((p) => p.breakBefore));
  assert.equal(view.coverage.gaps, 1);
  assert.equal(view.coverage.state, "partial");
  assert.equal(
    Exact.decimal("0.0000000000001").mul(Exact.decimal("0.5")).decimal(24),
    "0.00000000000005",
  );
  assert.equal(
    Exact.decimal("-2.25").div(Exact.decimal("0.5")).decimal(),
    "-4.5",
  );
  assert.equal(
    Exact.json(Exact.decimal("-1.234").toJSON()).decimal(),
    "-1.234",
  );
  for (const bad of ["NaN", "1e3", "1.2.3", "01", "Infinity"])
    assert.throws(() => Exact.decimal(bad));
});
