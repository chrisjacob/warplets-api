import test from "node:test";
import assert from "node:assert/strict";
import {
  tradingMetrics,
  rankTraders,
  type TraderEvidence,
  type TradeEvent,
} from "./trading";
import { encode58 } from "./base58";
const wallet = encode58(new Uint8Array(32).fill(1)),
  other = encode58(new Uint8Array(32).fill(2)),
  sig = encode58(new Uint8Array(64).fill(1));
const event = (
  index: number,
  kind: TradeEvent["kind"],
  quantity: string,
  extra: Partial<TradeEvent> = {},
): TradeEvent => ({
  id: "event:" + index,
  slot: index + 1,
  index,
  at: index * 1000,
  wallet,
  marketId: "m",
  kind,
  quantity,
  signature: sig,
  evidenceHash: "a".repeat(64),
  finalized: true,
  ...extra,
});
export const evidence = (events: TradeEvent[]): TraderEvidence => ({
  version: 1,
  fid: 1,
  wallets: [wallet, other],
  verifiedAt: 0,
  throughAt: 100000000,
  complete: true,
  gaps: [],
  sourceHash: "a".repeat(64),
  mode: "simulated",
  markets: [{ id: "m", attnMint: wallet, ogMint: other }],
  events,
});
test("moving weighted average handles topups, fees, rewards and self-transfers without inventing profit", () => {
  const input = evidence([
    event(1, "buy", "10", { usd: "100", og: "20", feeUsd: "2", feeOg: "0.4" }),
    event(2, "buy", "10", { usd: "200", og: "40", feeUsd: "0", feeOg: "0" }),
    event(3, "external-in", "20"),
    event(4, "self-transfer", "20", { destination: other }),
    event(5, "sell", "20", {
      wallet: other,
      usd: "400",
      og: "80",
      feeUsd: "4",
      feeOg: "0.8",
    }),
  ]);
  const m = tradingMetrics(input, "all", 100000000);
  assert.equal(m.costUsd, "151");
  assert.equal(m.proceedsUsd, "198");
  assert.equal(m.pnlUsd, "47");
  assert.equal(m.ogGains[0].amount, "9.4");
  assert.equal(m.sells, 1);
  assert.equal(tradingMetrics(input, "24h", 100000000).sells, 0);
});
test("disposals and rebuys use the surviving cost, excluded tokens and negative outcomes remain honest", () => {
  const input = evidence([
    event(1, "buy", "10", { usd: "100", og: "10", feeUsd: "0", feeOg: "0" }),
    event(2, "external-out", "5"),
    event(3, "buy", "5", { usd: "200", og: "20", feeUsd: "0", feeOg: "0" }),
    event(4, "sell", "10", { usd: "100", og: "10", feeUsd: "1", feeOg: "0.1" }),
  ]);
  const m = tradingMetrics(input, "all", 100000000);
  assert.equal(m.pnlUsd, "-151");
  assert.equal(m.costUsd, "250");
  assert.equal(m.roiPercent, "-60.4");
  assert.equal(rankTraders([m])[0].rank, 1);
  assert.equal(
    tradingMetrics(
      evidence([
        event(1, "external-in", "10"),
        event(2, "sell", "10", {
          usd: "100",
          og: "10",
          feeUsd: "0",
          feeOg: "0",
        }),
      ]),
      "all",
      100000000,
    ).sells,
    0,
  );
});
test("gaps, incomplete history, unverified transfers and duplicate event aliases block publication", () => {
  const buy = event(1, "buy", "10", {
    usd: "100",
    og: "10",
    feeUsd: "0",
    feeOg: "0",
  });
  for (const input of [
    { ...evidence([buy]), complete: false },
    { ...evidence([buy]), gaps: ["unknown-price"] },
    evidence([buy, { ...buy, id: "alias" }]),
    evidence([
      event(1, "sell", "1", { usd: "2", og: "1", feeUsd: "0", feeOg: "0" }),
    ]),
    evidence([
      buy,
      event(2, "self-transfer", "1", {
        destination: encode58(new Uint8Array(32).fill(3)),
      }),
    ]),
  ])
    assert.throws(() => tradingMetrics(input, "all", 100000000));
});
