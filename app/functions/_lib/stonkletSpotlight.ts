import { trendingNewsEntries } from "../../shared/stonkletsTrendingNews.js";
import { type CatalystResearch } from "../../shared/stonkletsCatalyst.js";
import { STONKLETS_CATALOG } from "../../shared/stonkletsCatalog.js";
import { rankSpotlight, spotlightStatus, spotlightHistoryMetrics, type SpotlightResponse, type SpotlightThesis } from "../../shared/stonkletsSpotlight.js";
import { loadStockQuoteHistory } from "./stonkletStockHistory.js";
import { loadStockMetricsBatch } from "./stonkletMarket.js";
import { loadCmcMarket } from "./stonkletCmc.js";
import { notificationStockChange } from "./stonkletQuoteIntegrity.js";
import { loadSpotlightResearch, researchReader, type SpotlightResearchEnv } from "./stonkletSpotlightResearch.js";
import { claimStonkletWork, releaseStonkletWork } from "./stonkletWorkLease.js";
import type { StonkletMarketIngestEnv } from "./stonkletIngestion.js";

export interface SpotlightEnv extends StonkletMarketIngestEnv, SpotlightResearchEnv {
  STONKLETS_SPOTLIGHT_ENABLED?: string;
}
interface Control { mode: "off" | "shadow" | "live"; trial_started_at: string; current_thesis_id: string | null }
interface ThesisRow { thesis_json: string; withdrawn_at: string | null; withdrawal_reason: string | null }

export function spotlightHour(now: Date): string | null {
  // Hourly discovery; retries only for failed evaluations, never duplicate stories.
  return [5, 10, 15].includes(now.getUTCMinutes()) ? `news-v3:${now.toISOString().slice(0, 13)}` : null;
}

export async function runStonkletSpotlight(env: SpotlightEnv, clock = new Date()): Promise<string> {
  if (env.STONKLETS_SPOTLIGHT_ENABLED !== "true") return "disabled";
  const hour = spotlightHour(clock);
  if (!hour) return "not-due";
  const db = env.WARPLETS, now = clock.toISOString();
  const owner = await claimStonkletWork(db, "spotlight", 180);
  if (!owner) return "busy";
  try {
    await db.prepare("INSERT OR IGNORE INTO stonklet_spotlight_control(id, mode, trial_started_at, updated_at, strategy_version) VALUES (1, 'shadow', ?, ?, 'trending-news-v3')").bind(now, now).run();
    const control = await db.prepare("SELECT * FROM stonklet_spotlight_control WHERE id=1").first<Control>();
    if (!control || control.mode === "off") return "disabled";
    const attempt = await db.prepare(`INSERT INTO stonklet_spotlight_runs(hour, attempts, status, evaluated_at) VALUES (?, 1, 'running', ?)
      ON CONFLICT(hour) DO UPDATE SET attempts=attempts+1, status='running', evaluated_at=excluded.evaluated_at
      WHERE attempts < 3 AND status NOT IN ('published', 'shadow', 'no-news') RETURNING attempts`).bind(hour, now).first();
    if (!attempt) return "already-evaluated";
    try {
      const [metrics, cmc] = await Promise.all([loadStockMetricsBatch(STONKLETS_CATALOG, env.WARPLETS_KV), loadCmcMarket(env)]);
      await Promise.all(STONKLETS_CATALOG.filter(entry => entry.launchStatus === "launched").map(async entry => {
        const primary = metrics.get(entry.id);
        if (primary?.status === "live" && primary.change4h != null) return;
        const reference = cmc.get(`${entry.id}:stock`)?.metrics;
        if (!reference || reference.status !== "live") return;
        const chart = await loadStockQuoteHistory(env.WARPLETS, entry.id, "24h", reference);
        const derived = chart?.provider === "cmc-local" ? spotlightHistoryMetrics(reference, chart.points) : null;
        if (derived) metrics.set(entry.id, derived);
      }));
      // Never fill missing rolling windows with a different provider's period.
      // Existing independent-quote safeguards exclude anomalous/conflicting 24h returns.
      const verified = new Map([...metrics].filter(([id, metric]) => notificationStockChange(metric, cmc.get(`${id}:stock`)?.metrics) != null));
      const ranked = rankSpotlight(verified, clock.getTime());
      if (ranked.length < 12) {
        await db.prepare("UPDATE stonklet_spotlight_runs SET status='insufficient-coverage',inputs_json=? WHERE hour=?").bind(JSON.stringify(ranked), hour).run();
        return "insufficient-coverage";
      }
      const research = new Map<string, CatalystResearch>();
      const queue = [...ranked], read = researchReader();
      // Four concurrent identities; shared feeds fetched once per evaluation.
      await Promise.all(Array.from({ length: 4 }, async () => {
        while (queue.length) {
          const candidate = queue.shift()!;
          research.set(candidate.pairId, await loadSpotlightResearch(env, candidate.pairId, now, read));
        }
      }));
      const candidates = await trendingNewsEntries(ranked, research, now);
      const fresh: SpotlightThesis[] = [];
      for (const item of candidates) {
        const existing = await db.prepare("SELECT id FROM stonklet_spotlight_theses WHERE id=?").bind(item.id).first();
        if (!existing) fresh.push(item);
        if (fresh.length === 10) break;
      }
      const thesis = fresh[0];
      await db.prepare("UPDATE stonklet_spotlight_runs SET inputs_json=? WHERE hour=?")
        .bind(JSON.stringify({ ranked, research: Object.fromEntries(research) }), hour).run();
      if (!thesis) {
        const status = [...research.values()].filter(item => item.status !== "unavailable").length < 12 ? "research-unavailable" : "no-news";
        await db.prepare("UPDATE stonklet_spotlight_runs SET status=? WHERE hour=?").bind(status, hour).run();
        return status;
      }
      // D1 batch is transactional. Administrative disable wins even during an in-flight run.
      await db.batch([
        ...fresh.map(item => db.prepare(`INSERT OR IGNORE INTO stonklet_spotlight_theses(id,pair_id,selected_at,published,thesis_json)
          SELECT ?,?,?,CASE WHEN mode='live' THEN 1 ELSE 0 END,? FROM stonklet_spotlight_control WHERE id=1 AND mode!='off'`)
          .bind(item.id, item.pairId, now, JSON.stringify(item))),
        db.prepare(`UPDATE stonklet_spotlight_control SET current_thesis_id=?,updated_at=? WHERE id=1 AND mode='live'
          AND EXISTS (SELECT 1 FROM stonklet_spotlight_theses WHERE id=? AND published=1 AND withdrawn_at IS NULL)`)
          .bind(thesis.id, now, thesis.id),
        db.prepare(`UPDATE stonklet_spotlight_runs SET status=CASE
          WHEN EXISTS(SELECT 1 FROM stonklet_spotlight_theses WHERE id=? AND published=1) THEN 'published'
          WHEN EXISTS(SELECT 1 FROM stonklet_spotlight_theses WHERE id=?) THEN 'shadow' ELSE 'disabled' END,
          evaluated_at=?,error=NULL WHERE hour=?`).bind(thesis.id, thesis.id, now, hour),
      ]);
      return (await db.prepare("SELECT status FROM stonklet_spotlight_runs WHERE hour=?").bind(hour).first<{ status: string }>())?.status ?? "disabled";
    } catch (error) {
      await db.prepare("UPDATE stonklet_spotlight_runs SET status='failed', error=? WHERE hour=?")
        .bind((error instanceof Error ? error.message : String(error)).slice(0, 300), hour).run();
      console.warn(JSON.stringify({ message: "stonklet_spotlight_failed", hour }));
      return "failed";
    }
  } finally { await releaseStonkletWork(db, "spotlight", owner); }
}

export async function readSpotlight(db: D1Database, id?: string | null, preview = false): Promise<SpotlightResponse> {
  const unavailable: SpotlightResponse = { thesis: null, lastEvaluatedAt: null, status: "unavailable" };
  const control = await db.prepare("SELECT * FROM stonklet_spotlight_control WHERE id=1").first<Control>();
  if (!control || (!preview && control.mode !== "live")) return unavailable;
  const recent = await db.prepare(`SELECT thesis_json FROM (
    SELECT thesis_json, selected_at, id,
      json_extract(thesis_json,'$.sources[0].publishedAt') AS source_at,
      ROW_NUMBER() OVER (PARTITION BY pair_id ORDER BY json_extract(thesis_json,'$.sources[0].publishedAt') DESC, selected_at DESC, id ASC) AS stock_rank
    FROM stonklet_spotlight_theses
    WHERE json_extract(thesis_json,'$.strategy')='trending-news-v3' AND withdrawn_at IS NULL ${preview ? "" : "AND published=1"}
  ) WHERE stock_rank=1 ORDER BY source_at DESC, selected_at DESC, id ASC LIMIT 10`).all<ThesisRow>();
  const entries: SpotlightThesis[] = (recent.results ?? []).map(row => JSON.parse(row.thesis_json));
  const selectedId = id ?? entries[0]?.id;
  if (!selectedId) return unavailable;
  const row = await db.prepare(`SELECT thesis_json, withdrawn_at, withdrawal_reason FROM stonklet_spotlight_theses WHERE id=? ${preview ? "" : "AND published=1"}`)
    .bind(selectedId).first<ThesisRow>();
  if (!row) return unavailable;
  const thesis: SpotlightThesis = { ...JSON.parse(row.thesis_json), withdrawnAt: row.withdrawn_at, withdrawalReason: row.withdrawal_reason };
  const last = await db.prepare("SELECT evaluated_at FROM stonklet_spotlight_runs WHERE status IN ('published','shadow','no-news') ORDER BY evaluated_at DESC LIMIT 1").first<{ evaluated_at: string }>();
  return { thesis, entries, lastEvaluatedAt: last?.evaluated_at ?? null, status: spotlightStatus(thesis, Boolean(id && id !== control.current_thesis_id)) };
}
