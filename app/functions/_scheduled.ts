import { ingestOpenSeaMarket, type OpenSeaMarketEnv } from "./_lib/openseaMarket.js";
import { runWarpletsNotificationJobs } from "./_lib/warpletNotifications.js";
import { processEmailIdentityOutbox, type EmailIdentityEnv } from "./_lib/emailIdentityClaims.js";

export const onSchedule = async (
  _event: ScheduledController,
  env: OpenSeaMarketEnv & EmailIdentityEnv,
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
  context.waitUntil(
    processEmailIdentityOutbox(env).catch((error) => {
      console.error("Email identity outbox scheduled sync failed", error);
    }),
  );
};
