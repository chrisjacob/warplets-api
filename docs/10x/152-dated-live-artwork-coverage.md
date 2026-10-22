# 152 — Dated saved-live artwork coverage

22 October 2026. Continues F2 after [151's journey slice](151-discovery-journey-context-and-recovery.md), within [148's build order](148-free-serving-assessment-and-build-order.md). [149's serving admission](149-native-builder-and-combined-free-budget.md) remains held.

## Delivered

The new pinned-input artwork study separates visible tokens, allowed sources, source attempts, decoded artwork, absent sources and exhausted failures. It uses the actual `TokenImage` renderer and unchanged image policy against saved live references, with twelve tokens per gallery page in an exclusive headless Chrome profile. Every measured artwork frame is fully visible once; this is a bounded gallery traversal, not a claim that all tokens are visible simultaneously in the full app.

The user-visible fix keeps loading/unavailable labels inside compact 48 px card and saved-list frames. Explicit line heights and a sufficiently specific small-label rule prevent inherited saved-list typography from clipping the label. Symbol/label accessibility, frame sizes, source order, deadlines and decode requirements remain unchanged. An eleventh synthetic browser regression checks both compact contexts geometrically.

## Frozen input and admission

The source is the existing local preview's default live first-day, score-sorted first page: **98 tokens**, selected from **280 current inputs / 569 retained identities**, with 98 ranked/matched/available. Source ingestion `as_of` is **2026-10-22 09:35:13.644 UTC**; the server's score cutoff is **09:43:09.434 UTC**, served at **09:43:09.993 UTC**. One bounded cache-only artwork GET for those exact 98 mints was received at **09:44:41.944 UTC**. Artwork is a later cache read, not a score observation at the earlier cutoff. The study does not qualify it as price, identity, organic activity or safety evidence.

Private input directory: `.tmp/artwork-coverage-input-20261022-152-001`. Manifest SHA-256: **`61e9d70ee3fd9dca52f07ac7e4bc37159506a4f8b6141d85d8b2c0f0cb5608be`**. Candidate bytes SHA-256: `b3399d2abe4ae21efb3e6775ff516bbd3790ba19cf8ca70ba2e7362366406197`. Artwork bytes SHA-256: `70bc198a96e2f1f09277017c83c67758fbd6b7e3f09f98bac822edb025ce840a`.

Admission checks the manifest and both byte hashes, fixed local query, live mode, chronology, current first-page scope/cursor/count relationships, unique mint joins, verified-window selection dates and exact v4 score cutoffs. A saved public projection does not independently re-prove chain origin. Foreign artwork identities, invalid dates/counts, unsupported sources and decode-less success cannot become passing checks. Missing metadata stays missing. No source lookup, retry job, counter reset or new collector admission is created.

## Observed rendering

Final run **09:52:58.918–09:53:49.471 UTC** on 22 October, 1280×900 viewport, nine gallery pages, actual compact **48×48 px** frames:

| Measure | Tokens / attempts | Interpretation |
|---|---:|---|
| Cohort / fully visible during traversal | 98 / 98 | Zero unobserved tokens in this gallery |
| Market-provider URL present | 16 | A reference, not decode success |
| Creation-linked cached URL present | 93 | A reference, not decode success |
| Visible with an allowed source / attempted | 94 / 94 | Union after the existing source policy |
| Decoded | **82** | **83.7% of visible; 87.2% of attempted** |
| Missing allowed source | **4** | Two unsupported metadata URIs; two unavailable metadata images |
| Exhausted render failures | **12** | Allowed references did not produce a decoded image |
| Still pending | 0 | Every frame reached a terminal state |
| DOM source attempts | 105 | Source assignments across token frames; not HTTP request count |
| Public image asset requests | 83 | 78 distinct URLs; browser reuse/deduplication differs from token counts |

Sixteen decoded tokens had a market URL; **66 decoded without a market URL**, showing why creation-linked cache coverage matters. This does not prove the artwork belongs to a trustworthy token. Network diagnostics include cross-origin response-policy blocking, opaque response blocking, one CSP block and an aborted image. Do not treat an HTTP 200, stored URL or browser error as a source-authenticity verdict. No intercepted unadmitted request was allowed; redirects and credential-bearing requests do not bypass the source list. No allowlist, proxy, gateway or deadline was widened to improve the result.

Final report: `.tmp/artwork-coverage-20261022-152-002/report.json`, SHA-256 **`cea02dbec99c85e7c04b15353f0dc4e376ec62a5c113d99b8d2ca4e6667ded61`**. It retains per-mint results, source attempts, network diagnostics, dates and hashes for the input, browser bundle, admission bundle/source, runner, fixture, renderer, CSS and image policy. The first-page screenshot was visually reviewed. Original input bytes remain unchanged and private/ignored.

Initial run `.tmp/artwork-coverage-20261022-152-001/report.json`, SHA-256 `1cf49c28de994b3144d522d6543b16160cb34611c12ce7f6e5671f403f35c3fe`, decoded 83/98 in the earlier gallery layout. Preserve it alongside the final 82/98 result. Different times/layouts and externally served image bytes prevent a causal before/after claim for the CSS fix. Both runs use the same frozen token/cache input; immutable local references do not make remote availability stable.

## Reproduction and validation

```powershell
pnpm test:discovery-artwork-coverage
pnpm typecheck:discovery-artwork-coverage
pnpm study:discovery-artwork-coverage PRIVATE_INPUT_DIRECTORY MANIFEST_SHA256 .tmp/NEW-PRIVATE-STUDY --allow-image-network
pnpm test:discovery-artwork-browser .tmp/NEW-SYNTHETIC-STUDY
```

Use installed local Chrome, locked dependencies and an exclusive new output directory. The input directory contains `candidates.json`, `artwork.json` and `manifest.json`; the manifest pins the two cache GETs, exact fixed local query, mode/count, source/score/serve times and artwork request/receipt times. The runner reads these files, not the app, database or credentials. It requires explicit image-network admission, permits only bounded GETs for already admitted image references, strips request credentials/referrers and blocks other network destinations. It makes no token/trading/RPC/metadata-provider collection calls. The initial availability probe plus the two input reads were three local cached GETs; public image loading is separate and honestly counted above.

All **five admission/denominator tests** pass. The expanded synthetic artwork study passes **eleven scenarios**, including compact label fit: `.tmp/artwork-browser-20261022-152-001/report.json`, SHA-256 **`034a449309f8efa983eb46c52d12086619c2aa464a340afa76726cc4597253bd`**. The new TypeScript study/tests/browser fixture pass scoped typechecking using existing installed app React declarations. App typecheck/build/performance budget, fresh thesis-only release check, security preflight/blocklist and original research row/foreign-key preservation pass. The closed home-shell budget remains **227.8 KiB gzip across eleven chunks**, not an enabled-Discovery performance claim. Original proof/target/journal hashes and actual credential exclusion are checked separately. Unrelated Network/legal changes stay outside this commit.

## Remaining acceptance and next work

The dated saved-live **measurement slice is delivered**; artwork reliability and F2 acceptance remain partial. Treat 82/98 as an observed baseline, not an acceptance threshold, live monitoring SLA or full-app coverage claim. Diagnose missing-source and failed-render groups separately through saved references and unchanged source admission. Do not fix third-party image failures by broadening origins or bypassing browser policies without reviewed source-format evidence.

Next: independent usability and explicit keyboard/focus/screen-reader/contrast review, actual 200% text zoom/device checks and enabled-route performance acceptance. The scripted journeys and this gallery do not certify those outcomes. Broad unfamiliar-token yield, preregistered qualified participation and read-only release/security acceptance then follow 148's order. Keep 149's named source-bound input-preparation cost blocker open; no serving adoption or freshness widening.

No Worker/API/schema, source adapter, v4/evidence/action/election/financial gate, provider limit, research authorization, historical evidence, spent allowance, migration, dependency or production flag changed. Everything remains free. No token-provider collection, spending, quota reset, evidence deletion, runtime switch, live migration, collector/tunnel restart or deploy. Thesis-only exposure remains closed to unfinished functionality.
