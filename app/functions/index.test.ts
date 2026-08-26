import { describe, expect, it, vi } from "vitest";
import {
  APP_SHARE_DESCRIPTION,
  APP_SHARE_TITLE,
  APP_MINIAPP_DESCRIPTION,
  APP_MINIAPP_TITLE,
  buildCanonicalUrl,
  buildFarcasterManifest,
  getBaseAppId,
  getStatsLaunchLookupPath,
  onRequestGet,
} from "./index";

describe("host-aware favicon fallback", () => {
  it("serves the Warplets ICO when a client requests the conventional favicon URL", async () => {
    const assetFetch = vi.fn(async (_input: RequestInfo | URL) => new Response(new Uint8Array([0, 0, 1, 0]), {
      headers: { "content-type": "image/x-icon" },
    }));
    const response = await onRequestGet({
      request: new Request("https://warplet.10x.meme/favicon.ico"),
      env: { ASSETS: { fetch: assetFetch } },
    } as never);

    expect(new URL((assetFetch.mock.calls[0]?.[0] as Request).url).pathname).toBe("/favicon-warplets-v2.ico");
    expect(response.headers.get("content-type")).toBe("image/x-icon");
  });
});

describe("Base app ownership", () => {
  it("uses independent registrations for the shared production domains", () => {
    expect(getBaseAppId("app.10x.meme")).toBe("6a8e3af7164a4b20f8b98f3a");
    expect(getBaseAppId("warplet.10x.meme")).toBe("6a8dba294f7ceaca3bfa774f");
  });

  it("does not expose a production registration on unregistered hosts", () => {
    expect(getBaseAppId("app-dev.10x.meme")).toBeNull();
    expect(getBaseAppId("drop.10x.meme")).toBeNull();
  });
});

describe("10X app metadata", () => {
  it("uses the requested SEO and Open Graph title", () => {
    expect(APP_SHARE_TITLE).toBe("10X.MEME 🟢 You're Just One Trade Away...");
  });

  it("keeps the requested description in the webpage metadata", () => {
    expect(APP_SHARE_DESCRIPTION).toBe("10X Memes, RWAs, NFTs, AI, Attention & Alpha.");
  });

  it("uses validator-safe Farcaster manifest metadata", () => {
    const manifest = buildFarcasterManifest("app.10x.meme").miniapp;

    expect(APP_MINIAPP_TITLE).toBe("You're Just One Trade Away...");
    expect(APP_MINIAPP_DESCRIPTION).toBe("10X Memes, RWAs, NFTs, AI, Attention and Alpha.");
    expect(manifest.description).toBe(APP_MINIAPP_DESCRIPTION);
    expect(manifest.ogTitle).toBe(APP_MINIAPP_TITLE);
    expect(manifest.ogDescription).toBe(APP_MINIAPP_DESCRIPTION);
    expect(manifest.ogTitle.length).toBeLessThanOrEqual(30);
    expect(`${manifest.description}${manifest.ogDescription}`).not.toMatch(/[@#$%^&*+=/\\|~«»]/);
  });

  it("publishes the current app screenshot", () => {
    expect(buildFarcasterManifest("app.10x.meme").miniapp.screenshotUrls).toEqual([
      "https://app.10x.meme/screenshots/app_1v2.jpg",
    ]);
  });
});

describe("10X Warplets Drop metadata", () => {
  it("describes the completed airdrop in the manifest and Open Graph metadata", () => {
    const manifest = buildFarcasterManifest("drop.10x.meme").miniapp;

    expect(manifest.buttonTitle).toBe("Drop Has Finished");
    expect(manifest.subtitle).toBe("Did you get the free airdrop?");
    expect(manifest.description).toBe("10X Warplets airdropped to 10,000 diamond hands.");
    expect(manifest.ogDescription).toBe("10X Warplets airdropped to 10,000 diamond hands.");
  });
});

describe("canonical URLs", () => {
  it("keeps the Warplet identity while removing search and tracking parameters", () => {
    const requestUrl = new URL(
      "https://warplet.10x.meme/?random=Sports&warplet=8535&clearcache=1&source=notification",
    );

    expect(buildCanonicalUrl(requestUrl)).toBe("https://warplet.10x.meme/?warplet=8535");
  });

  it("normalizes tokenId aliases to the public Warplet parameter", () => {
    const requestUrl = new URL("https://warplet.10x.meme/?tokenId=8535&utm_source=farcaster");

    expect(buildCanonicalUrl(requestUrl)).toBe("https://warplet.10x.meme/?warplet=8535");
  });

  it("removes query parameters from non-detail pages and normalizes trailing slashes", () => {
    const requestUrl = new URL("https://warplet.10x.meme/perks/sports/?clearcache=1");

    expect(buildCanonicalUrl(requestUrl)).toBe("https://warplet.10x.meme/perks/sports");
  });

  it("uses the requested production hostname for apps served by the shared Pages project", () => {
    expect(buildCanonicalUrl(new URL("https://app.10x.meme/?source=pwa"))).toBe("https://app.10x.meme/");
    expect(buildCanonicalUrl(new URL("https://drop.10x.meme/?fid=1129138"))).toBe("https://drop.10x.meme/");
  });
});

describe("dynamic Stats Open Graph routes", () => {
  it("normalizes canonical Market, Activity, holder, and item-activity lookup paths", () => {
    expect(getStatsLaunchLookupPath(new URL("https://warplet.10x.meme/stats/market/30d/sales")))
      .toBe("/stats/market/30d/sales");
    expect(getStatsLaunchLookupPath(new URL("https://warplet.10x.meme/stats/activity/7d/offers")))
      .toBe("/stats/activity/7d/offers");
    expect(getStatsLaunchLookupPath(new URL("https://warplet.10x.meme/stats/holders/top10?wallet=0x1234567890abcdef1234567890abcdef12345678")))
      .toBe("/stats/holders/top10");
    expect(getStatsLaunchLookupPath(new URL("https://warplet.10x.meme/stats/holders?wallet=0x1234567890abcdef1234567890abcdef12345678&utm_source=x")))
      .toBe("/stats/holders?wallet=0x1234567890abcdef1234567890abcdef12345678");
    expect(getStatsLaunchLookupPath(new URL("https://warplet.10x.meme/?event=send&range=all&activity=1&warplet=4512")))
      .toBe("/?warplet=4512&activity=1&range=all&event=send");
  });

  it("does not treat unrelated app routes as Stats snapshot routes", () => {
    expect(getStatsLaunchLookupPath(new URL("https://warplet.10x.meme/perks/memes"))).toBeNull();
  });
});

describe("shared-content Farcaster embeds", () => {
  it.each([
    ["https://warplet.10x.meme/stats/market/30d/floor-price", "View Floor Price"],
    ["https://warplet.10x.meme/stats/activity/7d/offers", "View Activity"],
    ["https://warplet.10x.meme/stats/holders/top10", "View Top 10 Holders"],
    ["https://warplet.10x.meme/stats/holders/top10friends?wallet=0x1234567890abcdef1234567890abcdef12345678", "View Top 10 Friends"],
    ["https://warplet.10x.meme/?warplet=4512&activity=1&range=all&event=send", "View Item #4512 Activity"],
  ])("uses a descriptive View CTA for %s", async (url, expectedTitle) => {
    const response = await onRequestGet({
      request: new Request(url),
      env: { ASSETS: { fetch: vi.fn() } },
      next: vi.fn(async () => new Response("<!doctype html><html><head><title>10X Warplets</title></head><body></body></html>", {
        headers: { "content-type": "text/html" },
      })),
    } as never);

    expect(await response.text()).toContain(`&quot;title&quot;:&quot;${expectedTitle}&quot;`);
  });

  it("uses an audience-facing View CTA for a shared Warplet deep link", async () => {
    const response = await onRequestGet({
      request: new Request("https://warplet.10x.meme/?warplet=8535"),
      env: { ASSETS: { fetch: vi.fn() } },
      next: vi.fn(async () => new Response("<!doctype html><html><head><title>10X Warplets</title></head><body></body></html>", {
        headers: { "content-type": "text/html" },
      })),
    } as never);

    const html = await response.text();
    expect(html).toContain("&quot;title&quot;:&quot;View 10X Warplet #8535&quot;");
    expect(html).toContain("&quot;name&quot;:&quot;10X Warplets&quot;");
    expect(html).not.toContain("&quot;title&quot;:&quot;10X Warplet #8535&quot;");
  });

  it("keeps the normal app-launch CTA on the unfiltered homepage", async () => {
    const response = await onRequestGet({
      request: new Request("https://warplet.10x.meme/"),
      env: { ASSETS: { fetch: vi.fn() } },
      next: vi.fn(async () => new Response("<!doctype html><html><head><title>10X Warplets</title></head><body></body></html>", {
        headers: { "content-type": "text/html" },
      })),
    } as never);

    const html = await response.text();
    expect(html).toContain("&quot;title&quot;:&quot;Open 10X Warplets&quot;");
  });
});

describe("Warplets Farcaster manifest bootstrap", () => {
  it("serves app metadata without an account association during bootstrap", () => {
    const manifest = buildFarcasterManifest("warplet.10x.meme", null);

    expect(manifest).not.toHaveProperty("accountAssociation");
    expect(manifest.miniapp).toMatchObject({
      canonicalDomain: "warplet.10x.meme",
      homeUrl: "https://warplet.10x.meme",
      name: "10X Warplets",
    });
  });

  it("publishes an exact-domain account association once configured", () => {
    const accountAssociation = {
      header: "header",
      payload: "payload",
      signature: "signature",
    };

    expect(
      buildFarcasterManifest("warplet.10x.meme", accountAssociation),
    ).toHaveProperty("accountAssociation", accountAssociation);
  });
});
