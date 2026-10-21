# Runtime experiment comparison gates

22 October 2026 (Australia/Sydney). Continues [109](109-full-reader-workerd-d1-profile.md) and PRD §17.7. A small-input one-shot SHA-256 experiment did **not** demonstrate a general full-reader improvement. The existing streaming verifier is restored exactly. This slice adds offline comparison tooling and regression coverage; it makes no production performance or Free acceptance claim.

## Implemented

From the repository root:

```powershell
pnpm exec tsx scripts/discovery-read-runtime-compare.ts .tmp/before/report.json .tmp/after/report.json .tmp/comparison-NEW.json
```

The command accepts the versioned reports produced by the 109 harness. Inputs and referenced profiles must be bounded regular files resolving inside `.tmp`; profile names cannot contain paths. Output must be a **new** ignored JSON file inside `.tmp`, created exclusively without overwriting existing evidence. No live database, credentials, bindings, provider calls, dependencies or services are needed.

The comparator requires matching runtime compatibility, cutoff, measurement scope, complete fixture publications and manifest hashes. It checks unique fixture/run/query coverage, twenty measurements per query, three concurrency batches at widths four and sixteen, three first-request samples, forty requests per profile, matching response sizes and native read contracts, zero read writes, authentication/origin/expiry guards and all populated/empty revision/generation race holds. All eleven queries and four concurrency cases remain visible, including regressions. It compares p50, p95, maximum and mean; a zero baseline has no percentage change.

Both input reports and all six referenced profile artifacts are pinned by their actual SHA-256 bytes. A profile checksum mismatch fails before output creation. This establishes file provenance and report consistency, **not authenticity of the measurements**, a causal experiment, a validated latency distribution or billed CPU certification. Both `cpu_acceptance` and `promotion_authorized` remain false. There is no automatic performance pass or promotion threshold.

## Rejected candidate

The temporary candidate used Node's one-shot `hash` for strings of at most 2,048 UTF-16 units and retained streaming `createHash` for larger inputs. It still computed every digest, without cached or substituted proofs. A component probe suggested a possible small-input benefit; only the complete-reader experiment was used to decide retention. The production helper now matches the pre-experiment source exactly.

Both full-reader runs used the same immutable synthetic publications, existing runtime compatibility and frozen historical cutoff. Every returned card/rank matched the full evaluator, all eight races held, and auth/expiry, read contracts and zero-write checks passed. Ordinary background processes remained running; test suites were not run concurrently with measurement. Independent local runs still contain scheduling, JIT, GC and proxy variance, so the following differences are descriptive rather than causal.

| Fixture / query | Baseline wall p50 / p95 (ms) | Candidate wall p50 / p95 (ms) |
|---|---:|---:|
| Ordinary 244, limit 1 | 12.41 / 16.09 | 13.22 / 18.07 |
| Ordinary 244, default 25 | 12.60 / 16.53 | 14.81 / 18.42 |
| Ordinary 244, liquidity 100 | 21.06 / 24.49 | 22.41 / 36.48 |
| Ordinary 244, exact mint | 12.55 / 15.35 | 10.87 / 15.14 |
| Ordinary 244, empty | 11.89 / 13.73 | 10.53 / 15.21 |
| Distinct wide 500, limit 1 | 21.19 / 26.41 | 23.41 / 25.92 |
| Distinct wide 500, default 25 | 25.17 / 27.85 | 26.38 / 31.53 |
| Distinct wide 500, liquidity 100 | 30.97 / 40.21 | 32.79 / 44.04 |
| Distinct wide 500, exact mint | 18.42 / 22.57 | 22.72 / 28.32 |
| Distinct wide 500, empty | 21.03 / 26.78 | 23.01 / 25.96 |
| Distinct wide 500, twenty-page scatter | 31.57 / 37.10 | 32.13 / 35.55 |

| Concurrent fixture / width | Baseline request p50 / p95 (ms) | Candidate request p50 / p95 (ms) |
|---|---:|---:|
| Ordinary / 4 | 45.62 / 47.52 | 48.75 / 51.84 |
| Ordinary / 16 | 184.17 / 212.51 | 204.97 / 220.60 |
| Wide / 4 | 84.85 / 90.26 | 90.68 / 103.24 |
| Wide / 16 | 347.17 / 364.85 | 328.55 / 361.21 |

Fresh-runtime first-request medians were 49.58→52.64 ms (ordinary) and 57.35→65.86 ms (wide), with only three samples each and preseeded D1. Most warm medians regressed; the scattered read showed no clear improvement. The isolated gains do not justify adoption. No candidate production implementation is retained.

## Private evidence pins

All artifacts remain ignored and local, without provider credentials. The rejected bundle and source map preserve the candidate for inspection. Nothing was copied into the serving store.

| Artifact under `.tmp` | SHA-256 |
|---|---|
| `read-runtime-20261022-003/report.json` (baseline 109) | `39571e40b7fad84f2c743b7e1c9bd22b78bfef9fb43f7ff8bbab4986bac516d5` |
| `read-runtime-20261022-004/report.json` (candidate) | `b8c7b7be5e7c2914d1a6cb8403de5a7f02c24b3aee6e4c87241ee95092a5aa30` |
| `read-runtime-comparison-20261022-001.json` | `6ef54b9764a87a64a0348df08ee9a2eb1d81c69754973c47d3b4f56f4d0af753` |
| `read-runtime-20261022-004/reader-runtime.mjs` | `b650ad99af7e8ab8a0883b447d6fcc6bcb583bd635e69592af8cf68c5c930f91` |
| `read-runtime-20261022-004/reader-runtime.mjs.map` | `28d3e231fe0c66e740bfcc86b27e876dfe658c70bdc79a9a6f0f945f20dff0ba` |
| Candidate ordinary default profile | `e953105a491d956cd9ee594eddd6c12a3273021a94052a2361b928dbb8ebbc5b` |
| Candidate wide default profile | `53af31f8c4e8ac35022dae9dffcdf8dd7e51b21083585d899ff632c56c032785` |
| Candidate wide scatter profile | `1699e8f5409d00754d655f10145e3c43b67d3956f1b5e573c3fae58176819723` |

## Verification and next work

69 affected tests in ten files pass, covering strict comparisons, malformed/incomparable reports, retained regressions, hash encoding, page/index/model integrity, browse, history and expiry. Worker and comparator TypeScript checks pass. The isolated workerd component check now passes 19 hash vectors, including small-input ASCII/three-byte UTF-8 boundaries, plus the 500-row inventory and 25-row summary round trips and six malformed codec rejection cases. Node tests also check empty, large, Unicode and unpaired-surrogate text against both native SHA-256 and Web Crypto. An actual CLI comparison validates all eleven query cases and six profile files; a separate forged-checksum report fails with no output. Original report/profile bytes are untouched.

Before another reader change, attribute exact complete-manifest parsing, serialization/hash call sites, native hash operations and schema work. Require repeatable paired whole-runtime evidence across every query and concurrency case; retain an optimization only when that evidence supports it. Do not infer billed CPU from elapsed timers, sampled CPU totals or component microbenchmarks. Real-data/router/true-storage-cold/sustained-load/actual-CPU acceptance, qualified multi-day inputs and shared builder/write/polling/storage budgets remain open. No speculative serving-format revision or weaker fallback is justified by this experiment.

The read-only preservation check confirms all 1,732 original row hashes and foreign keys. Actual-key scans pass for changed Discovery sources, comparator code, private experiment artifacts and 66 existing build assets; secret files remain ignored/untracked. Static security preflight and the thesis-only check of existing release assets/configuration pass. These checks do not resolve the previously documented dependency audit findings or certify a new production build.

Original evidence, every digest/schema check, score-v4, serving v4, provider Free limits, action/election/financial gates and thesis-only production remain unchanged. Public and automatic read-model adoption stay held. No live migration/rebuild, collector or preview restart, quota reset, evidence eviction or deploy.

Runtime references: [Cloudflare Node crypto support](https://developers.cloudflare.com/workers/runtime-apis/nodejs/crypto/), [Cloudflare CPU profiling and timer limits](https://developers.cloudflare.com/workers/observability/dev-tools/cpu-usage/), [Node one-shot hash API](https://nodejs.org/api/crypto.html#cryptohashalgorithm-data-outputencoding). API support and general small-input guidance do not establish a benefit for this reader.
