import { describe, expect, it } from "vitest";
import {
  getDefaultLaunchUrl,
  normalizeAppSlug,
  normalizeNotificationAudienceSlug,
  resolveAppSlugFromAppFid,
  resolveAppSlugFromUrl,
} from "./appSlug";

describe("Warplets application identity", () => {
  it.each([
    "https://warplet-local.10x.meme/",
    "https://warplet-dev.10x.meme/stats",
    "https://warplet.10x.meme/offers/item",
    "https://app.10x.meme/warplets/perks/ai",
  ])("resolves %s to the warplets application", (url) => {
    expect(resolveAppSlugFromUrl(new URL(url))).toBe("warplets");
  });

  it("does not retain the old Search application slug or hostname", () => {
    expect(normalizeAppSlug("search")).toBe("app");
    expect(normalizeNotificationAudienceSlug("search")).toBe("app");
    expect(resolveAppSlugFromUrl(new URL("https://search.10x.meme/"))).toBe("app");
  });

  it.each([
    "https://10x.meme/",
    "https://www.10x.meme/",
    "https://app.10x.meme/",
    "https://app-local.10x.meme/",
  ])("scopes %s subscriptions to the 10X application", (url) => {
    expect(resolveAppSlugFromUrl(new URL(url))).toBe("app");
  });

  it("uses the canonical production launch URL", () => {
    expect(getDefaultLaunchUrl("warplets")).toBe("https://warplet.10x.meme/");
  });

  it("maps the registered Warplets Mini App FID independently", () => {
    expect(resolveAppSlugFromAppFid(1234, { warplets: 1234 })).toBe("warplets");
  });
});

describe("Stonklets application identity", () => {
  it.each([
    "https://stonklet-local.10x.meme/",
    "https://stonklet-dev.10x.meme/trade?pair=tesla",
    "https://stonklet.10x.meme/stats",
    "https://app.10x.meme/stonklets/portfolio",
  ])("resolves %s to the isolated Stonklets app", (url) => {
    expect(resolveAppSlugFromUrl(new URL(url))).toBe("stonklets");
  });

  it("uses independent launch and FID mappings", () => {
    expect(getDefaultLaunchUrl("stonklets")).toBe("https://stonklet.10x.meme/");
    expect(resolveAppSlugFromAppFid(9876, { stonklets: 9876 })).toBe("stonklets");
  });
});
