import { ingestOpenSeaMarket, marketJson, type OpenSeaMarketEnv } from "../../_lib/openseaMarket.js";
import { WARPLETS_APP_HOSTS } from "../../../shared/warpletsApp.js";

function isLocalRequest(request: Request): boolean {
  const hostname = new URL(request.url).hostname.toLowerCase();
  return hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "::1" ||
    hostname.endsWith(".localhost") ||
    hostname === WARPLETS_APP_HOSTS[0];
}

export const onRequestPost: PagesFunction<OpenSeaMarketEnv> = async (context) => {
  if (!isLocalRequest(context.request)) {
    return marketJson({ error: "not_found" }, { status: 404 });
  }

  try {
    return marketJson(await ingestOpenSeaMarket(context.env));
  } catch (error) {
    return marketJson(
      {
        error: "market_refresh_failed",
        message: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    );
  }
};
