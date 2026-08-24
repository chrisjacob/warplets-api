import {
  advanceDuneAnalytics,
  rebuildDuneDerivedTables,
  type DuneAnalyticsEnv,
} from "../../_lib/duneAnalytics.js";
import { jsonSecure } from "../../_lib/security.js";

function isLocalRequest(request: Request): boolean {
  const hostname = new URL(request.url).hostname.toLowerCase();
  return hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "::1" ||
    hostname.endsWith(".localhost");
}

export const onRequestPost: PagesFunction<DuneAnalyticsEnv> = async (context) => {
  if (!isLocalRequest(context.request)) {
    return jsonSecure({ error: "not_found" }, { status: 404 });
  }
  const url = new URL(context.request.url);
  try {
    if (url.searchParams.get("rebuild") === "1") {
      await rebuildDuneDerivedTables(context.env.WARPLETS);
      return jsonSecure({ status: "rebuilt", source: "dune-derived-d1" }, {
        headers: { "cache-control": "private, no-store" },
      });
    }
    return jsonSecure(await advanceDuneAnalytics(context.env, {
      force: true,
      execute: url.searchParams.get("execute") === "1",
      backfill: url.searchParams.get("backfill") === "1",
    }), {
      headers: { "cache-control": "private, no-store" },
    });
  } catch (error) {
    return jsonSecure({
      error: "dune_analytics_advance_failed",
      message: error instanceof Error ? error.message : String(error),
    }, {
      status: 500,
      headers: { "cache-control": "private, no-store" },
    });
  }
};
