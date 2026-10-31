import test from "node:test";
import assert from "node:assert/strict";
import { testDb } from "./testDb";
import { createCard, attachCardImage, sharesRequest } from "./shares";
import { registerMarket, appendMarketEvidence, publishMarket } from "./markets";
test("share text derives only from immutable published evidence; incomplete cards cannot enter lookup", async () => {
  const t = testDb();
  try {
    const now = Date.now();
    await registerMarket(t.db, {
      id: "m",
      symbol: "ATTN",
      ogSymbol: "OG",
      ogMint: "11111111111111111111111111111111",
      attnMint: "So11111111111111111111111111111111111111112",
      pool: null,
      launchedAt: now - 10000,
      mode: "simulated",
    });
    await assert.rejects(
      createCard(t.db, "performance", "m", "24h", null, now),
      /Fresh/,
    );
    await appendMarketEvidence(
      t.db,
      "m",
      "batch",
      [0, 1].map((i) => ({
        at: now - 1000 + i * 1000,
        observedAt: now,
        ogUsd: "1",
        attnOg: i ? "0.5" : "1",
        intervalMs: 1000,
        source: "fixture",
        evidenceHash: (i ? "b" : "a").repeat(64),
      })),
      now,
    );
    await publishMarket(t.db, "m", "24h", now);
    const card = await createCard(t.db, "performance", "m", "24h", null, now);
    assert(card.lines[0].includes("-50.00%"));
    assert.equal(
      new URL(card.targetPath, "http://localhost").searchParams.get(
        "marketWindow",
      ),
      "24h",
    );
    await publishMarket(t.db, "m", "30d", now);
    const monthly = await createCard(
      t.db,
      "performance",
      "m",
      "30d",
      null,
      now,
    );
    assert.equal(
      new URL(monthly.targetPath, "http://localhost").searchParams.get(
        "marketWindow",
      ),
      "30d",
    );
    assert.equal(
      (await createCard(t.db, "performance", "m", "24h", null, now)).id,
      card.id,
    );
    const response = await sharesRequest(
      t.db,
      new Request(
        "http://localhost/api/meme/shares?kind=performance&subject=m&window=24h",
      ),
    );
    assert.equal(((await response!.json()) as { card: unknown }).card, null);
    await assert.rejects(attachCardImage(t.db, card.id, "mini", "AAAA"), /PNG/);
    assert.throws(
      () => t.raw.exec("UPDATE meme_share_cards SET payload='{}'"),
      /Immutable/,
    );
    await assert.rejects(
      createCard(t.db, "candidate", "m", "24h", null, now),
      /edition state/,
    );
  } finally {
    t.close();
  }
});
