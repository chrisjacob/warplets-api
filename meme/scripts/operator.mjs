import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes, createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { readOwnership } from "./ownership-source.mjs";
import {
  operatorRequest,
  statusExitCode,
  controlRequestBody,
} from "./operator-client.mjs";
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
async function send(path, body, method = "POST") {
  if (!path.startsWith("/api/meme/operator/"))
    throw Error("Operator route required");
  if (!existsSync(tokenFile)) throw Error("Run operator init first");
  return operatorRequest(
    apiOrigin,
    readFileSync(tokenFile, "utf8").trim(),
    path,
    body,
    method,
  );
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
} else if (command === "status") {
  if (args.some((arg) => arg !== "--check"))
    throw Error("Usage: operator status [--check]");
  const report = await send(
    "/api/meme/operator/operations/health",
    undefined,
    "GET",
  );
  console.log(JSON.stringify(report, null, 2));
  if (args.includes("--check")) process.exitCode = statusExitCode(report);
} else if (command === "pause" || command === "resume") {
  if (
    !["serving", "participation", "operations", "collection"].includes(
      args[0],
    ) ||
    !args[1]
  )
    throw Error("Provide a non-financial control and a short reason");
  const { controls } = await send(
    "/api/meme/operator/operations/controls",
    undefined,
    "GET",
  );
  const current = controls.find((c) => c.name === args[0]);
  if (!current) throw Error("Control configuration is incomplete");
  const request = {
    key: randomBytes(18).toString("base64url"),
    name: args[0],
    paused: command === "pause",
    expectedVersion: current.version,
    reason: args.slice(1).join(" "),
  };
  const directory = resolve(state, "control-requests");
  mkdirSync(directory, { recursive: true });
  const file = resolve(directory, request.key + ".json");
  writeFileSync(
    file,
    JSON.stringify({
      version: 1,
      target,
      origin: apiOrigin,
      workspace: root,
      request,
    }),
    { flag: "wx", mode: 0o600 },
  );
  console.log("Saved control retry request: " + file);
  console.log(
    JSON.stringify(
      await send("/api/meme/operator/operations/controls", request),
      null,
      2,
    ),
  );
} else if (command === "control-retry") {
  if (args.length !== 1) throw Error("Provide the saved control request file");
  const request = controlRequestBody(
    JSON.parse(readFileSync(resolve(args[0]), "utf8")),
    target,
    apiOrigin,
    root,
  );
  console.log(
    JSON.stringify(
      await send("/api/meme/operator/operations/controls", request),
      null,
      2,
    ),
  );
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
} else if (command === "share-publish") {
  const card = await send("/api/meme/operator/shares", {
    action: "create",
    kind: args[0],
    subject: args[1],
    window: args[2] ?? "24h",
    fid: args[3] ? Number(args[3]) : null,
  });
  const { renderCard } = await import("./render-share.mjs");
  for (const [format, height] of [
    ["mini", 800],
    ["og", 630],
  ]) {
    const png = await renderCard(card, height);
    await send("/api/meme/operator/shares", {
      action: "image",
      id: card.id,
      format,
      png: png.toString("base64"),
    });
  }
  console.log(
    JSON.stringify({
      id: card.id,
      path: "/api/meme/share/" + card.id,
      sourceHash: card.sourceHash,
    }),
  );
} else if (command === "trading-import" || command === "trading-publish") {
  let body;
  if (command === "trading-import") {
    const bytes = readFileSync(resolve(args[0] ?? ""));
    if (bytes.length > 262144) throw Error("Trading source exceeds 256 KiB");
    body = {
      action: "import",
      source: JSON.parse(bytes.toString("utf8")),
      parentId: args[1] === "none" ? null : args[1],
      reason: args[2],
    };
  } else body = { action: "publish", asOf: Number(args[0]) };
  console.log(
    JSON.stringify(await send("/api/meme/operator/trading", body), null, 2),
  );
} else if (command === "packet-attach" || command === "packet-status") {
  if (!/^tx:[a-f0-9]{64}$/.test(args[0] ?? ""))
    throw Error("Provide the immutable transaction intent id");
  const path =
    "/api/meme/operator/transactions/" +
    encodeURIComponent(args[0]) +
    "/packet";
  if (command === "packet-status")
    console.log(JSON.stringify(await send(path, undefined, "GET"), null, 2));
  else {
    if (!args[1]) throw Error("Provide an unsigned packet JSON file");
    const bytes = readFileSync(resolve(args[1]));
    if (bytes.length > 262144) throw Error("Packet exceeds its bound");
    console.log(
      JSON.stringify(
        await send(path, { packet: JSON.parse(bytes.toString("utf8")) }),
        null,
        2,
      ),
    );
  }
} else if (
  [
    "market-register",
    "market-import",
    "market-publish",
    "market-correct",
  ].includes(command)
) {
  const fileJSON = (file) => {
    if (!file) throw Error("A JSON file is required");
    const bytes = readFileSync(resolve(file));
    if (bytes.length > 64000) throw Error("Market input exceeds 64 KiB");
    return JSON.parse(bytes.toString("utf8"));
  };
  let body;
  if (command === "market-register")
    body = { action: "register", market: fileJSON(args[0]) };
  if (command === "market-import")
    body = {
      action: "append",
      marketId: args[0],
      observations: fileJSON(args[1]),
      key: args[2],
    };
  if (command === "market-publish")
    body = { action: "publish", marketId: args[0], window: args[1] ?? "24h" };
  if (command === "market-correct") {
    const review = fileJSON(args[0]);
    body = {
      action: "correct",
      key: review.key,
      oldId: review.oldId,
      newId: review.newId,
      reason: review.reason,
    };
  }
  console.log(
    JSON.stringify(await send("/api/meme/operator/markets", body), null, 2),
  );
} else if (command === "tick" || command === "run") {
  const once = command === "tick";
  let lastReport = "",
    lastPrintedAt = 0;
  do {
    const result = await send("/api/meme/operator/operations/tick", {});
    const report = JSON.stringify(result);
    if (once || report !== lastReport || Date.now() - lastPrintedAt >= 60000) {
      console.log(report);
      lastReport = report;
      lastPrintedAt = Date.now();
    }
    if (args[0] && result.state !== "paused") {
      const response = await fetch(apiOrigin + "/api/meme/state", {
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
    "Commands: init | status [--check] | pause <control> <reason> | resume <control> <reason> | control-retry <request-file> | demo | settle <round-id> | collect <source-run-id> | request <operator-route> <json-file> | ownership-export <warplets-sqlite-path> | ownership-freeze <sqlite> <round> | tick | run [authoritative-sqlite]",
  );
