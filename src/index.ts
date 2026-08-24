import { createApp } from "./app";
import { runOpenseaSync, type OpenseaSyncEnv } from "./opensea-sync";
import {
	advanceDuneAnalytics,
	type DuneAnalyticsEnv,
} from "../app/functions/_lib/duneAnalytics";
import { processWarpmojiJobs, type WarpmojiEnv } from "./warpmoji";
import {
	processEmailIdentityOutbox,
	type EmailIdentityEnv,
} from "../app/functions/_lib/emailIdentityClaims";
import {
	processEmailOnboardingOutbox,
	reconcileUncertainEmailOnboarding,
} from "../app/functions/_lib/emailOnboarding";

const app = createApp();

export default {
	fetch: app.fetch.bind(app),

	async scheduled(
		_event: ScheduledEvent,
		env: unknown,
		ctx: ExecutionContext,
	): Promise<void> {
		const scheduledEnv = env as OpenseaSyncEnv & DuneAnalyticsEnv & EmailIdentityEnv;
		ctx.waitUntil(runOpenseaSync(scheduledEnv));
		ctx.waitUntil(
			advanceDuneAnalytics(scheduledEnv).catch((error) => {
				console.error("[dune-analytics] scheduled ingest failed", error);
			}),
		);
		ctx.waitUntil(processWarpmojiJobs(scheduledEnv as unknown as WarpmojiEnv));
		ctx.waitUntil(
			processEmailIdentityOutbox(scheduledEnv).catch((error) => {
				console.error("[email-identities] scheduled Resend sync failed", error);
			}),
		);
		ctx.waitUntil(
			processEmailOnboardingOutbox(scheduledEnv).catch((error) => {
				console.error("[email-onboarding] scheduled event dispatch failed", error);
			}),
		);
		ctx.waitUntil(
			reconcileUncertainEmailOnboarding(scheduledEnv).catch((error) => {
				console.error("[email-onboarding] scheduled reconciliation failed", error);
			}),
		);
	},
};
