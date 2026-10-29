import { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";
const attributes = [
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
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
/** Canonical Warplets ownership source. Never uses preferred-FID, opt-in or airdrop indexes.
 * A read-only SQLite transaction gives one source snapshot while its writer remains running. */
export function readOwnership(path, now = Date.now()) {
  const db = new DatabaseSync(path, { readOnly: true });
  let records;
  try {
    db.exec("BEGIN");
    records = db
      .prepare(
        `SELECT m.token_id,m.owner_wallet,m.owner_checked_at,${attributes.map((a) => "n." + a + "_level").join(",")} FROM warplet_market_state m JOIN warplets_metadata n ON n.token_id=m.token_id ORDER BY m.token_id`,
      )
      .all();
    db.exec("COMMIT");
  } finally {
    db.close();
  }
  if (records.length !== 10000)
    throw Error("Full 10K ownership/metadata coverage required");
  let sourceAt = now;
  const ownership = records.map((r, i) => {
    if (
      Number(r.token_id) !== i + 1 ||
      !/^0x[0-9a-f]{40}$/i.test(String(r.owner_wallet))
    )
      throw Error("Unresolved or duplicate Warplet owner");
    const checked = Date.parse(String(r.owner_checked_at));
    if (
      !Number.isSafeInteger(checked) ||
      checked > now ||
      checked < now - 86400000
    )
      throw Error("Stale or invalid ownership observation");
    sourceAt = Math.min(sourceAt, checked);
    const levels = {};
    for (const a of attributes) {
      const match = String(r[a + "_level"]).match(
        /^(?:L(?:evel)?\s*)?(10|[1-9])X?$/i,
      );
      if (!match) throw Error("Unresolved Warplet attribute");
      levels[a] = Number(match[1]);
    }
    return {
      tokenId: i + 1,
      wallet: String(r.owner_wallet).toLowerCase(),
      levels,
    };
  });
  return {
    source: "warplets",
    mode: "observed",
    sourceAt,
    checkpoint: hash(JSON.stringify(records)),
    complete: true,
    ownership,
  };
}
