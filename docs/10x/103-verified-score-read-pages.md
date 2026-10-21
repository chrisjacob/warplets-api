# Verified score-card pages and Free write budget

22 October 2026 (Australia/Sydney). Continues [102 — persisted score experiment](102-persisted-score-read-model.md) and PRD §17.7. Delivers a smaller independently verified read path with complete current-card browse semantics. It remains **local admin research**: no public Discover adoption or automatic rebuilding, and F5 Free-serving acceptance stays open.

## Implemented

Additive migration **0045** stores one bounded inventory manifest plus up to 500 compact card records keyed by mint. It shares 0044's monotonic source revision; no additional source triggers are added. Each manifest pins the v4/action-policy hash, evaluator/browse contract version, cutoff, sixty-second read window, current live inventory scope, frozen semantics, all browse fields and each card's semantic hash. Cards omit their original display rank; the reader reattaches the exact rank for the selected sort/action-status/age view after verification.

The existing evaluator still assesses complete evidence. The builder runs it once, projects cards and publishes **all cards and the manifest in a single three-statement D1 transaction**. Every statement requires the original source revision, unpaused control state and no newer cutoff. A source/pause race or older builder leaves the previous generation unchanged; a write failure rolls back the whole replacement. Original raw evidence, immutable research/election snapshots and the older 0044 experiment are separate and unchanged. Only disposable derived cards are replaced. [D1 batch API](https://developers.cloudflare.com/d1/worker-api/d1-database/).

Reads use two statements:

1. Read and verify the compact manifest with the source revision. Apply the shared original browse-ordering implementation to its small index: first-day population, action-status counts/filter, score or fresh-liquidity sort, creation/mint tie-breaks, global rank, exact-mint/name/symbol search, freshness, reported-liquidity and coverage filters, then top-100/500 presentation bound.
2. Fetch only the requested 1–100 card records by indexed mint, rechecking the source revision and manifest generation in the same lookup. This barrier also runs for **empty matches**. Verify each card hash and its indexed fields before returning cards. Hash work is bounded to the selected page and awaited in parallel.

The shared browse helper is also used by the existing full evaluator path; current card/full responses and ordering stay the same. Pagination pins the manifest hash and every filter, while allowing page-size changes as before. Changed/expired/future snapshots, malformed/filter-mismatched cursors, missing/corrupt/substituted cards, invalid/repinned inconsistent manifests, policy changes, source changes (including off-page edits), or missing migrations hold without evaluator/provider fallback. Checksums identify semantic content; they are not signatures from an independent source or protection against an authorized writer replacing every pin.

Bounds: existing evaluator **500 candidates / 4 MB combined / 1.6 MB individual**, 600 KB manifest, 16 KB per derived card, 1.8 MB combined cards and 1.8 MB encoded transaction input. The last guard includes JSON escaping/record overhead. A page loads at most 100 cards / 1.6 MB of card payload plus the manifest. These are derived-storage/read safety bounds, not new provider or research-capture limits. Oversize input holds instead of trimming evidence, weakening a schema or replacing the prior complete generation.

`available` means a verified **frozen cutoff** snapshot can be inspected within its read window. Its market data and eligibility are not relabeled current. All responses retain `action_authority: false`; independent action/election/financial paths still reassess their original evidence. Reported volume and raw holder counts gain no organic-demand or holder-growth credit.

## Local use

GET `/api/10x/admin/score-read-pages` accepts `limit`, `sort`, `status`, `age`, `browse`, `q`, `freshness`, `min_liquidity`, `min_coverage` and `cursor`. It serves only current live cards. POST to that path accepts only `reason`, with no cutoff, policy or limit override. Both retain local-host/runtime, Bearer/origin and no-store protections. Existing candidate endpoints, client cursors, UI and production closure are not switched to the experiment.

```powershell
node scripts/discovery-operator.mjs build-score-read-pages
node scripts/discovery-operator.mjs score-read-pages
```

These operator commands were **not run against the live runtime**. Migration 0045 was exercised in isolated fixtures only; activation is through the next ordinary migration-aware startup. There was no forced restart, live migration, lease/reset, provider request or schedule activation. No new service, dependency or billing tier was added.

## Measurements

The same previously verified private scratch archive was opened read-only at `2026-10-21T14:24:50.571Z`. Its **244 current candidates and 6,321 market-history rows** were copied into a new in-memory fixture. All 244 returned cards—including ranks, scores, concerns and evidence coverage—match the original evaluator at that cutoff. This older fixed archive is not today's live coverage or a full raw-store restore.

The final run includes JSON response serialization and sixty requests per read shape. The baseline was rerun on the same local host; its timings are not directly comparable to milestone 102's earlier environment/run.

| Read | Response bytes | Wall p50 / p95 | Mean process CPU |
|---|---:|---:|---:|
| Older all-244-card snapshot | 349,197 | 23.10 / 30.49 ms | 23.97 ms |
| One-card page | 2,083 | 7.43 / 9.30 ms | 8.33 ms |
| Default 25-card page | **39,032** | **9.94 / 12.34 ms** | **9.40 ms** |
| 100-card page | 147,784 | 18.51 / 22.31 ms | 21.62 ms |

The manifest is **70,639 bytes**; stored card payloads total 343,525 bytes. Allocated SQLite storage: manifest 73,728 bytes; cards 503,808 bytes; card primary-key index 20,480 bytes. Those allocations exclude shared revision/schema pages and the older experiment. They exceed the single-row experiment's allocation because individual rows/indexes trade storage for selected-card access.

The builder took 989.11 ms wall / 1,313 ms process CPU. Reads made no writes or provider requests. Query plans show singleton revision/manifest primary-key lookups, the bounded selected-mint JSON list and indexed card lookups, without source/evidence table scans. A 500-candidate fixture with maximum-length JSON-escaped names/symbols produced a 532,234-byte manifest and 1,086,509 card bytes. Its 25-card mean CPU was **15.62 ms** (wall p50/p95 15.21/18.16 ms); 100-card mean CPU was 26.30 ms. Other fields were sampled from the archive and history omitted: this is a wide-metadata stress fixture, not the worst possible valid schema population.

Local process CPU includes host/GC/background and timer quantization; individual p95 samples reached 16–47 ms. It is **not Workers CPU, deployed latency or D1 billing telemetry**. A default-page mean below 10 ms does not establish compliance with the Workers Free per-invocation limit, particularly with these tails, larger pages and wide-index results. Public adoption stays held. [Workers limits](https://developers.cloudflare.com/workers/platform/limits/).

Private final proof `.tmp/score-read-pages-benchmark-20261022-002.json` has SHA-256 `7b1602434286fd6371e380858a4fcc9546b329c11128f5abd75d548974a71b0f`. The earlier serial-hash run `...-001.json` is preserved separately; `.tmp/measure-score-read-pages.ts`, both reports and all real inputs stay ignored/private. No old archive or proof was overwritten.

## Free budget finding and revised next step

Current D1 Free publishes **5 million reads and 100,000 writes/day**, shared with other account usage; indexes also contribute writes. A 244-card replacement measured **489 logical table changes** (244 deletes + 244 inserts + one manifest update), before index writes or source-revision updates. At one rebuild/minute, those table changes alone would be **704,160/day**. This experiment must not be scheduled at that cadence. Actual usage must be checked with D1 metadata before future adoption; no remote meter was exercised. [D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/).

Do not treat a slower schedule as a solution while keeping a sixty-second validity window and invalidation on every source mutation: it would mostly serve held results. Current local calibration authority, source collection quotas and spent allowances are unchanged; this worksheet does not add a research limit or reset anything.

Next build order:

1. **Incremental serving design and prototype:** stable content-addressed derived cards or equivalently verified changed-card updates, smaller independently verified index/page proofs, bounded generation publication and explicit time-dependent score refresh. Measure changes on consecutive admitted source snapshots. Preserve complete search/filter/rank/cursor semantics and off-page invalidation. Do not relax address validation, skip integrity checks, silently age a score, or extend freshness to meet a benchmark.
2. **Full Free worksheet:** include actual CPU tails, serialization, retries/concurrency, row/index reads/writes, builder work, source-trigger overhead, viewers/polling and all shared account usage. A hypothetical 100 continuously polling viewers at one request/minute already makes 144,000 requests/day, above Workers Free's published request allowance before other traffic; polling defaults require deliberate design. No paid fallback or production adoption without demonstrated fit.
3. Add an admitted local-maintenance builder only after duplicate-work, pause, resource and Free write admission are verified. Keep expensive evaluation out of a per-visitor request/Worker timer. Separately continue qualified activity and prospective coverage, private recovery/offload and outstanding parser/security work. The raw store still does not fit one D1 Free database.

Nine new page tests and original projection/browse/history/expiry, scoring v1–v4, counterexample, election/replay and admin-security tests pass: **188 distinct tests**. Worker typecheck passes. No UI/dependency/config change requires a new visual build. Original evidence hashes/foreign keys, secret exclusion, security preflight, operator syntax and the existing thesis-only release artifact are checked before commit; static preflight does not resolve the previously documented dependency audit findings. V4, all evidence/action/financial/provider/release gates remain unchanged. No deploy.
