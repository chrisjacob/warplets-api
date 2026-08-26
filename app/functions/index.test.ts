import { describe, expect, it, vi } from "vitest";
import {
  APP_SHARE_DESCRIPTION,
  APP_SHARE_TITLE,
  buildCanonicalUrl,
  buildFarcasterManifest,
  getBaseAppId,
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

  it("uses the requested description in the app manifest", () => {
    expect(APP_SHARE_DESCRIPTION).toBe("10X Memes, RWAs, NFTs, AI, Attention & Alpha.");
    expect(buildFarcasterManifest("app.10x.meme").miniapp.description).toBe(APP_SHARE_DESCRIPTION);
  });

  it("publishes the current app screenshot", () => {
    expect(buildFarcasterManifest("app.10x.meme").miniapp.screenshotUrls).toEqual([
      "https://app.10x.meme/screenshots/app_1v2.jpg",
    ]);
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
