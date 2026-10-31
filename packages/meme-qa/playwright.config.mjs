import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./browser",
  testMatch: "*.spec.mjs",
  workers: 1,
  fullyParallel: false,
  timeout: 60000,
  outputDir: "../../.tmp/meme-qa/browser",
  reporter: [
    ["list"],
    ["json", { outputFile: "../../.tmp/meme-qa/browser-results.json" }],
  ],
  use: {
    baseURL: "http://127.0.0.1:5196",
    trace: "off",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "desktop", use: { viewport: { width: 1280, height: 900 } } },
    { name: "mobile-viewport", use: { viewport: { width: 390, height: 844 } } },
    {
      name: "mobile-webkit",
      testMatch: "mobile-brand.spec.mjs",
      use: {
        browserName: "webkit",
        viewport: { width: 390, height: 844 },
        isMobile: true,
        hasTouch: true,
      },
    },
  ],
  webServer: [
    {
      command:
        "node ../../meme/node_modules/tsx/dist/cli.mjs browser/server.ts",
      url: "http://127.0.0.1:8798/__qa/health",
      reuseExistingServer: false,
      timeout: 60000,
      env: { MEME_QA_HARNESS: "local-disposable" },
    },
    {
      command:
        "node ../../meme/node_modules/vite/bin/vite.js ../../meme --config ../../meme/vite.config.ts --port 5196 --strictPort",
      url: "http://127.0.0.1:5196",
      reuseExistingServer: false,
      timeout: 60000,
      env: {
        MEME_LOCAL_WORKER_PORT: "8798",
        // Keep ordinary regression offline, regardless of local QA settings.
        VITE_WALLETCONNECT_PROJECT_ID: "",
      },
    },
  ],
});
