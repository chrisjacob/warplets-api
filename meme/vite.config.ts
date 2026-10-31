import { defineConfig, type UserConfig } from "vite";
import react from "@vitejs/plugin-react";
import { securityHeaders } from "./src/shared/securityHeaders";
import { rootMeta } from "./src/shared/rootMeta";
const qaPort = Number(process.env.MEME_LOCAL_QA_PORT ?? 8801);
if (!Number.isInteger(qaPort) || qaPort < 1024 || qaPort > 65535)
  throw Error("Invalid local QA port");
export default defineConfig(({ mode }) => {
  const workerPort = Number(
    process.env.MEME_LOCAL_WORKER_PORT ?? (mode === "review" ? 8800 : 8797),
  );
  if (!Number.isInteger(workerPort) || workerPort < 1024 || workerPort > 65535)
    throw Error("Invalid local Worker port");
  return {
    plugins: [
      {
        name: "local-launchpad-admin",
        configureServer(server) {
          server.middlewares.use(async (req, res, next) => {
            if ((req.url ?? "").split("?")[0] !== "/__adminhidden/meme")
              return next();
            const { memeAdminPage } = await import(
              "../app/functions/_lib/memeAdminPage"
            );
            const response = memeAdminPage(true);
            res.writeHead(
              response.status,
              Object.fromEntries(response.headers),
            );
            res.end(await response.text());
          });
        },
      },
      react(),
      {
        name: "launchpad-social-meta",
        transformIndexHtml(html, context) {
          const origin =
            process.env.MEME_PUBLIC_ORIGIN ||
            (context.server
              ? `http://127.0.0.1:${context.server.config.server.port}`
              : undefined);
          return html.replace("<!--launchpad-social-meta-->", rootMeta(origin));
        },
      },
    ],
    define: {
      "import.meta.env.VITE_BASE_ACCOUNT_ENABLED": JSON.stringify("true"),
      "import.meta.env.VITE_WEB_WALLET_ENABLED": JSON.stringify("true"),
      "import.meta.env.VITE_TRUSTCONNECT_ENABLED": JSON.stringify("true"),
    },
    server: {
      headers: securityHeaders,
      cors: false,
      host: "127.0.0.1",
      port: 5194,
      strictPort: true,
      proxy: {
        "/__qa": { target: `http://127.0.0.1:${qaPort}`, changeOrigin: false },
        "/api": {
          target: `http://127.0.0.1:${workerPort}`,
          changeOrigin: false,
        },
      },
      fs: {
        strict: true,
        deny: [
          ".env",
          ".env.*",
          "**/.dev.vars*",
          "**/.wrangler/**",
          "**/.tmp/**",
          "**/.git/**",
        ],
      },
    },
    preview: {
      host: "127.0.0.1",
      port: 5195,
      strictPort: true,
      headers: securityHeaders,
    },
    build: { manifest: true },
  } satisfies UserConfig;
});
