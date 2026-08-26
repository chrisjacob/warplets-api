import assert from "node:assert/strict";
import test from "node:test";
import {
  buildOpenSeaSalesEventsUrl,
  parseOpenSeaTimestampSeconds,
  resolveOpenSeaResumePoint,
  runOpenseaSync,
} from "./opensea-sync";

test("OpenSea sales requests use the supported v2 time filter and maximum page size", () => {
  const url = new URL(buildOpenSeaSalesEventsUrl(1787156433, "next-page"));

  assert.equal(url.pathname, "/api/v2/events/collection/10xwarplets");
  assert.equal(url.searchParams.get("after"), "1787156433");
  assert.equal(url.searchParams.has("occurred_after"), false);
  assert.equal(url.searchParams.get("event_type"), "sale");
  assert.equal(url.searchParams.get("limit"), "200");
  assert.equal(url.searchParams.get("next"), "next-page");
});

test("OpenSea resume parsing accepts the production Unix-seconds cursor", () => {
  assert.equal(parseOpenSeaTimestampSeconds("1787156433"), 1787156433);
  assert.deepEqual(
    resolveOpenSeaResumePoint("1787156433", undefined, Date.parse("2026-08-26T00:00:00Z")),
    {
      occurredAfterSec: 1787156433,
      persistedCursorSec: 1787156433,
      source: "persisted",
    },
  );
});

test("OpenSea resume parsing normalizes ISO and millisecond timestamps", () => {
  assert.equal(parseOpenSeaTimestampSeconds("2026-08-25T00:00:00.000Z"), 1787616000);
  assert.equal(parseOpenSeaTimestampSeconds("1787616000000"), 1787616000);
});

test("OpenSea resume parsing falls back safely instead of emitting NaN", () => {
  const nowMs = Date.parse("2026-08-26T00:00:00.000Z");
  const result = resolveOpenSeaResumePoint("invalid-cursor", undefined, nowMs);
  assert.equal(result.occurredAfterSec, Math.floor(nowMs / 1000) - 86400);
  assert.equal(Number.isNaN(result.occurredAfterSec), false);
  assert.equal(result.source, "lookback");
});

test("a valid manual OpenSea window overrides the persisted cursor", () => {
  assert.deepEqual(resolveOpenSeaResumePoint("1787156433", 1787000000), {
    occurredAfterSec: 1787000000,
    persistedCursorSec: 1787156433,
    source: "manual",
  });
});

test("legacy OpenSea duplicates are inserted in bounded D1 batches", async () => {
  const batchSizes: number[] = [];
  let individualRuns = 0;
  const statement = {
    bind() {
      return statement;
    },
    async run() {
      individualRuns += 1;
      return { meta: { changes: 0 } };
    },
  };
  const db = {
    prepare() {
      return statement;
    },
    async batch(statements: unknown[]) {
      batchSizes.push(statements.length);
      return statements.map(() => ({ meta: { changes: 0 } }));
    },
  } as unknown as D1Database;
  const storedKv = new Map<string, string>([["opensea_last_sync_at", "1787616000"]]);
  const kv = {
    async get(key: string) {
      return storedKv.get(key) ?? null;
    },
    async put(key: string, value: string) {
      storedKv.set(key, value);
    },
  } as unknown as KVNamespace;
  const events = Array.from({ length: 72 }, (_, index) => ({
    event_type: "sale",
    event_timestamp: `2026-08-25T00:${String(index % 60).padStart(2, "0")}:00.000Z`,
    transaction: `0x${index.toString(16).padStart(64, "0")}`,
    nft: { identifier: String(index + 1) },
    seller: "0x1111111111111111111111111111111111111111",
    buyer: "0x2222222222222222222222222222222222222222",
  }));
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ asset_events: events, next: null }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });

  try {
    const result = await runOpenseaSync({
      WARPLETS: db,
      WARPLETS_KV: kv,
      OPENSEA_API_KEY: "test-key",
    });
    assert.deepEqual(batchSizes, [50, 22]);
    assert.equal(individualRuns, 0);
    assert.deepEqual(result, { processed: 0, matched: 0, skipped: 72 });
  } finally {
    globalThis.fetch = originalFetch;
  }
});
