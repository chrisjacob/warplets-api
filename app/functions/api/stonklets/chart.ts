import { jsonSecure } from "../../_lib/security.js";
import { isStonkletsFlapPreview } from "../../../shared/stonkletsFlapPreview.js";
import { FlapPreviewRateLimitError, loadFlapPreviewChart } from "../../_lib/stonkletFlapPreview.js";
import { loadChart } from "../../_lib/stonkletMarket.js";
import { loadStonkletRangeChart, type StonkletMarketIngestEnv } from "../../_lib/stonkletIngestion.js";
import { STONKLETS_BY_ID } from "../../../shared/stonkletsCatalog.js";
import { DEFAULT_STONKLET_CHANGE_RANGE, parseStonkletChangeRange, stonkletRangeCacheSeconds } from "../../../shared/stonkletsTime.js";

interface Env extends StonkletMarketIngestEnv {}

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const url = new URL(request.url);
  const pair = url.searchParams.get("pair") ?? "";
  const asset = url.searchParams.get("asset");
  const rawRange = url.searchParams.get("range");
  const range = rawRange == null ? DEFAULT_STONKLET_CHANGE_RANGE : parseStonkletChangeRange(rawRange);
  const entry = STONKLETS_BY_ID.get(pair);
  if (!entry) return jsonSecure({ error: "unknown pair" }, { status: 404 });
  if (asset !== "stock" && asset !== "stonklet") return jsonSecure({ error: "asset must be stock or stonklet" }, { status: 400 });
  if (!range) return jsonSecure({ error: "invalid range" }, { status: 400 });
  if (asset === "stonklet" && isStonkletsFlapPreview(url)) {
    const source = url.searchParams.get("source") ?? "";
    if (!/^0x[0-9a-f]{40}$/i.test(source)) return jsonSecure({ error: "invalid preview source" }, { status: 400 });
    try {
      return jsonSecure({ pair, asset, ...await loadFlapPreviewChart(env.WARPLETS_KV, source, range) }, { headers: { "cache-control": "no-store" } });
    } catch (error) {
      if (!(error instanceof FlapPreviewRateLimitError)) throw error;
      return jsonSecure({ error: "Preview chart provider is busy; retry shortly" }, { status: 429, headers: { "cache-control": "no-store", "retry-after": "60" } });
    }
  }
  const cacheSeconds = stonkletRangeCacheSeconds(range);
  const result = asset === "stonklet"
    ? await loadStonkletRangeChart(env, pair, range)
    : await loadChart(pair, asset, env.WARPLETS_KV, range);
  return jsonSecure({ pair, asset, ...result }, {
    headers: { "cache-control": `public, max-age=${Math.min(300, cacheSeconds)}, s-maxage=${cacheSeconds}, stale-while-revalidate=${Math.max(300, cacheSeconds * 2)}` },
  });
};
