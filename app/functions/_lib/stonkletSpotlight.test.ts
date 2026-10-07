import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { STONKLETS_CATALOG, emptyMarketMetrics } from "../../shared/stonkletsCatalog";
import { loadStockMetricsBatch } from "./stonkletMarket";
import { loadCmcMarket } from "./stonkletCmc";
import { loadSpotlightResearch } from "./stonkletSpotlightResearch";
import { loadStockQuoteHistory } from "./stonkletStockHistory";
import { readSpotlight, runStonkletSpotlight, spotlightHour } from "./stonkletSpotlight";
import { onRequestPost } from "../api/admin/stonklet-spotlight";
import { requireAdminScope } from "./security";

vi.mock("./stonkletMarket", () => ({ loadStockMetricsBatch: vi.fn() }));
vi.mock("./stonkletCmc", () => ({ loadCmcMarket: vi.fn(async () => new Map()) }));
vi.mock("./stonkletStockHistory", () => ({ loadStockQuoteHistory: vi.fn(async () => null) }));
vi.mock("./stonkletSpotlightResearch", async original => ({ ...await original<typeof import("./stonkletSpotlightResearch")>(), researchReader: () => vi.fn(), loadSpotlightResearch: vi.fn(async () => ({ sources: [], selected: [], status: "no-catalyst" })) }));
vi.mock("./security", async original => ({ ...await original<typeof import("./security")>(), requireAdminScope: vi.fn(async () => ({ ok: true, keyId: "test" })) }));

const now = new Date("2026-10-06T00:05:00Z");
let sqlite: DatabaseSync;
function database() {
  sqlite = new DatabaseSync(":memory:");
  sqlite.exec(readFileSync(new URL("../../../migrations/0073_stonklet_spotlight.sql", import.meta.url), "utf8"));
  sqlite.exec(readFileSync(new URL("../../../migrations/0074_stonklet_daily_spotlight.sql", import.meta.url), "utf8"));
  sqlite.exec("CREATE TABLE notification_job_state(job_key TEXT PRIMARY KEY,value TEXT,updated_at TEXT)");
  const prepare = (sql: string) => {
    let args: (string | number | null)[] = [];
    return { bind(...values: (string | number | null)[]) { args = values; return this; },
      async first() { return sqlite.prepare(sql).get(...args) ?? null; },
      async all() { return { results: sqlite.prepare(sql).all(...args) }; },
      async run() { return sqlite.prepare(sql).run(...args); },
    };
  };
  return { prepare, async batch(statements: { run(): Promise<unknown> }[]) {
    sqlite.exec("BEGIN");
    try { const results = []; for (const statement of statements) results.push(await statement.run()); sqlite.exec("COMMIT"); return results; }
    catch (error) { sqlite.exec("ROLLBACK"); throw error; }
  } } as unknown as D1Database;
}
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(loadCmcMarket).mockResolvedValue(new Map());
  vi.mocked(loadStockQuoteHistory).mockResolvedValue(null);
  vi.useFakeTimers(); vi.setSystemTime(now);
  vi.mocked(loadStockMetricsBatch).mockResolvedValue(new Map(STONKLETS_CATALOG.filter(entry => entry.launchStatus === "launched").map((entry, index) => [entry.id, {
    ...emptyMarketMetrics(), price: 100, change1h: index / 10, change4h: index / 10, change24h: index / 10, status: "live", updatedAt: now.toISOString(),
  }])));
  vi.mocked(loadSpotlightResearch).mockImplementation(async (_env, pairId) => ({ sources: pairId === "apple" ? [{ id: "https://example.com/results", url: "https://example.com/results", title: "Apple launches a new product", publisher: "Issuer", publishedAt: now.toISOString(), fetchedAt: now.toISOString() }] : [], selected: [], status: "sources" }));
  vi.mocked(requireAdminScope).mockResolvedValue({ ok: true, keyId: "test" });
});
afterEach(() => { if (sqlite?.isOpen) sqlite.close(); vi.useRealTimers(); });

describe("hourly trending news persistence", () => {
  it("does not republish unchanged news on a later hourly poll", async () => {
    const db = database(), env = { WARPLETS: db, STONKLETS_SPOTLIGHT_ENABLED: "true" };
    await runStonkletSpotlight(env, now);
    const first = (await readSpotlight(db, null, true)).thesis!;
    const next = new Date("2026-10-06T01:05:00Z"); vi.setSystemTime(next);
    for (const metric of (await loadStockMetricsBatch([], undefined)).values()) metric.updatedAt = next.toISOString();
    expect(await runStonkletSpotlight(env, next)).toBe("no-news");
    expect(await runStonkletSpotlight(env, next)).toBe("already-evaluated");
    expect((await readSpotlight(db, null, true)).thesis?.selectedAt).toBe(first.selectedAt);
    expect(sqlite.prepare("SELECT COUNT(*) n FROM stonklet_spotlight_theses").get()?.n).toBe(1);
  });
  it("returns ten distinct stocks despite duplicate stories, while archived links remain resolvable", async () => {
    const db = database(), env = { WARPLETS: db, STONKLETS_SPOTLIGHT_ENABLED: "true" };
    await runStonkletSpotlight(env, now);
    const first = (await readSpotlight(db, null, true)).thesis!;
    sqlite.exec("UPDATE stonklet_spotlight_control SET mode='live'; DELETE FROM stonklet_spotlight_theses");
    for (let i = 0; i < 22; i++) {
      const time = new Date(now.getTime() + i * 60000).toISOString();
      const story = { ...first, pairId: STONKLETS_CATALOG.filter(e => e.launchStatus === "launched")[Math.floor(i / 2)]!.id, id: `news-${String(i).padStart(24, '0')}`, sources: [{ ...first.sources[0], publishedAt: time }] };
      sqlite.prepare("INSERT INTO stonklet_spotlight_theses(id,pair_id,selected_at,published,thesis_json) VALUES (?,?,?,1,?)").run(story.id, story.pairId, time, JSON.stringify(story));
    }
    const recent = await readSpotlight(db);
    expect(recent.entries).toHaveLength(10);
    expect(new Set(recent.entries!.map(item => item.pairId)).size).toBe(10);
    expect(recent.entries![0]!.id).toBe(`news-${'21'.padStart(24,'0')}`);
    const oldId = `news-${'0'.repeat(24)}`;
    expect((await readSpotlight(db, oldId)).thesis?.id).toBe(oldId);
    sqlite.prepare("UPDATE stonklet_spotlight_theses SET withdrawn_at=? WHERE id=?").run(now.toISOString(), recent.entries![0]!.id);
    expect((await readSpotlight(db)).entries!.some(item => item.id === recent.entries![0]!.id)).toBe(false);
  });
  it("resets the trial for the news strategy while retaining history and off mode", () => {
    database();
    sqlite.exec("INSERT INTO stonklet_spotlight_control VALUES (1,'live','2026-01-01','old','2026-01-01','daily-catalyst-v2')");
    sqlite.exec("INSERT INTO stonklet_spotlight_theses(id,pair_id,selected_at,published,thesis_json) VALUES ('old','apple','2026-01-01',1,'{}')");
    sqlite.exec(readFileSync(new URL("../../../migrations/0075_stonklet_trending_news.sql", import.meta.url), "utf8"));
    expect(sqlite.prepare("SELECT mode,current_thesis_id,strategy_version FROM stonklet_spotlight_control").get()).toMatchObject({ mode: "shadow", current_thesis_id: null, strategy_version: "trending-news-v3" });
    expect(sqlite.prepare("SELECT COUNT(*) n FROM stonklet_spotlight_theses").get()?.n).toBe(1);
  });
  it("retains a daily pick when no new or upcoming catalyst qualifies", async () => {
    const db = database(), env = { WARPLETS: db, STONKLETS_SPOTLIGHT_ENABLED: "true" };
    await runStonkletSpotlight(env, now);
    const first = (await readSpotlight(db, null, true)).thesis!;
    const next = new Date("2026-10-07T00:05:00Z"); vi.setSystemTime(next);
    for (const metric of (await loadStockMetricsBatch([], undefined)).values()) metric.updatedAt = next.toISOString();
    vi.mocked(loadSpotlightResearch).mockResolvedValue({ sources: [], selected: [], status: "no-catalyst" });
    expect(await runStonkletSpotlight(env, next)).toBe("no-news");
    expect((await readSpotlight(db, null, true)).thesis?.id).toBe(first.id);
  });
  it("qualifies CMC bStocks with recorded 4h history when Binance symbols are unavailable", async () => {
    const db = database();
    const existing = await loadStockMetricsBatch([], undefined);
    vi.mocked(loadCmcMarket).mockResolvedValue(new Map([...existing].map(([id, metric]) => [`${id}:stock`, { metrics: { ...metric, change4h: null } } as never])));
    vi.mocked(loadStockMetricsBatch).mockResolvedValue(new Map());
    const end = now.getTime() / 1000;
    vi.mocked(loadStockQuoteHistory).mockResolvedValue({ provider: "cmc-local", points: [
      { time: end - 3600, price: 99, value: 0 }, { time: end - 14400, price: 98, value: 0 },
    ] } as never);
    expect(await runStonkletSpotlight({ WARPLETS: db, STONKLETS_SPOTLIGHT_ENABLED: "true" }, now)).toBe("shadow");
    expect((await readSpotlight(db, null, true)).thesis?.eligibleCount).toBe(20);
  });
  it("runs only at :05, :10, :15 UTC", () => {
    expect(spotlightHour(now)).toBe("news-v3:2026-10-06T00");
    expect(spotlightHour(new Date("2026-10-06T00:06:00Z"))).toBeNull();
    expect(spotlightHour(new Date("2026-10-06T12:05:00Z"))).toBe("news-v3:2026-10-06T12");
  });
  it("collects shadow theses without exposing them and holds a successful daily pick", async () => {
    const db = database(), env = { WARPLETS: db, STONKLETS_SPOTLIGHT_ENABLED: "true" };
    expect(await runStonkletSpotlight(env, now)).toBe("shadow");
    expect(await runStonkletSpotlight(env, now)).toBe("already-evaluated");
    expect((await readSpotlight(db)).thesis).toBeNull();
    expect((await readSpotlight(db, null, true)).thesis?.eligibleCount).toBe(20);
    expect(loadSpotlightResearch).toHaveBeenCalledTimes(20);
  });
  it("retains the published card through failures, bounds retries and releases the lease", async () => {
    const db = database(), env = { WARPLETS: db, STONKLETS_SPOTLIGHT_ENABLED: "true" };
    await runStonkletSpotlight(env, now);
    sqlite.exec("UPDATE stonklet_spotlight_control SET mode='live'; DELETE FROM stonklet_spotlight_runs; DELETE FROM stonklet_spotlight_theses;");
    expect(await runStonkletSpotlight(env, now)).toBe("published");
    const first = await readSpotlight(db);
    vi.mocked(loadSpotlightResearch).mockRejectedValue(new Error("offline"));
    const next = new Date("2026-10-07T00:05:00Z");
    const current = await loadStockMetricsBatch([], undefined);
    for (const metric of current.values()) metric.updatedAt = next.toISOString();
    vi.setSystemTime(next);
    for (let attempt = 0; attempt < 3; attempt++) expect(await runStonkletSpotlight(env, next)).toBe("failed");
    expect(await runStonkletSpotlight(env, next)).toBe("already-evaluated");
    expect((await readSpotlight(db)).thesis?.id).toBe(first.thesis?.id);
    expect(sqlite.prepare("SELECT COUNT(*) n FROM notification_job_state").get()?.n).toBe(0);
    expect((await readSpotlight(db, first.thesis!.id)).thesis?.returns).toEqual(first.thesis?.returns);
  });
  it("keeps insufficient-coverage evaluations unpublished and does not run research", async () => {
    const db = database(); vi.mocked(loadStockMetricsBatch).mockResolvedValue(new Map());
    expect(await runStonkletSpotlight({ WARPLETS: db, STONKLETS_SPOTLIGHT_ENABLED: "true" }, now)).toBe("insufficient-coverage");
    expect(loadSpotlightResearch).not.toHaveBeenCalled();
  });
  it("requires an authorized completed seven-day trial, and preserves withdrawn history", async () => {
    const db = database(), env = { WARPLETS: db, STONKLETS_SPOTLIGHT_ENABLED: "true" };
    await runStonkletSpotlight(env, now);
    sqlite.exec(readFileSync(new URL("../../../migrations/0077_stonklet_narrative_news.sql", import.meta.url), "utf8"));
    const post = (body: object) => onRequestPost({ env, request: new Request("https://example.test/api/admin/stonklet-spotlight", { method: "POST", body: JSON.stringify(body) }) } as never);
    expect((await post({ mode: "live" })).status).toBe(409);
    sqlite.exec("UPDATE stonklet_spotlight_control SET trial_started_at=datetime('now','-8 days')");
    for (let day = 1; day <= 7; day++) sqlite.prepare("INSERT INTO stonklet_news_runs(hour,expected,status,evaluated_at) VALUES (?,1,'complete',datetime('now',?))").run(`news-v3:day-${day}`, `-${day} days`);
    expect((await post({ mode: "live" })).status).toBe(200);
    const shadow = (await readSpotlight(db, null, true)).thesis!;
    sqlite.prepare("UPDATE stonklet_spotlight_theses SET published=1 WHERE id=?").run(shadow.id);
    sqlite.prepare("UPDATE stonklet_spotlight_control SET current_thesis_id=?").run(shadow.id);
    expect((await post({ withdraw: shadow.id, reason: "Conflicting source evidence" })).status).toBe(200);
    expect((await readSpotlight(db)).thesis).toBeNull();
    expect((await readSpotlight(db, shadow.id)).status).toBe("withdrawn");
    vi.mocked(requireAdminScope).mockResolvedValue({ ok: false, response: new Response(null, { status: 401 }) });
    expect((await post({ mode: "off" })).status).toBe(401);
  });
});
