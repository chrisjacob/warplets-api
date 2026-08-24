import {
  loadOneTokenSnapshot,
  marketJson,
  refreshOneTokenMarket,
  type OpenSeaMarketEnv,
} from "../../_lib/openseaMarket.js";

export const onRequestGet: PagesFunction<OpenSeaMarketEnv> = async (context) => {
  const tokenId = Number(context.params.tokenId);
  if (!Number.isInteger(tokenId) || tokenId <= 0) {
    return marketJson({ error: "invalid_token_id" }, { status: 400 });
  }

  try {
    const url = new URL(context.request.url);
    if (url.searchParams.get("refresh") === "1") {
      return marketJson(await refreshOneTokenMarket(context.env, tokenId, context.request));
    }

    return marketJson({
      tokenId,
      snapshot: await loadOneTokenSnapshot(context.env, tokenId),
      refreshed: false,
      refreshStatus: "cached",
    });
  } catch (error) {
    return marketJson(
      {
        error: "market_token_state_unavailable",
        message: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    );
  }
};
