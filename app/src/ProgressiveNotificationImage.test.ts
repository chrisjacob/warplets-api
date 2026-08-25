import { describe, expect, it } from "vitest";
import { getRetriedImageUrl } from "./ProgressiveNotificationImage";

describe("progressive notification image retries", () => {
  it("uses the canonical image URL for the first request", () => {
    expect(getRetriedImageUrl("https://warplets.10x.meme/5019.png", 0))
      .toBe("https://warplets.10x.meme/5019.png");
  });

  it("cache-busts retries without discarding existing query parameters", () => {
    expect(getRetriedImageUrl("https://warplets.10x.meme/5019.png?v=2", 2))
      .toBe("https://warplets.10x.meme/5019.png?v=2&10x-image-retry=2");
  });
});
