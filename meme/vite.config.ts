import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { securityHeaders } from "./src/shared/securityHeaders";
const workerPort = Number(process.env.MEME_LOCAL_WORKER_PORT ?? 8797);
if (!Number.isInteger(workerPort) || workerPort < 1024 || workerPort > 65535)
  throw new Error("Invalid local Worker port");
export default defineConfig({
  plugins: [react()],
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
      "/api": { target: `http://127.0.0.1:${workerPort}`, changeOrigin: false },
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
});
