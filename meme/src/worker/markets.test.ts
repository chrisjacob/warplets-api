import test from "node:test";
import assert from "node:assert/strict";
import { testDb } from "./testDb";
import {
  registerMarket,
  appendMarketEvidence,
  publishMarket,
  readMarket,
  marketRequest,
  correctMarketEvidence,
} from "./markets";
import { sha } from "./db";
import { canonical } from "../shared/canonical";
import type { MarketDefinition, MarketObservation } from "../shared/markets";
const definition: MarketDefinition = {
  id: "demo",
  symbol: "ATTN",
  ogSymbol: "OG",
  ogMint: "11111111111111111111111111111111",
  attnMint: "So11111111111111111111111111111111111111112",
  pool: null,
  launchedAt: 1000,
  mode: "simulated",
};
const observations: MarketObservation[] = [
  {
    at: 1000,
    observedAt: 3000,
    ogUsd: "1",
    attnOg: "1",
    intervalMs: 1000,
    source: "fixture",
    evidenceHash: "a".repeat(64),
  },
  {
    at: 2000,
    observedAt: 3000,
    ogUsd: "2",
    attnOg: "1.5",
    intervalMs: 1000,
    source: "fixture",
    evidenceHash: "b".repeat(64),
  },
];
test("market imports survive lost responses and public reads use only an immutable published view", async () => {
  const t = testDb();
  try {
    await registerMarket(t.db, definition);
    await registerMarket(t.db, definition);
    await assert.rejects(
      registerMarket(t.db, { ...definition, symbol: "OTHER" }),
      /different terms/,
    );
    t.interruptNextBatch();
    await assert.rejects(
      appendMarketEvidence(t.db, "demo", "batch:1", observations, 3000),
      /lost response/,
    );
    assert.equal(
      (await appendMarketEvidence(t.db, "demo", "batch:1", observations, 3000))
        .replayed,
      true,
    );
    await assert.rejects(
      appendMarketEvidence(t.db, "demo", "batch:1", [observations[0]], 3000),
      /different evidence/,
    );
    const view = await publishMarket(t.db, "demo", "all", 3000);
    assert.equal(view.returns.attn, "200");
    const before = t.queries.length,
      writes = t.raw.prepare("SELECT total_changes() n").get()!.n;
    const read = await readMarket(t.db, "demo", "all");
    assert.equal(read.inputHash, view.inputHash);
    assert.equal(t.raw.prepare("SELECT total_changes() n").get()!.n, writes);
    assert.equal(t.queries.slice(before).length, 1);
    assert(
      !t.queries.slice(before).join().includes("meme_market_observations"),
    );
    assert.throws(
      () => t.raw.exec("UPDATE meme_market_views SET payload='{}'"),
      /immutable/,
    );
    assert.throws(
      () => t.raw.exec("DELETE FROM meme_market_observations"),
      /immutable/,
    );
    await assert.rejects(
      marketRequest(
        t.db,
        new Request("http://localhost/api/meme/markets/demo?window=no"),
      ),
      /Invalid window/,
    );
  } finally {
    t.close();
  }
});
test("malformed and future/prelaunch evidence, unknown mints and unauthorized mutation stay blocked", async () => {
  const t = testDb();
  try {
    await registerMarket(t.db, definition);
    for (const change of [
      { ogUsd: "0" },
      { attnOg: "-1" },
      { at: 0 },
      { observedAt: 100000 },
      { evidenceHash: "not-evidence" },
    ])
      await assert.rejects(
        appendMarketEvidence(
          t.db,
          "demo",
          "bad",
          [{ ...observations[0], ...change }],
          3000,
        ),
      );
    await assert.rejects(
      marketRequest(
        t.db,
        new Request("http://localhost/api/meme/operator/markets", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ action: "register", market: definition }),
        }),
      ),
      /Operator token/,
    );
    assert.equal(
      t.raw.prepare("SELECT COUNT(*) n FROM meme_market_observations").get()!.n,
      0,
    );
  } finally {
    t.close();
  }
});
test("contradictory prices require an explicit append-only correction and cannot rewrite a published card input", async () => {
  const t = testDb();
  try {
    await registerMarket(t.db, definition);
    await appendMarketEvidence(t.db, "demo", "original", observations, 3000);
    const original = await publishMarket(t.db, "demo", "all", 3000);
    const changed = {
      ...observations[1],
      attnOg: "2",
      observedAt: 4000,
      evidenceHash: "c".repeat(64),
    };
    await appendMarketEvidence(t.db, "demo", "later", [changed], 4000);
    await assert.rejects(
      publishMarket(t.db, "demo", "all", 4000),
      /explicit correction/,
    );
    const oldId = await sha("demo:" + canonical(observations[1])),
      newId = await sha("demo:" + canonical(changed));
    t.interruptNextBatch();
    await assert.rejects(
      correctMarketEvidence(
        t.db,
        "review:1",
        oldId,
        newId,
        "Corrected source quote",
      ),
      /lost response/,
    );
    assert.equal(
      (
        await correctMarketEvidence(
          t.db,
          "review:1",
          oldId,
          newId,
          "Corrected source quote",
        )
      ).replayed,
      true,
    );
    await assert.rejects(
      correctMarketEvidence(t.db, "cycle", newId, oldId, "Reject cycle"),
      /Invalid market correction/,
    );
    const corrected = await publishMarket(t.db, "demo", "all", 4000);
    assert.equal(corrected.returns.attn, "300");
    assert.notEqual(corrected.inputHash, original.inputHash);
    assert.equal(
      JSON.parse(
        t.raw
          .prepare("SELECT payload FROM meme_market_views WHERE input_hash=?")
          .get(original.inputHash)!.payload as string,
      ).returns.attn,
      "200",
    );
  } finally {
    t.close();
  }
});
