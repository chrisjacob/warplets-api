import test from "node:test";
import assert from "node:assert/strict";
import { testDb } from "./testDb";
import { recordCampaign, importLedger, holdingForRound } from "./holding";
import { verifyReceipt, type Receipt } from "./receipts";
import { encode58 } from "../shared/base58";
import { DAY_MS } from "../shared/rules";
import type { LedgerEvent, Campaign } from "../shared/holding";
const wallet = encode58(new Uint8Array(32).fill(3)),
  mint = encode58(new Uint8Array(32).fill(4)),
  payment = encode58(new Uint8Array(32).fill(5)),
  signature = encode58(new Uint8Array(64).fill(6));
async function setup() {
  const t = testDb(),
    now = Math.floor(Date.now() / 1000) * 1000,
    launch = now - 2 * DAY_MS;
  await recordCampaign(t.db, {
    id: "c",
    mint,
    symbol: "C",
    launchedAt: launch,
    totalSupply: "1000000000",
    decimals: 6,
    mode: "simulated",
    launchEvidence: "Explicit simulated edition",
  });
  t.raw
    .prepare(
      "INSERT INTO meme_rounds(id,opens_at,closes_at,attribute,state,rules_version) VALUES('r',?,?,'cast','closed','local-v1')",
    )
    .run(launch, now - 1000);
  t.raw
    .prepare("INSERT INTO meme_candidates VALUES('r','a','A','A',?,'Reviewed')")
    .run(mint);
  t.raw
    .prepare("INSERT INTO meme_votes VALUES('r',42,'a',?,?,?,'scope')")
    .run(launch + 1, launch + 1, wallet);
  t.raw.prepare("INSERT INTO meme_vote_wallets VALUES('r',42,?)").run(wallet);
  const event: LedgerEvent = {
    signature,
    index: 0,
    slot: 1,
    at: launch,
    kind: "purchase",
    quantity: "1000",
    wallet,
    quote: {
      paidUnits: "100000000",
      paymentMint: payment,
      paymentDecimals: 6,
      usdPriceMicros: "1000000",
      at: launch,
      source: "simulated quote",
      evidenceHash: "11".repeat(32),
    },
  };
  const batch = {
    campaignId: "c",
    mode: "simulated",
    scopeWallets: [wallet],
    events: [event],
    throughAt: now - 1000,
    throughSlot: 1,
    source: "local-fixture",
    cursor: "page-1",
    complete: true,
    fromMint: true,
  };
  return { ...t, now, launch, event, batch };
}
test("ledger import replays without duplicates, seals scope coverage and supplies an exact 5x holding boost", async () => {
  const t = await setup();
  try {
    let h = await holdingForRound(t.db, "r", t.now - 1000);
    assert.equal(h.complete, false);
    const imported = await importLedger(t.db, t.batch);
    assert.equal(imported.imported, 1);
    assert.equal((await importLedger(t.db, t.batch)).imported, 0);
    h = await holdingForRound(t.db, "r", t.now - 1000);
    assert.equal(h.complete, true);
    assert.equal(h.units.get(42), 50000n);
    assert.equal(
      t.raw.prepare("SELECT COUNT(*) n FROM meme_ledger_events").get()?.n,
      1,
    );
    await assert.rejects(
      importLedger(t.db, {
        ...t.batch,
        events: [{ ...t.event, quantity: "2000" }],
      }),
      /changed/,
    );
    assert.throws(
      () => t.raw.prepare("UPDATE meme_ledger_events SET payload='{}'").run(),
      /immutable/,
    );
  } finally {
    t.close();
  }
});
test("missing price evidence and late events cannot advance or rewrite a completed checkpoint", async () => {
  const t = await setup();
  try {
    await assert.rejects(
      importLedger(t.db, {
        ...t.batch,
        events: [{ ...t.event, quote: undefined }],
      }),
      /quote/,
    );
    assert.equal(
      t.raw.prepare("SELECT COUNT(*) n FROM meme_ledger_checkpoints").get()?.n,
      0,
    );
    await importLedger(t.db, t.batch);
    const { quote: omitted, ...baseEvent } = t.event;
    const late = {
      ...baseEvent,
      signature: encode58(new Uint8Array(64).fill(9)),
      at: t.launch + 1000,
      slot: 2,
      kind: "airdrop",
    } as LedgerEvent;
    await assert.rejects(
      importLedger(t.db, { ...t.batch, throughSlot: 2, events: [late] }),
      /Late event/,
    );
    await assert.rejects(
      importLedger(t.db, { ...t.batch, throughAt: t.now - 2000, events: [] }),
      /backwards/,
    );
  } finally {
    t.close();
  }
});
test("observed acquisition verification reconciles finalized receipt time, net token units and payment", () => {
  const c: Campaign = {
    id: "c",
    mint,
    symbol: "C",
    launchedAt: 1000,
    endsAt: 100000,
    totalSupply: "10000",
    decimals: 6,
    mode: "observed",
  };
  const e: LedgerEvent = {
    signature,
    index: 0,
    slot: 100,
    at: 2000,
    kind: "purchase",
    quantity: "500",
    wallet,
    quote: {
      paidUnits: "100",
      paymentMint: payment,
      paymentDecimals: 6,
      usdPriceMicros: "1000000",
      at: 2000,
      source: "quote",
      evidenceHash: "11".repeat(32),
    },
  };
  const receipt: Receipt = {
    slot: 100,
    blockTime: 2,
    meta: {
      err: null,
      fee: 5000,
      preBalances: [10000],
      postBalances: [5000],
      preTokenBalances: [
        { owner: wallet, mint: payment, uiTokenAmount: { amount: "100" } },
      ],
      postTokenBalances: [
        { owner: wallet, mint, uiTokenAmount: { amount: "500" } },
      ],
    },
    transaction: { message: { accountKeys: [wallet] } },
  };
  assert.doesNotThrow(() => verifyReceipt(e, c, receipt));
  assert.throws(
    () => verifyReceipt({ ...e, quantity: "501" }, c, receipt),
    /reconcile/,
  );
  assert.throws(() => verifyReceipt(e, c, { ...receipt, slot: 99 }), /slot/);
  assert.throws(
    () =>
      verifyReceipt(e, c, {
        ...receipt,
        meta: { ...receipt.meta!, err: { failed: true } },
      }),
    /failed/,
  );
});
