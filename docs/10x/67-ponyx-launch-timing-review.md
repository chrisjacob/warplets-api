# PONYX: same-slot launch timing and score-v4

Founder review, 21 October 2026. Exact mint `ZyGXWijSJEgcCDb8CeSJ4Vj33iceATGoeKGidnfpump` (PROJECT ONYX / PONYX). Local cached evidence, unchanged source/action/election gates, no paid service or deployment.

## What the prior score missed

The founder supplied minute charts showing a high first displayed cap and persistent small price rises with limited displayed volume. They are a valid review lead; the images do not independently establish wash trading, common control or actual first-trade valuation. No candle/wick/volume measurements are fabricated from our sparse price observations.

The retained v3 scorecard at **04:35:23.903 UTC** (15:35 Sydney) gives **60/100**, 75% effective coverage and 68.13 base support points. It already flags thin reported relative depth and high early reported valuation. The failure is that its early-cap ceiling of 60 still lets a concerning launch rank highly among incomplete candidates. Its distribution credit describes current token owners, not independent beneficial owners or original acquisition. Wallet/trade evidence is absent and earns zero points.

The independently retained finalized Pump proofs show creation and graduation in **slot 459466560**, both at **02:43:21 UTC** (13:43:21 Sydney), in different transactions. The first retained DEX Screener report is **$7,195,545** at **02:47:51.413 UTC**, **270.413 seconds** after creation. This is an early provider cap, not a verified opening valuation. Same-slot timing does not itself establish a shared transaction bundle, who bought the supply or coordinated ownership.

The original score has 28 sampled prices, with a latest continuous run of 27 over 92 minutes. V3's six-hour/60-price staircase check is correctly insufficient; neither doubling/halving nor that mature-history pattern is a young-launch detector. The current store has a hash-matching normalized creation proof, but no corresponding balance-bearing wallet transaction. We cannot reconstruct a creator purchase or apply its historical-supply ceiling from that proof alone. No extra provider read was forced to fill the gap.

## Versioned implementation plan and result

1. Preserve every v1/v2/v3 evaluator, record and replay hash. Add `discovery-score-v4`, retaining the existing fixed-denominator support calculation and all adverse ceilings.
2. Check a verified Pump creation/graduation pair with recognized instructions, both available by the scoring cutoff and fetched no earlier than their chain events. Reject incomplete, future, unsupported, reversed or contradictory slot/time context for this feature. A same-slot pair must agree on block time; equal rounded seconds in different slots do not satisfy the rule.
3. Apply a **50 ceiling** for that confirmed same-slot launch. If the existing independent early-report check also finds **at least $5M within ten minutes**, apply a **25 ceiling**. Use the lowest applicable ceiling and withhold positive momentum. This does not wait for six hours of history, infer a launch purchase from current holdings, alter eligibility or use a mint blacklist.
4. Publish dated concerns on cards and details, show the two slot identities and early-report limits, and extend the published exact policy and scorecard export/replay.
5. Admit current v4 prospective research through local migration **0040**, retaining old model rows/outcomes and archived v3/v2/v1 views. Preserve all shared source/storage, capture/finalization, pause/backoff, follow-up and action/election rules.
6. Freeze the actual original scorecard, test boundaries and adversarial/ordinary controls, verify the preview, update the PRD/checklist and commit/push. No deploy.

**Identical frozen inputs:** v3 remains **60**, record hash `4f7e0fdd62c8f712fbead2ca6006b26527d60b3ceb72cc0966e004e4a8bcccb9`; v4 becomes **25**, record hash `205844c6a90a7dd836e3ae056d1d97741038a4c7043508eaba1ca2b3deaffff0`. Both replay. The [original regression fixture](../../discovery/fixtures/score-ponyx-review.json) fixes the timestamp, prices, candidate and earliest report so later market movement cannot explain the difference. The current local token page also shows 25 with its newer observation time.

The 50/25 ceilings are provisional conservative review choices, not calibrated fraud probabilities. Same-slot launches can be legitimate. A different-slot launch earns no extra points and is not a safety pass. A favourable current holder distribution or later price path cannot erase a dated same-slot launch concern; a stronger existing concern still wins. Independent labelled false-positive/outcome evaluation remains necessary.

## Completed checklist

- [x] Preserve the real PONYX v3 baseline and identify the existing early-cap concern, missing wallet evidence and insufficient staircase history.
- [x] Add pure, strictly versioned same-slot and combined early-cap checks without new provider calls or changes to v1–v3.
- [x] Integrate current ranking, scorecard replay, transparent thresholds, card/detail warnings and archived research views.
- [x] Apply the reviewed local-only model migration after a consistent SQLite backup and before/after row snapshots. All **100 cohorts, zero outcomes and 178 original attempts** match byte for byte; foreign-key validation passes. Isolated migration tests also preserve nonempty v1/v2/v3 outcomes and verify rollback after an injected failure.
- [x] Keep research at **100 records / 10 MB per UTC day**, three captures and five total finalizations per maintenance pass; all four models share follow-up mint slots/cooldown. The normal local tick is healthy and holds new v4 captures because today's 100 records are already retained (71 v1, 29 v2). No original grade is relabelled/backfilled.
- [x] Verify the actual local PONYX 25/100 display, exact slot/early-cap explanation, cache-only ranking/replay and API schema.

## Remaining work

- [ ] Obtain permitted, authenticated minute candles and representative trade observations before detecting repeated wick/volume patterns or making a wash-trading finding.
- [ ] Complete balance-bearing creator/launch evidence through normal bounded collection; original purchase and current beneficial ownership remain unknown here.
- [ ] Retain new v4 cohorts at their actual capture time when shared capacity permits, then evaluate later outcomes, independent controls and false positives on a separate time split. This retrospectively reviewed case is a development fixture, not held-out validation.
- [ ] Continue the [Jupiter/GeckoTerminal access, fixture and budget plan](66-source-activity-review.md) and the separate GMGN access/rights investigation. V4 is a cached launch-timing correction, not adoption or validation of any new vendor score/API; provider-based changes still require their G0–G4 preflight and a preregistered custom-baseline version.

## Validation

The focused scoring/model/migration suite passes 100 tests; discovery UI passes **81 tests across 15 files**. Both typechecks and app build pass. Home startup remains **234.1 KiB gzip across eleven chunks**, below the unchanged 250 KiB budget. Existing dependency annotation warnings remain non-fatal. Generated OpenAPI includes v4 and leaves legacy unqualified research reads pinned to v1.

Tests cover the real baseline, exact $5M/ten-minute boundaries, no early report/FDV substitution, different slots within a rounded second, missing/future/contradictory proof context, stale concerns, limited price history, stronger risk dominance, unchanged action checks, zero provider calls, tamper replay and shared four-model limits. The complete discovery suite passes **1,021 tests across 61 files**, including historical score/election replay. Local documentation targets and Git whitespace checks pass.

Browser QA confirms the live local score, concerns and explanation. The ignored proof screenshot is `.tmp/ponyx-v4-score.png`. Cache-only review at 04:44 UTC returned 70 ranked candidates, zero eligible, and PONYX at 25; the highest displayed grade was 45, which is neither an endorsement nor a validation result. No fake candidate was inserted, no source refresh forced, no quota raised and no deploy performed.

Local migration follows the existing [D1 deferred foreign-key pattern](https://developers.cloudflare.com/d1/sql-api/foreign-keys/) and [local Wrangler migration commands](https://developers.cloudflare.com/d1/wrangler-commands/). The Cloudflare/Workers/Wrangler references were reviewed; no dependency, binding or remote configuration changed.
