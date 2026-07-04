import { loadMarketSnapshot, marketJson, type OpenSeaMarketEnv } from "../_lib/openseaMarket.js";

export const onRequestGet: PagesFunction<OpenSeaMarketEnv> = async (context) => {
  try {
    const snapshot = await loadMarketSnapshot(context.env);
    return marketJson(snapshot);
  } catch (error) {
    return marketJson(
      {
        error: "market_state_unavailable",
        message: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    );
  }
};
