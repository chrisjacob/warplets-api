import { ingestOpenSeaMarket, type OpenSeaMarketEnv } from "./_lib/openseaMarket.js";

export const onSchedule = async (
  _event: ScheduledController,
  env: OpenSeaMarketEnv,
  context: ExecutionContext,
) => {
  context.waitUntil(
    ingestOpenSeaMarket(env).catch((error) => {
      console.error("OpenSea market scheduled ingest failed", error);
    }),
  );
};
