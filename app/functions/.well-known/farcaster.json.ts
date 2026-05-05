/**
 * GET /.well-known/farcaster.json
 *
 * Host-aware Farcaster manifest. Serves a different manifest per subdomain.
 *
 * Each subdomain needs its own accountAssociation signed for that domain.
 * Generate via: https://warpcast.com/~/developers/mini-apps → "Add domain"
 */

// --------------------------------------------------------------------------
// accountAssociation for app.10x.meme  (FID 1129138, already registered)
// --------------------------------------------------------------------------
const APP_ASSOCIATION = {
  header:
    "eyJmaWQiOjExMjkxMzgsInR5cGUiOiJhdXRoIiwia2V5IjoiMHg0NzA5YTRCMTJEQWYwZUVEYUUwZWY0OEEyOGEwNTY2NDBEZWUwODQ2In0",
  payload: "eyJkb21haW4iOiJhcHAuMTB4Lm1lbWUifQ",
  signature:
    "JstfeHToe/7YhAoEZbwRmzOcwWnH5F1muSdJ+n4q0fB4JrJOtwN61xpIszl2XzbC9bQZd8+oOnUI2CchshE9XRs=",
};

// --------------------------------------------------------------------------
// accountAssociation for drop.10x.meme  (TODO — replace placeholder)
// Generate at: https://warpcast.com/~/developers/mini-apps → "Add domain"
// Enter domain: drop.10x.meme  →  copy the resulting JSON here
// --------------------------------------------------------------------------
const DROP_ASSOCIATION = {
    "header": "eyJmaWQiOjExMjkxMzgsInR5cGUiOiJhdXRoIiwia2V5IjoiMHg0NzA5YTRCMTJEQWYwZUVEYUUwZWY0OEEyOGEwNTY2NDBEZWUwODQ2In0",
    "payload": "eyJkb21haW4iOiJkcm9wLjEweC5tZW1lIn0",
    "signature": "EYVGQ7agQ+KoXvdu9vu4zsrEXk97yRwrMIeeVr9DqW11L748hmLKwCRMLL91N8nFOZRPQHr4dcQ52HM0Ds9yixw="
};

const DROP_ASSOCIATION_READY =
  !DROP_ASSOCIATION.header.startsWith("REPLACE_");

function buildManifest(
  association: { header: string; payload: string; signature: string },
  miniapp: object
) {
  return { accountAssociation: association, miniapp };
}

export const onRequestGet: PagesFunction = (context) => {
  const host = new URL(context.request.url).hostname;

  // ── drop.10x.meme ─────────────────────────────────────────────────────────
  if (host === "drop.10x.meme" || host === "drop-dev.10x.meme") {
    const association = DROP_ASSOCIATION_READY ? DROP_ASSOCIATION : APP_ASSOCIATION;
    const manifest = buildManifest(association, {
      version: "1",
      name: "10X Warplets Drop",
      canonicalDomain: host === "drop-dev.10x.meme" ? "drop-dev.10x.meme" : "drop.10x.meme",
      homeUrl: `https://${host}`,
      iconUrl: "https://drop.10x.meme/icon.png",
      imageUrl: "https://drop.10x.meme/embed.png",
      heroImageUrl: "https://drop.10x.meme/hero.png",
      buttonTitle: "Claim Your Warplet",
      splashImageUrl: "https://drop.10x.meme/splash.png",
      splashBackgroundColor: "#000000",
      webhookUrl: "https://app.10x.meme/webhook",
      castShareUrl: `https://${host}`,
      subtitle: "Don't miss out.",
      description: "Claim your 10X Warplet NFT before it's gone.",
      primaryCategory: "social",
      tags: ["10x", "warplets", "farcaster", "nft", "drop"],
      tagline: "Your Warplet is waiting.",
      ogTitle: "10X Warplets Drop",
      ogDescription: "Claim your 10X Warplet NFT before it's gone.",
      ogImageUrl: "https://drop.10x.meme/embed.png",
    });
    return Response.json(manifest, {
      headers: { "cache-control": "no-store" },
    });
  }

  // ── app.10x.meme (default) ────────────────────────────────────────────────
  const manifest = buildManifest(APP_ASSOCIATION, {
    version: "1",
    name: "10X",
    canonicalDomain: "app.10x.meme",
    homeUrl: "https://app.10x.meme",
    iconUrl: "https://app.10x.meme/icon.png",
    imageUrl: "https://app.10x.meme/embed.png",
    heroImageUrl: "https://app.10x.meme/hero.png",
    buttonTitle: "Open 10X",
    splashImageUrl: "https://app.10x.meme/splash.png",
    splashBackgroundColor: "#000000",
    webhookUrl: "https://app.10x.meme/webhook",
    castShareUrl: "https://app.10x.meme",
    subtitle: "Don't miss out.",
    description: "10X Network. 10X Warplets. 10X Memecoins.",
    primaryCategory: "social",
    screenshotUrls: [
      "https://app.10x.meme/screenshots/1.jpg",
      "https://app.10x.meme/screenshots/2.jpg",
      "https://app.10x.meme/screenshots/3.jpg",
    ],
    tags: ["10x", "warplets", "farcaster", "nft", "memecoins"],
    tagline: "Don't miss out.",
    ogTitle: "10X",
    ogDescription: "Builders, capital and signal - aligned.",
    ogImageUrl: "https://app.10x.meme/embed.png",
  });
  return Response.json(manifest, {
    headers: { "cache-control": "no-store" },
  });
};
