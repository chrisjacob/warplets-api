# Product simplification and public QA artwork

Genesis advisory ballots are retired from the consumer interface, public APIs, SDK and current demo setup. Audience polling can happen separately on social media or Discord; no external poll has been created. Historical migrations, recorded decisions and recovery/economic safeguards remain for compatibility. Retiring an advisory poll does not approve a launch or bypass founder notice requirements.

## Review the local app

Refresh https://app-local.10x.meme to load the new assets.

1. Open **NFTs** and Genesis details: there is no ballots panel or voting form.
2. Open **Tokens** and its performance board: the 90 synthetic token entries now use current public Solana trending-token names and artwork. Open a token detail page to see its name, symbol and source attribution.
3. Open a participant from a leaderboard: the 249 synthetic participants use unique Farcaster handles, display names and portraits. Your connected owner wallet keeps its existing identity.
4. Check narrow and wide layouts, pagination and image loading. The original 90-day history and balances are preserved.

All activity, valuations, wallet associations and rewards remain simulated. These public profiles are display samples, not registered users or endorsements. The trending source includes Solana tokens generally; it is not an assertion that every entry is a memecoin. Operational token IDs and economic symbols remain the original fixtures.

## Data and images

The explicit local importer reads public Farcaster following lists and GeckoTerminal Solana 24-hour trending pools without credentials. The final snapshot contains 249 profiles, 90 tokens and 338 unique cached images for 339 associations, with no selected-image fallbacks. Unsafe, oversized and unavailable candidate images were rejected before selecting the final sample.

The manifest pins source-response hashes, capture time, the unchanged economic snapshot hash and every image hash. Images are bounded raster files, served from local hashed paths; the browser makes no image-provider requests. No data, images or real-profile screenshots are committed to the repository. See [QA refresh instructions](../qa/README.md) for creating a new immutable overlay and starting the app with it.

Current manifest: `work/qa-public-identities-complete-2026-11-14/identities.json`.

Current screenshots and browser results: `work/qa-identities-browser` and `work/qa-identities-browser-webkit`.

## Verification

Both Chromium and WebKit passed at 320 and 1280 pixels, including decoding all 338 cached images, no external requests, owner identity preservation and no horizontal overflow. Frontend types/build and 37 tests pass; 8 QA tests and the ballot/demo regressions pass. [Full combined CI](https://github.com/chrisjacob/warplets-api/actions/runs/43549287399) passed on `62aa4ee`: **1,539 tests**, zero failures, skips or cancellations, plus builds, types, contracts and Earn recovery. [Exact evidence](evidence/product-simplification-2026-11-14.json). Nothing was deployed and no financial capability changed.
