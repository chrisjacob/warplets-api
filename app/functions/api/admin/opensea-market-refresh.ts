import { ingestOpenSeaMarket, marketJson, type OpenSeaMarketEnv } from "../../_lib/openseaMarket.js";
import { requireAdminScope, type SecurityEnv } from "../../_lib/security.js";

type Env = OpenSeaMarketEnv & SecurityEnv;

async function refresh(context: EventContext<Env, string, unknown>) {
  const auth = await requireAdminScope(context, { scope: "market:refresh" });
  if (!auth.ok) return auth.response;

  try {
    const url = new URL(context.request.url);
    return marketJson(await ingestOpenSeaMarket(context.env, {
      bootstrap: url.searchParams.get("bootstrap") === "1",
    }));
  } catch (error) {
    return marketJson(
      {
        error: "market_refresh_failed",
        message: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    );
  }
}

export const onRequestPost: PagesFunction<Env> = refresh;
export const onRequestGet: PagesFunction<Env> = refresh;
