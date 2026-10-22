# Personal attention-review worksheet

23 October2026, Australia/Sydney. Continues [160](160-shortlist-candle-review.md). No deploy.

## Delivered

- [x] Each live attention row offers Review. One worksheet captures meme relevance, current catalyst, quality concerns, personal assessment and a rationale. Worth following requires an explained catalyst; a follow-up outcome requires an explanation. Unknown/uncertain remain valid. These are personal judgments, not system safety grades, founder-identity verification, launch recommendations or automatic exclusions.
- [x] Opening a review freezes the exact chain/contract and saved token/source/candle context, cutoff and coverage gaps. Feed refreshes do not update the open review’s context or draft. SHA-256 context hashes bind the saved observations; captured provider fields are not upgraded to independently verified evidence.
- [x] Save appends a timestamped revision with Sydney review date, global previous hash and previous revision/hash for that chain/contract. Equal EVM contracts on different chains remain distinct. Prior notes and source context remain unchanged. A later follow-up can deliberately refer to the original observations, preserving the distinction between what was known then and the reviewer’s later report.
- [x] Reload local history, inspect revisions and follow up on a saved token even when it leaves the current feed. Export verifies the retained history and creates a JSON download with original context, labels, hashes, timestamps and closed adoption gates. Export does not fetch providers, write D1 or execute external links.
- [x] Native exclusive browser locks serialize appends; stale-head checks before/after hashing reject competing changes. Storage events suspend saving until explicit reload. Missing locks, corruption, read/write failures and local resource bounds hold saving with the draft retained; there is no memory-only saved claim or automatic repair/pruning. Row switching is disabled during review operations.
- [x] Accessible labels, focus to the review heading, progress/status messaging and bounded responsive fields. Provider/token text and notes render as plain escaped text. No credentials enter the workflow.

## Scope and custody

Notes are plaintext local storage for this browser/origin, not synced to the server, another origin or another device. The storage key is `tenx:attention-personal-reviews:v1`, separate from the older shortlist identities and original evidence. Exports contain the user’s notes and captured observations. There is no import, remote/team review registry, deletion UI or automatic archival in this slice.

The local resource bound is200 revisions/2MB, with600-character explanation fields. This is a browser payload bound, not a new source quota or sampling limit; reaching it holds new saves and retains export/read access. No existing Free quota, pacing, backoff or evidence ledger changes. A future custody/archive design must preserve original exported context and history instead of silently evicting old reviews.

Hashes detect inconsistent retained chains and altered contexts, but users/scripts controlling local storage can rewrite/recompute them or remove a whole suffix. They establish neither a reviewer identity, an independent source receipt, completeness, trusted recording time nor durable/off-device custody. Browser clearing can remove the data. Do not use these labels to pass evidence gates, infer verified outcomes or automatically calibrate production scoring. No user/founder opinions were manufactured during implementation: browser-test labels are explicitly synthetic in a separate temporary profile.

Browser API contracts checked in [Web Locks documentation](https://developer.mozilla.org/en-US/docs/Web/API/LockManager/request) and [SHA-256 digest documentation](https://developer.mozilla.org/en-US/docs/Web/API/SubtleCrypto/digest). Unsupported locking/secure-context capabilities leave saving unavailable rather than introduce an unsafe fallback.

## Validation

173 Discovery UI/store tests across36 suites and frontend typecheck pass. New cases cover deterministic SHA-256 encoding, Sydney dates, exact chain identities, immutable context, linked revisions, altered/reordered/deleted records, invalid time/labels, storage/race failures and verified exports with all adoption gates closed. Closed production build/performance budget, thesis-only release guard and security preflight pass. Home startup remains227.8KiB gzip/11chunks; this is the closed production surface, not enabled-Discovery performance acceptance.

Final isolated browser study: `.tmp/attention-browser-20261023-161-003/`. Uses a dated cache-only99-token queue and explicitly synthetic personal labels, without source collection or actual founder judgments. Exercises save → feed refresh with draft/context preserved → reload → follow-up → failed storage write with original history/draft preserved → explicit reload/retry → export → competing-storage-event hold → corrupt-history hold. Confirms initial top-ten/chain filtering, launch hold and desktop1280/mobile390/reflow320 without document overflow or exceptions. No provider calls; screenshots visually inspected. It is component workflow evidence, not full-app UX/accessibility, live-image, enabled-performance or release acceptance. Earlier001/002 scripts/output remain separate;001 failed on a test selector before saving, and003 explicitly adds filter/launch assertions to the002 workflow pass.

One local GET saved the input queue; no provider collection, backend changes, migration, runtime restart, quota reset, evidence renewal, dependency/config change or deploy. Old private artifacts/proof hashes remain preserved under new161 integrity metadata.

## Next strategic work

- [ ] Real prospective founder review sessions and day-by-day follow-ups across unfamiliar tokens. Separate subjective labels, reported outcomes, missingness and independently checked facts; do not evaluate only known winners or known manipulated references.
- [ ] Portable/shared private review custody and admitted import/archive before relying on browser notes for durable calibration. No team/identity or retention guarantee is delivered here.
- [ ] Focus participation/holder review on the small queue and measure completion latency, missed patterns, false reassurance and marginal source value. Reported volume/growth remain unverified for wash trading/dusting.
- [ ] Broader chain/full-day candle coverage, authoritative completed-launch exclusions and optional Free-key FOMO/Birdeye remain open under the existing gates.
- [ ] Keep v4/action/election/financial policies, source-bound serving149 hold, thesis-only exposure and independent enabled-UX/performance/security release requirements unchanged.
