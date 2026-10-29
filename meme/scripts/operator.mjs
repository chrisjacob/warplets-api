import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes, createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
const root = resolve(dirname(fileURLToPath(import.meta.url)), ".."),
  state = resolve(root, ".wrangler");
mkdirSync(state, { recursive: true });
const tokenFile = resolve(state, "operator-token");
const [command, ...args] = process.argv.slice(2),
  hash = (v) => createHash("sha256").update(v).digest("hex");
async function send(path, body) {
  if (!path.startsWith("/api/meme/operator/"))
    throw Error("Operator route required");
  if (!existsSync(tokenFile)) throw Error("Run operator init first");
  const r = await fetch("http://127.0.0.1:8797" + path, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: "http://127.0.0.1:8797",
      authorization: "Bearer " + readFileSync(tokenFile, "utf8").trim(),
    },
    body: JSON.stringify(body),
  });
  const result = await r.json();
  if (!r.ok) throw Error(result.error ?? "Operator request failed");
  return result;
}
if (command === "init") {
  if (existsSync(tokenFile)) {
    console.log("Operator token already exists at " + tokenFile);
  } else {
    const token = randomBytes(32).toString("hex");
    const r = spawnSync(
      process.execPath,
      [
        resolve(root, "node_modules/wrangler/bin/wrangler.js"),
        "d1",
        "execute",
        "meme-local",
        "--local",
        "--persist-to",
        ".wrangler/state",
        "--command",
        `INSERT INTO meme_operator_tokens VALUES('${hash(token)}','local operator',${Date.now()})`,
        "--json",
      ],
      { cwd: root, encoding: "utf8", windowsHide: true },
    );
    if (r.status !== 0)
      throw Error("Apply local migrations first; operator registration failed");
    writeFileSync(tokenFile, token, { mode: 0o600 });
    console.log(
      "Registered local operator. Token saved outside Git: " + tokenFile,
    );
  }
} else if (command === "request") {
  console.log(
    JSON.stringify(
      await send(args[0], JSON.parse(readFileSync(resolve(args[1]), "utf8"))),
      null,
      2,
    ),
  );
} else if (command === "demo") {
  const current = await (
    await fetch("http://127.0.0.1:8797/api/meme/state")
  ).json();
  if (current.round) {
    console.log("Existing round retained: " + current.round.id);
  } else {
    const now = Date.now(),
      id = "local-" + new Date(now).toISOString().slice(0, 10);
    console.log(
      await send("/api/meme/operator/rounds", {
        id,
        opensAt: now + 10000,
        closesAt: now + 3600000,
        attribute: "cast",
        candidates: [
          {
            id: "orbit",
            name: "Orbit",
            symbol: "ORBIT",
            ogMint: "1".repeat(32),
            evidence:
              "SIMULATED LOCAL CANDIDATE: no launch or screening verdict implied.",
          },
        ],
      }),
    );
    console.log(
      await send(`/api/meme/operator/rounds/${id}/freeze`, {
        source: "warplets",
        mode: "simulated",
        sourceAt: now,
        checkpoint: "local-empty-ownership-demo",
        complete: true,
        ownership: [],
      }),
    );
    console.log(
      "Simulated round opens in ten seconds; no financial actions are enabled.",
    );
  }
} else if (command === "ownership-export") {
  if (!args[0]) throw Error("Provide the existing Warplets SQLite path");
  const db = new DatabaseSync(resolve(args[0]), { readOnly: true });
  db.exec("BEGIN");
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
  const rows = db
    .prepare(
      `SELECT m.token_id,m.owner_wallet,m.owner_checked_at,${attributes.map((a) => "n." + a + "_level").join(",")} FROM warplet_market_state m JOIN warplets_metadata n ON n.token_id=m.token_id ORDER BY m.token_id`,
    )
    .all();
  db.exec("COMMIT");
  db.close();
  if (rows.length !== 10000)
    throw Error("Full 10K ownership/metadata coverage required");
  let sourceAt = Date.now();
  const ownership = rows.map((row) => {
    if (!/^0x[0-9a-f]{40}$/i.test(String(row.owner_wallet)))
      throw Error("Unresolved owner for " + row.token_id);
    const checked = Date.parse(String(row.owner_checked_at));
    if (!Number.isSafeInteger(checked) || checked > Date.now())
      throw Error("Invalid ownership observation time");
    sourceAt = Math.min(sourceAt, checked);
    const levels = {};
    for (const attribute of attributes) {
      const level = Number(String(row[attribute + "_level"]).match(/\d+/)?.[0]);
      if (!Number.isInteger(level) || level < 1 || level > 10)
        throw Error("Unresolved attribute: " + row.token_id);
      levels[attribute] = level;
    }
    return {
      tokenId: Number(row.token_id),
      wallet: String(row.owner_wallet).toLowerCase(),
      levels,
    };
  });
  const evidence = {
    source: "warplets",
    mode: "observed",
    sourceAt,
    checkpoint: hash(JSON.stringify(rows)),
    complete: true,
    ownership,
  };
  const output = resolve(state, "ownership-source.json");
  writeFileSync(output, JSON.stringify(evidence));
  console.log(
    JSON.stringify({
      file: output,
      tokens: ownership.length,
      sourceAt,
      sha256: hash(JSON.stringify(evidence)),
    }),
  );
} else
  throw Error(
    "Commands: init | demo | request <operator-route> <json-file> | ownership-export <warplets-sqlite-path>",
  );
