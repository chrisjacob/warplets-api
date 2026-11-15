# Dark design and supported posts — review guide

## Local review

Open https://app-local.10x.meme and refresh after the final app restart recorded in MORNING_HANDOFF. No production deployment is part of this change.

1. **Home:** dark emerald surfaces, bright green primary actions, category chips, a collectible hero and featured token portraits. Use the keyboard to follow category links and open/close the wallet dialog.
2. **Tokens and user rankings:** larger artwork, clear names and readable mobile rows. Public QA portraits still illustrate simulated activity; they do not identify real participants or imply endorsement.
3. **NFTs:** Genesis uses cached 10X Warplet images. Seasons includes five original CATE, PEPE, DOGE, WIF and ANSEM black-bull concept artworks. These are preview art, not committed reveal metadata or approved releases. Unrevealed NFTs remain concealed. Existing Levels, traits, ownership and economic data are unchanged.
4. **Earn:** new submissions accept shared Farcaster or X post links. Profile pages, feeds, shortened links and other websites are rejected. A supported domain does not establish authorship, content quality or safety.
5. **Post previews:** use “View post” on your submissions or “View winning post” on a published winner. The app renders source-labelled text without executing third-party embed HTML/scripts or loading external media. Only supported original-post links are offered. Private or deleted posts can be unavailable.

## Capture and scoring limits

Public previews and saved scoring evidence are distinct. An owner may view their verified saved capture. Other viewers may read only a fresh public-source preview of the exact qualified submission recorded as a published winner. Pending submissions and private review captures are not public.

Farcaster's public reader can supply text and a hashed source receipt. Text-only posts can feed an explicit operator capture; media requires separate review. X's public oEmbed response supplies an excerpt, not a guaranteed complete post. Full-source evidence is required before scoring it. No paid model call or automatic final moderation is enabled by this work. AI output is not inherently unbiased; calibration, authorship checks, appeals and human oversight remain required.

## Artwork provenance

The built-in image generator produced five original Season images; optimized WebP copies are committed under `platform/site/src/assets/collectibles`. Six public Warplet images were retrieved from `warplets.10x.meme` using URLs already recorded in the repository. Delivery artwork totals approximately372KB across11files, with lazy loading and hashed same-origin URLs. [Prompts, sources and hashes](../site/src/assets/collectibles/provenance.json) and [artwork limitations](../site/src/assets/collectibles/README.md) are recorded alongside the assets.

## Verification

Local checks pass: 38 frontend tests, TypeScript/build, 12 source/privacy/capture tests, the final 7 source-access/capture regressions, 6 Node/Worker checks, an additional Worker owner-content check and 6 contract checks. Both Chromium and WebKit passed the dark design at 320/390/1280 pixels and post cards at 320/1280 pixels. Chromium also passed the existing review/appeals flow at 320/390/1280 pixels. Full combined CI is pending; its exact product commit and result will be recorded in MORNING_HANDOFF.

Local screenshots: `work/dark-design-final-chromium`, `work/dark-design-final-webkit`, `work/post-content-chromium` and `work/post-content-webkit`. Public profile screenshots stay untracked. [Operator capture and source limitations](../earn/SUPPORTED_POSTS.md).

## Remaining production work

Approve final collection artwork, themes and mint terms; obtain dependable supported-source access and full X capture; verify creator identity and media; calibrate scoring against a representative rubric; approve model/provider budgets and operational review policies. Hosted security, recovery and financial release gates remain separate and unapproved.
