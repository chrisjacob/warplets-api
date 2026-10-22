# Personal review follow-up progress

23 October 2026, Australia/Sydney. Continues [167](167-readable-shortlist-evidence.md). No deploy.

## Delivered

- [x] Add a read-only progress projection over the existing verified personal review ledger. Revalidate its original hash chain and resource bounds before counting; malformed history, an invalid clock or any revision later than the evaluation time holds the report instead of producing zero counts.
- [x] Group tokens by exact chain/contract. Retain the first saved review's Sydney date as its daily cohort and the first recorded time as its follow-up origin. Revisions do not create new token counts, move the original cohort or restart the clock. Equal EVM contracts on different chains remain distinct.
- [x] Separate under24h, due and reported-at24h-or-later states. This24h interval is a personal review reminder, not token/graduation age or a new evidence gate. Only the latest revision can satisfy the follow-up; an outcome reported early remains explicit and does not count as a24h follow-up. Do not fall back to an older favorable outcome after a later revision removes it.
- [x] Keep still-active, attention-faded, adverse-reported and unknown reports separate in daily cohorts. Unknown is a reported uncertainty, not success or clean evidence. Include set-aside, needs-evidence and uncertain reviews in the same follow-up population; do not select only favorable personal assessments.
- [x] Show the oldest due reviews first, with exact identity, first date and due date. Render at most ten due entries while keeping the complete retained population in counts and explaining the remainder. Follow-up opens the existing worksheet with a separate copy of that token's latest saved context/labels; saving still appends through the original lock/hash/storage controls.
- [x] Add explicit local progress refresh with an as-of time; no timer, background source request or automatic review. While local history is held or busy, disable follow-up actions and label any retained summary as the last verified history. Counts cover the browser's personal notes only, not all displayed candidates, the market, recall or a success rate.

## Verification

Discovery UI:199 tests/40 suites pass; app typecheck passes. Cases cover empty history, exact24h timing, immutable first-review cohorts, equal contracts on different chains, early/unknown outcomes, latest-revision precedence, full due counts with a ten-entry display, non-favorable assessments, future/corrupt histories, no source IO and independent projection copies.

The final isolated browser study starts with four synthetic reviewed identities/six revisions: one under24h, two due and one later unknown report. Keyboard follow-up appends one synthetic unknown revision, producing one due/two reported tokens while preserving all six original records and the original reviewed context exactly. Explicit progress refresh makes no writes. A tampered history disables follow-up, remains untouched through failed reload, and recovers only after explicit valid-history reload. No actual founder judgments, real token outcomes, provider requests or application fetches occur.

Desktop1280/mobile390/reflow320 screenshots were visually inspected. Progress reflows without document/detail overflow; the daily cohort table scrolls within its own bound. Browser exceptions and unexpected requests are zero. This is targeted workflow/readability QA, not full-app accessibility or production serving acceptance. Closed production build/performance budget, thesis-only guard, security preflight, prior private artifacts and historical proof-row checks are recorded separately before commit.

## Constraints and next work

Original ledger/context/hash/export/import/storage limits and captured source dates remain unchanged. The derived report is not persisted into evidence, scoring or source records. No backend, provider, RPC, migration, configuration/dependency, timer or runtime changes. Keep every Free quota/backoff/hourly/byte/read bound, original20/50-event replay and score/evidence/action/launch/serving149 gate. Thesis-only production exposure remains closed. No deploy.

At16:37UTC22 October, the latest ordinary activity sample was still the unchanged165 failure from16:01:52.976UTC, receipt hash `e5342c39fa64f6b257fe8895ed444217b43d47146833702194f4a3c6beefc29e`. This slice makes no extra request to reopen that spent hour. Synthetic review progress does not establish live event acceptance or Discovery usefulness.

1. Observe the next ordinary activity slot and verify complete50-event/source replay under166; then assess an explicit bounded independent transaction-sample contract without broadening legacy RPC/quote bounds.
2. Use the readable shortlist and follow-up queue for real prospective founder sessions across unfamiliar tokens. Record actual relevance/catalyst judgments and later outcomes, including uncertainty and negative results. Tooling is delivered; real usefulness evidence remains outstanding.
3. Review coverage, missingness and personal cohort outcomes before deciding on calibration changes. Do not infer organic demand, verified performance or market recall from these local labels.
4. Continue qualified holder observations, authoritative completed-ATTN-launch exclusions, durable/shared review custody and production serving acceptance before enabling unfinished public functionality.
