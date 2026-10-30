import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes, createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { readOwnership } from "./ownership-source.mjs";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const target = process.env.MEME_OPERATOR_TARGET ?? "preview";
if (!["preview", "restricted-qa"].includes(target))
  throw Error("Unknown local operator target");
const persistence =
  target === "restricted-qa"
    ? ".wrangler/restricted-qa-state"
    : ".wrangler/state";
const state = resolve(
  root,
  target === "restricted-qa" ? ".wrangler/restricted-qa-operator" : ".wrangler",
);
const apiOrigin =
  target === "restricted-qa"
    ? "http://127.0.0.1:8799"
    : "http://127.0.0.1:8797";
mkdirSync(state, { recursive: true });
const tokenFile = resolve(state, "operator-token");
const [command, ...args] = process.argv.slice(2),
  hash = (v) => createHash("sha256").update(v).digest("hex");
async function send(path, body) {
  if (!path.startsWith("/api/meme/operator/"))
    throw Error("Operator route required");
  if (!existsSync(tokenFile)) throw Error("Run operator init first");
  const r = await fetch(apiOrigin + path, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: apiOrigin,
      authorization: "Bearer " + readFileSync(tokenFile, "utf8").trim(),
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(60000),
    redirect: "manual",
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
        persistence,
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
} else if (command === "settle") {
  if (!args[0]) throw Error("Provide the closed round ID");
  for (let page = 0; page < 1000; page++) {
    const result = await send(
      `/api/meme/operator/rounds/${encodeURIComponent(args[0])}/settle`,
      {},
    );
    console.log(
      JSON.stringify({
        state: result.state,
        progress: result.progress,
        inputHash: result.inputHash,
        resultHash: result.resultHash,
      }),
    );
    if (result.state === "finalized") break;
    if (page === 999) throw Error("Page limit reached; rerun to resume");
  }
} else if (command === "collect") {
  if (!args[0]) throw Error("Provide the persisted source run ID");
  for (let page = 0; page < 10000; page++) {
    const result = await send("/api/meme/operator/sources/step", {
      id: args[0],
    });
    console.log(JSON.stringify(result));
    if (result.state === "ready") break;
    if (page === 9999) throw Error("Page limit reached; rerun to resume");
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
} else if (command === "demo") {
  const current = await (await fetch(apiOrigin + "/api/meme/state")).json();
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
        simulated: true,
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
} else if (command === "ownership-export" || command === "ownership-freeze") {
  if (!args[0]) throw Error("Provide the authoritative Warplets SQLite path");
  const evidence = readOwnership(resolve(args[0]));
  if (command === "ownership-freeze") {
    if (!args[1]) throw Error("Provide the prepared round ID");
    console.log(
      await send(
        "/api/meme/operator/rounds/" + encodeURIComponent(args[1]) + "/freeze",
        evidence,
      ),
    );
  } else {
    const output = resolve(state, "ownership-source.json");
    writeFileSync(output, JSON.stringify(evidence));
    console.log(
      JSON.stringify({
        file: output,
        tokens: evidence.ownership.length,
        sourceAt: evidence.sourceAt,
        sha256: hash(JSON.stringify(evidence)),
      }),
    );
  }
} else if (command === "tick" || command === "run") {
  const once = command === "tick";
  do {
    const result = await send("/api/meme/operator/operations/tick", {});
    console.log(JSON.stringify(result));
    if (args[0]) {
      const response = await fetch("http://127.0.0.1:8797/api/meme/state", {
        signal: AbortSignal.timeout(15000),
      });
      if (!response.ok) throw Error("Local round state unavailable");
      const { round } = await response.json();
      if (round?.state === "prepared" && Date.now() < round.opens_at) {
        try {
          console.log(
            await send(
              "/api/meme/operator/rounds/" +
                encodeURIComponent(round.id) +
                "/freeze",
              readOwnership(resolve(args[0])),
            ),
          );
        } catch {
          console.error(
            "Ownership freeze blocked; inspect source freshness and job status.",
          );
        }
      }
    }
    if (!once)
      await new Promise((resolve) =>
        setTimeout(resolve, result.state === "queued" ? 25 : 1000),
      );
  } while (!once);
} else
  throw Error(
    "Commands: init | demo | settle <round-id> | collect <source-run-id> | request <operator-route> <json-file> | ownership-export <warplets-sqlite-path> | ownership-freeze <sqlite> <round> | tick | run [authoritative-sqlite]",
  );
