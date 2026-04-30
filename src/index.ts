import { createApp } from "./app";
import { runOpenseaSync, type OpenseaSyncEnv } from "./opensea-sync";

const app = createApp();

export default {
	fetch: app.fetch.bind(app),

	async scheduled(
		_event: ScheduledEvent,
		env: unknown,
		ctx: ExecutionContext,
	): Promise<void> {
		ctx.waitUntil(runOpenseaSync(env as OpenseaSyncEnv));
	},
};
