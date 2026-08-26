import { describe, expect, it } from "vitest";
import { resolveBaseNotificationConfig, type BaseNotificationsEnv } from "./baseNotifications";

function testEnv(): BaseNotificationsEnv {
  return {
    WARPLETS: {} as D1Database,
    BASE_NOTIFICATIONS_API_KEY: "warplets-key",
    BASE_APP_NOTIFICATIONS_API_KEY: "app-key",
    BASE_APP_URL: "https://warplet.10x.meme",
  };
}

describe("Base notification app configuration", () => {
  it("uses the app registration for app.10x.meme deliveries", () => {
    expect(resolveBaseNotificationConfig(testEnv(), "app")).toEqual({
      apiKey: "app-key",
      appUrl: "https://app.10x.meme/",
    });
  });

  it("preserves the existing Warplets registration", () => {
    expect(resolveBaseNotificationConfig(testEnv(), "warplets")).toEqual({
      apiKey: "warplets-key",
      appUrl: "https://warplet.10x.meme",
    });
  });

  it("does not reuse another app's credentials for unregistered apps", () => {
    expect(resolveBaseNotificationConfig(testEnv(), "drop")).toEqual({
      apiKey: null,
      appUrl: "https://drop.10x.meme/",
    });
  });
});
