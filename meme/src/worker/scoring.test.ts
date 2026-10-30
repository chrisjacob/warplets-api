import test from "node:test";
import assert from "node:assert/strict";
import { testDb } from "./testDb";
import { scoreRound } from "./scoring";
import { round } from "./rounds";
import { DAY_MS } from "../shared/rules";
test("an incomplete ownership import is not an offered round and cannot reset a participation streak", async () => {
  const t = testDb(),
    close = Date.now() - 1000;
  try {
    for (const [id, days, ready] of [
      ["prior", 2, true],
      ["gap", 1, false],
      ["current", 0, true],
    ] as const) {
      const cutoff = close - days * DAY_MS;
      t.raw
        .prepare(
          "INSERT INTO meme_rounds(id,opens_at,closes_at,attribute,state,snapshot_id,rules_version) VALUES(?,?,?,'cast','closed',?,'local-v1')",
        )
        .run(id, cutoff - DAY_MS, cutoff, id);
      t.raw
        .prepare(
          "INSERT INTO meme_ownership_snapshots VALUES(?,?,'warplets','simulated',?,?,0,?,'{}')",
        )
        .run(
          id,
          id,
          cutoff - DAY_MS,
          cutoff - DAY_MS,
          ready ? "ready" : "importing",
        );
      t.raw
        .prepare(
          "INSERT INTO meme_candidates VALUES(?,'a','A','A',?,'Simulated')",
        )
        .run(id, "1".repeat(32));
      if (ready)
        t.raw
          .prepare(
            "INSERT INTO meme_votes(round_id,fid,candidate_id,first_valid_at,updated_at,reward_wallet) VALUES(?,42,'a',?,?,?)",
          )
          .run(id, cutoff - 1, cutoff - 1, "1".repeat(32));
    }
    const r = await round(t.db, "current");
    assert.equal((await scoreRound(t.db, r, 42)).view.boost?.streak, "0.2");
    t.raw
      .prepare(
        "UPDATE meme_ownership_snapshots SET state='ready' WHERE id='gap'",
      )
      .run();
    assert.equal((await scoreRound(t.db, r, 42)).view.boost?.streak, "0.1");
  } finally {
    t.close();
  }
});
