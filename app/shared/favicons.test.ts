import { describe, expect, it } from "vitest";
import { APP_FAVICONS, buildFaviconLinks, getHostnameFaviconKey } from "./favicons";

describe("favicons", () => {
  it("selects a distinct cache-busted icon for each app hostname", () => {
    expect(getHostnameFaviconKey("app.10x.meme")).toBe("app");
    expect(getHostnameFaviconKey("warplet.10x.meme")).toBe("warplets");
    expect(getHostnameFaviconKey("stonklet.10x.meme")).toBe("stonklets");
    expect(getHostnameFaviconKey("drop.10x.meme")).toBe("drop");
    expect(new Set(Object.values(APP_FAVICONS).map(({ png }) => png)).size).toBe(Object.keys(APP_FAVICONS).length);
  });

  it("publishes both PNG and ICO favicon links", () => {
    expect(buildFaviconLinks("warplets")).toContain('href="/favicon-warplets-v2.png"');
    expect(buildFaviconLinks("warplets")).toContain('href="/favicon-warplets-v2.ico"');
  });
});
