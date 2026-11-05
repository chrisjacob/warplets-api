/** Lifetime-history read benchmark; disposable SQLite, no provider calls or signing. */
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { testDb } from "../../../meme/src/worker/testDb";
import { sha } from "../../../meme/src/worker/db";
import worker from "../../../meme/src/worker/index";
import { seedReadArchive } from "./readArchive";

const t = testDb();
try {
  seedReadArchive(t.raw, 365);
  t.raw
    .prepare("INSERT INTO meme_sessions VALUES(?,?,?,?,?)")
    .run(
      await sha("disposable-read-benchmark"),
      "http://localhost",
      42,
      null,
      Date.now() + 60000,
    );
  const env = {
    MEME_DB: t.db,
    LOCAL_PREVIEW_ONLY: "true",
    LOCAL_PARTICIPATION_ENABLED: "true",
    LOCAL_OPERATIONS_ENABLED: "false",
    MEME_QA_ORIGIN: "",
    MEME_QA_FIDS: "",
    MEME_QA_GATEWAY_TOKEN: "",
    HELIUS_API_KEY: "",
    PYTH_API_KEY: "",
  } satisfies Env;
  const writes = t.raw.prepare("SELECT total_changes() n").get()!.n;
  async function measure(path: string) {
    const timings: number[] = [];
    let bytes = 0;
    const queryStart = t.queries.length;
    for (let i = 0; i < 20; i++) {
      const start = performance.now();
      const response = await worker.fetch(
        new Request("http://localhost" + path, {
          headers: { cookie: "meme_session=disposable-read-benchmark" },
        }),
        env,
      );
      const body = await response.text();
      if (!response.ok) throw Error("Read benchmark failed");
      bytes = new TextEncoder().encode(body).length;
      timings.push(performance.now() - start);
    }
    const queries = t.queries.slice(queryStart);
    timings.sort((a, b) => a - b);
    if (
      queries.some((q) =>
        /meme_(?:ledger_events|version_events)|\b(?:INSERT|UPDATE|DELETE)\b/i.test(
          q,
        ),
      )
    )
      throw Error("A reader collected, replayed or mutated state");
    return {
      bytes,
      readP95Ms: timings[18],
      queriesPerRead: queries.length / 20,
      readsEntitlements: queries.some((q) =>
        /\b(?:FROM|JOIN) meme_entitlements/.test(q),
      ),
    };
  }
  const legacy = await measure("/api/meme/state"),
    compact = await measure("/api/meme/state?view=today"),
    rewardPage = await measure("/api/meme/rewards");
  if (t.raw.prepare("SELECT total_changes() n").get()!.n !== writes)
    throw Error("Reads wrote to SQLite");
  const report = {
    version: 1,
    generatedAt: new Date().toISOString(),
    build: execFileSync("git", ["rev-parse", "HEAD"], {
      encoding: "utf8",
      windowsHide: true,
    }).trim(),
    workingTreeModified:
      execFileSync("git", ["status", "--porcelain", "--untracked-files=no"], {
        encoding: "utf8",
        windowsHide: true,
      }).trim().length > 0,
    node: process.version,
    platform: process.platform,
    ciRun: process.env.GITHUB_RUN_ID ?? null,
    campaigns: 365,
    entitlements: 3650,
    legacy,
    compact,
    rewardPage,
    pollBytesReductionPercent: 100 * (1 - compact.bytes / legacy.bytes),
    providerRequests: 0,
    mainnetActions: false,
    productionCertified: false,
    mode: "in-process SQLite; excludes network and D1 service limits",
  };
  const output = resolve(import.meta.dirname, "../../../.tmp/meme-qa");
  mkdirSync(output, { recursive: true });
  writeFileSync(
    resolve(output, "read-history-load.json"),
    JSON.stringify(report, null, 2) + "\n",
  );
  console.log(JSON.stringify(report, null, 2));
  if (
    compact.readsEntitlements ||
    compact.bytes >= legacy.bytes / 10 ||
    compact.readP95Ms >= 1000 ||
    rewardPage.readP95Ms >= 1000
  )
    throw Error("Read budget exceeded");
} finally {
  t.close();
}
