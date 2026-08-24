import { handleOfferPrepare, type OpenSeaTradeEnv } from "../../../_lib/openseaTrade.js";

export const onRequestPost: PagesFunction<OpenSeaTradeEnv> = async (context) => {
  try {
    return await handleOfferPrepare(context);
  } catch (error) {
    return Response.json(
      { error: "offer_prepare_failed", message: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
};
