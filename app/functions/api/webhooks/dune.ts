import {
  isDuneWebhookAuthorized,
  resolveDuneWebhook,
  type DuneAnalyticsEnv,
} from "../../_lib/duneAnalytics.js";
import { jsonSecure, rateLimit } from "../../_lib/security.js";

type Env = DuneAnalyticsEnv & { WARPLETS_KV?: KVNamespace };

export const onRequestPost: PagesFunction<Env> = async (context) => {
  if (!isDuneWebhookAuthorized(context.env, context.request)) {
    return jsonSecure({ error: "not_found" }, { status: 404 });
  }
  const requestRate = await rateLimit(
    context.env.WARPLETS_KV,
    "dune-webhook",
    "configured-query-results",
    10,
    60,
  );
  if (!requestRate.allowed) {
    return jsonSecure(
      { error: "rate_limited", retryAfterSeconds: requestRate.retryAfterSeconds },
      {
        status: 429,
        headers: {
          "cache-control": "private, no-store",
          "retry-after": String(requestRate.retryAfterSeconds),
        },
      },
    );
  }

  try {
    // The notification is not trusted as data. resolveDuneWebhook validates the
    // configured query ID and fetches the execution from Dune using the private
    // server-side API key before any row is ingested.
    return jsonSecure(await resolveDuneWebhook(context.env, context.request), {
      headers: { "cache-control": "private, no-store" },
    });
  } catch (error) {
    return jsonSecure({
      error: "dune_webhook_failed",
      message: error instanceof Error ? error.message : String(error),
    }, {
      status: 400,
      headers: { "cache-control": "private, no-store" },
    });
  }
};
