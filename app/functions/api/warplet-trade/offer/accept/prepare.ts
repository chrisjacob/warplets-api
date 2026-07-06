import { handleAcceptOfferPrepare, type OpenSeaTradeEnv } from "../../../../_lib/openseaTrade.js";

export const onRequestPost: PagesFunction<OpenSeaTradeEnv> = async (context) => {
  try {
    return await handleAcceptOfferPrepare(context);
  } catch (error) {
    return Response.json(
      { error: "accept_offer_prepare_failed", message: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
};
