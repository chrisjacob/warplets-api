# Authentic daily attention and momentum

Holder history, 21 October: [cached owner changes and endpoint retention](76-cached-holder-growth.md) replay full saved inventories with original hashes, canonical vault exclusion and bounded first/latest comparisons. PONYX shows three entrants, one exit and net +2 raw owners over 5.21 hours; its latest interval is flat. Meaningful/daily growth and acquisition provenance remain unknown. No new RPC, database writes, scoring change, quota or evidence-gate waiver. No deploy.

Founder direction recorded **21 October 2026 (Australia/Sydney)**. This updates the [PRD §4.7](spec/10X_MEME_FULL_PRD_v1_2.md#47-graded-discovery--v12-founder-direction-and-implementation-plan) and [ordered task map](19-prd-task-map.md). Requirements and implementation planning only: no runtime scoring, collection, migration or deployment change in this milestone.

## Product objective

Find the strongest supported **first-day market-attention wave** among observed newly created, genuinely migrated OG memecoins. The founder identifies **genuine 24hr volume** and **genuine 24hr holder growth** as central scoring inputs: a future authorized ATTN spotlight should build on that existing wave. This is an attention-selection objective, not a claim that high activity predicts safety or returns.

Volume bought through wash activity and holders manufactured by unsolicited crop dusting must not improve authentic-demand credit. Authenticity requires qualified evidence, breadth and retention, with unresolved manipulation and coverage visible. The bounded observed inventory does not establish which token leads the entire market. Independent voting, election, evidence and launch gates still govern any later action; no ATTN launch is authorized here.

## Current implementation audit

| Existing capability | What it supports | Remaining gap |
|---|---|---|
| [Current evaluator](../../discovery/src/discovery-score.ts) and [v4 policy](../../discovery/src/discovery-score-v4-model.ts) | Origin 10, controls 15, market 20, holders 25, wallet/funding 25, sampled performance 5; inherited adverse ceilings and withheld momentum | No volume or holder-growth criterion; a structural grade alone does not rank genuine daily attention |
| [Owner inventory](../../discovery/src/holders.ts) and [public summary](../../discovery/src/holder-model.ts) | Aggregates positive balances by owner, excludes the exact canonical pool vault, checks supply and account layouts; publishes count/concentration and at most 20 owner rows | Count includes tiny positive balances; published top owners cannot reconstruct all entrants/exits or identify unsolicited transfers. No dust-resistant growth series |
| [Jupiter file normalizer](../../discovery/src/source-pilot-normalize.ts) and [activity review](../../discovery/src/source-pilot-activity.ts) | Parses reported buy/sell and organic buy/sell volumes, trader/net-buyer fields across 5m/1h/6h/24h | Offline file provenance; provider estimates are not independent organic proof, and net buyers are not net retained holders |
| [GeckoTerminal candle/trade foundation](68-source-collection-foundation.md) | Bounded closed-minute and trade measurements, anomaly-flag coverage, atomic admission and prepared transport | Collector remains disconnected; access/retention, permitted real fixtures, canonical binding and full-window coverage are unresolved. Six-hour/300-event trade review is not a complete 24h audit |

All existing score versions and frozen observations remain unchanged. Current v4 owner-count points do **not** certify dust-resistant demand. This plan closes that identified weakness through a separately validated revision, rather than relabelling existing counts as genuine holders.

## Measurement contract for implementation

Every observation must retain exact mint/pool scope, cutoff, creation time, requested and covered windows, source/field attribution, observation/receipt times, units, version, hashes, exclusions and missingness. Measurements available after the cutoff cannot improve that cutoff's grade. Hash integrity alone does not authenticate a provider or certify completeness.

| Metric | Required semantics | Holds and exclusions |
|---|---|---|
| Reported 24h USD volume | Raw source total, labelled token-wide or exact pool; window anchored to a common cutoff | Context only. Do not add overlapping provider/pool totals or substitute FDV, swap counts or fees |
| Qualified activity volume | Separately report provider-labelled organic estimates and locally qualified sampled trade volume; publish their denominator, coverage and unresolved relationships | Exclude evidenced self-trades, related-wallet round trips, known manipulation and dust according to declared rules. An anomaly-free flag alone is insufficient. Partial samples cannot certify the full 24h total; incomplete classification stays explicit |
| Meaningful holder growth | Comparable owner inventories at window boundaries, same scope/layout and documented completeness; aggregate token accounts by owner, exclude the canonical vault. Report entrants, exits and **net** meaningful holders, plus retention over a declared interval | Require declared economic-balance and voluntary-acquisition evidence rules. Unsolicited dust/airdrops earn no demand credit. Dust balance thresholds alone do not prove independence; do not use easily manipulated spot USD valuation as the sole qualification. Unknown provenance stays unqualified/unknown |
| Growth percentage | Net change divided by a comparable positive starting meaningful-holder count, with both counts and dates shown | Zero baseline: percentage undefined, absolute growth may be reported with valid evidence. Missing baseline is unknown, never zero. Negative growth remains negative |
| Recent momentum | Fresh qualified 5m/1h activity and changes across comparable intervals, trader breadth, net demand and meaningful-holder retention | Keep cumulative 24h volume separate from recent activity; no point boost for isolated price jumps, artificial staircases, wallet-count spikes or a fading historical total |

For tokens created less than 24h ago, use the supported portion of `[max(creation, cutoff − 24h), cutoff]`. State actual covered duration and token age; do not multiply an hour into hypothetical daily volume. A provider's opaque trailing window may be reported as such, with boundary uncertainty, but cannot be relabelled exact since-creation evidence. Migration time does not reset the creation clock.

A new token's initial holder baseline cannot be assumed zero from its age. An exact zero is valid only if supported by the declared inventory and acquisition rules at that time. A first snapshot taken late cannot retrospectively reconstruct earlier growth. Summaries and archived top-20 owner rows alone are insufficient for owner-level retention or dust exclusions.

## Scoring and ranking requirements

- Make qualified volume and meaningful holder growth core contributors to a proposed **attention component**, with recent participation/retention establishing that the wave remains active. Show its contribution separately from structural quality/risk and evidence coverage. Final discovery ranking remains one transparent 0–100 grade once a new version is validated.
- Preregister candidate transformations and weights after field coverage is measured. Evaluate saturation/log scaling and age-matched controls so whale churn, raw scale, tiny percentage denominators or extrapolated launch rates cannot dominate. No arbitrary weight allocation or new minimum is approved by this note.
- Preserve dominant adverse ceilings and existing momentum-withholding rules in the candidate model. Known manipulation must not be cancelled by large volume or holder growth. Missing evidence earns no organic-demand support and no clean-risk pass; do not renormalize the remaining inputs into a better score.
- Attribute provider estimates and local sample measurements separately; neither proves beneficial independence. Keep contradictory sources, excluded cases and all selected missing tokens in research denominators. Avoid counting the same provider organic construct twice without testing the dependence.
- Preserve archived v1–v4 evaluators, policy hashes, scorecards, outcome studies and election inputs. Do not silently change v4 weights, recompute historical grades using later data, or let attention rank override the documented voting outcome.

## Implementation order and acceptance gates

1. **Close source readiness.** Continue the held Jupiter/GeckoTerminal plan: permitted use/retention, actual Free endpoint availability, real fixtures and independently verified canonical pool binding. Connect only a predeclared cohort within existing spare capacity, pause/backoff, shared market/research/storage limits and maintenance allowances. No paid fallback, parallel provider schedule or quota increase.
2. **Design bounded owner history.** Add a versioned snapshot/delta format with timestamps/slots, supply/layout/coverage checks, exact owner aggregation, acquisition evidence and bounded retention/storage. Determine how qualifying entrants, exits and retained balances can be established using permitted cached evidence and existing collection budgets. Propose economic thresholds and retention intervals with controls; if full coverage is unaffordable, expose a sample and withhold population-growth claims. No extra owner scan or unbounded wallet graph is assumed.
3. **Publish descriptive measurements.** Add volume, holder-growth and short-window fields to normalized evidence, replay and UI with actual windows, exclusions and unknowns. Begin qualified holder observation prospectively; never invent a historical baseline. Do not award scoring points at this stage.
4. **Compare candidates prospectively.** Freeze v4 and proposed attention/composite variants at the same cutoff on the complete predeclared cohort. Include independently chosen ordinary launches, high-cap launches and manipulation controls. Keep raw totals, qualified estimates, coverage and age separate. Assess false positives, dust/wash resistance and forward retention/participation as well as same-source price/liquidity outcomes; price return alone is not validation of authenticity. Hold out later days and prohibit lookahead.
5. **Adopt an explicit new version only after review.** Publish the supported formula, thresholds, uncertainty and score breakdown; add migrations/export/replay compatibility only when the design is established. Validate budgets and all existing action/election/source gates, then commit/push the local milestone. No deploy or launch.

Required adversarial and acceptance cases:

- Large raw volume with linked-wallet churn cannot outrank well-supported genuine demand merely because the raw total is larger; unverified links also cannot become accusations or clean passes.
- Thousands of unsolicited tiny balances, splitting one owner's balance across token accounts, or repeated dust transfers add no qualified holder-growth credit. A legitimate broad launch is retained as a false-positive control.
- Holder entries offset by exits report the net correctly; later loss of acquired balances affects retention. Acquisition after cutoff cannot improve earlier growth. Zero/missing baselines and partial inventories remain distinct.
- A 23h-old token with a fading final hour is distinguishable from a currently accelerating wave; an hour-old token is not presented as having an observed full day. Age/window mismatch and missing recent data cannot manufacture acceleration.
- Pool/token scope mismatch, pagination/sample caps, gaps, stale/future timestamps, duplicates, unknown anomaly flags and source disagreement hold affected comparisons. Provider outages yield missingness, not organic volume zero or proof of clean trading.
- Known current risk concerns remain dominant even when qualified activity is high; exact old score exports and election replays still verify. All new retained records and attempts consume the existing shared allowances.

## This milestone's boundary

Recorded the founder's direction, audited the implementation, specified measurement semantics and reordered next work. No metrics, score weights or eligibility rules were activated. No API calls, credentials, database writes, collection schedules, financial actions or deploy. Validation is documentation target checking, source-reference review and whitespace review; application tests/build are not rerun for this documentation-only change.
