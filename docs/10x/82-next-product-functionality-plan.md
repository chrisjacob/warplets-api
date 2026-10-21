# Next functionality: a useful daily discovery product

21 October 2026. Engineering plan requested by the founder after reviewing the disproportionate focus on PONYX. Reviewed against [PRD v1.2](spec/10X_MEME_FULL_PRD_v1_2.md), the [task map](19-prd-task-map.md), [decision register](04-decisions.md), [daily-attention requirements](70-authentic-attention-momentum.md), milestones 71–81 and current source code.

**Recommendation:** finish an effective Solana discovery MVP before expanding launch/reward functionality. Build broad token coverage, a comparable daily workspace, meaningful activity measurements and a prospectively evaluated scoring revision. Existing one-token investigations become regression fixtures. This plan changes no runtime, source allocation, model, gate or deployment.

**First implementation delivered:** [83 — rotating coverage and discovery workspace](83-rotating-coverage-and-discovery-workspace.md) records the shipped F1/F2 slice and remaining work. The review table below describes the planning baseline. Common activity normalization, live rotation smoke within available capacity and three-token comparison remain next.

**Second implementation delivered:** [84 — common activity and three-token comparison](84-common-activity-and-token-comparison.md) implements source-scoped dated records and explicit-refresh comparison while keeping unsupported qualified metrics held. The next data work is admitted broad-rotation observation and preregistered F3 qualification. Optional local shortlists were deferred at that checkpoint and are now delivered in [92](92-browser-local-discovery-shortlist.md).

**Third implementation delivered:** [85 — recent candle activity](85-recent-candle-activity.md) adds fixed-policy 5m/1h/6h measurements and equal-period reported-volume comparisons from existing saved candles. This is the recent-candle slice of F3; meaningful holder/organic-volume qualification, broader admitted observation and the prospective scoring study remain open.

**Fourth implementation delivered:** [86 — acquired and retained holder samples](86-acquired-retained-holder-sample.md) adds a fixed experimental native-size and endpoint-retention policy to comparison. It classifies raw entrants once, keeps missing/conflicting/truncated data held, excludes observed connections conservatively and preserves v4/legacy replay. This is sampled evidence; qualified daily growth, independence, organic volume and prospective scoring remain open.

## What the review found

**F3 trading sample delivered, 22 October:** [90 — signed trading samples](90-signed-trading-sample.md) adds dated 5m/1h/6h sampled breadth and exact native quote measurements to comparison, sharing the existing holder source replay. Equal-size/overlap measurements are descriptive, not manipulation labels or organic volume. Broad admitted observation, independence/valuation qualification and F4 evaluation remain open; v4 and production closure are unchanged.

**F1 accounting delivered, 22 October:** [89 — broad rotation coverage](89-broad-rotation-coverage.md) exposes fourteen UTC days of verified selection manifests and operational attempt metadata on Research. Selected, attempted and new-to-GMGN mints remain separate from validated observations. Prior work against the original scheduled baseline stays visible even without a manifest. Broad admitted observation and F3/F4 qualification remain open; current v4 and the thesis-only production gate are unchanged.

| Area | Actually available | Product gap |
|---|---|---|
| Discovery | Verified Pump creation/migration, canonical pool checks, cached cards/details, artwork recovery, age/action filters, score/liquidity sorting and versioned 0–100 v4 | The main list lacks search, a compact comparison table and a consistent cross-token attention view |
| Activity data | GMGN info/security/pool/candles, trader/activity investigations, bounded RPC comparison and quote/fee review | Scheduled GMGN work is still a fixed three-mint investigation. Rich evidence is not systematically available across today's candidates |
| Ranking | Frozen v1–v4 replay, risk ceilings, score explanations and prospective price/liquidity outcomes | V4 does not score qualified volume or meaningful holder growth. Detailed investigations have not by themselves improved the daily ranking |
| Holders | Full cached inventories, raw changes, endpoint retention and sampled acquisition checks | Dust-resistant, economically meaningful acquired/retained growth is not established; raw owners cannot substitute for it |
| Operations | Shared budgets/leases/backoff, local task/supervisor, watchdog, cache-only reads and immutable evidence | Workstation runtime exits, incomplete source coverage and archive/release readiness still affect the usable experience |
| Backing, launch and rewards | Signed Solana linking, backing/election rehearsals, three-pool economic/recovery labs, content moderation and reward-accounting prototypes | These are foundations and rehearsals, not live vote credit, a deployed launch adapter or claimable rewards |

The immediate deliverable is a better answer to **“Which observed new tokens have the strongest supported attention and momentum today, and what evidence or concerns explain their position?”** It is not a claim to identify the entire market's best token or certify safety.

## Build order and delivery estimates

Estimates are focused engineering days, excluding provider access delays and elapsed observation time. They are planning ranges, not delivery promises. The observation run can continue while later UI/operations work is built.

| Order | Functionality | User-visible result | Estimate / dependency |
|---|---|---|---|
| F1 | Broad candidate coverage and common activity records | Multiple fresh mints receive comparable dated observations; coverage shows what was actually collected | 3–5 days; first build |
| F2 | Daily discovery workspace | Search, compact table, useful filters and side-by-side comparison from cached data | 2–3 days; reuse current v4, then F1 fields |
| F3 | Meaningful volume, holder growth and recent momentum | Reported totals, supported samples and qualified estimates are separated; real windows and missingness are clear | 4–7 days; F1, prospective snapshots and qualification design |
| F4 | Cross-token scoring comparison and proposed v5 | A candidate ranking can be assessed against v4 and provider-derived heuristics on unseen tokens | 3–5 days implementation, plus a prospective observation period; F1/F3 |
| F5 | Discovery MVP reliability and storage readiness | A dependable cached product with understandable freshness, quota and recovery behavior | 2–3 days; start relevant fixes alongside F1/F2 |

Total implementation range: **14–23 engineering days**, with overlap where dependencies permit. Plan an initial **2–4 week observation/review window** consistent with PRD Phase 1; elapsed time alone never qualifies a model. Deliver F1/F2 first and review measured coverage before committing to unsupported F3 metrics or declaring v5 ready.

## F1 — Broad candidate coverage and a common activity record

**User story:** I can inspect multiple newly discovered tokens using the same metrics, rather than finding rich evidence only for previously investigated mints.

1. Add a versioned activity read model keyed by chain, mint, observation cutoff and source. Fields carry units, actual window, fetch/provider times, scope (token/pool/wallet), sample denominator, coverage, qualification state and immutable receipt references.
2. Use the existing chain-observed candidate inventory as the primary cohort. Add fixed-contract GMGN trending/completed-launchpad feeds as a candidate-enrichment/discovery lane only after endpoint-specific schema, Free entitlement and weight checks. Provider-listed graduation is a lead for existing verification, not a replacement for creation/migration proofs.
3. Replace fixed recurring regression-mint selection with deterministic rotating enrichment. Freeze selection before reading the new model's scores. Include age/liquidity/current-v4 bands and a deterministic address/date tie-break; retain missing/rejected entries. Founder-reported concern cases remain a separately labelled regression set.
4. Use inexpensive list/basic observations across the cohort; allocate richer candles, holder/trader or RPC investigations to a declared subset. All work uses existing shared admission and spare maintenance capacity. No parallel provider timer or per-browser provider calls.
5. Record effective server filters and list bounds. GMGN documents default Solana filters, so omitted parameters are not evidence of an unfiltered population. A token absent from a provider list remains in our cohort as missing; it is not a negative or clean label.
6. Reuse source artwork as a sanitized metadata hint and the existing recovery path. A broken image stays visible as pending/unavailable with a bounded fallback; image availability earns no trust points.

GMGN's [documented market commands](https://github.com/GMGNAI/gmgn-skills/blob/main/src/commands/market.ts) and [early-screening workflow](https://github.com/GMGNAI/gmgn-skills/blob/main/docs/workflow-early-project-screening.md) support investigating list-first screening. Its [market field reference](https://github.com/GMGNAI/gmgn-skills/blob/main/skills/gmgn-market/SKILL.md) documents trending, lifecycle categories and filtering. These public contracts do **not** verify our account's Free access, exact endpoint weights, complete coverage or label accuracy. No trading commands are part of this plan.

If a new feed is unavailable under our Free access, use the chain-observed inventory and already verified read contracts for rotating enrichment. Record the feed as unavailable and continue the common read model/workspace; do not make a new provider entitlement a prerequisite for every useful product feature.

Acceptance:

- A fixed replay fixture includes ordinary, concerning, absent, rejected and duplicate provider rows; all input mints remain accounted for.
- A bounded live smoke test covers at least three previously unreviewed mints when existing capacity permits. No paid fallback or automatic funding if access fails.
- Establish a prospective manifest of at least 30 previously unreviewed tokens across at least three UTC days, extending elapsed collection as needed to fit capacity. This is a plumbing/coverage target, **not statistical validation or a claim that 30 tokens are sufficient**.
- Publish coverage and spending per feature/source, including failed attempts. A source outage degrades fields without removing inconvenient cohort members.
- PONYX/USDF/XTO remain regression examples, not the main sample, ground truth or recurring default query targets. A named token gets another deep investigation only for a reproducible issue that blocks a general feature or an explicit user request.

## F2 — Daily discovery workspace

**Saved-list extension delivered, 22 October:** [92 — browser-local shortlist](92-browser-local-discovery-shortlist.md) adds exact-mint save/remove controls across cards/table/details, a persistent local list outside current results and existing comparison selection. Live/fixture scopes, temporary-storage warnings and corrupt-data preservation are explicit. No new provider/server work or score/gate change; this small UI extension does not alter admitted F1 or prospective F3/F4 dependencies.

**User story:** I can quickly find and compare candidates without opening several long evidence pages.

- Keep the existing cards and add a compact table with artwork, mint identity, verified age, current model/score, evidence coverage, reported liquidity/cap, volume/growth window status, recent momentum and the main concern.
- Add name/symbol/exact-mint search, freshness/coverage/liquidity filters and shareable view parameters. Search scope and truncation must be explicit; search precedes the visible top-100 limit, with stable ordering/pagination. Never identify a token by symbol alone.
- Compare up to three tokens at a common displayed cutoff, showing source/window differences rather than presenting mismatched metrics as equivalent. Reuse existing score breakdowns; summarize the strongest supported components and limiting concerns.
- Preserve v4 as the default ranking while new metrics are descriptive. Do not offer an “organic leaders” sort backed by raw or unknown organic values. A provider-ranked view, if exposed, must identify its source and separate purpose.
- Keep copyable mint addresses, explorers, image fallbacks, mobile layouts, last-successful data and freshness labels. Unknown is distinct from zero; staleness can change score/rank only through the published evaluator.

Acceptance: duplicate symbols are unambiguous; filters/search/compare preserve chain+mint identity and frozen request identity; unavailable images and providers do not blank the list; opening a comparison makes zero provider requests. The existing action-check filters stay secondary to graded browsing. The browser-local saved shortlist is now delivered as a small UX extension, with no financial, identity, collection or study-enrollment effect.

## F3 — Genuine participation metrics

**User story:** I can distinguish strong supported attention from a large reported volume number or thousands of tiny unsolicited holder balances.

| Metric family | Build | Required distinctions |
|---|---|---|
| Volume | Dated reported totals, source-quality flags, supported trade samples and a proposed qualified estimate when evidence meets declared criteria | Reported USD ≠ verified economic volume. No abs/signed-cost conversion, buy/sell netting or pool/event/fee-basis substitution. Missing independence or valuation evidence cannot become organic credit |
| Holder growth | Comparable prospective inventories, owner aggregation, exclusions, acquired/retained entrants, exits and net change | Raw holders ≠ meaningful owners. Dust/transfers/vaults/account splitting and acquisition unknowns remain distinct; raw entrants alone earn no qualified growth points |
| Recent momentum | Comparable 5m/1h/6h windows where supported, participation breadth and acceleration/retention measurements | Source/window gaps stay explicit. An hour-old token cannot have a measured 24h history; a late first observation is not automatically its creation baseline |
| Manipulation concerns | Run existing candle/launch/concentration checks across the sampled cohort; evaluate repeated sizes, one-sided participation and provider labels with counterexamples | A chart shape or vendor label is a concern, not fraud ground truth. Missing labels are not clean passes; ordinary order sizing and arbitrage are controls |

Qualification rules must be written before evaluating outcomes: required finality/source scope, unit/valuation support, acquisition evidence, economic size, retention interval, known linked-wallet exclusions, freshness and coverage. Minimum balances, thresholds and weights remain experimental until tested. Do not demand that all tokens pass binary action eligibility merely to be displayed or compared.

Use existing holder/wallet archives first. Collect additional snapshots or trades only for the declared subset with a measured RPC/storage plan. A supported sample stays a sample; do not extrapolate it to a certified full day or call it an organic lower bound without evidence supporting that claim. If qualified measurement is unaffordable on Free access, ship the honest descriptive view and record the unresolved scoring input.

Acceptance: dust airdrops, duplicate token accounts, linked-wallet churn, missing USD, source disagreement, truncated histories, stale/future evidence, young launches and fading recent activity have explicit adversarial cases. Ordinary launches are independently reviewed controls, not automatically labelled benign. No later acquisition, price or holder evidence enriches an earlier score.

## F4 — A scoring revision that earns its place

**User story:** My default order improves on previously unseen tokens, with an explanation of what the score measures and why it changed.

- Compare **A: frozen v4**, **B: a deterministic pinned GMGN-derived heuristic**, and **C: a proposed hybrid with material volume/growth/momentum components**. GMGN's skills are heuristics, not a guaranteed single trust-score API. A vendor arm missing necessary fields remains unavailable; do not fabricate it or block the useful UI while waiting.
- Preserve one public 0–100 Discovery score plus its component/coverage breakdown. Do not add competing “safety probability” numbers or invert `rug_ratio` into trust. Define the candidate formula and at most one sensitivity variant after the F1 coverage audit, then freeze both before observing outcomes; do not tune repeatedly against the same tokens.
- Retain existing adverse-evidence ceilings and separate action/election rules. Unknown criteria earn no unsupported points, missing weights are not renormalized, and broad attention cannot cancel independently supported risk concerns.
- Give paired comparisons their own study ID/record namespace. Existing score research retains the first grade per mint/model; an earlier first-grade v4 cohort cannot be paired with a later GMGN snapshot as if they shared a cutoff. New comparison records consume existing admission/accounting; old cohorts and their outcomes stay unchanged.
- Freeze all arms for each mint at the same cutoff with declared source freshness/skew. Stagger tokens within Free capacity rather than pretending the entire cohort was fetched simultaneously. Retain incomparable/missing cases in the full-inventory denominator.
- Hold out later UTC days and newly enrolled mints. Founder concern cases are regression checks only. Measure independently reviewed concern detection/false positives, top-ranked adverse cases, breadth/retention, rank stability, missingness and provider cost. Price return or agreement with GMGN alone does not validate authenticity or trust.
- Preserve all v1–v4 evaluators, scorecards, cohorts and election inputs. Add v5 export/replay and a reversible local selection only after the comparison supports it and the formula/evidence requirements are published. No automatic self-training or policy promotion.

**Positive counterexample requirement:** [Kimchi](87-kimchi-positive-counterexample.md) is founder-selected retrospective runner evidence, including reported strategic concentration. The standalone $10M/24h warning is retired. Evaluate fast successful runners and concentrated successful/failing launches as distinct controls; measure missed attention opportunities and control/integrity concerns separately. Allocation intent or a later gain cannot waive independent evidence or turn a known development case into a held-out success.

Promotion review requires a preregistered definition of material improvement and acceptable false-positive/missingness regressions, evidence from the held-out sample, known limitations and affordable sustained coverage. There is no automatic pass after a token count or calendar deadline. If the candidate fails, retain v4 and publish the result; do not spend another sequence of milestones tailoring it to one token.

## F5 — Reliability and Free-service readiness

**Storage recovery delivered, 22 October:** [91 — full local archive and verified restore](91-local-evidence-archive-and-restore.md) implements private whole-store snapshots, checksummed schema/row/page inventories, pinned offline verification, safe scratch restoration and chronological growth differences. A real 1.01 GB / 83-table store restored with identical bytes; no historical eviction or runtime adoption occurred. Multi-day growth, approved retention, off-device recovery, stopped-owner adoption and the reliability rehearsals below remain open. This is a parallel F5 slice; admitted broad observation and F3/F4 qualification remain product dependencies.

**User story:** I can return tomorrow and see a useful list or an honest last-known view, without needing repeated manual restarts.

- Reproduce and address the recurring local runtime/supervisor failure path with owned-process checks and fault fixtures. Keep the three-starts/15-minute rule, pause/backoff, existing stores and no-duplicate-collector behavior. Provider quotas or intentional pauses must not trigger restart loops.
- Show last success, source freshness, per-metric coverage and the next permitted refresh in existing status surfaces. Preserve cached results on errors. External alerts are a later explicit destination/opt-in setup; this plan sends nothing.
- Measure row/byte growth, specify an archive/export/restore policy and verify restoration before any eviction. Existing evidence is not deleted, overwritten or silently reclassified. Keep current local calibration authority; production restoration of bounded internal admission remains a release prerequisite, not a new restriction applied today.
- Rehearse 48h provider outage, duplicate jobs, clock/day rollover, exhausted quotas, image failures and recovery. Maintain the existing app performance budget and cached read paths.

Acceptance: a repeatable daily discovery journey survives a stopped owned launcher and source outage without corrupting evidence, overstating freshness, making paid requests or requiring an action-gate waiver. This is local MVP readiness, not a deployment or production-uptime certification.

## Source and capacity rules for every slice

Use the already authorized GMGN query integration and existing chain/market data first. Jupiter/GeckoTerminal expansion remains conditional on their unresolved endpoint-specific access/usage and canonical-scope checks; it must not hold the entire discovery workspace hostage. Do not reopen the founder's GMGN storage/display authorization or assume it applies to another provider.

Before F1 collection changes, create a capacity worksheet covering normal pricing, source feed calls, per-token details, every candle page, holder/wallet RPC, retries/failures, response bytes and retained bytes. Use measured headroom under current configured ceilings, not advertised theoretical rates. The existing fixed pilot's maximum 21 endpoint attempts/day is a planning baseline to redistribute, not an extra allowance or a new global cap. Verify weights for new endpoints; an unsupported or over-weight endpoint stays held.

Preserve the existing shared market/RPC budgets, wallet/quality/artwork subsets, per-response bounds, one-flight source lease, ten-second pacing and provider reset/backoff. Keep three capture/five finalization maintenance limits unless a separately justified future change is made. D23's explicit local-calibration exemption remains; never reset counters or silently reintroduce its disabled internal caps. Provider Free limits and all evidence gates remain in force. Do not promise minute-level candles or full owner scans for all 100 tokens until the worksheet demonstrates affordability.

## Work after the discovery MVP

| Next product phase | Reuse | Remaining prerequisites |
|---|---|---|
| End-to-end community-backing rehearsal | Existing signed Solana identity, ledger, cutoff and election labs | Complete supported-window/finality/reorg coverage, historical USD, membership/Sybil evidence and D07 policy before real vote credit. Discovery rank never silently elects the spotlight |
| Campaign/content journey | Existing submissions, moderation, reports, manual authorship, accounting and appeal prototypes | Authenticated authorship, qualified votes/referrals/engagement, retention/staffing and D11/D12 policy before rewards. Raw merit rank remains separate from boosts |
| Certified Solana launch preparation | Existing exact three-pool, fee/route/timing and recovery labs | Protocol/config/lock certification, durable execution receipts, custody/fees/legal/security decisions, approved spending/signing and viable same-chain $10X before a full ATTN launch. Preserve 50/20/20/10 and zero founder $10X mint |
| Warplet boosts and additional chains | Existing NFT product and chain-aware architecture | Signed cross-chain ownership/snapshot policy, per-chain verification and launch adapters. No automatic bridging, reward entitlement or assumed chain support |

These later areas remain part of the PRD. Rebuilding their existing labs, adding another bespoke evidence panel, launching tokens, treasury work or expanding chains is not the next default work item.

## Recommended first implementation request

**Build F1 and the first F2 table/search slice:** introduce common dated activity records, deterministic rotating cohort selection, a Free-access-verified GMGN list adapter and a cached cross-token discovery table. Keep v4 live, new qualification fields honest and all existing evidence/action gates unchanged. Demonstrate the result across previously unreviewed tokens, then commit/push without deploying.

## Planning checkpoint

This milestone reviews and updates documentation only. No token/market-data API request, credential read/change, collection activation, database write, ranking change, runtime restart, financial action or deploy. Documentation targets and whitespace are checked; application tests/build are not rerun for prose-only changes. Existing unrelated Network/legal work remains excluded from the planning commit.
