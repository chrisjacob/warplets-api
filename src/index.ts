import { createApp } from "./app";
import {
	scheduleProductionTasks,
	type ProductionScheduledEnv,
} from "./production-scheduler";
import {
	processNotificationQueue,
	type NotificationQueueWakeMessage,
} from "../app/functions/_lib/warpletNotifications";

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

	async queue(
		batch: MessageBatch<NotificationQueueWakeMessage>,
		env: ProductionScheduledEnv,
	): Promise<void> {
		try {
			await processNotificationQueue(
				env,
				Math.min(100, Math.max(20, batch.messages.length)),
				batch.messages.map((message) => Number(message.body?.queueId)),
			);
			batch.ackAll();
		} catch (error) {
			console.error(JSON.stringify({
				message: "Notification queue consumer failed",
				error: error instanceof Error ? error.message : String(error),
				batchSize: batch.messages.length,
			}));
			batch.retryAll({ delaySeconds: 30 });
		}
	},
};
