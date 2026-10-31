import test from "node:test";
import assert from "node:assert/strict";
import { testDb } from "../../../meme/src/worker/testDb";
import { seedData, profile, receipt, finalizeDemoRounds } from "./data";
test("month seed obeys foreign keys, reward conservation, real read contracts and synthetic identities", async () => {
  const t = testDb();
  try {
    const now = Date.parse("2026-10-31T01:00:00Z");
    const result = await seedData(t, now, "active");
    assert.equal(result.markets, 30);
    assert.equal(
      t.raw.prepare("SELECT COUNT(*) n FROM meme_campaigns").get()!.n,
      30,
    );
    assert.equal(
      t.raw.prepare("SELECT COUNT(*) n FROM meme_trading_source_heads").get()!
        .n,
      240,
    );
    assert.equal(t.raw.prepare("PRAGMA foreign_key_check").all().length, 0);
    for (const a of t.raw
      .prepare("SELECT id,total,allocated,reserve FROM meme_allocations")
      .all()) {
      assert.equal(
        BigInt(a.total as string),
        BigInt(a.allocated as string) + BigInt(a.reserve as string),
      );
      const amounts = t.raw
        .prepare("SELECT amount FROM meme_entitlements WHERE allocation_id=?")
        .all(a.id);
      assert.equal(
        amounts.reduce((s, r) => s + BigInt(r.amount as string), 0n),
        BigInt(a.allocated as string),
      );
      assert.equal(amounts.length, 100);
    }
    assert.ok(profile(0).fid >= 2000000000);
    assert.ok(
      (t.raw
        .prepare(
          "SELECT COUNT(*) n FROM qa_trades WHERE payload LIKE '%external-in%'",
        )
        .get()!.n as number) > 0,
    );
    assert.equal(
      t.raw
        .prepare(
          "SELECT COUNT(*) n FROM meme_financial_receipts cl JOIN meme_allocations a ON cl.subject LIKE a.id||':%' WHERE cl.operation='claim' AND NOT EXISTS(SELECT 1 FROM meme_financial_receipts f WHERE f.operation='fund' AND f.subject=a.id)",
        )
        .get()!.n,
      0,
    );
    assert.equal(
      t.raw
        .prepare("SELECT COUNT(*) n FROM meme_votes WHERE fid=? AND round_id=?")
        .get(profile(0).fid, result.roundId)!.n,
      0,
    );
    t.raw
      .prepare("UPDATE meme_rounds SET state='closed' WHERE id=?")
      .run(result.roundId);
    const boundary = Date.parse("2026-10-31T19:30:00Z") + 1;
    finalizeDemoRounds(t, boundary);
    const allocations = t.raw
      .prepare("SELECT COUNT(*) n FROM meme_allocations")
      .get()!.n;
    finalizeDemoRounds(t, boundary);
    assert.equal(
      t.raw.prepare("SELECT COUNT(*) n FROM meme_allocations").get()!.n,
      allocations,
    );
    assert.equal(
      t.raw
        .prepare("SELECT COUNT(*) n FROM meme_allocations WHERE round_id=?")
        .get(result.roundId)!.n,
      10,
    );
    receipt(t, "claim", "demo-id", now);
    receipt(t, "claim", "demo-id", now);
    assert.equal(
      t.raw
        .prepare(
          "SELECT COUNT(*) n FROM meme_financial_receipts WHERE subject='demo-id'",
        )
        .get()!.n,
      1,
    );
  } finally {
    t.close();
  }
});
test("recovery and empty scenarios preserve their disclosed gaps and reset only separate seed state", async () => {
  const t = testDb();
  try {
    await seedData(t, Date.parse("2026-10-31T01:00:00Z"), "recovery");
    assert.equal(
      t.raw.prepare("SELECT COUNT(*) n FROM meme_campaigns").get()!.n,
      28,
    );
    assert.equal(
      t.raw
        .prepare("SELECT COUNT(*) n FROM meme_rounds WHERE state='skipped'")
        .get()!.n,
      2,
    );
    assert.ok(
      (t.raw
        .prepare(
          "SELECT COUNT(*) n FROM meme_allocations a WHERE NOT EXISTS(SELECT 1 FROM meme_financial_receipts f WHERE f.operation='fund' AND f.subject=a.id)",
        )
        .get()!.n as number) > 0,
    );
    assert.equal(t.raw.prepare("PRAGMA foreign_key_check").all().length, 0);
  } finally {
    t.close();
  }
  const empty = testDb();
  try {
    await seedData(empty, Date.parse("2026-10-31T01:00:00Z"), "empty");
    assert.equal(
      empty.raw.prepare("SELECT COUNT(*) n FROM meme_rounds").get()!.n,
      0,
    );
    assert.equal(
      empty.raw.prepare("SELECT COUNT(*) n FROM meme_campaigns").get()!.n,
      0,
    );
  } finally {
    empty.close();
  }
});
