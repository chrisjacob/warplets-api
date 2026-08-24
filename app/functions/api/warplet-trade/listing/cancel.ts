import { handleCancelOrder, type OpenSeaTradeEnv } from "../../../_lib/openseaTrade.js";

export const onRequestPost: PagesFunction<OpenSeaTradeEnv> = async (context) => {
  try {
    return await handleCancelOrder(context, "cancel_listing");
  } catch (error) {
    return Response.json(
      { error: "listing_cancel_failed", message: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
};
