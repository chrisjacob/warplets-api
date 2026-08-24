import { createApp } from "./app";
import {
	scheduleProductionTasks,
	type ProductionScheduledEnv,
} from "./production-scheduler";

const app = createApp();

export default {
	fetch: app.fetch.bind(app),

	async scheduled(
		_event: ScheduledEvent,
		env: ProductionScheduledEnv,
		ctx: ExecutionContext,
	): Promise<void> {
		scheduleProductionTasks(env, ctx);
	},
};
