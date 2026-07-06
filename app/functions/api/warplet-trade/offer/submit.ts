import { handleOfferSubmit, type OpenSeaTradeEnv } from "../../../_lib/openseaTrade.js";

export const onRequestPost: PagesFunction<OpenSeaTradeEnv> = async (context) => {
  try {
    return await handleOfferSubmit(context);
  } catch (error) {
    return Response.json(
      { error: "offer_submit_failed", message: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
};
