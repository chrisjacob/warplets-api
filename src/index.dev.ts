import { createApp } from "./app";
import { runOpenseaSync, type OpenseaSyncEnv } from "./opensea-sync";
import {
  processNotificationQueue,
  type NotificationQueueWakeMessage,
  type WarpletNotificationEnv,
} from "../app/functions/_lib/warpletNotifications";

process.env.SNAP_PUBLIC_BASE_URL = "https://api-dev.10x.meme";

// crypto.randomUUID() is not allowed at module (global) scope in the Workers
// runtime. We generate the token lazily on the first fetch() call instead.
// The app instance is cached at module scope so the token remains stable for
// the lifetime of the isolate — the dev-tunnel health check uses it to confirm
// that api-dev.10x.meme is routing to THIS local Wrangler instance.
let _app: ReturnType<typeof createApp> | undefined;

export default {
  fetch(req: Request, env: unknown, ctx: ExecutionContext) {
    if (!_app) {
      _app = createApp({
        skipJFSVerification: true,
        devTunnelToken: globalThis.crypto.randomUUID(),
      });
    }

    // Dev-only: manually trigger the OpenSea sync via HTTP
    const url = new URL(req.url);
    if (url.pathname === "/__dev/sync-now") {
      ctx.waitUntil(
        runOpenseaSync(env as OpenseaSyncEnv).then((result) => {
          console.log("[dev] sync-now result:", result);
        }),
      );
      return Response.json({ ok: true, message: "sync triggered" });
    }

    return _app.fetch(req, env, ctx);
  },

  async queue(
    batch: MessageBatch<NotificationQueueWakeMessage>,
    env: OpenseaSyncEnv & WarpletNotificationEnv,
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
        message: "Development notification queue consumer failed",
        error: error instanceof Error ? error.message : String(error),
        batchSize: batch.messages.length,
      }));
      batch.retryAll({ delaySeconds: 30 });
    }
  },
};
