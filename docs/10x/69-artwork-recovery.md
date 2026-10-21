# Token artwork recovery

21 October 2026, Australia/Sydney. The founder identified missing token images as a critical discovery problem. This extends the [original artwork pipeline](15-token-artwork-review.md) while retaining free collection limits and independent scoring/action evidence.

## Findings and completed work

- [x] Inspect actual cached coverage and browser rendering. Initially, 71 current tokens had nine market-image URLs and 63 creation-linked image URLs; their union left seven with no usable URL. An available URL is not proof that its image decoded, and offscreen lazy images are not failed images.
- [x] Identify the actual missing format in retained Pump metadata: PONYX and ADTF use `images.pump.fun/coin-image/...` references, including original IPFS or Irys sources in query parameters. Our old allowlist rejected that host. YO uses a public Supabase token-asset image. These were source-format omissions, not absent artwork.
- [x] Support the observed Pump image path, fixed Irys transaction paths, Twitter profile-image paths and a tightly bounded public Supabase token-asset path. Custom Pinata IPFS pointers are rewritten to the existing fixed gateway; no arbitrary metadata server is contacted. HTTPS, origin/path checks, credential/port restrictions and existing metadata-fetch constraints remain.
- [x] Try validated provider/creation image URLs first, then safe original Pump source pointers and an alternate IPFS image gateway. Unknown nested origins and proxy chains are not followed directly. These are browser image requests: no paid image service, binary proxy, media download or new provider API is introduced. References remain presentation metadata, not proof of ownership or brand authenticity.
- [x] Add local migration `0042_artwork_recovery.sql`: retain at most a 2 KB original image reference privately, record artwork-reader version and own the collector lease. Public artwork responses never return rejected references.
- [x] Revisit old failed readers once under the normal paced collector. Subsequent unsuccessful requests keep the six-hour retry delay. A newly supported cached reference can be adopted without a request only when it matches the saved creation hash and has an original metadata hash and non-future fetched time. Keep the original fetched time/hash; do not fabricate a fresh source observation.
- [x] Prioritize recent tokens lacking a market-provider image. Retain the maximum three selected tokens per minute, 64 KB metadata body limit, ten-second metadata timeout, no redirects and no additional RPC calls.
- [x] Atomically reserve artwork's 120/day subset and the unchanged shared market allowance. Exhaustion charges neither counter; a failed market write rolls back both reservations. HTTP failures still count. Pause, lease expiry/replacement and publication ownership are checked, and a stale collector cannot clear a replacement lease.
- [x] Preserve already cached artwork across inventory changes. Show “Loading artwork…” while a cache lookup is pending and “Image unavailable” only after a missing/failed result. Continue listing observed tokens; image availability does not silently change rankings, eligibility or the selected research cohort.
- [x] Recover PONYX and ADTF from retained references with **zero additional metadata requests**. The existing collector subsequently recovered YO from its retained public-asset reference. PONYX's actual image decoded in browser QA; its token page no longer shows the unavailable placeholder.

Implementation: [image normalization/fallbacks](../../discovery/src/images.ts), [owned collection and accounting](../../discovery/src/artwork.ts), [regressions](../../discovery/src/artwork.test.ts), [browser image/cache handling](../../app/src/discovery/TokenMarket.tsx), [local migration](../../discovery/migrations/0042_artwork_recovery.sql).

## Limits and remaining work

- [ ] Investigate remaining dead IPFS metadata files and unsupported metadata origins. Do not enable arbitrary remote metadata requests, invent artwork, scrape terminal pages or bypass free budgets to fill every tile.
- [ ] Continue observing real image decoding/failover. URL coverage and a successful HTTP header check do not establish browser coverage for the whole inventory. Providers can remove images or stop serving a gateway.
- [ ] Decide long-term artwork refresh and private-reference retention with other presentation-cache policies. No image binary is retained by this work, and a valid image does not establish token safety.

The existing supervisor recovered the local collector during verification; no restart budget, pause state or source quota was reset. No change to the Jupiter/GeckoTerminal pilot's held state, score-v4, research budgets, immutable cohorts, elections or financial permissions. No deploy.

## Verification

Local migration followed a consistent SQLite backup. All 100 original score cohorts and zero outcomes remained byte-identical; foreign keys passed and the source-pilot reservation table stayed empty.

- The later cached inventory contained 69 tokens: 65 had a usable source URL and four still did not. Two tokens had aged out since the initial 71-token snapshot. PONYX, ADTF and YO were the three specific recovered gaps; no image-less token was hidden. Remaining gaps were a failing IPFS metadata file and three unsupported metadata origins. Metadata reservations moved from 47 to 51 inside the existing 120/day subset during recovery; cached adoption made no metadata requests.
- Browser QA confirmed PONYX decoded on its detail page and discovery card (64 px source image), and ADTF decoded on its discovery card (600 px source image). This does not claim every offscreen lazy image was downloaded or independently authenticated.
- All **20 artwork regressions** passed. The full discovery run passed 1,087 tests and hit one existing election-storage test's five-second timeout. The unchanged election-storage suite then passed all 16 checks with `--testTimeout=15000`; no repository test timeout or application/evidence limit was changed. Final artwork rerun passed independently.
- All **81 discovery UI tests**, both project typechecks and the app build passed. Home startup remains **234.1 KiB gzip across 11 chunks**, below 250 KiB. Documentation checks passed 275 local targets across 12 documents; staged whitespace checks passed.
- No new credentials, paid service, image binary storage, score policy or deployment. Unrelated Network work remains outside this milestone.
