import test from "node:test";
import assert from "node:assert/strict";
import {
  replayHolding,
  normalizedHolding,
  type LedgerEvent,
  type Campaign,
  type Quote,
} from "./holding";
import { DAY_MS } from "./rules";
const c: Campaign = {
    id: "c",
    mint: "mint",
    symbol: "C",
    launchedAt: 1000,
    endsAt: 1000 + 10 * DAY_MS,
    totalSupply: "1000000000",
    decimals: 6,
    mode: "simulated",
  },
  wallet = "wallet",
  other = "other",
  scope = new Set([wallet, other]);
const quote = (dollars: number): Quote => ({
  paidUnits: String(dollars * 1000000),
  paymentMint: "USDC",
  paymentDecimals: 6,
  usdPriceMicros: "1000000",
  at: 1000,
  source: "fixture",
  evidenceHash: "11".repeat(32),
});
function event(
  index: number,
  at: number,
  kind: LedgerEvent["kind"],
  quantity: string,
  extra: Partial<LedgerEvent> = {},
): LedgerEvent {
  return {
    signature: "tx" + index,
    index: 0,
    slot: index,
    at,
    kind,
    quantity,
    wallet,
    ...extra,
  };
}
test("airdrop dilution and proportional disposal leave exactly $75 purchase credit", () => {
  const events = [
    event(1, 1000, "purchase", "1000", { quote: quote(100) }),
    event(2, 1000 + DAY_MS, "airdrop", "1000"),
    event(3, 1000 + 2 * DAY_MS, "sell", "500"),
  ];
  const r = replayHolding(c, events, scope, 1000 + 2 * DAY_MS);
  assert.equal(r.eligibleCredit.n, 75000000n);
  assert.equal(r.eligibleCredit.d, 1n);
  assert.equal(r.quantity, 1500n);
  assert.equal(r.pointMs, BigInt(2 * DAY_MS));
  assert.deepEqual(
    replayHolding(c, [...events, events[2]], scope, 1000 + 2 * DAY_MS)
      .eligibleCredit,
    r.eligibleCredit,
  );
});
test("topups improve only future earning and purchases do not inherit token age", () => {
  const events = [
    event(1, 1000 + DAY_MS, "purchase", "100", { quote: quote(10) }),
    event(2, 1000 + 2 * DAY_MS, "purchase", "900", { quote: quote(90) }),
  ];
  assert.equal(
    replayHolding(c, events, scope, 1000 + 3 * DAY_MS).pointMs,
    BigInt(3 * DAY_MS),
  );
  assert.equal(
    replayHolding(
      c,
      [event(1, 1000 + 2 * DAY_MS, "purchase", "1000", { quote: quote(100) })],
      scope,
      1000 + 3 * DAY_MS,
    ).pointMs,
    BigInt(2 * DAY_MS),
  );
});
test("internal transfers preserve credit; external receipts give none; rebuys start new clocks", () => {
  const bought = event(1, 1000, "purchase", "1000", { quote: quote(100) }),
    moved = event(2, 1000 + DAY_MS, "transfer", "500", {
      from: wallet,
      to: other,
    });
  assert.equal(
    replayHolding(c, [bought, moved], scope, 1000 + 2 * DAY_MS).pointMs,
    BigInt(4 * DAY_MS),
  );
  const sold = event(3, 1000 + DAY_MS, "sell", "1000");
  assert.equal(
    replayHolding(
      c,
      [
        bought,
        sold,
        event(4, 1000 + 2 * DAY_MS, "purchase", "1000", { quote: quote(100) }),
      ],
      scope,
      1000 + 3 * DAY_MS,
    ).pointMs,
    BigInt(2 * DAY_MS),
  );
  assert.equal(
    replayHolding(
      c,
      [event(1, 1000, "transfer", "1000", { from: "external", to: wallet })],
      scope,
      1000 + DAY_MS,
    ).pointMs,
    0n,
  );
});
test("normalization uses active campaign opportunity, exact partial durations and no-campaign zero", () => {
  const bought = event(1, 1000, "purchase", "1000", { quote: quote(100) }),
    events = new Map([["c", [bought]]]);
  assert.equal(
    normalizedHolding([c], events, scope, 1000 + DAY_MS / 2).units,
    50000n,
  );
  const second = { ...c, id: "second", mint: "second" };
  assert.equal(
    normalizedHolding([c, second], events, scope, 1000 + DAY_MS / 2).units,
    25000n,
  );
  assert.equal(normalizedHolding([], events, scope, 1000 + DAY_MS).units, 0n);
  assert.equal(normalizedHolding([c], events, scope, c.endsAt + 1).units, 0n);
});
test("missing inventory, conflicting replay and absent acquisition evidence fail explicitly", () => {
  assert.throws(
    () => replayHolding(c, [event(1, 1000, "sell", "1")], scope, 2000),
    /negative|exceeds/,
  );
  assert.throws(
    () => replayHolding(c, [event(1, 1000, "purchase", "1")], scope, 2000),
    /quote/,
  );
  assert.throws(
    () =>
      replayHolding(
        c,
        [event(1, 1000, "airdrop", "1"), event(1, 1000, "airdrop", "2")],
        scope,
        2000,
      ),
    /Conflicting/,
  );
});
