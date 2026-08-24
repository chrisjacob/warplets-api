import { handleTradeLog, type OpenSeaTradeEnv } from "../../_lib/openseaTrade.js";

export const onRequestPost: PagesFunction<OpenSeaTradeEnv> = async (context) => {
  try {
    return await handleTradeLog(context);
  } catch (error) {
    return Response.json(
      { error: "trade_log_failed", message: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
};
