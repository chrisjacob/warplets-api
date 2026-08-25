import { describe, expect, it } from "vitest";
import { buildClickTrackingUrl } from "./notificationTracking.js";

describe("buildClickTrackingUrl", () => {
  it("wraps and attributes a single-recipient notification target", () => {
    const result = new URL(buildClickTrackingUrl({
      notificationId: "warplets:launch test/1",
      targetUrl: "https://warplet.10x.meme/?notificationId=warplets%3Alaunch+test%2F1",
      trackingBaseUrl: "https://warplet.10x.meme/",
      appSlug: "warplets",
      fid: 1129138,
    }));

    expect(result.origin).toBe("https://warplet.10x.meme");
    expect(result.pathname).toBe("/n/warplets%3Alaunch%20test%2F1");
    expect(result.searchParams.get("app")).toBe("warplets");
    expect(result.searchParams.get("fid")).toBe("1129138");
    expect(result.searchParams.get("t")).toBe(
      "https://warplet.10x.meme/?notificationId=warplets%3Alaunch+test%2F1",
    );
  });

  it("omits FID attribution for a multi-recipient target", () => {
    const result = new URL(buildClickTrackingUrl({
      notificationId: "app:announcement",
      targetUrl: "https://app.10x.meme/?notificationId=app%3Aannouncement",
      trackingBaseUrl: "https://app.10x.meme/",
      appSlug: "app",
    }));

    expect(result.searchParams.has("fid")).toBe(false);
  });
});
