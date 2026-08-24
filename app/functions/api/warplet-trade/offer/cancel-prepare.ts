import { handleCancelPrepare, type OpenSeaTradeEnv } from "../../../_lib/openseaTrade.js";

export const onRequestPost: PagesFunction<OpenSeaTradeEnv> = async (context) => {
  try {
    return await handleCancelPrepare(context, "cancel_offer");
  } catch (error) {
    return Response.json(
      { error: "offer_cancel_prepare_failed", message: error instanceof Error ? error.message : String(error) },
      { status: 500, headers: { "cache-control": "no-store" } },
    );
  }
};
