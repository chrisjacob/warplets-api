import { describe, expect, it } from "vitest";
import { buildFarcasterManifest } from "./index";

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
