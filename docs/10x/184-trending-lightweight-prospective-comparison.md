# Trending / Hot first, with a prospective usefulness comparison

23 October 2026, Australia/Sydney. Continues [183](183-ordinary-solana-coverage-and-targeted-history.md). Founder-directed simplification; no deploy.

Discover now starts with fresh provider attention rather than v4 structural scores. GMGN Hot observations lead, preferring a fresh 24h window, then another fresh GMGN window; order is reported heat, source rank and canonical identity. Fresh GeckoTerminal-only leads follow. No age, multi-provider consensus, candle or v4 bonus is added. This is a declared deterministic blend of returned feeds, not a reproduction of one provider's complete ranking. Existing bounded source inventory and chain filters remain.

Lightweight checks require fresh attention, no reported adverse flag, a fresh DEX observation, at least $10,000 reported liquidity, and positive reported buys and sells. They label review readiness; unknown security is never verified safety. Pending cases stay visible, adverse cases retain the existing default exclusion and explicit disclosure control. The v4 workspace is optional and collapsed initially; its candidate-page reads and polling start only when opened. Saved research links, score details, exports and old replay remain available. New score features, formula changes and broad enrichment for scoring are paused pending useful-selection evidence. Existing collectors and immutable research records are preserved.

## Preregistered comparison

`discovery/src/attention-selection-trial.ts` freezes policy before a live source snapshot. `scripts/discovery-attention-trial.ts` provides local operator commands using the existing database in a read-only transaction. No provider fetches, main-store writes, new scheduler, binding, migration or quota. Study/policy/implementation hashes, source plans, cached v4 inputs/results, cohorts and labels are exclusive private files under ignored `.tmp`. A failed or uncertain original slot stays spent; no retry, replacement, late backfill or rewriting labels. Source plans precede deep reads. Changed implementations require a separately declared study, preserving the old one.

| Arm | Five-slot daily shortlist |
| --- | --- |
| A: provider | First five fresh Solana attention leads in the declared provider order |
| B: lightweight | First five passing the frozen lightweight checks, preserving provider order |
| C: frozen v4 | Highest cached, exactly replayable current v4 results from that same source population/cutoff |

Missing deep candidates and unfilled slots stay explicit and unknown. No new acquisition is triggered to repair arm C. Stored candidate inputs must predate the cutoff; identity, freshness, source-family accounting and v4 replay are checked. Source JSON is bounded to 1 MB, deep records to 2 MB and review union to 20 identities. Cached candidate input reads also have a 2 MB aggregate bound. Limits describe this comparison, not a Free-serving certification.

Fourteen daily capture slots open for the first two hours after each 24h anniversary of the study start. Days 0–2 are run-in; later days are held out. Previously observed identities are excluded from every held-out arm and control before ranking, so repeat appearances cannot inflate the effective sample. Empty days remain empty. Enrollment is the complete returned fresh Solana population, not just reviewed picks. This evaluates new entrants in a bounded Solana view, not all-chain or whole-market recall; later held-out results do not describe repeated runners.

Review the deduplicated A/B/C union plus up to five deterministic controls from provider positions 11 onward, excluding arm picks. Blind files expose identity/basic context without arm membership, rank or v4 score. The same founder/reviewer can recognize familiar tokens; this is allocation blinding, not an independent or fully blinded panel. Controls measure missed worthwhile leads only within that selected lower-ranked sample. Adverse arm-A picks remain in the comparison; no purchase/action is authorized.

Baseline labels must be frozen within two hours of capture; follow-up observation and labels within 24–48h. Record worthwhile yes/no/unknown, observed adverse yes/no/unknown, review minutes and a short rationale. “Worthwhile” means a meme deserving further founder review, not price appreciation, organic trading, safety or launch eligibility. The primary endpoint is worthwhile at baseline and still worthwhile at follow-up. Missing rows/endpoints and bounded-view absence remain unknown, never failures or vanished-token claims. Follow-up requires a submitted baseline. Labels cannot be edited after submission.

Reports replay source/deep/cohort/label hashes, show per-arm filled slots, retained worthwhile picks, unknowns, adverse observations and review minutes, with aggregate held-out totals and conservative missing-outcome bounds per five slots. Reviewed lower-ranked controls stay separate. At least 30 unique held-out **arm** identities with completed non-unknown baseline/follow-up usefulness labels are required before an adoption review. The preregistered material target is at least one extra retained worthwhile pick per five compared with each simpler alternative, no additional observed adverse picks, and no more than ten percentage points lost shortlist coverage. Missingness, day-to-day variation and overlap must be assessed; counts or a point estimate alone do not establish improvement. There is no automatic significance claim or promotion.

Marginal provider requests are zero. Original cached deep-evidence acquisition RPC/bytes remain **unknown** and must be measured before any claim that deeper checks earn their acquisition cost. Review minutes permit a partial human-cost comparison. A cached-v4 victory would justify a separately budgeted cost measurement, not adoption by itself. If no credible, affordable improvement appears, keep the lightweight default and report the null result; do not tune weights against the holdout. Current v1–v4 evaluators, original cohorts/elections and all source/evidence/freshness/action/financial/release gates remain unchanged. Serving blocker [149](149-native-builder-and-combined-free-budget.md) and thesis-only production exposure remain.

## Operator workflow

There is no unattended trial timer. Daily capture, baseline review and 24–48h follow-up are explicit operator work; missed windows stay missing. Use the same study root throughout. Commands do not collect new evidence or invoke a deploy:

```powershell
pnpm exec tsx scripts/discovery-attention-trial.ts init .tmp/NEW-STUDY
pnpm exec tsx scripts/discovery-attention-trial.ts capture .tmp/NEW-STUDY DATABASE
pnpm exec tsx scripts/discovery-attention-trial.ts review .tmp/NEW-STUDY DAY EDITED-LABELS.json
pnpm exec tsx scripts/discovery-attention-trial.ts followup .tmp/NEW-STUDY DAY DATABASE
pnpm exec tsx scripts/discovery-attention-trial.ts review .tmp/NEW-STUDY DAY EDITED-FOLLOWUP-LABELS.json
pnpm exec tsx scripts/discovery-attention-trial.ts report .tmp/NEW-STUDY
```

Use the existing discovery SQLite path recorded in RESTART. Review `day-N/blind-review.json` and copy/edit its `baseline-template.json` to a new private file before submission; do not inspect cohort allocations/deep records first. After follow-up capture, use its separate template and retained observation. Do not submit untouched unknown templates as completed reviews. The test suite does this only to verify missing-data handling in isolated synthetic stores.

## Verification and first enrollment

The full discovery regression passes **1,727 tests / 119 suites**, including 14 new trial cases covering original-slot/label immutability, read-only capture, no quota mutation, missing outcomes, source/deep tampering, future inputs, held-out repeats and capture/review windows. Discovery typecheck, 24 targeted UI/review/pager tests, app typecheck/build, security preflight and thesis-only release check pass. Home startup is 227.8 KiB gzip /11 chunks, within the unchanged250 KiB budget. Browser QA confirms the primary provider view and optional v4 disclosure opening/closing. Screenshot: `.tmp/attention-trial-ui-184-001.png`.

The original historical file-only replay still matches18 receipts/17 reviews/one canonical/two completed history turns and one spent transport failure, with zero calls/writes. Original preserved cohort/outcome/source/holder/wallet/cache row hashes and foreign keys match. All84 private artifacts pinned by181–183, v1–v4 evaluators/store and gate/config hashes remain unchanged. Forty-seven unrelated files are excluded from this change; three Network files changed during the later user interruption, and their resumed versions are preserved rather than reverted or committed here.

Original study: `.tmp/attention-selection-study-20261023-184-001`, study hash `a47fff1a8f8ad44ef5fa5074dc8fe7bd0ed891b4fffa428cace5c9206e2fd126`, registered23 October09:44:53 UTC. Day0 captured09:45:05 UTC: **34 fresh Solana identities; A5/B5/C0;14 blind reviews including controls**. Cohort hash `a472cc517b058162acf55b72ede9afd46ac8a6aa899d04200fb4f82571cdb0d0`. There are no usable saved v4 candidates in this source population; this is a coverage gap, not a measured quality loss or justification for new collection. Capture adds zero provider requests and zero database writes.

The baseline deadline was23 October11:45:05 UTC (22:45 Sydney). On resume at24 October00:37 Sydney, it had elapsed without submitted labels. The retained report correctly says `baseline_window_missed`; all five outcome slots per arm remain unknown. Do not backfill or replace day0. The next original day1 capture window is **24 October20:44:53–22:44:53 Sydney**; daily enrollment remains explicit operator work. No selection uplift, independently established safety or acquisition-cost advantage has been measured.

```powershell
pnpm exec tsx scripts/discovery-attention-trial.ts capture .tmp/attention-selection-study-20261023-184-001 discovery/.wrangler/local/v3/d1/miniflare-D1DatabaseObject/daf636fcbef1c9ac586f35b886cf4aab026d59a97e006ac52cad422db0bcaf4c.sqlite
pnpm exec tsx scripts/discovery-attention-trial.ts report .tmp/attention-selection-study-20261023-184-001
```

Private report: `.tmp/attention-trial-initial-report-184-001.json`. Integrity manifest: `.tmp/attention-trial-integrity-20261023-184.json`. The existing app-local tunnel was restarted on24 October at the user's request, reusing the existing preview store with zero pending migrations; Discover and the local API return200. This is local preview startup, not deployment.
