import { createApp } from "./app";
import { runOpenseaSync, type OpenseaSyncEnv } from "./opensea-sync";
import {
	advanceDuneAnalytics,
	type DuneAnalyticsEnv,
} from "../app/functions/_lib/duneAnalytics";
import { processWarpmojiJobs, type WarpmojiEnv } from "./warpmoji";

const app = createApp();

export default {
	fetch: app.fetch.bind(app),

	async scheduled(
		_event: ScheduledEvent,
		env: unknown,
		ctx: ExecutionContext,
	): Promise<void> {
		const scheduledEnv = env as OpenseaSyncEnv & DuneAnalyticsEnv;
		ctx.waitUntil(runOpenseaSync(scheduledEnv));
		ctx.waitUntil(
			advanceDuneAnalytics(scheduledEnv).catch((error) => {
				console.error("[dune-analytics] scheduled ingest failed", error);
			}),
		);
		ctx.waitUntil(processWarpmojiJobs(scheduledEnv as unknown as WarpmojiEnv));
	},
};
