import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { join, resolve, sep, basename } from "node:path";
import { tmpdir } from "node:os";
import { readOwnership } from "./ownership-source.mjs";
test("ownership bridge reads the authoritative complete snapshot, validates real X levels and rejects stale coverage", () => {
  const dir = mkdtempSync(join(tmpdir(), "meme-ownership-")),
    file = join(dir, "source.sqlite"),
    db = new DatabaseSync(file),
    now = Date.now();
  const attrs = [
    "cast",
    "fid",
    "follower",
    "holder",
    "luck",
    "minter",
    "neynar",
    "nft",
    "token",
    "volume",
  ];
  try {
    db.exec(
      `CREATE TABLE warplet_market_state(token_id INTEGER PRIMARY KEY,owner_wallet TEXT,owner_checked_at TEXT);CREATE TABLE warplets_metadata(token_id INTEGER PRIMARY KEY,${attrs.map((a) => a + "_level TEXT").join(",")})`,
    );
    const owner = db.prepare("INSERT INTO warplet_market_state VALUES(?,?,?)"),
      meta = db.prepare(
        "INSERT INTO warplets_metadata VALUES(" +
          Array(11).fill("?").join(",") +
          ")",
      );
    db.exec("BEGIN");
    for (let i = 1; i <= 10000; i++) {
      owner.run(i, "0x" + "11".repeat(20), new Date(now - 1000).toISOString());
      meta.run(i, ...attrs.map(() => "7X"));
    }
    db.exec("COMMIT");
    const snapshot = readOwnership(file, now);
    assert.equal(snapshot.ownership.length, 10000);
    assert.equal(snapshot.ownership[0].levels.cast, 7);
    assert.equal(snapshot.sourceAt, now - 1000);
    assert.equal(snapshot.consistency.chainSnapshotVerified, false);
    assert.equal(snapshot.consistency.financialFreezeEligible, false);
    assert.equal(snapshot.consistency.oldestOwnerObservationAt, now - 1000);
    assert.equal(snapshot.checkpoint, readOwnership(file, now).checkpoint);
    db.prepare(
      "UPDATE warplet_market_state SET owner_checked_at=? WHERE token_id=1",
    ).run(new Date(now - 90000000).toISOString());
    assert.throws(() => readOwnership(file, now), /Stale/);
    db.exec("DELETE FROM warplets_metadata WHERE token_id=1");
    assert.throws(() => readOwnership(file, now), /10K/);
  } finally {
    db.close();
    if (
      !resolve(dir).startsWith(resolve(tmpdir()) + sep) ||
      !basename(dir).startsWith("meme-ownership-")
    )
      throw Error("Refusing cleanup outside the test temporary directory");
    rmSync(dir, { recursive: true, force: true });
  }
});
