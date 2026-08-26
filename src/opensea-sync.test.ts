import assert from "node:assert/strict";
import test from "node:test";
import {
  buildOpenSeaSalesEventsUrl,
  parseOpenSeaTimestampSeconds,
  resolveOpenSeaResumePoint,
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
