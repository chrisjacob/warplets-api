/** Disposable SQLite lab. No remote provider, real account or signer. */
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { testDb } from "../../../meme/src/worker/testDb";
import {
  registerMarket,
  appendMarketEvidence,
  publishMarket,
  readMarket,
} from "../../../meme/src/worker/markets";
import {
  importTrading,
  publishTrading,
  readTrading,
} from "../../../meme/src/worker/trading";
import { encode58 } from "../../../meme/src/shared/base58";
import type {
  TradeEvent,
  TraderEvidence,
} from "../../../meme/src/shared/trading";
const t = testDb(),
  now = Date.now(),
  count = 1000;
try {
  const market = {
    id: "load",
    symbol: "ATTN",
    ogSymbol: "OG",
    ogMint: encode58(new Uint8Array(32).fill(8)),
    attnMint: encode58(new Uint8Array(32).fill(9)),
    pool: null,
    launchedAt: now - 1000000,
    mode: "simulated" as const,
  };
  await registerMarket(t.db, market);
  const start = performance.now();
  for (let i = 1; i <= count; i++) {
    const bytes = new Uint8Array(32).fill(3);
    new DataView(bytes.buffer).setUint32(28, i);
    const wallet = encode58(bytes),
      signature = encode58(new Uint8Array(64).fill(1));
    const events: TradeEvent[] = Array.from({ length: 40 }, (_, j) => ({
      id: "event:" + j,
      slot: j + 1,
      index: j,
      at: now - 40000 + j * 1000,
      wallet,
      marketId: market.id,
      kind: j % 2 ? "sell" : "buy",
      quantity: "10",
      usd: String(j % 2 ? 110 : 100 + (i % 70)),
      og: String(j % 2 ? 110 : 100),
      feeUsd: "1",
      feeOg: "1",
      signature,
      evidenceHash: "a".repeat(64),
      finalized: true,
    }));
    const source: TraderEvidence = {
      version: 1,
      fid: 2000000 + i,
      wallets: [wallet],
      verifiedAt: 0,
      throughAt: now,
      complete: true,
      gaps: [],
      sourceHash: "a".repeat(64),
      mode: "simulated",
      markets: [
        { id: market.id, attnMint: market.attnMint, ogMint: market.ogMint },
      ],
      events,
    };
    await importTrading(
      t.db,
      source,
      null,
      "Simulated 1000-account benchmark",
      now,
    );
  }
  const importMs = performance.now() - start,
    publishStart = performance.now();
  t.queries.length = 0;
  const boards = await publishTrading(t.db, now, now),
    publishMs = performance.now() - publishStart,
    publishQueries = t.queries.length;
  if (boards.some((b) => b.items.length !== 100 || b.cohort !== 1000))
    throw Error("Top 100 cohort incomplete");
  if (t.queries.some((q) => q.includes("SELECT s.id,s.payload")))
    throw Error("Publication loaded complete cohort histories");
  for (let offset = 0; offset < 500; offset += 20)
    await appendMarketEvidence(
      t.db,
      market.id,
      "prices:" + offset,
      Array.from({ length: 20 }, (_, j) => {
        const n = offset + j;
        return {
          at: now - 499000 + n * 1000,
          observedAt: now,
          ogUsd: "1",
          attnOg: n % 2 ? "1.1" : "0.9",
          intervalMs: 1000,
          source: "simulated-load",
          evidenceHash: (n + 1).toString(16).padStart(64, "0"),
        };
      }),
      now,
    );
  await publishMarket(t.db, market.id, "all", now);
  const timings: number[] = [],
    writes = t.raw.prepare("SELECT total_changes() n").get()!.n;
  let maxBytes = 0;
  t.queries.length = 0;
  for (let n = 0; n < 40; n++) {
    const before = performance.now(),
      value =
        n % 2
          ? await readTrading(t.db, "all")
          : await readMarket(t.db, market.id, "all");
    timings.push(performance.now() - before);
    maxBytes = Math.max(maxBytes, Buffer.byteLength(JSON.stringify(value)));
  }
  if (
    t.raw.prepare("SELECT total_changes() n").get()!.n !== writes ||
    t.queries.length !== 40
  )
    throw Error(
      "Public display reads must perform exactly one SELECT without writes",
    );
  timings.sort((a, b) => a - b);
  const report = {
    version: 1,
    mode: "in-process SQLite lab, excludes D1 service/network limits",
    cohort: count,
    tradeEvents: 40000,
    importMs,
    publishMs,
    publishQueries,
    sourcePageSize: 64,
    publicReadP95Ms: timings[Math.floor(timings.length * 0.95)],
    maxPublicBytes: maxBytes,
    providerRequests: 0,
    financialActions: false,
    productionCertified: false,
  };
  if (report.publicReadP95Ms >= 1000 || maxBytes > 786432)
    throw Error("Growth read budget exceeded");
  const out = resolve(import.meta.dirname, "../../../.tmp/meme-qa");
  mkdirSync(out, { recursive: true });
  writeFileSync(
    resolve(out, "growth-load.json"),
    JSON.stringify(report, null, 2) + "\n",
  );
  console.log(JSON.stringify(report, null, 2));
} finally {
  t.close();
}
