# Full-reader local workerd/D1 profiling

22 October 2026 (Australia/Sydney). Continues [108](108-compact-original-score-summaries.md) and PRD §17.7. Adds a repeatable local runtime study rather than another serving-format change. Production code, serving format, scoring model and every evidence/action/release gate remain unchanged. Public and automatic read-model adoption remain held.

## Implemented

```powershell
pnpm exec tsx scripts/discovery-read-runtime-study.ts .tmp/read-runtime-NEW
```

Run from the repository root with a **new** directory under `.tmp`. Existing directories/artifacts are never overwritten. The script bundles the actual unmodified `readScoreReadPages`, starts isolated local workerd instances through existing Miniflare/esbuild dependencies and uses a native local D1 binding. It does not run Wrangler, deploy, restart the preview/collector, load `.dev.vars`, attach app bindings or call providers. Network egress is blocked and any attempted outbound request fails the study. Temporary random harness credentials are never printed or retained in reports.

The test-only entry point in `scripts/lib/discovery-read-runtime-worker.ts` reuses production authentication, browser-origin checks and response headers, calls the complete reader, and serializes the complete response. The general application router is excluded. This entry point is never referenced by application/production configuration and must never be deployed or given real bindings/credentials.

Fixtures are **synthetic**, not the archived 244-token observation used in earlier measurements. One has 244 ordinary identities; the other has 500 distinct maximum-length escaped identities and a search selecting five cards from each of twenty summary pages. The unchanged full evaluator builds their projections in isolated Node memory and provides independent expected card/rank hashes for every query. Only the four serving tables, with their actual derived table definitions, are copied into scratch D1. Any unexpected raw-source/evidence read would therefore fail. No raw evidence is relocated or removed.

The reader's existing explicit `now` argument is frozen at the synthetic cutoff `2026-10-22T01:00:00.000Z`, without replacing global clocks or changing production time semantics. An additional cutoff +60 seconds probe must hold. This is controlled historical replay, not evidence of live freshness or production readiness.

Eight fresh runtimes separate first requests, warm/concurrent measurements and CPU profiles. Each is disposed in `finally`, including errors. Local compatibility is the existing `2026-09-01` / `nodejs_compat`; installed dependencies are reused without additions/upgrades. Setup uses D1 prepared DDL and native transactional batches, not a Node SQLite substitute for the reader.

## First, warm and concurrent requests

Each fixture has three unprofiled first requests after a fresh runtime. D1 is already seeded/prewarmed; these are **new-runtime first requests, not uncached production cold starts**. Scratch runtime creation/schema/data seeding takes roughly 13 seconds for the small fixture and 24–25 seconds for the wide one; this setup cost is excluded from request timing and is not an application cold-start measurement. Three first-request samples are too few to estimate a production tail distribution.

Warm queries have three warmups and twenty measured responses each. Timing includes local host/proxy/IPC, D1 binding IO, all reader checks, response serialization and complete body consumption. Client parsing/parity checks happen afterward. No inspector or query instrumentation is attached during these timings; no test suite was run concurrently. The ordinary background environment remained running.

| Fixture / query | First-request range, if applicable | Warm wall p50 / p95 | Response bytes |
|---|---:|---:|---:|
| Ordinary 244, default 25 | 48.04–57.10 ms | **12.60 / 16.53 ms** | 26,989 |
| Ordinary 244, liquidity 100 | — | 21.06 / 24.49 ms | 105,985 |
| Ordinary 244, no match | — | 11.89 / 13.73 ms | 497 |
| Distinct wide 500, default 25 | 53.69–65.08 ms | **25.17 / 27.85 ms** | 45,146 |
| Distinct wide 500, liquidity 100 | — | 30.97 / 40.21 ms | 178,196 |
| Distinct wide 500, exact mint | — | 18.42 / 22.57 ms | 2,282 |
| Distinct wide 500, no match | — | 21.03 / 26.78 ms | 498 |
| Distinct wide 500, twenty-page scatter | — | **31.57 / 37.10 ms** | 178,926 |

The small/large response difference does not remove the fixed complete-inventory work: wide empty searches still cost about 21 ms locally. These are local elapsed timings, **not request CPU measurements** or a direct comparison to the earlier Node-only harness.

Three batches at each width alternate the fixture's query shapes. Every returned card/rank hash matches the full evaluator:

| Fixture | Concurrent width / measured requests | Per-request wall p50 / p95 | Maximum batch completion |
|---|---:|---:|---:|
| Ordinary 244 | 4 / 12 | 45.62 / 47.52 ms | 49.07 ms |
| Ordinary 244 | 16 / 48 | 184.17 / 212.51 ms | 214.49 ms |
| Distinct wide 500 | 4 / 12 | 84.85 / 90.26 ms | 90.60 ms |
| Distinct wide 500 | 16 / 48 | 347.17 / 364.85 ms | 369.05 ms |

This exposes local queuing; it is not a sustained load/capacity certification. The full report retains all query shapes and extrema, not just default-page medians.

## Separate D1 trace and race checks

An additional untimed trace pass records native D1 metadata and transported result JSON bytes. Timed/profiled reads use native `first()` unchanged. Only the trace pass substitutes equivalent `all()`/first-row selection for the manifest lookup to obtain metadata; the two page selects still use native D1 `batch()`. Unexpected SQL is rejected. All ordinary traces have three statements and zero reported writes; projection content digests before/after measured/profiled reads match.

| Query | Manifest / details / summary rows read | Total local rows read |
|---|---:|---:|
| One card or exact mint | 2 / 4 / 4 | 10 |
| Default 25 | 2 / 52 / 4 | 58 |
| Ordinary liquidity 100 | 2 / 201 / 14 | 217 |
| Wide liquidity 100 | 2 / 201 / 10 | 213 |
| Empty match | 2 / 2 / 2 | 6 |
| Twenty-page scatter | 2 / 201 / 41 | 244 |

The scatter trace returns twenty summary rows and verifies all 500 original summaries for the 100 selected cards. D1 durations in this local trace are 0–1 ms per statement. This is useful local query evidence, **not remote billing or latency certification**. Transported JSON includes string escaping and wrappers: the wide manifest result alone is 571,660 bytes, even though only one manifest record is returned. Small row counts do not imply low parsing/hash cost. [D1 return metadata](https://developers.cloudflare.com/d1/worker-api/return-object/), [D1 usage accounting](https://developers.cloudflare.com/d1/platform/pricing/).

On each fixture, unauthorized requests return 401, disallowed origins 403 and the expired cutoff holds. Scratch-only probes change either source revision or manifest generation **between** the first lookup and the page batch, for both a populated page and an empty search. All eight cases hold with `source_or_generation_changed`. Probe mutations are deliberate test writes outside read-cost measurements; original scratch values are restored and checked afterward. There are no live writes or gate waivers.

## CPU profile attribution

A separate runtime records forty requests per profiled query through the local V8/CDP profiler, with external source maps to actual modules. Sampling interval is requested at 1,000 microseconds. Three raw `.cpuprofile` artifacts are retained. The analyzer attributes native child samples to the nearest mapped caller and preserves idle, GC, program and unmapped/runtime samples explicitly. Its tests reject invalid samples/clocks/trees instead of manufacturing a timing result.

| Profile | Samples | Hash module | Zod | Reader module | Unmapped/runtime | Idle / GC / program |
|---|---:|---:|---:|---:|---:|---:|
| Ordinary default 25 | 145 | 46 | 40 | 20 | 8 | 5 / 6 / 5 |
| Wide default 25 | 417 | 148 | 84 | 82 | 42 | 7 / 11 / 10 |
| Wide twenty-page scatter | 669 | 286 | 127 | 142 | 46 | 4 / 11 / 11 |

Other samples map to the harness, browse ordering, codecs and address validation. These are **sample counts**, not per-request CPU or percentages of billed compute. `timeDeltas` describe sampled elapsed time; idle and GC are not silently discarded. Profiles can identify likely work but cannot turn timer deltas or aggregate Node process CPU into Cloudflare CPU accounting. Cloudflare documents local profiling and the limitations of in-Worker timers. [CPU profiling guidance](https://developers.cloudflare.com/workers/observability/dev-tools/cpu-usage/).

Hashing, schema validation and reader work dominate mapped samples; summary-codec frames are a small part of these particular fixtures. Together with the wide empty-query timing, this directs the next investigation toward complete-inventory parsing/verification and exact hash-call sites, rather than another speculative summary-format revision. The unmapped/native portion and coarse sample counts still limit precision. No check, field or original digest was skipped to obtain these results.

## Evidence, validation and next acceptance

Private evidence under `.tmp/read-runtime-20261022-003/` remains ignored:

- `report.json`: SHA-256 `39571e40b7fad84f2c743b7e1c9bd22b78bfef9fb43f7ff8bbab4986bac516d5`.
- `reader-runtime.mjs`: `ca558639cbf995d74539801be3dfd2b3e710439acc25ec0945f16749d7a864f5`.
- `reader-runtime.mjs.map`: `c3cbaf45064f9e1374a8b16ac0479f9920b309e05728808eaa1938ed679a4180`.
- Ordinary profile: `44066a7d31b1f8c82c05f70cfd557b704029be126c876f4e7a1a5f602e23c851`.
- Wide default profile: `5176b9b9dad8f68cbd8d0cc0e494b19ded4779746870e134ad7ec02cce047cbb`.
- Wide scatter profile: `18be443f3f77ee2ed9e8960af91df9b470e1dcf7489cb578c2a1e3281bcc9477`.

Earlier incomplete scratch directories 001/002 are retained as incomplete, not accepted measurements. The successful run includes 220 unprofiled measured warm reads, 120 concurrent reads, 120 profiled reads, warmups/first requests, eleven traces and the explicit guard/race probes. Every ordinary result is compared with the unchanged full evaluator. Independent read-only replay of all three profile artifacts verifies their hashes and reproduces the final accounting/source mapping exactly; the harness rejects a profile without mapped reader sources. **65 affected tests** and both Worker/standalone-harness typechecks pass. Static security preflight, credential exclusion, original evidence/foreign-key preservation and the existing thesis-only artifact/config check are verified before commit. No new production UI behavior or clean dependency-audit claim is made.

Next isolate manifest/policy/card/page hash call sites and schema/native overhead in the existing full-runtime harness, then test one evidence-preserving change against the same baseline. Preserve unmapped samples and all original integrity/size/time/source checks. Remaining acceptance includes broader adversarial/schema-maximum and query/cursor matrices, real current/archived representative data, complete application-router overhead, realistic cold storage/isolates, sustained concurrency, actual CPU accounting and shared account admission. Public/automatic adoption also needs representative multi-day builder/churn/trigger/index/write/polling costs and the separate raw-store Free-capacity solution. [Workers limits](https://developers.cloudflare.com/workers/platform/limits/).

Broad current source coverage, qualified organic 24h demand/meaningful holder growth, prospective scoring, private recovery and remaining dependency findings remain open. No provider allowance, research quota/reset, evidence eviction, scoring/serving format, financial/action/election gate, production thesis-only flag, paid service, live migration/rebuild/restart or deploy changes.
