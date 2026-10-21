import { afterEach, describe, expect, it, vi } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import { sqliteD1 } from "../../app/functions/_lib/sqliteTestDb";
import { key } from "./wallet-fixtures.test-helper";
import { sourceFetchDescriptor } from "./source-collection-request";
import { reserveSourceFetch, sharedResearchUsage, SOURCE_COLLECTION_LIMITS as L } from "./source-collection-store";
import { executeReservedSource, readSourceReceipt } from "./source-collection-transport";
import { publishScoreCohort, scoreResearch } from "./score-research";
import { freezeScoreCohort } from "./score-research-analysis";
import { defaultScoreInput, freezeDiscoveryScore } from "./discovery-score";
import { fixtureCandidates } from "./fixtures";
import { SCORE_RESEARCH_LIMITS as R } from "./score-research-model";
import { reserveQuota } from "./store";

const at = new Date("2026-10-21T01:00:00.000Z"), opened: DatabaseSync[] = [];
const request = { kind: "jupiter_tokens_v2" as const, addresses: [key(91)] };
const later = (seconds: number) => new Date(at.getTime() + seconds * 1000);
afterEach(() => { opened.splice(0).forEach(db => db.close()); vi.restoreAllMocks(); vi.useRealTimers(); });
function setup() {
  const sqlite = new DatabaseSync(":memory:"); opened.push(sqlite);
  for (const f of readdirSync(new URL("../migrations/", import.meta.url)).filter(f => f.endsWith(".sql")).sort()) sqlite.exec(readFileSync(new URL(`../migrations/${f}`, import.meta.url), "utf8"));
  const db = sqliteD1(sqlite), batch = db.batch.bind(db);
  // D1 serializes SQL transactions; the Node helper needs the same queue.
  let queue = Promise.resolve();
  db.batch = ((...args: Parameters<typeof batch>) => { const result = queue.then(() => batch(...args)); queue = result.then(() => undefined, () => undefined); return result; }) as typeof db.batch;
  return { sqlite, db };
}
function filler(sqlite: DatabaseSync, n: number, bytes = 1) {
  for (let i = 0; i < n; i++) sqlite.prepare("INSERT INTO tenx_score_cohorts VALUES(?,'discovery-score-v1',?,'2026-10-21','hash',?,'{}')").run(`filler-${i}`, at.toISOString(), bytes);
}
async function score(db: D1Database) {
  const candidate = { ...(await fixtureCandidates(at))[0]!, mode: "live" as const };
  const record = await freezeScoreCohort(await freezeDiscoveryScore(defaultScoreInput(candidate, at)));
  await db.prepare("UPDATE tenx_score_control SET lease_owner='score',lease_until=?1 WHERE id=1").bind(later(120).toISOString()).run();
  return record;
}
describe("one-call Free source contracts", () => {
  it("separates metadata/candles/trades, pins version and includes anomalous trades without Pro params", () => {
    const pool = key(92), address = key(91);
    const candle = sourceFetchDescriptor({ kind: "geckoterminal_pool_candles", address, pool, start_at: later(-120).toISOString(), end_at: at.toISOString() }, at);
    expect(candle.url).toContain(`/pools/${pool}/ohlcv/minute?`); expect(candle.url).toContain("limit=2"); expect(candle.headers.Accept).toContain("version=20230203");
    expect(sourceFetchDescriptor({ kind: "geckoterminal_pool_metadata", address, pool }, at).url).toBe(`https://api.geckoterminal.com/api/v2/networks/solana/pools/${pool}`);
    const trades = new URL(sourceFetchDescriptor({ kind: "geckoterminal_pool_trades", address, pool }, at).url);
    expect([...trades.searchParams]).toEqual([["include_anomalous", "true"], ["token", address]]);
    expect(sourceFetchDescriptor(request, at).url).toBe(`https://api.jup.ag/tokens/v2/search?query=${address}`);
  });
  it("rejects supplied URLs/headers, duplicate mints, invalid addresses and open candles", () => {
    for (const raw of [{ ...request, url: "https://example.com" }, { ...request, headers: { Authorization: "private" } }, { ...request, addresses: [key(91), key(91)] }, { kind: "geckoterminal_pool_trades", address: key(91), pool: "../../keys" }]) expect(() => sourceFetchDescriptor(raw, at)).toThrow();
    expect(() => sourceFetchDescriptor({ kind: "geckoterminal_pool_candles", address: key(91), pool: key(92), start_at: at.toISOString(), end_at: later(60).toISOString() }, at)).toThrow("open_candle");
  });
});
describe("atomic shared research and market admission", () => {
  it("admits a source request beyond the former internal 100-record cap while preserving original rows and byte/request limits", async () => {
    const { db, sqlite } = setup(); filler(sqlite, 100);
    const before = sqlite.prepare("SELECT * FROM tenx_score_cohorts ORDER BY address").all();
    expect(R.daily_records).toBe(120); expect(R.daily_bytes).toBe(10_000_000); expect(L.daily_requests).toBe(20);
    expect(await reserveSourceFetch(db, "after-old-cap", request, 600, at)).not.toBeNull();
    expect(await sharedResearchUsage(db, "2026-10-21")).toEqual({ records: 101, bytes: 100 + L.reserved_bytes });
    expect(sqlite.prepare("SELECT * FROM tenx_score_cohorts ORDER BY address").all()).toEqual(before);
  });
  it("reserves once under competing calls and charges the same market allowance", async () => {
    const { db, sqlite } = setup();
    const results = await Promise.all([reserveSourceFetch(db, "same", request, 600, at), reserveSourceFetch(db, "same", request, 600, at)]);
    expect(results.filter(Boolean)).toHaveLength(1); expect(await sharedResearchUsage(db, "2026-10-21")).toEqual({ records: 1, bytes: L.reserved_bytes });
    expect(sqlite.prepare("SELECT used FROM tenx_usage WHERE provider='market'").get()).toEqual({ used: 1 });
    expect(await reserveSourceFetch(db, "other", request, 600, at)).toBeNull();
    await expect(reserveSourceFetch(db, "same", { ...request, addresses: [key(93)] }, 600, later(130))).rejects.toThrow("id_conflict");
    await expect(reserveSourceFetch(db, "invalid", request, 601, at)).rejects.toThrow();
  });
  it.each(["paused", "backoff", "market_backoff", "rpc_backoff", "market_budget", "records", "bytes"])("holds before IO/charging on %s", async kind => {
    const { db, sqlite } = setup();
    if (kind === "paused") sqlite.exec("UPDATE tenx_control SET paused=1");
    if (kind === "backoff") sqlite.prepare("UPDATE tenx_source_transport_control SET backoff_until=?").run(later(60).toISOString());
    if (kind === "market_backoff") sqlite.prepare("UPDATE tenx_market_control SET last_error='limited',next_refresh_at=?").run(later(60).toISOString());
    if (kind === "rpc_backoff") sqlite.prepare("UPDATE tenx_control SET retry_after=?").run(later(60).toISOString());
    if (kind === "market_budget") sqlite.exec("INSERT INTO tenx_usage VALUES('market','2026-10-21',600)");
    if (kind === "records") filler(sqlite, R.daily_records);
    if (kind === "bytes") filler(sqlite, 5, 1_700_000);
    expect(await reserveSourceFetch(db, "held", request, 600, at)).toBeNull();
    expect(sqlite.prepare("SELECT count(*) n FROM tenx_source_reservations").get()).toEqual({ n: 0 });
    expect(sqlite.prepare("SELECT COALESCE(sum(used),0) n FROM tenx_usage").get()).toEqual({ n: kind === "market_budget" ? 600 : 0 });
  });
  it("rolls back reservation and pacing if shared quota write fails", async () => {
    const { db, sqlite } = setup(); sqlite.exec("CREATE TRIGGER no_quota BEFORE INSERT ON tenx_usage BEGIN SELECT RAISE(ABORT,'quota_failure'); END");
    await expect(reserveSourceFetch(db, "rollback", request, 600, at)).rejects.toThrow("quota_failure");
    expect(await sharedResearchUsage(db, "2026-10-21")).toEqual({ records: 0, bytes: 0 }); expect(sqlite.prepare("SELECT next_at FROM tenx_source_transport_control").get()).toEqual({ next_at: null });
  });
  it("accounts both score and source paths against the same final record", async () => {
    const { db, sqlite } = setup(), record = await score(db); filler(sqlite, R.daily_records - 1);
    expect(await reserveSourceFetch(db, "last", request, 600, at)).not.toBeNull();
    expect(await publishScoreCohort(db, record, "score", at)).toBe(false);
    expect((await scoreResearch(db, at)).today.records).toBe(R.daily_records);
    const other = setup(), otherRecord = await score(other.db); filler(other.sqlite, R.daily_records - 1);
    expect(await publishScoreCohort(other.db, otherRecord, "score", at)).toBe(true);
    expect(await reserveSourceFetch(other.db, "too-late", request, 600, at)).toBeNull();
  });
  it("shares the byte bound with score publication including abandoned attempts", async () => {
    const { db, sqlite } = setup(), record = await score(db);
    const first = await reserveSourceFetch(db, "abandoned", request, 600, at); expect(first).not.toBeNull();
    filler(sqlite, 5, 1_620_000);
    expect(await publishScoreCohort(db, record, "score", at)).toBe(false);
    expect(await reserveSourceFetch(db, "next", request, 600, later(130))).toBeNull();
    expect(await sharedResearchUsage(db, "2026-10-21")).toEqual({ records: 6, bytes: 10_000_000 });
  });
  it("honors a lower market configuration and normal collection sees pilot usage", async () => {
    const { db } = setup(); const reservation = (await reserveSourceFetch(db, "first", request, 1, at))!;
    await executeReservedSource(db, reservation, async () => Response.json([]), () => at);
    expect(await reserveSourceFetch(db, "second", request, 1, later(10))).toBeNull();
    await expect(reserveQuota(db, { rpc: 100, market: 1 }, at)("market")).rejects.toThrow("market_daily_budget_exhausted");
  });
  it("enforces twenty total pilot attempts and resets only on a new UTC day", async () => {
    const { db, sqlite } = setup();
    for (let i = 0; i < 20; i++) {
      const now = later(i * 10), reservation = (await reserveSourceFetch(db, `r${i}`, request, 600, now))!;
      expect(reservation).not.toBeNull(); expect(await executeReservedSource(db, reservation, async () => Response.json([]), () => now)).toMatchObject({ state: "retained", provider_requests: 1 });
    }
    expect(await reserveSourceFetch(db, "over", request, 600, later(210))).toBeNull();
    expect(sqlite.prepare("SELECT used FROM tenx_usage").get()).toEqual({ used: 20 });
    expect(await reserveSourceFetch(db, "tomorrow", request, 600, new Date("2026-10-22T01:00:00.000Z"))).not.toBeNull();
  });
});
describe("owned bounded transport without runtime wiring", () => {
  it("paces a delayed fetch from claim time instead of allowing a burst after lease expiry", async () => {
    const { db } = setup(), reservation = (await reserveSourceFetch(db, "delayed", request, 600, at))!;
    expect(await executeReservedSource(db, reservation, async () => Response.json([]), () => later(119))).toMatchObject({ state: "retained", provider_requests: 1 });
    expect(await reserveSourceFetch(db, "early", request, 600, later(120))).toBeNull();
    expect(await reserveSourceFetch(db, "spaced", request, 600, later(129))).not.toBeNull();
  });
  it("issues one GET and reconciles retained bytes, with no cookies, credentials or redirect following", async () => {
    const { db, sqlite } = setup(), reservation = (await reserveSourceFetch(db, "one", request, 600, at))!;
    const fetcher = vi.fn(async () => Response.json([{ id: key(91) }]));
    const [a, b] = await Promise.all([executeReservedSource(db, reservation, fetcher, () => at), executeReservedSource(db, reservation, fetcher, () => at)]);
    expect([a.state, b.state].sort()).toEqual(["held", "retained"]); expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0]).toEqual([sourceFetchDescriptor(request, at).url, expect.objectContaining({ method: "GET", credentials: "omit", redirect: "manual", headers: { Accept: "application/json" } })]);
    const row = sqlite.prepare("SELECT state,bytes,receipt FROM tenx_source_reservations").get() as { state:string;bytes:number;receipt:string };
    expect(row.state).toBe("succeeded"); expect(row.bytes).toBe(new TextEncoder().encode(row.receipt).length); expect(row.bytes).toBeLessThan(L.reserved_bytes);
    expect(JSON.parse(row.receipt)).toMatchObject({ response: [{ id: key(91) }], semantic_validation: "not_checked", canonical_pool_proof: "not_checked", scoring_effect: "none" });
    expect(await readSourceReceipt(db, "one")).toMatchObject({ replay: "verified", source_authenticity: "not_independently_verified", provider_requests: 0 });
    sqlite.exec("UPDATE tenx_source_reservations SET receipt=json_set(receipt,'$.status',201)");
    await expect(readSourceReceipt(db, "one")).rejects.toThrow("receipt_mismatch");
  });
  it.each(["paused", "expired", "replaced", "wrong_hash", "day_change"])("does not fetch with %s admission", async kind => {
    const { db, sqlite } = setup(), reservation = (await reserveSourceFetch(db, "one", request, 600, at))!;
    if (kind === "paused") sqlite.exec("UPDATE tenx_control SET paused=1");
    if (kind === "replaced") reservation.owner = "other";
    if (kind === "wrong_hash") reservation.request_hash = "bad";
    const now = kind === "expired" ? later(120) : kind === "day_change" ? later(86400) : at, fetcher = vi.fn();
    expect(await executeReservedSource(db, reservation, fetcher, () => now)).toEqual({ state: "held", provider_requests: 0 }); expect(fetcher).not.toHaveBeenCalled();
  });
  it.each(["paused", "expired", "replaced", "day_change"])("retains charged capacity but withholds response after %s during IO", async kind => {
    const { db, sqlite } = setup(), reservation = (await reserveSourceFetch(db, "one", request, 600, at))!; let now = at;
    const fetcher = async () => {
      if (kind === "paused") sqlite.exec("UPDATE tenx_control SET paused=1");
      if (kind === "replaced") sqlite.exec("UPDATE tenx_source_reservations SET owner='other'");
      if (kind === "expired") now = later(120);
      if (kind === "day_change") now = later(86400);
      return Response.json([]);
    };
    expect(await executeReservedSource(db, reservation, fetcher, () => now)).toEqual({ state: "held", provider_requests: 1 });
    expect(sqlite.prepare("SELECT bytes,receipt FROM tenx_source_reservations").get()).toEqual({ bytes: L.reserved_bytes, receipt: null });
  });
  it.each(["redirect", "html", "oversize", "length", "malformed", "complex", "network"])("retains a sanitized failure for %s, with no second request", async kind => {
    const { db, sqlite } = setup(), reservation = (await reserveSourceFetch(db, "one", request, 600, at))!;
    const fetcher = vi.fn(async () => {
      if (kind === "network") throw new Error("private credential");
      if (kind === "redirect") return new Response("private credential", { status: 302, headers: { Location: "https://evil.invalid/private" } });
      if (kind === "html") return new Response("private credential", { headers: { "content-type": "text/html" } });
      if (kind === "malformed") return new Response("{private credential", { headers: { "content-type": "application/json" } });
      if (kind === "length") return new Response("[]", { headers: { "content-type": "application/json", "content-length": "1000001" } });
      if (kind === "complex") return Response.json(Array(30001).fill(0));
      return Response.json("x".repeat(1_000_001));
    });
    expect(await executeReservedSource(db, reservation, fetcher, () => at)).toEqual({ state: "failed", provider_requests: 1 });
    const receipt = String(sqlite.prepare("SELECT receipt FROM tenx_source_reservations").get()!.receipt);
    expect(receipt).not.toContain("private"); expect(receipt).not.toContain("evil.invalid"); expect(JSON.parse(receipt).response).toBeNull();
    await executeReservedSource(db, reservation, fetcher, () => at); expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it.each(["429", "date", "reset", "huge", "503"])("persists %s backoff without retries, even when paused during IO", async kind => {
    const { db, sqlite } = setup(), reservation = (await reserveSourceFetch(db, "one", request, 600, at))!;
    const fetcher = async () => {
      sqlite.exec("UPDATE tenx_control SET paused=1");
      return Response.json([], { status: kind === "reset" ? 200 : kind === "503" ? 503 : 429,
        headers: kind === "date" ? { "retry-after": later(180).toUTCString() } : kind === "reset" ? { "x-ratelimit-remaining": "-2", "x-ratelimit-reset": String(later(180).getTime() / 1000) } : kind === "huge" ? { "retry-after": "999999999999999" } : {} });
    };
    expect(await executeReservedSource(db, reservation, fetcher, () => at)).toEqual({ state: "held", provider_requests: 1 });
    sqlite.exec("UPDATE tenx_control SET paused=0");
    const row = sqlite.prepare("SELECT backoff_until FROM tenx_source_transport_control").get();
    expect(row).toEqual({ backoff_until: kind === "huge" ? "9999-12-31T23:59:59.999Z" : later(kind === "date" || kind === "reset" ? 180 : 60).toISOString() });
    expect(await reserveSourceFetch(db, "next", request, 600, later(130))).toEqual(kind === "date" || kind === "reset" || kind === "huge" ? null : expect.anything());
  });
  it("times out and aborts rather than automatically retrying", async () => {
    vi.useFakeTimers(); const { db, sqlite } = setup(), reservation = (await reserveSourceFetch(db, "one", request, 600, at))!;
    const fetcher = vi.fn((_url: string, init: RequestInit) => new Promise<Response>((_resolve, reject) => init.signal!.addEventListener("abort", () => reject(new Error("abort")))));
    const pending = executeReservedSource(db, reservation, fetcher, () => at);
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1)); await vi.advanceTimersByTimeAsync(15000);
    expect(await pending).toEqual({ state: "failed", provider_requests: 1 });
    expect(String(sqlite.prepare("SELECT receipt FROM tenx_source_reservations").get()!.receipt)).toContain("source_collection_timeout");
  });
});
