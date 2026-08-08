import { ingestOpenSeaMarket, type OpenSeaMarketEnv } from "./_lib/openseaMarket.js";
import { runWarpletsNotificationJobs } from "./_lib/warpletNotifications.js";

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
  context.waitUntil(
    runWarpletsNotificationJobs(env).catch((error) => {
      console.error("Warplets notification scheduled jobs failed", error);
    }),
  );
};
