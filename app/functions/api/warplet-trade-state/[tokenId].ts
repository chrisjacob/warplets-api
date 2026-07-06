import { handleTradeStateRequest, type OpenSeaTradeEnv } from "../../_lib/openseaTrade.js";

export const onRequestGet: PagesFunction<OpenSeaTradeEnv> = async (context) => {
  const tokenId = Number(context.params.tokenId);
  if (!Number.isInteger(tokenId) || tokenId <= 0) {
    return Response.json({ error: "invalid_token_id" }, { status: 400 });
  }

  try {
    return await handleTradeStateRequest(context, tokenId);
  } catch (error) {
    return Response.json(
      { error: "trade_state_unavailable", message: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
};
