/** Disposable historical read fixture, never imported by application code. */
import type { DatabaseSync } from "node:sqlite";
export function seedReadArchive(raw: DatabaseSync, count = 45, fid = 42) {
  const day = 86400000,
    now = Date.now(),
    start = Math.floor(now / day) * day - (count + 20) * day;
  raw.exec("BEGIN");
  try {
    for (let i = 0; i < count; i++)
      raw
        .prepare(
          "INSERT INTO meme_campaigns VALUES(?,?,?,?,?,?,?,'simulated','SIMULATED read archive')",
        )
        .run(
          "qa-c" + i,
          "qa-mint" + i,
          "QA" + i,
          start + i * day,
          start + (i + 10) * day,
          "900719925474099300",
          0,
        );
    for (let i = 0; i < count + 9; i++) {
      const close = start + (i + 1) * day - 1,
        id = "qa-r" + i;
      raw
        .prepare(
          "INSERT INTO meme_rounds(id,opens_at,closes_at,attribute,state,rules_version,outcome_reason) VALUES(?,?,?,'cast','skipped','local-v1','SIMULATED archive round')",
        )
        .run(id, close - 3600000, close);
      raw
        .prepare(
          "INSERT INTO meme_settlements VALUES(?,?,?,?,?,1,10,10,'finalized','simulated',?,?)",
        )
        .run(
          id,
          close,
          "fixture-input",
          "fixture-result",
          "{}",
          close,
          close + 1,
        );
    }
    for (let i = 0; i < count; i++)
      for (let k = 1; k <= 10; k++) {
        const id = `qa-c${i}:${k}`;
        raw
          .prepare(
            "INSERT INTO meme_allocations VALUES(?,?,?,?,?,?,?,?,?,?,'simulated',NULL)",
          )
          .run(
            id,
            "qa-c" + i,
            k,
            start + (i + k) * day,
            "qa-r" + (i + k - 1),
            "9007199254740993",
            "9007199254740993",
            "0",
            "fixture-input",
            "fixture-result",
          );
        raw
          .prepare(
            "INSERT INTO meme_entitlements VALUES(?,?,1,?,'9007199254740993','finalized_unfunded')",
          )
          .run(id, fid, "1".repeat(32));
      }
    raw.exec("COMMIT");
  } catch (error) {
    raw.exec("ROLLBACK");
    throw error;
  }
}
