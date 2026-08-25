import {
  advanceDuneAnalytics,
  rebuildDuneDerivedTables,
  type DuneAnalyticsEnv,
} from "../../_lib/duneAnalytics.js";
import {
  jsonSecure,
  requireAdminScope,
  type SecurityEnv,
} from "../../_lib/security.js";

type Env = DuneAnalyticsEnv & SecurityEnv;

export function parseDuneQueryId(value: string | null): number | null {
  if (value === null || value.trim() === "") return null;
  const normalized = value.trim();
  if (!/^\d+$/.test(normalized)) throw new Error("queryId must be a positive integer.");
  const queryId = Number(normalized);
  if (!Number.isSafeInteger(queryId) || queryId <= 0) {
    throw new Error("queryId must be a positive integer.");
  }
  return queryId;
}

export const onRequestPost: PagesFunction<Env> = async (context) => {
  const auth = await requireAdminScope(context, { scope: "stats:dune" });
  if (!auth.ok) return auth.response;

  const url = new URL(context.request.url);
  try {
    if (url.searchParams.get("rebuild") === "1") {
      await rebuildDuneDerivedTables(context.env.WARPLETS);
      return jsonSecure({ status: "rebuilt", source: "dune-derived-d1" }, {
        headers: { "cache-control": "private, no-store" },
      });
    }
    return jsonSecure(await advanceDuneAnalytics(context.env, {
      force: url.searchParams.get("force") === "1",
      execute: url.searchParams.get("execute") === "1",
      backfill: url.searchParams.get("backfill") === "1",
      queryId: parseDuneQueryId(url.searchParams.get("queryId")),
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
