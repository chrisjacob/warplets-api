import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { testDb } from "./testDb";
import { historyPage, rewardsPage, readPagesRequest } from "./readPages";
import { state } from "./rounds";
import { sha } from "./db";
const origin = "http://localhost:8797",
  day = 86400000;
async function archive(count = 65) {
  const t = testDb(),
    base = Date.now() - day,
    start = base - (count + 10) * day;
  t.raw
    .prepare("INSERT INTO meme_sessions VALUES(?,?,?,?,?)")
    .run(await sha("reader"), origin, 42, null, Date.now() + 60000);
  t.raw
    .prepare("INSERT INTO meme_sessions VALUES(?,?,?,?,?)")
    .run(await sha("other"), origin, 43, null, Date.now() + 60000);
  for (let i = 0; i < count; i++)
    t.raw
      .prepare(
        "INSERT INTO meme_campaigns VALUES(?,?,?,?,?,?,?,'simulated','read-only fixture')",
      )
      .run(
        "c" + i,
        "mint" + i,
        "TOK" + i,
        start + i * day,
        start + (i + 10) * day,
        "900719925474099300",
        0,
      );
  for (let i = 0; i < count + 9; i++) {
    const close = start + (i + 1) * day - 1;
    t.raw
      .prepare(
        "INSERT INTO meme_rounds(id,opens_at,closes_at,attribute,state,rules_version,outcome_reason) VALUES(?,?,?,'cast','skipped','local-v1','Read fixture')",
      )
      .run("r" + i, close - 3600000, close);
    t.raw
      .prepare(
        "INSERT INTO meme_settlements VALUES(?,?,?,?,?,1,10,10,'finalized','simulated',?,?)",
      )
      .run("r" + i, close, "input", "result", "{}", close, close + 1);
  }
  for (let i = 0; i < count; i++)
    for (let k = 1; k <= 10; k++) {
      const id = `c${i}:${k}`;
      t.raw
        .prepare(
          "INSERT INTO meme_allocations VALUES(?,?,?,?,?,?,?,?,?,?,'simulated',NULL)",
        )
        .run(
          id,
          "c" + i,
          k,
          start + (i + k) * day,
          "r" + (i + k - 1),
          "9007199254740993",
          "9007199254740993",
          "0",
          "input",
          "result",
        );
      t.raw
        .prepare(
          "INSERT INTO meme_entitlements VALUES(?,42,1,?,'9007199254740993','finalized_unfunded')",
        )
        .run(id, "1".repeat(32));
    }
  return t;
}
function request(path: string, token = "reader") {
  return new Request(origin + path, {
    headers: { cookie: "meme_session=" + token },
  });
}
test("history keyset pages reach beyond 30 rounds; compact polling avoids lifetime rewards/history reads", async () => {
  const t = await archive();
  try {
    let cursor: string | null = null;
    const ids: string[] = [];
    do {
      const p = await historyPage(
        t.db,
        request(
          "/api/meme/history?limit=7" + (cursor ? "&cursor=" + cursor : ""),
        ),
      );
      ids.push(...p.items.map((r) => r.id));
      cursor = p.nextCursor;
    } while (cursor);
    assert.equal(ids.length, 74);
    assert.equal(new Set(ids).size, 74);
    const old = await state(t.db, request("/api/meme/state"));
    assert.equal(old.history.length, 30);
    assert.equal(old.entitlements.length, 650);
    const writes = t.raw.prepare("SELECT total_changes() n").get()!.n;
    t.queries.length = 0;
    const compact = await state(t.db, request("/api/meme/state?view=today"));
    assert.deepEqual(compact.history, []);
    assert.deepEqual(compact.entitlements, []);
    assert(
      !t.queries.some((q) =>
        /FROM meme_entitlements|ORDER BY r.closes_at DESC LIMIT 30/.test(q),
      ),
    );
    assert.equal(t.raw.prepare("SELECT total_changes() n").get()!.n, writes);
    assert(JSON.stringify(compact).length < JSON.stringify(old).length / 10);
  } finally {
    t.close();
  }
});
test("rewards page by complete campaign, preserve exact amounts and isolate the authenticated FID", async () => {
  const t = await archive();
  try {
    const writes = t.raw.prepare("SELECT total_changes() n").get()!.n;
    let cursor: string | null = null;
    const ids: string[] = [];
    do {
      const p = await rewardsPage(
        t.db,
        request(
          "/api/meme/rewards?limit=3" + (cursor ? "&cursor=" + cursor : ""),
        ),
      );
      assert.equal(p.viewerFid, 42);
      assert.equal(p.claimable, false);
      assert(p.items.length <= 3);
      for (const c of p.items) {
        ids.push(c.id);
        assert.equal(c.rewards.length, 10);
        assert.equal(
          c.rewards.reduce((n, r) => n + BigInt(r.amount), 0n),
          90071992547409930n,
        );
        assert(c.rewards.every((r) => r.claimable === false));
      }
      if (!cursor && p.nextCursor)
        await assert.rejects(
          rewardsPage(
            t.db,
            request("/api/meme/rewards?cursor=" + p.nextCursor, "other"),
          ),
          /cursor/,
        );
      cursor = p.nextCursor;
    } while (cursor);
    assert.equal(ids.length, 65);
    assert.equal(new Set(ids).size, 65);
    assert.deepEqual(
      (await rewardsPage(t.db, request("/api/meme/rewards", "other"))).items,
      [],
    );
    await assert.rejects(
      rewardsPage(t.db, request("/api/meme/rewards", "anonymous")),
      /Connect Farcaster/,
    );
    const sql = t.queries.find((q) => q.startsWith("SELECT i.campaign_id"))!;
    const plan = t.raw
      .prepare("EXPLAIN QUERY PLAN " + sql)
      .all(42, Date.now(), Date.now(), 4);
    assert(
      plan.some((row) =>
        String(row.detail).includes("meme_reward_campaign_page"),
      ),
    );
    assert.equal(t.raw.prepare("SELECT total_changes() n").get()!.n, writes);
    assert(
      !t.queries.some((q) =>
        /FROM meme_ledger_events|FROM meme_version_events/.test(q),
      ),
    );
  } finally {
    t.close();
  }
});
test("invalid cursors, oversized/duplicate parameters and mutations fail closed", async () => {
  const t = await archive(1);
  try {
    for (const query of [
      "limit=0",
      "limit=21",
      "limit=1.5",
      "limit=1&limit=2",
      "fid=43",
      "cursor=",
      "cursor=bad",
      "cursor=" + "a".repeat(769),
    ])
      await assert.rejects(
        historyPage(t.db, request("/api/meme/history?" + query)),
        /page|Page/,
      );
    const p = await historyPage(t.db, request("/api/meme/history?limit=1"));
    await assert.rejects(
      rewardsPage(t.db, request("/api/meme/rewards?cursor=" + p.nextCursor)),
      /cursor/,
    );
    await assert.rejects(
      readPagesRequest(
        t.db,
        new Request(origin + "/api/meme/rewards", { method: "POST" }),
      ),
      /Method/,
    );
  } finally {
    t.close();
  }
});
test("additive reward index migration backfills existing immutable entitlements and follows new ones", async () => {
  const t = await archive(2);
  try {
    const before = t.raw
      .prepare("SELECT amount FROM meme_entitlements ORDER BY allocation_id")
      .all();
    t.raw.exec(
      "DROP TRIGGER meme_entitlement_read_index; DROP TABLE meme_reward_campaign_index; DROP INDEX meme_round_history_page;",
    );
    t.raw.exec(
      readFileSync(
        resolve(
          import.meta.dirname,
          "../../migrations/0014_reward_read_index.sql",
        ),
        "utf8",
      ),
    );
    assert.equal(
      t.raw.prepare("SELECT COUNT(*) n FROM meme_reward_campaign_index").get()!
        .n,
      2,
    );
    assert.deepEqual(
      t.raw
        .prepare("SELECT amount FROM meme_entitlements ORDER BY allocation_id")
        .all(),
      before,
    );
    assert.equal(t.raw.prepare("PRAGMA foreign_key_check").all().length, 0);
  } finally {
    t.close();
  }
});
