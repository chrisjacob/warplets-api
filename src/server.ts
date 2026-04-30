import { serve } from "@hono/node-server";
import app from "./index.js";

/*
 * This file is used for local development only.
 * It MUST NOT be included in the Cloudflare Workers deploy — wrangler uses
 * src/index.ts as the entry point and bundles only what is imported from there.
 * @hono/node-server depends on Node.js built-ins that are incompatible with the
 * Workers runtime.
 */

const port = Number(process.env.PORT ?? "3003");

serve({ fetch: app.fetch, port });

console.log(`Snapflare dev server running on http://localhost:${port}`);
console.log(`Test with:`);
console.log(
  `  curl -sS -H 'Accept: application/vnd.farcaster.snap+json' http://localhost:${port}/`,
);
