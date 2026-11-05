import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./browser",
  testMatch: "gateway-form.test.mjs",
  workers: 1,
  timeout: 30000,
  outputDir: "../../.tmp/meme-qa/gateway-browser",
  reporter: [
    ["list"],
    ["json", { outputFile: "../../.tmp/meme-qa/gateway-browser-results.json" }],
  ],
  use: {
    viewport: { width: 390, height: 844 },
    trace: "off",
    screenshot: "off",
  },
  projects: [
    { name: "chromium", use: { browserName: "chromium" } },
    { name: "webkit", use: { browserName: "webkit" } },
  ],
});
