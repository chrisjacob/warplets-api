# Frozen diagnostic research

Implemented locally on 20 October 2026 for task P2 in the [PRD task map](19-prd-task-map.md). The cap and smooth-rise warnings now have prospective research records and later outcome checks. Neither warning changes eligibility, ranking or the active policy.

## Capture and provenance

Each token has at most one retained baseline per signal: `new_token_high_cap` and `smooth_price_rise`. Both flagged and unflagged usable observations are collected. This is a diagnostic cohort, not a recommendation or a replacement for the first-selection cohort.

Creation and Pump graduation must already be verified, creation must be within 24 hours, and the saved positive price must be fresh. Missing reported cap cannot become an unflagged cap control. A price-pattern observation requires sufficient comparable history ending at the saved market baseline; source changes, missing data and inadequate history remain gaps. History after that baseline, future evidence, and observations before graduation cannot be used. FDV never substitutes for market cap.

The capture time is the actual local research observation time. Later price history is not attached to an earlier selection. Full candidate inputs, policy, relevant saved history, feature values, versions and SHA-256 hashes are frozen in a separate table. Existing observation, recommendation, wallet, election and daily-review records are unchanged. Retry preserves the first usable record and one audit entry even if a later warning differs.

The smooth-rise implementation is pinned to `pricePatternReviewV1` and `PRICE_PATTERN_RULE_V1`; future display rules must preserve that decoder. The cap experiment uses its explicit `new-token-cap-v1` $10M rule. A labelled synthetic sealed fixture protects v1 replay; it is never seeded as live evidence.

## Later outcomes

The outcome target is 24 hours after each diagnostic observation, not after the original token listing. Finalization waits until the entire two-hour endpoint collection grace is over. A comparable same-provider endpoint from target minus 30 minutes through target plus two hours is selected deterministically by proximity, then timestamp. Future, duplicate, missing, zero-price and source-switched endpoints cannot establish a measured result. Both price and liquidity comparisons must be available to classify the outcome; missing data remains insufficient, never zero return or a fabricated rug.

The result retains its endpoint, provenance link and hash. A severe-loss signal means an observed price or liquidity drop of at least 80%, not a fraud finding. Snapshot sampling does not measure every intervening price move. Retained inputs replay the feature; outcome hashes are checked, and the detail reader independently checks return/liquidity arithmetic against the frozen baseline.

## Validation protocol

`signal-holdout-v1` tests each predeclared warning separately. It uses distinct tokens, chronological 70/30 training/holdout ordering, and removes training observations whose complete outcome window or actual finalization was not available before the holdout started. Thus a random split or a pile of same-day outcomes cannot manufacture a time-separated validation result.

Draft review criteria require at least 40 measured distinct tokens per signal, at least 25 available training outcomes and 12 later holdout outcomes, five flagged training samples, four flagged holdout samples and four unflagged holdout controls. Flagged loss precision must be at least 60% in training and holdout and at least ten percentage points above the full holdout loss rate. The UI also exposes unflagged control loss rates and flagged non-loss outcomes. These are exploratory engineering criteria, not a statistical guarantee or permission to activate a filter. No model maximizes gross trading volume, changes its own code or alters a policy.

Summary analysis covers at most the latest 1,000 retained diagnostic cohorts and discloses truncation. The two signals can describe related behaviour and are not added together as independent votes. Free-source availability, first-usable-history requirements, survivorship and observational selection bias limit conclusions. The original daily learner remains separate.

## Local automation and budgets

Migration `0015_signal_research.sql` creates separate cohort, outcome, attempt and control tables. The existing authenticated local maintenance timer runs the new work with a durable lease and a one-minute due time. Each tick inspects at most three tokens and finalizes at most five matured outcomes. Capture rotates through missing cohorts; pause preserves retained records and stops the new cycle. Capture rows have a 1.8 MB serialized limit. Snapshot and audit admission use [D1 transaction batches](https://developers.cloudflare.com/d1/worker-api/d1-database/#batch).

The new research steps and public reads make zero provider calls. Existing market batches also track new diagnostic baselines for up to 26 hours, within the existing 200-token research rotation and unchanged 30-token batch / 600-request daily allowance. This reallocates existing slots rather than increasing quotas or adding a provider polling loop. Fresh endpoints are not guaranteed under those bounds. Global RPC, wallet, holder, artwork and all evidence gates remain unchanged. Local workload/storage retention and Worker CPU/query budgets need profiling before any future remote release; no production capacity claim is made here.

`GET /api/10x/research/signals` returns cached counts, recent observations, validation status, capture gaps and timer status. `GET /api/10x/research/signals/solana/:address/:signal` replays the frozen input and returns the retained outcome if available. These endpoints have no public write capability. `/research` shows the new section alongside the unchanged daily selection reports. No new environment variables, paid services, Windows tasks or remote resources are introduced. The workstation must remain awake.

## Verification

The first local read observed six cap cohorts and three smooth-rise cohorts; one cap cohort was flagged and every outcome was pending. A subsequent read-only check replayed four records across nine cap and six price-pattern cohorts with no source requests. Counts continue to advance automatically; none of these observations establishes a validated rule change. The first outcomes cannot mature until 26 hours after their new capture times.

Offline coverage includes flagged/unflagged observations, unknown cap versus FDV, stale and future data, post-baseline history, immutable older cohorts, retries/audits, hash tampering, sealed v1 replay, endpoint grace, source/zero/duplicate/missing endpoints, arithmetic verification, pause, bounded row storage, automatic capture/finalization, distinct-token validation and overlapping training windows. All 209 discovery tests passed across 24 files, as did discovery typecheck, app build/performance and local replay checks. The browser preview confirmed automatic collection and pending outcomes.

Commands used:

```powershell
pnpm --dir discovery typecheck
pnpm --dir discovery test
pnpm --dir discovery test -- src/signal-research.test.ts src/price-pattern.test.ts
pnpm --dir app build
pnpm exec tsx scripts/generate-discovery-openapi.ts
pnpm exec tsx scripts/check-discovery-signals.ts
# From discovery/; local only:
pnpm exec wrangler d1 migrations apply TENX_DB --local --config wrangler.local.jsonc --persist-to .wrangler/local
git diff --check
```

Next: improve finishable wallet/funding coverage without loosening gates, and build the offline reliability exercise while these new outcomes mature. The ten-eligible-token target remains open. Proposal review, wallet-backed voting, protocol simulation and all launch/reward/treasury release gates remain as recorded in the task map.
