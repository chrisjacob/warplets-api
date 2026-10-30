import test from "node:test";
import assert from "node:assert/strict";
import { testDb } from "./testDb";
import { registerMarket } from "./markets";
import { importTrading, publishTrading, readTrading } from "./trading";
import { encode58 } from "../shared/base58";
import type { TraderEvidence } from "../shared/trading";
const wallet = encode58(new Uint8Array(32).fill(1)),
  og = encode58(new Uint8Array(32).fill(2)),
  signature = encode58(new Uint8Array(64).fill(3));
const source: TraderEvidence = {
  version: 1,
  fid: 42,
  wallets: [wallet],
  verifiedAt: 0,
  throughAt: 10000,
  complete: true,
  gaps: [],
  sourceHash: "a".repeat(64),
  mode: "simulated",
  markets: [{ id: "m", attnMint: wallet, ogMint: og }],
  events: [
    {
      id: "buy",
      at: 1000,
      slot: 1,
      index: 0,
      wallet,
      marketId: "m",
      kind: "buy",
      quantity: "10",
      usd: "10",
      og: "20",
      feeUsd: "0",
      feeOg: "0",
      signature,
      evidenceHash: "a".repeat(64),
      finalized: true,
    },
    {
      id: "sell",
      at: 2000,
      slot: 2,
      index: 1,
      wallet,
      marketId: "m",
      kind: "sell",
      quantity: "5",
      usd: "20",
      og: "40",
      feeUsd: "1",
      feeOg: "2",
      signature,
      evidenceHash: "b".repeat(64),
      finalized: true,
    },
  ],
};
test("projection publication resumes after its committed response is lost and refuses a different cohort time", async () => {
  const t = testDb();
  try {
    await registerMarket(t.db, {
      id: "m",
      symbol: "ATTN",
      ogSymbol: "OG",
      attnMint: wallet,
      ogMint: og,
      pool: null,
      launchedAt: 0,
      mode: "simulated",
    });
    let batches = 0;
    const interrupted: Pick<D1Database, "prepare" | "batch"> = {
      prepare: t.db.prepare,
      batch: async <T = unknown>(statements: D1PreparedStatement[]) => {
        if (++batches === 2) t.interruptNextBatch();
        return t.db.batch<T>(statements);
      },
    };
    await assert.rejects(
      importTrading(
        interrupted,
        source,
        null,
        "Interrupted projection fixture",
        10000,
      ),
      /lost response/,
    );
    assert.equal(
      (
        await importTrading(
          t.db,
          source,
          null,
          "Interrupted projection fixture",
          10000,
        )
      ).replayed,
      true,
    );
    t.queries.length = 0;
    await publishTrading(t.db, 10000, 10000);
    assert(!t.queries.some((q) => q.includes("SELECT s.id,s.payload")));
    assert.equal((await readTrading(t.db, "all"))!.items[0].pnlUsd, "14");
    await assert.rejects(
      publishTrading(t.db, 9000, 10000),
      /matching complete coverage/,
    );
    assert.throws(
      () => t.raw.exec("DELETE FROM meme_trading_projections"),
      /Immutable/,
    );
  } finally {
    t.close();
  }
});
test("trading source corrections and snapshots recover lost responses; public reads never replay ledger history", async () => {
  const t = testDb();
  try {
    await registerMarket(t.db, {
      id: "m",
      symbol: "ATTN",
      ogSymbol: "OG",
      attnMint: wallet,
      ogMint: og,
      pool: null,
      launchedAt: 0,
      mode: "simulated",
    });
    t.interruptNextBatch();
    await assert.rejects(
      importTrading(t.db, source, null, "Fixture source", 10000),
      /lost response/,
    );
    const first = await importTrading(
      t.db,
      source,
      null,
      "Fixture source",
      10000,
    );
    assert.equal(first.replayed, true);
    await publishTrading(t.db, 10000, 10000);
    const before = t.queries.length;
    const board = await readTrading(t.db, "all");
    assert.equal(t.queries.length - before, 1);
    assert.equal(board!.items[0].pnlUsd, "14");
    assert.equal(board!.mode, "simulated");
    await assert.rejects(
      importTrading(
        t.db,
        { ...source, complete: false },
        first.id,
        "Invalid incomplete correction",
        10000,
      ),
      /coverage/,
    );
    await assert.rejects(
      importTrading(
        t.db,
        { ...source, throughAt: 11000 },
        null,
        "Stale source update",
        11000,
      ),
      /parent/,
    );
    const corrected = {
      ...source,
      throughAt: 11000,
      events: source.events.map((e) =>
        e.id === "sell" ? { ...e, usd: "10" } : e,
      ),
    };
    await importTrading(
      t.db,
      corrected,
      first.id,
      "Correct historical price evidence",
      11000,
    );
    assert.equal((await readTrading(t.db, "all"))!.items[0].pnlUsd, "14");
    await publishTrading(t.db, 11000, 11000);
    assert.equal((await readTrading(t.db, "all"))!.items[0].pnlUsd, "4");
    assert.throws(
      () => t.raw.exec("DELETE FROM meme_trading_boards"),
      /Immutable/,
    );
    assert.throws(
      () => t.raw.exec("UPDATE meme_trading_sources SET reason='changed'"),
      /Immutable/,
    );
    await assert.rejects(publishTrading(t.db, 12000, 12000), /coverage/);
  } finally {
    t.close();
  }
});
test("multiple public identities cannot count one wallet and observed sources need actual proof links", async () => {
  const t = testDb();
  try {
    await registerMarket(t.db, {
      id: "m",
      symbol: "ATTN",
      ogSymbol: "OG",
      attnMint: wallet,
      ogMint: og,
      pool: null,
      launchedAt: 0,
      mode: "simulated",
    });
    await importTrading(t.db, source, null, "Fixture source", 10000);
    await importTrading(
      t.db,
      { ...source, fid: 43 },
      null,
      "Second fixture identity",
      10000,
    );
    await assert.rejects(
      publishTrading(t.db, 10000, 10000),
      /multiple identities/,
    );
    await registerMarket(t.db, {
      id: "live",
      symbol: "ATTN",
      ogSymbol: "OG",
      attnMint: wallet,
      ogMint: og,
      pool: null,
      launchedAt: 0,
      mode: "observed",
    });
    await assert.rejects(
      importTrading(
        t.db,
        {
          ...source,
          fid: 44,
          mode: "observed",
          markets: [{ ...source.markets[0], id: "live" }],
          events: source.events.map((e) => ({ ...e, marketId: "live" })),
        },
        null,
        "Unproven live identity",
        10000,
      ),
      /verified wallet/,
    );
  } finally {
    t.close();
  }
});
