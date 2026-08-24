import { serve } from "@hono/node-server";
import { app } from "./index.js";

const port = Number.parseInt(process.env.PORT ?? "3003", 10);

serve({ fetch: app.fetch, port }, ({ port: boundPort }) => {
  console.log(`Archived Drop Snap listening on http://localhost:${boundPort}/drop`);
});
