import { claimStonkletWork, releaseStonkletWork } from "../../_lib/stonkletWorkLease.js";
import { jsonSecure } from "../../_lib/security.js";
import { isStonkletsFlapPreview } from "../../../shared/stonkletsFlapPreview.js";
import { applyFlapPreview, cachedFlapPreviewChange, loadFlapPreviewBoard } from "../../_lib/stonkletFlapPreview.js";
import { loadStockMetricsBatch, loadStockPeriodChanges } from "../../_lib/stonkletMarket.js";
import { loadStonkletDemoMarket, loadStonkletPeriodChanges, marketSnapshotsByPair, marketStatusForSnapshots, type StonkletMarketIngestEnv } from "../../_lib/stonkletIngestion.js";
import { ingestCmcMarketIfDue, loadCmcMarket, mergeCmcMetrics } from "../../_lib/stonkletCmc.js";
import { STONKLETS_CATALOG, emptyMarketMetrics } from "../../../shared/stonkletsCatalog.js";
import { DEFAULT_STONKLET_CHANGE_RANGE, parseStonkletChangeRange, stonkletRangeCacheSeconds } from "../../../shared/stonkletsTime.js";

interface Env extends StonkletMarketIngestEnv {}

type FavouriteAsset = "stock" | "stonklet";

async function favouriteAggregates(db: D1Database): Promise<Map<string, { total: number; momentum7d: number }>> {
  const result = await db.prepare(
    `SELECT pair_id, asset,
            SUM(CASE WHEN active = 1 THEN 1 ELSE 0 END) AS total,
            SUM(CASE WHEN active = 1 AND julianday(favourited_at) >= julianday('now', '-7 days') THEN 1 ELSE 0 END) AS momentum
     FROM stonklet_asset_favourites GROUP BY pair_id, asset`,
  ).all<{ pair_id: string; asset: FavouriteAsset; total: number; momentum: number }>().catch(() => ({ results: [] }));
  return new Map((result.results ?? []).map((row) => [`${row.pair_id}:${row.asset}`, { total: Number(row.total) || 0, momentum7d: Number(row.momentum) || 0 }]));
}

const buildMarketResponse: PagesFunction<Env> = async (context) => {
  const { env, request } = context;
  const url = new URL(request.url);
  const hostname = url.hostname.toLowerCase();
  const preview = isStonkletsFlapPreview(url);
  const rawChange = url.searchParams.get("range") ?? url.searchParams.get("change");
  const changeRange = rawChange == null ? DEFAULT_STONKLET_CHANGE_RANGE : parseStonkletChangeRange(rawChange);
  if (!changeRange) return jsonSecure({ error: "invalid change range" }, { status: 400 });
  const pairId = url.searchParams.get("id");
  const catalog = pairId ? STONKLETS_CATALOG.filter((entry) => entry.id === pairId) : STONKLETS_CATALOG;
  if (!catalog.length) return jsonSecure({ error: "unknown Stonklet" }, { status: 404 });
  if (hostname === "localhost" || hostname === "127.0.0.1" || hostname.includes("-local.")) {
    context.waitUntil(ingestCmcMarketIfDue(env).catch((error) => console.warn("stonklets_cmc_background_refresh_failed", String(error))));
  }
  const [aggregates, metrics, demoSnapshots, cmcMarket, stockPeriodChanges] = await Promise.all([
    favouriteAggregates(env.WARPLETS),
    loadStockMetricsBatch(catalog, env.WARPLETS_KV),
    loadStonkletDemoMarket(env),
    loadCmcMarket(env),
    loadStockPeriodChanges(catalog, changeRange, env.WARPLETS_KV),
  ]);
  const stonkletPeriodChanges = await loadStonkletPeriodChanges(env, changeRange, demoSnapshots, catalog.map((entry) => entry.id));
  const demos = marketSnapshotsByPair(demoSnapshots);
  const entries = catalog.map((entry) => {
    const cmcStock = cmcMarket.get(`${entry.id}:stock`);
    const cmcStonklet = cmcMarket.get(`${entry.id}:stonklet`);
    return {
      ...entry,
      flapPreview: false,
      stock: {
        ...entry.stock,
        contractAddress: entry.stock.contractAddress ?? cmcStock?.contractAddress ?? null,
      },
      stockMetrics: mergeCmcMetrics(metrics.get(entry.id) ?? emptyMarketMetrics(), cmcStock),
      stonkletMetrics: mergeCmcMetrics(demos.get(entry.id)?.metrics ?? emptyMarketMetrics(), cmcStonklet),
      stockPeriodChange: stockPeriodChanges.get(entry.id) ?? null,
      stonkletPeriodChange: stonkletPeriodChanges.get(entry.id) ?? null,
      demoMarket: demos.get(entry.id)?.state ?? null,
      favourites: aggregates.get(`${entry.id}:stonklet`)?.total ?? 0,
      momentum7d: aggregates.get(`${entry.id}:stonklet`)?.momentum7d ?? 0,
      stockFavourites: aggregates.get(`${entry.id}:stock`)?.total ?? 0,
      stockMomentum7d: aggregates.get(`${entry.id}:stock`)?.momentum7d ?? 0,
    };
  });
  let responseEntries = entries;
  if (preview) {
    try {
      responseEntries = applyFlapPreview(entries, await loadFlapPreviewBoard(env.WARPLETS_KV), changeRange);
      // Chart histories load separately as cards approach the viewport.
      if (changeRange !== "1h" && changeRange !== "24h") {
        await Promise.all(responseEntries.map(async entry => {
          if (entry.flapPreview) entry.stonkletPeriodChange = await cachedFlapPreviewChange(env.WARPLETS_KV, entry.demoToken!.contractAddress, changeRange);
        }));
      }
    } catch (error) {
      console.warn("Flap preview unavailable", error instanceof Error ? error.message : String(error));
      return jsonSecure({ error: "Flap preview is temporarily unavailable" }, { status: 503, headers: { "cache-control": "no-store" } });
    }
  }
  const metricValues = responseEntries.flatMap((entry) => [entry.stockMetrics, entry.stonkletMetrics]);
  const liveTimes = metricValues.map((metric) => metric.updatedAt).filter((value): value is string => Boolean(value));
  return jsonSecure({
    entries: responseEntries,
    flapPreview: preview,
    changeRange,
    basis: "price",
    updatedAt: liveTimes.sort().at(-1) ?? null,
    stale: metricValues.some((metric) => metric.status === "stale"),
    demoMarketStatus: marketStatusForSnapshots(demoSnapshots),
  }, {
    headers: { "cache-control": preview ? "no-store" : `public, max-age=15, s-maxage=${stonkletRangeCacheSeconds(changeRange)}, stale-while-revalidate=${Math.max(120, stonkletRangeCacheSeconds(changeRange) * 2)}` },
  });
};

// Cache only the public board; personal favourites remain on their authenticated endpoint.
export const onRequestGet: PagesFunction<Env> = async (context) => {
  const url = new URL(context.request.url);
  const range = parseStonkletChangeRange(url.searchParams.get("range") ?? url.searchParams.get("change") ?? "24h");
  const pairId = url.searchParams.get("id");
  if (!range || (pairId && !STONKLETS_CATALOG.some((entry) => entry.id === pairId))) return buildMarketResponse(context);
  const kv = context.env.WARPLETS_KV;
  if (!kv || isStonkletsFlapPreview(url)) return buildMarketResponse(context);
  const key = `stonklets:board:v1:${url.hostname}:${range}:${pairId ?? "all"}`;
  type Snapshot = { storedAt: number; payload: Record<string, unknown> };
  const cached = await kv.get<Snapshot>(key, "json");
  const refresh = async () => {
    const response = await buildMarketResponse(context);
    if (response.ok) {
      const payload = await response.clone().json() as Record<string, unknown>;
      await kv.put(key, JSON.stringify({ storedAt: Date.now(), payload }), { expirationTtl: 600 });
    }
    return response;
  };
  if (cached && Date.now() - cached.storedAt < 300_000) {
    const stale = Date.now() - cached.storedAt >= 30_000;
    if (stale) context.waitUntil((async () => {
      const lease = await claimStonkletWork(context.env.WARPLETS, key, 120);
      if (!lease) return;
      try { await refresh(); }
      finally { await releaseStonkletWork(context.env.WARPLETS, key, lease); }
    })().catch((error) => console.warn("stonklets_board_refresh_failed", String(error))));
    return jsonSecure({ ...cached.payload, stale: cached.payload.stale === true, refreshing: stale }, {
      headers: { "cache-control": "public, max-age=15", "x-stonklets-cache": stale ? "stale" : "hit" },
    });
  }
  return refresh();
};
