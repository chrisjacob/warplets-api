import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ProgressiveNotificationImage, { getRetriedImageUrl } from "./ProgressiveNotificationImage";

describe("progressive notification image retries", () => {
  it("uses the canonical image URL for the first request", () => {
    expect(getRetriedImageUrl("https://warplets.10x.meme/5019.png", 0))
      .toBe("https://warplets.10x.meme/5019.png");
  });

  it("cache-busts retries without discarding existing query parameters", () => {
    expect(getRetriedImageUrl("https://warplets.10x.meme/5019.png?v=2", 2))
      .toBe("https://warplets.10x.meme/5019.png?v=2&10x-image-retry=2");
  });

  it("cache-busts same-origin fallback retries", () => {
    expect(getRetriedImageUrl("/preview.jpg", 1))
      .toBe("/preview.jpg?10x-image-retry=1");
  });

  it("renders a same-origin last-resort image behind both remote sources", () => {
    const markup = renderToStaticMarkup(
      createElement(ProgressiveNotificationImage, {
        highResolutionSrc: "https://warplets.10x.meme/5019.png",
        fallbackSrc: "https://warplets.10x.meme/5019.jpg",
        revealPercent: 0,
      }),
    );

    expect(markup).toContain('src="/splash_search.png"');
    expect(markup).toContain('src="https://warplets.10x.meme/5019.jpg"');
    expect(markup).toContain('src="https://warplets.10x.meme/5019.png"');
  });
});
