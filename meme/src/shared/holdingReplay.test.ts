import test from "node:test";
import assert from "node:assert/strict";
import { HoldingReplay } from "./holdingReplay";
import { replayHolding, type Campaign, type LedgerEvent } from "./holding";

test("paged exact replay preserves local-v1 holding semantics across topups, disposals, internal transfers and rebuys", () => {
  const c: Campaign = {
    id: "c",
    mint: "m",
    symbol: "C",
    launchedAt: 1000,
    endsAt: 200000,
    totalSupply: "1000000",
    decimals: 0,
    mode: "simulated",
  };
  const wallets = new Set(["a", "b"]),
    events: LedgerEvent[] = [];
  for (let i = 0; i < 50; i++) {
    const at = 1000 + i * 1000;
    events.push({
      signature: "s" + i,
      index: 0,
      slot: i * 5 + 1,
      at,
      kind: "purchase",
      wallet: "a",
      quantity: "100",
      quote: {
        paidUnits: "100",
        paymentMint: "SOL",
        paymentDecimals: 0,
        usdPriceMicros: "1000000",
        at,
        source: "simulated",
        evidenceHash: "test",
      },
    });
    events.push({
      signature: "s" + i,
      index: 1,
      slot: i * 5 + 2,
      at: at + 1,
      kind: "airdrop",
      wallet: "a",
      quantity: "5",
    });
    events.push({
      signature: "s" + i,
      index: 2,
      slot: i * 5 + 3,
      at: at + 2,
      kind: "transfer",
      from: "a",
      to: "b",
      quantity: "25",
    });
    events.push({
      signature: "s" + i,
      index: 3,
      slot: i * 5 + 4,
      at: at + 3,
      kind: "sell",
      wallet: "b",
      quantity: "10",
    });
    events.push({
      signature: "s" + i,
      index: 4,
      slot: i * 5 + 5,
      at: at + 4,
      kind: "transfer",
      from: "b",
      to: "outside",
      quantity: "15",
    });
  }
  let replay = new HoldingReplay(c, wallets, 100000);
  for (let offset = 0; offset < events.length; offset += 7) {
    for (const e of events.slice(offset, offset + 7)) replay.push(e);
    replay = new HoldingReplay(
      c,
      wallets,
      100000,
      JSON.parse(JSON.stringify(replay.checkpoint())),
    );
  }
  const a = replay.value(),
    b = replayHolding(c, events, wallets, 100000);
  assert.equal(a.pointMs, b.pointMs);
  assert.equal(a.quantity, b.quantity);
  assert.deepEqual(a.eligibleCredit.toJSON(), b.eligibleCredit.toJSON());
  assert.throws(() => replay.push(events.at(-1)!), /duplicate|order/);
  assert.throws(
    () => new HoldingReplay(c, new Set(["a"]), 100000, replay.checkpoint()),
    /scope/,
  );
});
