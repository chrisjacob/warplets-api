import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./seed",
  testMatch: "*.spec.mjs",
  workers: 1,
  fullyParallel: false,
  timeout: 90000,
  reporter: "list",
  outputDir: "../../.tmp/meme-qa/seed-browser",
  use: { baseURL: "http://127.0.0.1:5197", screenshot: "only-on-failure" },
  projects: [
    { name: "desktop", use: { viewport: { width: 1280, height: 900 } } },
    { name: "mobile", use: { viewport: { width: 390, height: 844 } } },
  ],
  webServer: [
    {
      command: "node seed/server.mjs",
      url: "http://127.0.0.1:8802/__qa/context",
      timeout: 180000,
      reuseExistingServer: false,
      env: {
        MEME_SEED_PORT: "8802",
        MEME_SEED_FRONTEND_PORT: "5197",
        MEME_SEED_STORAGE: "meme-qa/seed-browser-" + Date.now(),
      },
    },
    {
      command:
        "node ../../meme/node_modules/vite/bin/vite.js ../../meme --config ../../meme/vite.config.ts --port 5197 --strictPort",
      url: "http://127.0.0.1:5197",
      timeout: 60000,
      reuseExistingServer: false,
      env: {
        MEME_LOCAL_QA_PORT: "8802",
        MEME_LOCAL_WORKER_PORT: "8798",
        VITE_WALLETCONNECT_PROJECT_ID: "",
      },
    },
  ],
});
