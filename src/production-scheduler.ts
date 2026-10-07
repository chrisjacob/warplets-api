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
import { ingestSocial } from "../app/functions/_lib/socialIngestion";
import type { SocialEnv } from "../app/functions/_lib/socialStore";

export type ProductionScheduledEnv = OpenseaSyncEnv &
	OpenSeaMarketEnv &
	DuneAnalyticsEnv &
	WarpmojiEnv &
	WarpletNotificationEnv &
	EmailIdentityEnv &
	EmailOnboardingEnv &
	StonkletMarketIngestEnv & StonkletsDailyNotificationEnv & NewsEnv & SocialEnv;

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

export function scheduleProductionTasks(
	env: ProductionScheduledEnv,
	ctx: ExecutionContext,
	tasks: ProductionScheduledTasks = productionScheduledTasks,
): void {
	scheduleTasks(env, ctx, tasks);
  // Separate opt-in task keeps existing scheduler task contracts compatible.
  ctx.waitUntil(ingestSocial(env).catch(error => console.error("social_ingestion_failed", error instanceof Error ? error.message : String(error))));
}
