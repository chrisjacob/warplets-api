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

export type ProductionScheduledEnv = OpenseaSyncEnv &
	OpenSeaMarketEnv &
	DuneAnalyticsEnv &
	WarpmojiEnv &
	WarpletNotificationEnv &
	EmailIdentityEnv &
	EmailOnboardingEnv &
	StonkletMarketIngestEnv;

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
};

export function scheduleProductionTasks(
	env: ProductionScheduledEnv,
	ctx: ExecutionContext,
	tasks: ProductionScheduledTasks = productionScheduledTasks,
): void {
	scheduleTasks(env, ctx, tasks);
}
