# Graded discovery implementation plan and checkpoint

Founder requested 21 October 2026: replace binary eligibility as the primary discovery ranking with a 0–100 grade. The canonical [PRD v1.2](spec/10X_MEME_FULL_PRD_v1_2.md), §4.7, records the plan before implementation. V1.1 and historical snapshots remain retained.

Plan: implement a versioned cached-data scorer (origin 10, controls 15, market 20, holders 25, wallet/funding 25, sampled performance 5), separate effective evidence coverage, missing/stale explanations and observed-risk ceilings; rank the complete bounded inventory before limiting; show scores on cards/details with replayable export; publish methodology, validate, commit/push. Action eligibility, election algorithms, source quotas, financial restrictions and no-deploy instruction remain. A low score is not proof of a scam, and a perfect model score is not a guarantee.

## Implemented behavior

Useful score-ranked discovery is now the primary browsing target; the ten-fully-eligible target remains an operational/action-readiness diagnostic. Provisional and excluded observations can rank. Existing action eligibility and the action `rank` field are computed with the original engine; a separate `discovery_rank` describes the browsing order. Neither ranking enables voting, launches or rewards.

The fixed weights sum to 100 across 18 criteria. Quantities earn gradual credit toward their reference targets; concentration health declines continuously beyond the current reference thresholds. The engine does not renormalize missing fields into a high score. Effective evidence coverage includes known failures and discounts incomplete/stale inputs, so an unobserved zero differs from a well-observed rejected origin. No score is a fraud or future-return probability.

Positive support decays linearly after the existing category freshness TTL and reaches zero at four times TTL. Future observations earn no credit. Origin proofs do not become stale simply because their fetch date is old. Dated adverse concentrations/exposures still apply published score ceilings even when stale/partial. Partial holder inventories cannot earn verified-holder health credit. Funding uses distinct expected sampled wallets; duplicate or unrelated windows do not fill gaps. Omitted-wallet/output-limit gaps make the denominator unknown and withhold clean-funding credit. Uncertified/omitted trade data cannot earn buyer or clean-sale credit.

Reported liquidity below $25K also caps the score continuously at `100 × clamp(liquidity/25000,0,1)`: zero reported depth caps at zero, $12.5K at 50. This prevents other positive evidence masking thin depth. Missing liquidity remains unknown and does not create a zero-liquidity finding. The dated observation remains inspectable; this is not a certified executable-exit estimate.

Momentum is only five points: at least six same-source positive-price samples spanning 30 minutes, no gap over 30 minutes, inside two hours. A -25% to +25% sampled return maps to 0–5 points. Mixed sources, duplicate/future/invalid prices, short/gapped/limited history and nonfinite derived ratios remain unknown with explicit reasons. Reported price growth does not certify organic trading. FDV never substitutes for reported cap. Paid boosts, names/artwork, unvalidated cap/linearity heuristics and unproven common-wallet allegations do not add points.

## Cached reads, ordering and scorecard evidence

- `GET /api/10x/candidates` defaults to `sort=score`. It assesses and grades the complete bounded inventory, filters the requested action status, sorts score descending / effective coverage descending / fresh liquidity descending / verified creation ascending / canonical address ASCII ascending, then takes at most 100. Optional fresh-liquidity sorting remains available.
- The score inventory query rejects more than **500 candidates**, **4,000,000 aggregate raw bytes** or an individual row above **1,600,000 bytes** before decoding. It does not guess the best 100 from a silently truncated set.
- One batched, address-scoped price read supplies at most **64** lightweight observations per token. A larger two-hour series explicitly sets `history_limited` and withholds momentum credit. No per-card provider request, database write, quota increase, collection-priority change or new schedule occurs.
- Cursors bind sort/view/filters, the source/order fingerprint and the score observation time, retained for at most five minutes. Changes affecting the view or cursor identity require a refresh; scoring time is pinned across pages rather than changing the rank on every page request.
- `GET /api/10x/discovery/scores/solana/:address?mode=live|fixture` returns a `discovery-scorecard-v1` with the complete cached candidate, bounded price series, exact `discovery-score-v1` policy, observation time, component/criterion results, concerns and input/policy/result/record hashes. Normalized input is capped at **1,800,000 UTF-8 bytes**.
- The token page exports its already displayed scorecard, preserving that exact observation rather than fetching new inputs at download time. Offline replay recomputes the same result and hashes with zero provider calls. Checksums demonstrate consistency, not issuer authentication or independent truth/completeness of provider/chain observations.
- Scorecards are computed on read; downloaded artifacts retain snapshots. Existing candidates, immutable cohorts, market history and old election records are not rewritten or retroactively enriched with grades. No D1 migration was required. Keep the v1 evaluator stable when adding a later scoring version.

## Product presentation

Discover shows score and evidence coverage prominently, without the previous eligible/provisional/excluded totals as the main verdict. Action filters and example data live in a secondary disclosure. The default 24h view still uses verified creation time; retained/unknown-date observations remain accessible through All stored observations. Model weights, targets, decay, ceilings and limitations are published on Rules (`/transparency`) and its existing public policy API.

Token pages show the score, six component contributions, dated concerns and ceilings before supporting action-readiness details. Every criterion exposes points, observed values, unknown/partial/stale/future state and collection limitations. Missing data does not become a scam finding, and a perfect model grade is not a trust guarantee. Previous scores retained after a failed UI refresh are explicitly marked potentially out of date.

## Local evidence and validation

At **2026-10-21T01:10:51Z**, the live cached 24h view ranked **71 observed tokens**, ranging **10–85/100**, while action readiness remained **0 eligible / 11 provisional / 60 excluded**. The leading observation had **85/100** and **91% effective coverage**. This is a descriptive checkpoint of the heuristic, not a recommendation or a performance prediction. An earlier checkpoint included 72 recent tokens; the count changed normally as the creation window advanced.

The independently replayed local scorecard for `TbX69Z9YEbBF647xRQSEKkdM5z99aAM8zyfXuUapump`, observed at **01:10:51.881Z**, had record checksum `457bce8cdc93a5bcade2c746ae06c8fdc96303cbdd39c55b7ca8c6a4f1ba8e9b`, 85 points and 91% coverage. No grade is claimed here for the requested Kimchi mint `CSocnzcRpgSCr1naKcNTieWZUxb6rABe45j844m7pump`; similarly named cached assets are distinct identities.

The 30 new backend tests cover maximum versus missing/known-bad grades, continuous monotonic criteria, concentration/authority/exposure/liquidity dominance over momentum, stale/future inputs, funding omissions and duplicate/unrelated windows, unsafe trade samples, insufficient/mixed/gapped/oversized price inputs, numeric overflow, changed inputs/policies/results, whole-inventory top-100 ordering, independent action rank, cursor identity and old election replay. Four UI tests cover grade/coverage prominence, unknown-score handling, dated risk ceilings, exact export semantics and published methodology.

The full backend suite passed **798 tests across 50 files**; discovery UI checks passed **67 tests across 12 files**, and backend typechecking passed. The existing large election-storage roundtrip test needed a 15-second test timeout instead of the default five seconds under concurrent workstation load; its assertions and runtime resource bounds are unchanged. Browser checks confirmed graded cards, criterion explanations, exact-scorecard export controls and published Rules on the local tunnel. A transient local HTTP 500 during heavy verification cleared without a restart; its cause was not established.

The final App build/typecheck and startup-budget check passed: **234.1 KiB gzip across 11 home-shell chunks**, below 250 KiB. At **01:27:22Z**, cached verification ranked **72** observations from **0–85**, with action counts **0 / 11 / 61**. Both the current scorecard and the retained `457bce8c…` scorecard replayed. The quiet operations check was healthy with a fresh independent watchdog, no election error, unchanged quotas and **three retained election records replayed**, including the 442-input daily record. These checks made **zero provider requests**. Public/private route-security checks also passed (15 private denials and 10 admin checks). No deployment or paid service was used.

Commands for cached/local verification:

```powershell
node node_modules/tsx/dist/cli.mjs scripts/check-discovery-scores.ts
node node_modules/tsx/dist/cli.mjs scripts/verify-discovery-scorecard.ts .tmp/discovery-scorecard-local.json
# The verifier also accepts a scorecard exported from a token page.
```

Initial weights are transparent heuristics, not calibrated fraud/return probabilities. Next: prospectively retain/measure versioned score cohorts for outcome calibration, improve source freshness/completeness, and certify additional supported paths. Do not infer prospective validation from replaying retrospective inputs. Existing market-data permissions, independent organic-activity/beneficial-control/LP-lock verification and real-wallet/small-screen/assistive-technology certification remain separate work. No paid service, deployment, financial execution or action-policy activation is introduced.
