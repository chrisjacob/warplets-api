import { processNewsJob, type NewsJob } from "../app/functions/_lib/stonkletNews";
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
		batch: MessageBatch<NotificationQueueWakeMessage | NewsJob>,
		env: ProductionScheduledEnv,
	): Promise<void> {
        if (batch.queue?.startsWith("stonklets-news")) {
            await Promise.all(batch.messages.map(async message => {
                try { await processNewsJob(env, message.body as NewsJob); message.ack(); }
                catch (error) { console.error("stonklet_news_job_failed", String(error).slice(0,250)); message.retry({ delaySeconds: 180 }); }
            }));
            return;
        }
		try {
			await processNotificationQueue(
				env,
				Math.min(100, Math.max(20, batch.messages.length)),
				batch.messages.map((message) => Number((message.body as NotificationQueueWakeMessage)?.queueId)),
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
