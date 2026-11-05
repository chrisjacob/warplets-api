import { runOpenseaSync, type OpenseaSyncEnv } from "./opensea-sync";
import {
	ingestOpenSeaMarketIfDue,
	type OpenSeaMarketEnv,
} from "../app/functions/_lib/openseaMarket";
import {
	advanceDuneAnalytics,
	type DuneAnalyticsEnv,
} from "../app/functions/_lib/duneAnalytics";
import { processWarpmojiJobs, type WarpmojiEnv } from "./warpmoji";
import {
	runWarpletsNotificationJobs,
	type WarpletNotificationEnv,
} from "../app/functions/_lib/warpletNotifications";
import {
	processEmailIdentityOutbox,
	type EmailIdentityEnv,
} from "../app/functions/_lib/emailIdentityClaims";
import {
	processEmailOnboardingOutbox,
	reconcileUncertainEmailOnboarding,
	type EmailOnboardingEnv,
} from "../app/functions/_lib/emailOnboarding";
import {
	ingestStonkletMarketIfDue,
	type StonkletMarketIngestEnv,
} from "../app/functions/_lib/stonkletIngestion";
import { scheduleTasks, type ScheduledTasks } from "./scheduled-runner";
import { runStonkletsDailyNotifications, type StonkletsDailyNotificationEnv } from "../app/functions/_lib/stonkletsDailyNotifications";
import { scheduleStonkletNews, type NewsEnv } from "../app/functions/_lib/stonkletNews";
import { advanceNetwork, advanceNetworkWallets } from "../app/functions/_lib/network/ingest";
import { importNetworkActivity } from "../app/functions/_lib/network/activity";
import type { NetworkEnv } from "../app/functions/_lib/network/store";

export type ProductionScheduledEnv = OpenseaSyncEnv &
	OpenSeaMarketEnv &
	DuneAnalyticsEnv &
	WarpmojiEnv &
	WarpletNotificationEnv &
	EmailIdentityEnv &
	EmailOnboardingEnv &
	StonkletMarketIngestEnv & StonkletsDailyNotificationEnv & NewsEnv & NetworkEnv;

export type ProductionScheduledTasks = ScheduledTasks<ProductionScheduledEnv>;

const productionScheduledTasks: ProductionScheduledTasks = {
	legacyOpenSea: (env) => runOpenseaSync(env),
	marketOpenSea: (env) => ingestOpenSeaMarketIfDue(env),
	dune: (env) => advanceDuneAnalytics(env),
	warpmoji: (env) => processWarpmojiJobs(env),
	notifications: (env) => runWarpletsNotificationJobs(env),
	emailIdentity: (env) => processEmailIdentityOutbox(env),
	emailOnboarding: (env) => processEmailOnboardingOutbox(env),
	emailOnboardingReconciliation: (env) => reconcileUncertainEmailOnboarding(env),
	stonkletsMarket: (env) => ingestStonkletMarketIfDue(env),
	stonkletsNotifications: (env) => runStonkletsDailyNotifications(env),
	stonkletsSpotlight: (env) => scheduleStonkletNews(env),
};

// Source helpers redact credentials before throwing. Strip URLs as well so
// runtime/D1 failures remain diagnosable without logging provider URLs.
function networkFailure(task: string, error: unknown) {
  const message = error instanceof Error ? error.message.replace(/https?:\/\/\S+/gi, '[source]').slice(0, 180) : 'Unknown failure';
  console.error(task, message);
}

export function scheduleProductionTasks(
	env: ProductionScheduledEnv,
	ctx: ExecutionContext,
	tasks: ProductionScheduledTasks = productionScheduledTasks,
): void {
	scheduleTasks(env, ctx, tasks);
  if (env.NETWORK_INGEST_ENABLED === 'true') {
    ctx.waitUntil(advanceNetwork(env,{coreOnly:true}).catch(error => networkFailure('network_ingestion_failed',error)));
    ctx.waitUntil(advanceNetworkWallets(env).catch(error => networkFailure('network_wallet_refresh_failed',error)));
    ctx.waitUntil(importNetworkActivity(env).catch(error => networkFailure('network_activity_refresh_failed',error)));
  }
}
