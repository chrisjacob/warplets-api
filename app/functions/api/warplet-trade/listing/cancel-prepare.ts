import { handleCancelPrepare, type OpenSeaTradeEnv } from "../../../_lib/openseaTrade.js";

export const onRequestPost: PagesFunction<OpenSeaTradeEnv> = async (context) => {
  try {
    return await handleCancelPrepare(context, "cancel_listing");
  } catch (error) {
    return Response.json(
      { error: "listing_cancel_prepare_failed", message: error instanceof Error ? error.message : String(error) },
      { status: 500, headers: { "cache-control": "no-store" } },
    );
  }
};
