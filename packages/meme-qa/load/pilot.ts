/** Disposable SQLite/Worker benchmark. No network, real identity, signing or provider keys. */
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { testDb } from "../../../meme/src/worker/testDb";
import {
  startVersion,
  sealVersion,
} from "../../../meme/src/worker/evidenceVersions";
import {
  startSnapshot,
  stepSnapshot,
} from "../../../meme/src/worker/snapshots";
import { settle } from "../../../meme/src/worker/settlement";
import worker from "../../../meme/src/worker/index";
import { encode58 } from "../../../meme/src/shared/base58";
import { canonical } from "../../../meme/src/shared/canonical";
import type { LedgerEvent } from "../../../meme/src/shared/holding";

const address = (n: number) => {
  const b = new Uint8Array(32);
  new DataView(b.buffer).setUint32(0, n);
  return encode58(b);
};
const signature = (n: number) => {
  const b = new Uint8Array(64);
  new DataView(b.buffer).setUint32(0, n);
  return encode58(b);
};
const hash = (s: string) => createHash("sha256").update(s).digest("hex");
async function benchmark(cohort: number) {
  const t = testDb(),
    now = Date.now(),
    close = now - 10000,
    launched = close - 86400000 + 1800000;
  try {
    t.raw
      .prepare(
        "INSERT INTO meme_rounds(id,opens_at,closes_at,attribute,state,snapshot_id,rules_version) VALUES('r',?,?,'cast','skipped','ownership','local-v1')",
      )
      .run(close - 86400000, close);
    t.raw
      .prepare(
        "INSERT INTO meme_ownership_snapshots VALUES('ownership','r','warplets','simulated',?,?,0,'ready','{}')",
      )
      .run(close - 86400000 - 1, close - 86400000);
    t.raw
      .prepare(
        "INSERT INTO meme_candidates VALUES('r','a','Fixture','FIX',?,'Simulated benchmark only')",
      )
      .run(address(900000));
    for (let i = 1; i <= cohort; i++) {
      t.raw
        .prepare("INSERT INTO meme_votes VALUES('r',?,'a',?,?,?,'fixture')")
        .run(i, close - 2500 + i, close - 500, address(i));
      t.raw
        .prepare("INSERT INTO meme_vote_wallets VALUES('r',?,?)")
        .run(i, address(i));
      t.raw
        .prepare("INSERT INTO meme_round_eligibility VALUES('r',?,'[]','[]',?)")
        .run(i, 1 + (i % 10));
    }
    let eventId = 0;
    for (let c = 0; c < 10; c++) {
      const id = "c" + c;
      const campaignLaunch = launched - c * 86400000;
      t.raw
        .prepare(
          "INSERT INTO meme_campaigns VALUES(?,?,?,?,?,?,?,'simulated','benchmark fixture')",
        )
        .run(
          id,
          address(800000 + c),
          "FIX" + c,
          campaignLaunch,
          campaignLaunch + 864000000,
          "1000000000000",
          0,
        );
      await startVersion(t.db, {
        id,
        campaignId: id,
        effectiveFrom: close - 1000,
        throughAt: close,
        scopeWallets: Array.from({ length: cohort }, (_, i) => address(i + 1)),
        mode: "simulated",
      });
      t.raw.exec("BEGIN");
      for (let i = 1; i <= cohort; i++)
        for (let j = 0; j < 2; j++) {
          const at = campaignLaunch + i * 2 + j,
            sig = signature(++eventId);
          const event: LedgerEvent = {
            signature: sig,
            index: 0,
            slot: 400000000 + i * 2 + j,
            at,
            kind: j === 0 ? "purchase" : "airdrop",
            wallet: address(i),
            quantity: "100",
            ...(j === 0
              ? {
                  quote: {
                    paidUnits: "100",
                    paymentMint: "native:SOL",
                    paymentDecimals: 0,
                    usdPriceMicros: "1000000",
                    at,
                    source: "simulated",
                    evidenceHash: "benchmark",
                  },
                }
              : {}),
          };
          const payload = canonical(event),
            key = sig + ":0";
          t.raw
            .prepare("INSERT INTO meme_version_events VALUES(?,?,?,?,?,?,?,?)")
            .run(id, key, payload, hash(payload), sig, 0, event.slot, at);
          t.raw
            .prepare("INSERT INTO meme_version_wallets VALUES(?,?,?,?)")
            .run(id, key, address(i), sig);
        }
      t.raw.exec("COMMIT");
      const sealed = await sealVersion(t.db, id);
      if (sealed.state !== "ready") throw Error("Benchmark evidence not ready");
    }
    const snapshotStarted = performance.now();
    await startSnapshot(t.db, "snapshot", "r", close);
    let snapshotSteps = 0;
    for (; snapshotSteps < cohort * 20 + 100; snapshotSteps++)
      if ((await stepSnapshot(t.db, "snapshot")).state === "ready") break;
    if (snapshotSteps >= cohort * 20 + 100)
      throw Error("Snapshot failed to finish");
    const snapshotMs = performance.now() - snapshotStarted;
    const env: Env = {
      MEME_DB: t.db,
      LOCAL_PREVIEW_ONLY: "true",
      LOCAL_PARTICIPATION_ENABLED: "true",
      LOCAL_OPERATIONS_ENABLED: "false",
      MEME_QA_ORIGIN: "",
      MEME_QA_FIDS: "",
      MEME_QA_GATEWAY_TOKEN: "",
      HELIUS_API_KEY: "",
      PYTH_API_KEY: "",
    };
    const durations: number[] = [],
      readStarted = performance.now();
    const queriesAtStart = t.queries.length;
    for (let batch = 0; batch < 5; batch++) {
      const batchStarted = performance.now();
      await Promise.all(
        Array.from({ length: 20 }, async () => {
          const start = performance.now(),
            response = await worker.fetch(
              new Request("http://localhost/api/meme/state"),
              env,
            );
          const body = (await response.json()) as {
            scoreSnapshot?: { state: string };
          };
          if (response.status !== 200 || body.scoreSnapshot?.state !== "ready")
            throw Error("Public projection unavailable");
          durations.push(performance.now() - start);
        }),
      );
      await new Promise((resolve) =>
        setTimeout(
          resolve,
          Math.max(0, 1000 - (performance.now() - batchStarted)),
        ),
      );
    }
    const readQueries = t.queries.slice(queriesAtStart);
    if (
      readQueries.some((sql) =>
        /meme_(?:ledger_events|version_events)|INSERT |UPDATE /i.test(sql),
      )
    )
      throw Error("Public reads replayed history or wrote state");
    durations.sort((a, b) => a - b);
    const settlementStarted = performance.now();
    let result;
    for (let i = 0; i < 200; i++) {
      result = await settle(t.db, "r", "disposable-benchmark");
      if (result?.state === "finalized") break;
    }
    if (result?.state !== "finalized")
      throw Error("Settlement did not finalize");
    const settlementMs = performance.now() - settlementStarted;
    const p95 = durations[Math.ceil(durations.length * 0.95) - 1];
    return {
      cohort,
      campaigns: 10,
      events: eventId,
      readRequests: durations.length,
      offeredReadsPerSecond: 20,
      actualReadsPerSecond:
        durations.length /
        ((performance.now() - readStarted - settlementMs) / 1000),
      readP95Ms: p95,
      readMaxMs: durations.at(-1),
      snapshotMs,
      snapshotSteps,
      settlementMs,
      targetsMet: {
        readP95: p95 < 1000,
        snapshot: snapshotMs < 120000,
        settlement: settlementMs < 300000,
      },
      mode: "in-process SQLite with simulated accepted evidence; excludes scheduler/network/D1 latency",
    };
  } finally {
    t.close();
  }
}
const results = [];
for (const n of [100, 1200]) results.push(await benchmark(n));
const report = {
  version: 1,
  layer: "local",
  build: execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: resolve(import.meta.dirname, "../../.."),
    encoding: "utf8",
    windowsHide: true,
  }).trim(),
  workingTreeModified:
    execFileSync("git", ["status", "--porcelain", "--untracked-files=no"], {
      cwd: resolve(import.meta.dirname, "../../.."),
      encoding: "utf8",
      windowsHide: true,
    }).trim().length > 0,
  ciRun: process.env.GITHUB_RUN_ID ?? null,
  generatedAt: new Date().toISOString(),
  node: process.version,
  platform: process.platform,
  productionCertified: false,
  mainnetActions: false,
  providerRequests: 0,
  results,
};
const output = resolve(import.meta.dirname, "../../../.tmp/meme-qa");
mkdirSync(output, { recursive: true });
writeFileSync(
  resolve(output, "pilot-load.json"),
  JSON.stringify(report, null, 2) + "\n",
);
console.log(JSON.stringify(report, null, 2));
if (results.some((r) => Object.values(r.targetsMet).some((v) => !v)))
  process.exitCode = 1;
