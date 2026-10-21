# Performance/security review and bounded stream work

22 October 2026 (Australia/Sydney), baseline `a271a25`. Reviews current source, refreshed production dependency metadata, existing built assets and synthetic Node/workerd stream behavior. Implements a concrete shared-reader resource fix and adds reproducible CI checks. Production remains thesis-only. No deployment, collection, live migration, restart or financial action.

## Findings and implementation

The previous `boundedJson` limited payload bytes but retained a `Uint8Array` reference for every fragment before allocating/copying the final buffer. Tiny or empty fragments could consume disproportionate memory/work while remaining below the byte ceiling. The reader had no independent body-read deadline. Its error path also awaited cancellation, allowing an uncooperative underlying `cancel()` promise to delay rejection indefinitely. Existing fetch/outer-operation deadlines cover some callers, but do not establish a shared body-consumption bound.

`discovery/src/rpc.ts` now keeps existing caller byte ceilings and adds:

- At most **4,096 delivered fragments**, including empty ones; fragment 4,097 holds with `response_fragment_limit`.
- A **12-second body-read deadline**, checked by timer and monotonic time between reads. The explicit time check covers immediate microtask streams where the runtime clock advances; the deterministic fragment bound still terminates read loops if clock updates or timers are delayed. This is not preemptive CPU interruption.
- One growing byte buffer, starting at at most 8 KiB and never allocated above the caller byte ceiling. Growth temporarily retains old/new buffers; parsed JSON objects, decoded strings and transport-owned memory are additional allocations. No whole-process memory ceiling is claimed.
- Non-blocking cancellation with rejection handled, followed by lock release and timer cleanup. The reader does not await an arbitrary cancellation hook.

Admin JSON maps fragmentation to `413 request_body_too_fragmented` and body timeout to `408 request_body_timeout`, with existing protected headers. Tests exercise the actual Worker route and confirm no database access before these rejections. Original authentication/origin/media-type checks, 32,000-byte admin ceiling and all source response ceilings remain. Existing shorter outer transport deadlines still apply. This adds transport resource guards, not research record limits; authorized local-calibration exemptions, provider allowances and all evidence/action gates remain unchanged.

Normal accepted bodies retain existing JSON values, UTF-8 split/BOM handling, malformed-JSON rejection and source normalization. A legitimately very fragmented response can now hold. No extra retry, quota, fallback source, source freshness or clean/organic credit follows. The deadline bounds asynchronous body reading, not synchronous JSON parsing, schema evaluation or full-request billed CPU.

The implementation follows the stream consumption/lifetime guidance in [Workers best practices](https://developers.cloudflare.com/workers/best-practices/workers-best-practices/) and the [Request API](https://developers.cloudflare.com/workers/runtime-apis/request/). Node and native workerd behavior are tested separately.

## Measured performance and runtime scope

`scripts/benchmark-bounded-json.ts` retains the pre-change reader algorithm only as a synthetic offline comparator. Two warmups then ten measured repetitions per reader/case include Response construction, read, parse and result hashing; stream construction is excluded. Versions run sequentially, not randomized; small local samples under concurrent testing do not establish a general speedup or regression distribution. All ordinary parsed values match their expected hashes.

| Synthetic input | Legacy median | Hardened median | Work/result |
|---|---:|---:|---|
| 32,053 bytes, 4 KiB fragments | 0.586 ms | 0.679 ms | Both parse identically; nine reads |
| 1,800,053 bytes, 64 KiB fragments | 17.370 ms | 19.451 ms | Both parse identically; 29 reads |
| 131,125 bytes, one-byte fragments | 158.425 ms | 6.153 ms | 131,126 reads/parsed → **4,097 reads/rejected** |

The adversarial rows deliberately have different outcomes: this is bounded early rejection, not a faster equivalent parse. Ordinary final-run timings show overhead; the earlier run was mixed. Retain this as resource hardening without claiming an ordinary-input optimization, browser improvement, Worker CPU acceptance or a passed Free target. Further optimization needs a specific hypothesis and paired complete-reader measurements.

The installed local workerd fixture passes five cases: exact Unicode/BOM JSON, oversized bytes, one-byte fragments, empty fragments with a hanging cancellation hook, and a stalled stream with a hanging cancellation hook. Every held stream cancels once and releases its lock. The stalled case returns at approximately 12.024 seconds local wall time. Runtime compatibility settings are read from the existing configuration; there are no application/database bindings or secrets, outbound IO is blocked and observed at zero, and the runtime is disposed. Local wall time includes harness overhead and is not billed CPU.

Private final reports:

| Artifact | SHA-256 |
|---|---|
| `.tmp/bounded-json-benchmark-20261022-002/benchmark.json` | `3bec24b90de83905a8ad3f8987c802c399f12cc33d5f88764647e58034f6dbc5` |
| `.tmp/bounded-json-native-20261022-001/streams.json` | `1bae5ce5d69db271c2e589ec1f5809e32e0cc3b00f0bb4e373c26a883022a2c9` |

The earlier benchmark directory is retained; 002 corrects the scope label and is the reported final run. Tools accept only new direct children of private `.tmp`, with exclusive output and no overwrite. Commands:

```powershell
pnpm --dir discovery test -- src/bounded-json.test.ts src/request-security.test.ts
pnpm exec tsc --noEmit -p tsconfig.stream-guards.json
node scripts/check-bounded-json-runtime.mjs .tmp/NEW-native-stream-study
pnpm exec tsx scripts/benchmark-bounded-json.ts .tmp/NEW-stream-benchmark
```

## Broader review and process revisions

The refreshed `pnpm --dir app audit --prod --json` reports **zero critical, zero moderate and two high findings**, exit **1**. Its review action names only `extract-zip` through the existing Cloudflare Puppeteer browser installer. The workspace already records two narrow CVE exceptions for that unused installer path. No dependency or exception is changed; this is not a clean audit or whole-application exploitability verdict. Revalidate actual dependency/bundle reachability and remove the exceptions when the dependency permits; any new ZIP extraction/browser installation invalidates the existing rationale. Private report: `.tmp/security-review-audit-20261022-123.json`.

The existing built thesis shell remains **227.8 KiB gzip across eleven startup chunks**, passing the unchanged 250 KiB startup/per-file budgets and thesis-only release assertion. No new frontend build occurred; these numbers describe the already-built artifact, not an enabled Discovery route or a clean-commit release build. Unrelated Network/legal work remains untouched. Chrome DevTools MCP tracing is unavailable, so Core Web Vitals, browser accessibility acceptance and network waterfalls are unmeasured in this review.

Required process for subsequent performance/security slices:

1. Record the affected user journey, source commit, artifact/fixture identity and concrete failing resource/security contract before selecting a fix. Retained snapshots must never be described as current live coverage.
2. Test both ordinary and adversarial behavior, including bytes, fragment/work counts, elapsed deadlines, cancellation and no-provider/no-write boundaries where applicable. Report ordinary regressions and distinguish early rejection from equivalent-output acceleration.
3. Retain baseline/result hashes and measurement scope. Node wall, native workerd wall, billed CPU, SQL row counts, browser vitals and production field measurements are separate evidence; do not substitute one for another or impose unstable wall-time CI thresholds.
4. Security preflight, dependency audit, exception review and artifact-specific reachability are separate checks. An excepted audit remains visibly non-clean; no blanket new exceptions or unsupported exploit claims.
5. Keep four distinct release acceptances: thesis-only public release, authorized private Discovery preview, public Discovery, and financial execution. A closed feature flag controls exposure; it does not provide private-preview authentication, affordable public serving or financial authority.
6. Native synthetic stream and focused regression checks now run in security CI, alongside tooling types. Existing fixed byte/fragment/deadline assertions guard the resource contract; benchmark wall times remain diagnostic. No hosted CI result is claimed.

Open priorities remain private-preview access, HTML CSP hardening with wallet/embed compatibility, public read caching/rate limiting and actual shared Free/CPU/storage acceptance. Continue the remaining compatible evidence readers/writers and fenced recovery work alongside ordinary admitted unfamiliar-token coverage and qualified participation research. This fix does not change v4, scoring claims, source schedules or the order of those dependencies.

## Verification and limits

All **1,395 Discovery tests across 93 files** pass. The final eleven focused tests include seven new stream tests and four existing request-security tests extended with actual Worker fragment/timeout rejection. Discovery/app, scratch-tooling and new stream-tooling typechecks pass. Five native runtime cases pass separately. Security preflight/blocklist, existing built performance/release checks, all 1,732 preserved live row hashes/foreign keys, actual credential/key exclusion, private ignored/untracked status and whitespace/syntax checks pass. No fresh frontend build, production penetration test, browser trace, remote Free entitlement verification or changed model qualification is claimed.

Original evidence, application bindings/routes, permissions, fee/economic parameters, provider Free limits, local research authority and thesis-only release closure remain. No source request, evidence deletion, counter reset, live store adoption, restart, deployment or spending occurred.
