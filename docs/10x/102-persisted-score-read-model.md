# Persisted scoring read experiment

22 October 2026 (Australia/Sydney). Implements the first compact serving experiment from [101 — Free capacity worksheet](101-compressed-archive-and-free-capacity.md) and PRD §17.7. F5 remains partial. This is an **admin-only local experiment**, not adoption by Discover, automatic maintenance, a new score model or a release-ready Free architecture.

## Delivered

Migration **0044** adds a disposable single-row compact score snapshot and a monotonic source revision. Candidate, market-history and expiry insert/update/delete triggers advance the revision within the source mutation's transaction. These cover the current-inventory v4 evaluator inputs; fixture/history-only writes conservatively invalidate too. Original candidates, evidence, immutable cohorts and election records are untouched. Expiry's existing immutable update/delete protections remain.

The builder reads the existing **current live inventory**, preserving the 500-candidate / 4 MB combined / 1.6 MB individual input guards and price-history limits. It runs the unchanged full v4 evaluator at one cutoff, then projects only existing card fields. The stored record includes version, score/action-policy hash, source revision, cutoff, a sixty-second read window, inventory scope, counts, ordered cards and semantic content hash. The version is also the evaluator-semantics contract: bump it for an evaluator change even if policy values stay identical. It is not an automatically generated source-code hash.

Publication is one conditional SQL statement. A source mutation, pause or newer snapshot arriving during evaluation prevents the builder from replacing the saved snapshot. A source write after publication invalidates the next lookup. Revision and snapshot are read together in one indexed statement; validity is relative to that statement's observation, not a lock on subsequent source changes. The 1.8 MB projection ceiling keeps the stored payload below D1's whole-row limit with space for metadata; exceeding it holds without replacing the snapshot.

The reader loads no candidates, histories, raw holders, wallets or receipts. It verifies schema, semantic hash, policy, revision, cutoff/window, unique live mints, contiguous ranks and counts before returning `available`. Missing migration/database access, absent snapshot, changed source, corrupt/invalid projection, policy mismatch, expired or future cutoff return `held`. There is **no rebuild or provider fallback on a read**.

`available` means **the frozen cutoff snapshot is available within its short read window**. It does not mean its market observations or action eligibility are fresh now. The response says `semantics: frozen_at_cutoff`, `action_authority: false`, and retains the original cutoff and card concerns. Scores, eligibility, ranks and evidence coverage are those of that cutoff, just as in a frozen browse; they must never authorize backing, election, launch or financial actions. Time-dependent grades can change before the read window ends. Reported market volume remains reported volume; there is no new qualified organic-volume, holder-growth or activity projection here.

## Local use after ordinary startup

Both methods use `/api/10x/admin/score-read-model`: POST builds, GET reads. Existing local-host, runtime, Bearer, browser-origin, body-size and no-store controls apply. POST accepts only a nonempty reason; callers cannot supply a cutoff, policy, authority flag or limit override. Operator helpers read the existing ignored local token without printing it:

```powershell
node scripts/discovery-operator.mjs build-score-read-model
node scripts/discovery-operator.mjs score-read-model
```

These commands were **not run against the live runtime** in this milestone. Migration 0044 was exercised in isolated SQLite fixtures and activates through the existing migration-aware launcher at the next ordinary startup; no running process, lease, migration ledger or spent allowance was reset. Until then the new code/routes are not guaranteed active, and the new functions hold if the new tables are unavailable. No timer or maintenance hook builds this experiment yet: measurements below do not support routine or per-visitor execution on Workers Free. The public candidate API, cursors, UI and independent action evaluator remain unchanged.

## Archived-input measurement

The already verified private scratch archive was opened **read-only** at `2026-10-21T14:24:50.571Z`. Its current selection, **244 candidates and 6,321 retained market snapshots**, was copied into a new in-memory fixture with all migrations. This is an older fixed snapshot, not today's live coverage, a full raw-store recovery or a chronological growth study. No collector, provider, original archive or existing scratch database was changed.

| Measurement | Result |
|---|---:|
| Parsed candidate JSON bytes | 945,037 |
| Copied market JSON bytes | 1,584,402 |
| Stored compact payload bytes | **349,164** |
| Projection table allocation | 352,256 bytes / 86 pages |
| Revision table allocation | 4,096 bytes / 1 page |
| Builder wall / process CPU | 731.85 ms / 983 ms |
| Thirty local reads, wall p50 / p95 | 11.05 / 13.38 ms |
| Thirty local reads, process CPU p50 / p95 | **15 / 31 ms** |
| Read query plan | Two integer-primary-key lookups in one statement |
| Read writes / provider calls | Zero / zero |
| Exact card equivalence at cutoff | All 244 cards, ranks, scores, concerns and coverage |

Allocation above covers the two new tables only; schema/trigger pages, total database allocation and unrelated indexes are additional. Trigger admission adds one revision-row update for **each** candidate/history/expiry mutation, even if its values are unchanged; the experiment's 6,565 source inserts therefore performed 6,565 additional revision updates. A successful builder adds one projection insert/replacement. D1 billing may account for written overflow pages differently; these logical counts are not remote metering.

These are local Node process/SQLite timings, including host scheduling, GC and worker-thread CPU. They are not Workers CPU, network response serialization, deployed latency or D1 usage measurements. The full read still parses/hashes all cards and performs schema validation. It **does not establish a fit within Workers Free's published 10 ms CPU/invocation**; the builder also remains unsuitable for a Free request. No paid fallback or service activation is proposed. [Workers limits](https://developers.cloudflare.com/workers/platform/limits/), [D1 limits](https://developers.cloudflare.com/d1/platform/limits/), [prepared statement API](https://developers.cloudflare.com/d1/worker-api/prepared-statements/).

Private proof: `.tmp/score-read-model-benchmark-20261022-001.json`, SHA-256 `5199061f8650c63e869dbbc66606825390f8ba287e556ce84e57a2c2a674cd38`; its measurement helper `.tmp/measure-score-read-model.ts` and all real inputs remain ignored/private. Preserved live evidence hashes and foreign keys were checked separately; the benchmark does not substitute for that check.

## Acceptance and next build

Eight new tests cover cutoff equivalence, read query count/no writes/no providers, same-timestamp edits, candidate/history mutations, verified expiry without evidence deletion, expired/future snapshots, corrupt and repinned invalid payloads, changed policy, concurrent source/pause/newer builders, 500/501 overflow, missing migration and admin security. Together with current/history/expiry browsing, **30 tests pass**. Another **149 tests** cover original v1–v4 scoring, concern/runner counterexamples, election storage/replay and admin security. Worker typecheck, operator syntax, security preflight, private credential exclusion, all original preserved row hashes/foreign keys and the existing built thesis-only release assertion pass. UI/config/dependencies are unchanged, so a new UI build or browser layout run is not required for this slice. The static security preflight is not a clean dependency audit; the existing parser findings remain open.

Next:

1. Replace the all-card read with small independently verified pages/records and a pinned inventory manifest. Preserve all search/sort/status/age/filter/cursor semantics and exact cutoff equivalence, including off-page source invalidation; do not silently trim the active inventory or reassess cards as full evidence.
2. Measure response serialization, row/page reads/writes, parser/hash CPU, worst-size inputs, concurrency and shared daily Free totals. Keep public adoption held until the actual Free-serving budget is demonstrated. Decide how to run the builder under existing local maintenance without adding provider requests, duplicate work or allowances; do not simply run the present expensive builder on a Worker timer.
3. Add qualified activity projection fields only after their original evidence gates pass. Separately complete private per-record recovery/offload/adoption design, parser security review and broad prospective observation. The larger raw store still does not fit one D1 Free database; this projection changes no retention or release decision.

V4, every evidence/action/election/financial gate, source quotas/pacing/backoff and the thesis-only production flag remain unchanged. No live migration, restart, evidence eviction, service activation, paid dependency or deploy.
