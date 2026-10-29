import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
export default defineConfig({
  plugins: [react()],
  define: {
    "import.meta.env.VITE_BASE_ACCOUNT_ENABLED": JSON.stringify("true"),
    "import.meta.env.VITE_WEB_WALLET_ENABLED": JSON.stringify("true"),
    "import.meta.env.VITE_TRUSTCONNECT_ENABLED": JSON.stringify("true"),
  },
  server: {
    host: "127.0.0.1",
    port: 5194,
    strictPort: true,
    proxy: { "/api": { target: "http://127.0.0.1:8797", changeOrigin: false } },
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
  build: { manifest: true },
});
