# Reader line and stack attribution

22 October 2026 (Australia/Sydney). Continues [110](110-runtime-experiment-comparison-gates.md), [109](109-full-reader-workerd-d1-profile.md) and PRD §17.7. Adds reproducible offline analysis of the saved profiles, without changing or executing the production reader. No optimization, performance gain or CPU/Free acceptance is claimed.

## Implemented

From the repository root, using the original 109 report/bundle/map pins:

```powershell
pnpm exec tsx scripts/discovery-read-runtime-attribution.ts .tmp/read-runtime-20261022-003/report.json 39571e40b7fad84f2c743b7e1c9bd22b78bfef9fb43f7ff8bbab4986bac516d5 ca558639cbf995d74539801be3dfd2b3e710439acc25ec0945f16749d7a864f5 c3cbaf45064f9e1374a8b16ac0479f9920b309e05728808eaa1938ed679a4180 .tmp/read-runtime-attribution-NEW.json
```

Five arguments: report path, its saved SHA-256, saved bundle SHA-256, saved source-map SHA-256, and a **new** private output path. For another study use that study's own pins. Inputs must be bounded regular files resolving inside `.tmp`; output is exclusively created inside `.tmp` and existing files cannot be overwritten. There are no runtime instances, database access, provider requests, credentials, dependency additions or deployments. Existing trace-mapping dependencies are reused.

The command applies the 110 report consistency/guard checks, validates all three input pins and all referenced profile hashes, and verifies sample count and elapsed accounting against the report. It validates the complete profile tree, including unsampled nodes, and rejects duplicate/missing nodes or parents, disconnected/cyclic trees, excessive depth, invalid sample/tick/time values and arithmetic overflow. Generated and original mapped positions are checked against the pinned bundle and the map's embedded source snapshots. The 97 embedded sources receive individual SHA-256 pins; no source path from a map is opened from the filesystem.

Each output retains:

- Every frame, parent ID, native/runtime URL, reported hit count and exclusive leaf-sample count/time. All leaf samples and `timeDeltas` are conserved, including idle/GC/program/unmapped samples.
- A separate nearest-project-function context view. This includes native/dependency descendants, but is **not an exact call site or independent additional cost**. Do not add it to exclusive-frame totals.
- Position ticks aggregated only for repeated lines within the same node. All distinct original source-line candidates are retained; ambiguous and unmapped lines remain explicit. Function locations and position ticks are distinct evidence. No expression, source column, native-child time or `timeDelta` is invented for a line tick.

The supplied pins establish which bytes were analyzed, not that measurements or bundle/map correspondence are independently authenticated. Source-map candidates remain advisory; a single original line can contain several expressions. V8 tick counts, reported hit counts and sampled leaf counts can differ and are retained separately rather than forced to agree. Both `cpu_acceptance` and `promotion_authorized` are always false.

## Findings from the original baseline

All profiles cover forty requests. These are **counts**, not milliseconds, billed CPU, per-request estimates or percentages of production compute. Tick columns and exclusive leaf samples are separate quantities and must not be summed.

| Baseline query | Leaf samples | Position ticks | Manifest parse line ticks | Hash serialization line ticks | Summary serialization line ticks | Native `update` leaf samples | D1 `toJson` leaf samples |
|---|---:|---:|---:|---:|---:|---:|---:|
| Ordinary 244, default 25 | 145 | 128 | 6 | 7 | 1 | 13 | 2 |
| Wide 500, default 25 | 417 | 387 | 47 | 36 | 2 | 86 | 34 |
| Wide 500, twenty-page scatter | 669 | 641 | 51 | 54 | 10 | 143 | 39 |

The manifest line contains both `JSON.parse` and `Manifest.parse` (`score-read-pages.ts:97` in the embedded snapshot). Its ticks do not distinguish those operations or include all descendant schema samples. Hash serialization is `stored-json-hash.ts:8`; shared hash frames do not distinguish manifest, policy and card invocations. Native `update` frames occur beneath `Hash.update` / `storedJsonTextHash`, confirming hashing context while leaving UTF-8 conversion versus digest computation unresolved. D1 `toJson` has URL `cloudflare-internal:d1-api`; those samples remain runtime frames rather than being relabeled as schema/hash work. Summary serialization is `score-read-pages.ts:134`.

Baseline idle/GC/program leaf counts are 5/6/5, 7/11/10 and 4/11/11 respectively. Nearest-project-unattributed counts are 8, 42 and 46; the output preserves their individual native/runtime frames. The scattered card-integrity line has thirteen position ticks, while the summary JSON/schema/unpack line has eight. These observations narrow the investigation but do not justify removing any original verification.

The rejected 110 candidate also replays successfully through the same analyzer. Different profile sample distributions do not overturn its full-reader latency regressions. That candidate remains rejected and its bundle is never executed by this analyzer.

## Evidence and verification

Private outputs remain ignored:

| Artifact under `.tmp` | SHA-256 |
|---|---|
| `read-runtime-attribution-20261022-001.json` (baseline) | `89d5e800d3ab15abb693f0559f8f267311e506b3ea7494df61fa581fd5eb1906` |
| `read-runtime-attribution-20261022-002.json` (rejected candidate) | `519f791110e17f90dc002903f615eda2761b2414dcbcfeccc1cd130b10dcba11` |

Both outputs pin their input report/bundle/map and all three raw profiles. Original input hashes are documented in 109/110 and remain unchanged. Final baseline replays 003/004 are byte-identical to 001. Actual CLI probes reject incorrect report, bundle and map pins before creating output; attempting to reuse 001 fails and preserves its exact bytes.

Ten focused attribution/accounting/comparison tests and both Discovery/standalone-command typechecks pass. Tests cover sample conservation, native/inclusive separation, duplicate line ticks, multiple original-line candidates, absent maps, malformed samples/positions, unsampled cycles, disconnected graphs, duplicate parents and tick overflow. Production reader/hash/schema/model/format files are unchanged. Original-row preservation, credential exclusion, static security and existing thesis-only release checks are verified before commit; this is not a clean dependency audit or a new production-build certification.

## Next work and held gates

The next measurement should separate JSON parsing from schema validation, and distinguish manifest/policy/body/full-card/page hash invocations with **test-only named phases** in an isolated profile pass. Keep an uninstrumented reader for all latency comparisons; the attribution instrumentation itself must never be adopted as a production optimization or used for budget certification. Then test one bounded change with repeated paired full-reader runs and the 110 all-query/concurrency comparator, retaining only a supported improvement. Avoid further crypto API or serving-format speculation from these counts alone.

Real-data/router/true-storage-cold/sustained-load/actual-CPU acceptance, shared multi-day builder/write/polling/storage budgets, qualified organic 24h demand and meaningful holder growth remain open. Public and automatic read-model adoption remain held. All original evidence/digest/schema/time/source/generation checks, score-v4, serving-v4, Free provider/research allowances, financial/action/election gates and thesis-only production stay unchanged. No live migrations, rebuilds, restarts, evidence eviction, quota resets, paid services or deploy.

References: [CDP profile, function-location and one-based position-tick definitions](https://raw.githubusercontent.com/ChromeDevTools/devtools-protocol/master/json/js_protocol.json), [Cloudflare local CPU profiling and timing limitations](https://developers.cloudflare.com/workers/observability/dev-tools/cpu-usage/).
