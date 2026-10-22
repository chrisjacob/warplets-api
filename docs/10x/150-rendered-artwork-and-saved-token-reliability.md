# Rendered artwork and saved-token reliability

22 October 2026. First product slice of the daily-decision UX/artwork work in [148](148-free-serving-assessment-and-build-order.md), following [149's held serving decision](149-native-builder-and-combined-free-budget.md). This improves image rendering and saved-token continuity; it does not complete F2, qualify token data or approve Free serving/release.

## User-visible changes

- A fixed-size, named artwork frame remains visible while an image loads. An image becomes `loaded` only after nonzero natural dimensions and successful browser decode. A URL, HTTP 200 or metadata response alone is not rendering success. Failed/invalid content advances through the existing allowed source order; exhausted references show **Image unavailable**.
- Each nearby image/decode attempt has an eight-second deadline. Off-screen lazy images acquire no deadline until they approach the viewport, preventing unseen images from expiring before scrolling. Late events/promises from an older attempt cannot mark a replacement loaded or skip its next source. A changed source set resets the attempt sequence; unchanged failures do not trigger an unlimited retry loop.
- The frame keeps the same dimensions through loading, fallback, success and failure, including existing card/table/saved/comparison/detail sizes. Images retain lazy/eager policy, asynchronous decode, `no-referrer`, the existing URL allowlist and gateway rules. Status has an accessible name and a visible fallback; a rendered image never earns score or safety credit.
- Saved tokens can use cache-only metadata artwork even outside the current ranked page. Off-page saved identities join the lookup **only while the saved disclosure is open**. The existing 100-card page and 100-entry shortlist are deduplicated into at most two requests, each within the unchanged 100-address endpoint contract. Closing the disclosure removes that extra polling scope. No artwork URL is added to persisted shortlist records and no stored grade is invented for an off-page token.
- Cached artwork reads have a ten-second deadline and do not overlap within the hook. A failed batch preserves last-good values for still-selected identities and settles new missing values explicitly. Cleanup aborts old selections; stale responses cannot populate another selection. The existing visible-page one-minute poll remains. These are saved-data reads, not provider enrichment requests; extra cache-read demand on an opened full shortlist is not a Free-capacity approval.

## Rendered browser evidence

`scripts/discovery-artwork-browser-study.mjs` runs actual React components in a fresh, agent-owned local headless Chrome profile. The lab supplies synthetic cache records and intercepts image traffic before any external request. It reads no `.dev.vars`, original/live database, provider key or wallet credentials. Images are deterministic test SVGs, not token authenticity evidence. Test controls and the lab entry are outside the app entry points and absent from release assets.

The complete private report is `.tmp/artwork-browser-20261022-150-004/report.json`, SHA-256 **`9c9f2511375f5be5e997d85e5ae633ebd4ed8694628e0d2afd6d284dcc45b9eb`**. Ten scenarios pass:

1. Primary decode, HTTP error fallback, invalid image bytes with HTTP 200, absent and unsafe sources.
2. Stalled download/decode deadlines, ignored late decode resolution and stable frame dimensions.
3. An off-screen stalled image remains pending beyond the first deadline, then receives a full attempt after scrolling.
4. A new source reference recovers a previously exhausted image.
5. Two cache batches cover 200 distinct requested identities; one failed batch does not erase the successful batch.
6. An off-page saved token renders cached artwork after opening its native disclosure.
7. Metadata timeout preserves prior successful artwork for 199 still-selected identities.
8. Metadata timeout settles new identities as unavailable rather than permanent loading.
9. Changing selection aborts the old requests and accepts only the new identity scope.
10. Keyboard focus remains usable between the fixture controls and narrow layouts do not overflow the page.

The report distinguishes visible `loaded` / `loading` / `unavailable` frames and records each fixture request. At the final desktop observation, seven visible frames are decoded and three deliberately missing/unsafe frames are unavailable; none are indefinitely loading. This is a synthetic test denominator, **not a 70% live image coverage claim**. Repeated viewport samples are not independent token observations. Browser errors and unexpected outbound requests are zero; provider calls, score changes and Free/release acceptance are false/zero.

| Rendered fixture | Viewport | Page scroll width | Result |
|---|---:|---:|---|
| Desktop | 1280 × 900 | 1265 px | No page overflow |
| Mobile width | 390 × 844 | 375 px | No page overflow |
| Narrow reflow | 320 × 900 | 305 px | No page overflow |
| Reduced layout viewport | 640 × 450 | 625 px | No page overflow; not actual text-zoom certification |

The ignored `desktop.png`, `mobile.png`, `reflow.png` and `zoom_equivalent.png` screenshots in that report directory were visually reviewed. The synthetic lab is not the complete production shell, a human usability study, a live provider-success measurement or a full keyboard/screen-reader/contrast audit. Cached-data presence and visible rendering remain separate measures.

## Validation and remaining work

All **154 Discovery UI tests across 31 files pass**, including four new artwork/cache-contract/saved-identity regressions. App typecheck and production build pass. The observed closed-release startup budget is **227.8 KiB gzip across eleven chunks**; this is not an enabled-Discovery Web Vitals measurement or an attributed performance improvement over other work. The fresh release check retains the thesis, excludes unfinished Discovery assets and keeps the server exposure flag closed. Security preflight/blocklist and original research row/foreign-key preservation pass. Existing unrelated Network/legal edits remain outside this change.

Manual reproduction on the current Windows workspace with installed Chrome and locked dependencies:

```powershell
pnpm --dir app test -- src/discovery
pnpm --dir app typecheck
pnpm test:discovery-artwork-browser .tmp/NEW-ARTWORK-STUDY
```

Use an exclusive private output directory. No app/tunnel/collector restart or provider collection is required. The browser study launches only its own headless profile and closes it afterward; it does not replace the user's browser session.

**Next:** complete the five recorded find → inspect → compare → save → reopen journeys with honest missing/stale states, then measure rendered artwork on a dated admitted live cohort with explicit visible/attempted/decoded/missing/failure denominators. Independent accessibility/usability, actual 200% text zoom, device checks and enabled-route performance remain open. The held Free-serving architecture/input-preparation blocker from 149 remains a release requirement; do not enable compact serving or widen freshness windows as part of UX work. Broad unfamiliar-token yield, qualified participation, read-only acceptance and frozen scoring comparison follow 148's order.

No source adapter, grading/evidence/action/election/financial gate, API schema, provider budget, local research authorization, retained evidence, spent allowance, production flag or dependency changed. Original archives/keys/journals/proofs/cohorts/elections remain intact. Everything remains free. No collection, spending, quota reset, evidence deletion, runtime adoption, live migration, restart or deploy.
