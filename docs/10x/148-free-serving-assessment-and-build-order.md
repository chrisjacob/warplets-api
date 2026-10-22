# Outcome-led build order and Free serving assessment

Follow-up: [149 — native builder and combined Free budget](149-native-builder-and-combined-free-budget.md) now measures the unchanged rebuild path. A minute rebuild schedule models 78.0 million archive reads/day before readers, so adoption remains held with a named input-preparation cost blocker. The initial assessment has a concrete decision; daily-decision UX/artwork acceptance is the next product slice. Original 148 measurements/pins below remain unchanged. No model, gate, schedule or runtime adoption follows.

22 October 2026. Implements the founder-approved revised order. This is an offline assessment and planning update; no runtime route, score, source allocation, provider entitlement, retention policy, production exposure or evidence gate changes.

## Approved next tranche

| Order | Deliverable and acceptance | Equivalent engineer days |
|---|---|---|
| 1 | **Free serving decision.** Exercise the intended route and representative retained data with all checks intact. Account for CPU, queries, scanned rows, writes/indexes, database/row/account storage, projection building, polling and other account usage. Record a supported or held decision with remaining evidence. | 2–3 |
| 2 | **Daily-decision UX and artwork.** Validate find → inspect → compare → save → reopen, with five timed journeys, rendered-image success/failure denominators and honest missing artwork. Verify keyboard, mobile/reflow and zoom usability without hiding concerns or unknowns. | 4–6 |
| 3 | **Unfamiliar-token yield.** Use admitted GMGN/existing sources to measure useful fresh candidates, complete/missing fields, rejection reasons and Free cost. Preserve prospective cohort denominators; existing three-target/day plumbing does not become unlimited collection. | 2–4 |
| 4 | **Qualified participation subset.** Preregister economically acquired/retained holder and organic-volume rules before outcomes. Build the affordable supported slice, expose unknowns and selection limits, and award no wash/dust/unsupported daily-attention credit. | 5–8 |
| 5 | **Read-only release/security acceptance.** Verify isolation, private/public and admin boundaries, abuse/default behavior, cached degradation, thesis-only closed assets and the concrete recovery requirements needed for release. Deployment remains separately instructed. | 4–6 |

The first tranche is **17–27 equivalent engineer days**. These are estimates for slices of the existing backlog, not measured historical hours, promises of agent completion time, or extra work added to the full backlog. Prospective observation and external waits may run alongside engineering; they still have to elapse. Completing this tranche does not complete the full PRD or authorize release.

Afterward, compare frozen A/B/C arms (v4, provider-derived heuristic, hybrid) on unseen mints and later-day holdouts. Keep v4 unless independent results support improvement. Never promote a score or action/election decision automatically.

Recovery is still required where it closes a **named release blocker**. Reader-recovery/snapshot/automatic manifests, consumption acknowledgement, orphan discovery, supersession/expired jobs, fenced new-generation adoption/rollback, private/off-device recovery and chronological growth remain open. Do not default to another generic/private recovery branch when it does not unblock the next product outcome. Existing F1–F5 and later phases remain; independent Solana $10X precedes the full ATTN three-pool architecture. Live votes/launches/rewards/treasury/multichain retain their approvals.

## Serving assessment scope

The actual current public candidate endpoint, `GET /api/10x/candidates`, still selects and validates the whole bounded current inventory. After the age-window filter, it loads bounded price/first-quote history and evaluates every remaining candidate before search, presentation filters and page output. A 25-card response or exact-mint search does not avoid that work. `GET /api/10x/admin/score-read-pages` is a separate authenticated compact experiment, **not the public serving implementation**.

`scripts/discovery-free-serving-study.ts` bundles the unchanged `discovery/src/worker.ts` router through a test-only wrapper. It uses native local workerd/D1, actual route query parsing, admin authentication/browser guards, envelope/serialization and existing evaluator/reader validation. A separate Node evaluator provides the expected card hashes. The first case matches the current browser's default query (`limit=100`, `browse=inventory`, `age=24h`, current inventory/cards/live/default filters); additional cases cover 25-card all-age, liquidity sort, exact mint and empty search. Warm latency runs have no tracing proxy or inspector; separate untimed reads record native D1 metadata. Each route/query gets three warmups and thirty measured requests, plus three mixed-query batches of width three. These are bounded local observations, not load certification or independent cold-start samples.

Fixtures are explicit: (1) the pinned restored metadata archive's selected candidates, their complete selected history through the historical cutoff and original control row; (2) five hundred distinct synthetic candidates with maximum-length escaped names/symbols and no historical qualification. All existing source-size/page/policy/generation/time/hash/schema checks remain. The test-only clock is fixed once per isolate to the original cutoff; historical observations never become fresh evidence. The reduced eight-table read closure preserves table/index definitions and the active view; it omits unrelated retained tables and cannot prove full-store storage fit. No production configuration imports this wrapper.

Only selected active candidates are copied: omitted expired/retained candidates are not recreated, so the isolated retained count and inventory scan cost are not the original full-store totals. The workload worksheet extrapolates these fixture reads only; production queries, contention and storage require their own evidence. Synthetic address/proof fields are test inputs, not independently verified chain identities.

The source is opened read-only and SHA-256 verified before and after; isolated read tables are hashed before and after all requests. No `.dev.vars`, provider key or original journal is loaded. Outbound transport is blocked and any attempt fails the study. Invalid outer credentials/method/path and actual admin auth/origin/local-runtime/host probes must reject; runtime/admin failures must make zero queries. New output must be an exclusive private `.tmp` directory; old artifacts are never overwritten. Output contains private copied records and stays ignored, not in public assets or Git.

## Current Free ceilings and worksheet

Checked against current Cloudflare documentation on 22 October:

- Workers Free: 100,000 requests/day, 10 ms CPU/invocation and 128 MB isolate memory. Waiting for IO is not CPU; local wall time cannot substitute for actual CPU accounting. [Workers limits](https://developers.cloudflare.com/workers/platform/limits/).
- D1 Free: 5 million rows read/day and 100,000 rows written/day. Indexed scans/writes count; returned-row counts and logical changes are not complete cost evidence. [D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/).
- D1 Free: 500 MB per database, 5 GB account storage, 50 queries per invocation and 2,000,000 bytes per row. [D1 limits](https://developers.cloudflare.com/d1/platform/limits/).

The model conservatively uses decimal storage ceilings. It takes daily background requests/reads/writes, actual CPU and full storage as nullable inputs: **unknown never becomes zero**. It rejects unsafe arithmetic and counts every endpoint/poll, including a partial interval. Model demand alone exceeding a ceiling is an explicit failure even if shared usage is unknown; being below a ceiling never grants Free or evidence admission. The pure model always returns `decision=held`, `free_acceptance=false`, `action_authority=false` and zero provider requests.

At one endpoint every thirty seconds for a full day, 1 / 10 / 30 / 100 continuous viewers produce 2,880 / 28,800 / 86,400 / 288,000 requests before other pages, assets, endpoints, collectors or projects. One hundred already exceeds the Workers Free daily ceiling. D1 reads multiply those requests by the measured scanned-row count, not response size. This is a demand scenario, not a usage forecast or a change to browser polling.

The actual `DiscoveryPagination` hook polls page one every **sixty seconds while visible**, skips other pages/busy/held states and keeps explicit navigation/refresh requests. The sixty-second worksheet therefore models 1,440 / 14,400 / 43,200 / 144,000 requests/day for the same continuous-viewer counts. It remains a ceiling scenario for persistent visible tabs, excluding initial loads, clicks, token/artwork/status requests and all other shared traffic. Thirty-second scenarios are stress assumptions only. No polling code is changed.

The original complete raw archive is approximately 1.01 GB and cannot fit one Free D1 database. The restored stripped metadata file is only an assessment input; its smaller size neither authorizes runtime adoption nor establishes independent private/off-device recovery. Existing original evidence, keys, receipts, journals, cohorts, elections and spent allowances remain intact.

## Measured result

The final private report is `.tmp/free-serving-20261022-148-003/report.json`, SHA-256 **`423ff7f03e6317f5a7587a033dc1013baa425c3d181c31c2c1ce6dfe87c985e8`**. Both fixtures pass all five query cases through both unchanged routes: **600 measured requests**, 36 concurrent parity checks and 14 boundary probes, in addition to warmups/untimed traces. All card hashes agree with the original evaluator. Original source and all eight fixture table hashes remain unchanged; every measured trace writes zero rows and there are zero outbound attempts/provider calls.

Default browser query results (100-card limit, verified-24h inventory):

| Fixture | Route | D1 rows read/request | Local wall median / p95 |
|---|---|---:|---:|
| 244 archived candidates, 6,321 market rows | Current public evaluator | 28,355 | 215.01 / 268.28 ms |
| Same archive selection | Compact admin reader | 148 | 21.56 / 30.78 ms |
| 500 synthetic wide candidates, no market history | Current public evaluator | 4,758 | 589.41 / 965.16 ms |
| Same synthetic fixture | Compact admin reader | 213 | 27.36 / 31.08 ms |

At the actual one-minute cadence, the archived default-query model gives **40,831,200 reads/day for one continuously visible evaluator viewer**, already above the five-million daily ceiling. The compact model gives **213,120 reads/day for one**, **2,131,200 for ten**, and **6,393,600 for thirty** continuous viewers. These exclude builder/background usage and other endpoints; “ten fits this arithmetic” is not approved capacity. For comparison, the all-age 25-card archive case reads 53,123 rows through the evaluator and 58 through the compact route; small responses do not eliminate full evaluator IO.

Local wall times include host transport and contention, including overlapping offline study work/background processes. They are advisory observations rather than a controlled CPU comparison, deployed latency guarantee or evidence that the 10 ms CPU ceiling is met. The synthetic fixture has no history and is not a worst-case full application dataset. No route is promoted on these results.

## Decision and next evidence

**Free serving admission remains held.** Compact route parity and lower local request cost are useful feasibility evidence, not permission to switch the public endpoint. No Free account, remote storage, actual deployed CPU, heap headroom, full Pages proxy/middleware, native projection-builder/index/write cost, prospective growth or shared-account usage is certified here. Existing component race/cursor/freshness/security tests remain required; this study does not replace them.

Next serving work must resolve the specific cost boundary: establish a complete shared read/write/request/storage budget and the compact builder's native cost, then assess the actual approved serving arrangement with full validation and observable CPU. Keep the public route unchanged until that decision is supported; no paid fallback, validation removal, wider limits, stale freshness labels or silent schedule change. Product UX/artwork acceptance is the next outcome in the approved order; admitted broad observations can mature within existing capacity while serving evidence remains held.

## Reproduction and validation

From the repository root, with installed locked dependencies:

```powershell
pnpm exec tsx --test scripts/discovery-serving-capacity.test.ts
pnpm exec tsc --noEmit -p tsconfig.serving-study.json
pnpm exec tsx scripts/discovery-free-serving-study.ts SOURCE_SQLITE EXPECTED_SHA256 CUTOFF NEW_PRIVATE_OUTPUT
```

Use independently retained source pins, not a newly computed pin as proof of provenance. The reference study uses `.tmp/discovery-metadata-unsealed-20261022-001/capacity/capacity.sqlite`, SHA-256 `c5bd52a6eeb0aa6b726cd05754779bd2a7e059171c226e964f3f0ac66b03d801`, cutoff `2026-10-21T14:24:50.571Z`. Original archives and older proof files remain untouched. No migrations run against a live or original database; migration SQL creates only a new in-memory fixture.

The study uses the existing local compatibility settings/dependency lock; current Workers types `5.20261022.1` were separately retrieved for D1 API review without changing dependencies. Security preflight, security blocklist, original research row digests/foreign keys and thesis-only artifact checks pass. Thirteen new unknown/boundary/background/overflow cases and 28 existing reader/security/browse cases pass, as does scoped TypeScript validation. The arithmetic tests and scoped typecheck join security CI. Frozen preservation checks verify 59 private proof/target/journal artifacts and actual credential/key exclusion without printing secrets. The prior 437-case evidence matrix was preserved, not rerun or counted as new coverage. All evidence/source/time/action/election/financial/release gates, v4, provider Free budgets, local research authorization and closed thesis-only exposure remain unchanged. No collection, spending, reset, deletion, runtime adoption, restart, live migration or deploy.
