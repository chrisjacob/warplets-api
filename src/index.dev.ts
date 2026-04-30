import { createApp } from "./app";

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
    return _app.fetch(req, env, ctx);
  },
};
