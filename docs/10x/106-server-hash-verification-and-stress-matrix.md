# Server hash verification and wide/scattered read measurements

22 October 2026 (Australia/Sydney). Continues [105 — verified-read CPU](105-exact-address-validation-and-read-cpu.md) and PRD §17.7. Adds bounded server-side SHA-256 verification, a repeatable local workerd compatibility check and a 500-token wide/scattered-query study. Public adoption and automatic rebuilding remain held.

## Implemented

`discovery/src/stored-json-hash.ts` uses `node:crypto.createHash('sha256')` for already bounded stored JSON. It reproduces the original writer's `JSON.stringify` → UTF-8 → SHA-256 lowercase hex exactly. Undefined/function/symbol roots retain the original empty-byte behavior; JSON omissions, property order, null/non-finite numbers, Unicode, lone surrogates and serialization errors are preserved. It is not a new canonicalization or hash format.

Only the **server-side paged reader** uses this verifier: filter/cursor identity, policy identity, manifest, score pages, reconstructed cards and details hashes. The builder and frozen v1–v4 evaluators/exporters keep their original Web Crypto hashing. The verifier still checks every original pin, but avoids asynchronous hash calls and byte-copy/hex-array allocations for each selected object. No digest is cached or substituted; query schemas, strict component validation, original hashes, full inventory/rank semantics, sixty-second cutoff, source/generation barriers and `action_authority: false` remain.

Payload bounds are enforced by the existing caller before verification: bounded query fields, 600 KB manifest, at most 100 selected details of at most 16 KB and twenty summary pages of at most 100 KB. The helper is server-only and must not be imported by browser models or used on unbounded request/provider streams. There is no client, score-policy, projection-format, migration, dependency, binding or configuration change. Existing Worker configuration already uses Node compatibility. Cloudflare documents `node:crypto` support; a local runtime check is also provided. [Workers crypto](https://developers.cloudflare.com/workers/runtime-apis/nodejs/crypto/), [Node Hash API](https://nodejs.org/api/crypto.html#class-hash).

## Repeatable local runtime check

```powershell
node scripts/discovery-hash-runtime-check.mjs
```

This one-shot check resolves existing Wrangler-bundled Miniflare/esbuild, bundles the actual helper in memory and starts an isolated local workerd component using the compatibility date/flags read from the repository's public local config. It compares native verification with independent Web Crypto digests on **13 vectors**, including undefined, property order, escaped/Unicode/surrogate strings and 16 KB / 100 KB / 600 KB / 1.8 MB payloads. A mismatch fails. The runtime is disposed in `finally`.

The installed Miniflare 5 API is used; no package is installed or upgraded. The temporary runtime has no app/database bindings or provider credentials; telemetry and Cloudflare metadata fetching are disabled, with loopback/ephemeral port configuration. It neither starts another collector nor restarts the running preview. Current local `2026-09-01` / `nodejs_compat` compatibility passes all 13 vectors. This proves component API/encoding parity, **not whole-application CPU, D1 metering, concurrency or deployment readiness**. The printed report explicitly keeps `cpu_acceptance: false`.

## Controlled same-input measurement

The previously verified archive was opened read-only. The same **244 candidates / 6,321 market snapshots**, cutoff `2026-10-21T14:24:50.571Z`, were copied into isolated memory for before/after runs. Five warmups and 100 reads per shape include JSON response serialization. The final after run had no concurrently launched test suites; an earlier run under test contention is retained separately. The ordinary local background environment was not stopped, so host/GC variation remains.

| Cards | Bytes (unchanged) | Before wall p50 / p95 | Final wall p50 / p95 | Before / final mean process CPU |
|---|---:|---:|---:|---:|
| 1 | 2,083 | 4.24 / 6.29 ms | 2.90 / 4.92 ms | 4.52 / 3.60 ms |
| 25 | 39,032 | **6.72 / 9.38 ms** | **3.95 / 5.40 ms** | **9.37 / 4.54 ms** |
| 100 | 147,784 | 17.21 / 21.96 ms | 8.27 / 11.95 ms | 22.19 / 9.84 ms |

Every original card, concern, coverage value, rank and v4 hash matches. Manifest hash `453acd08faeafc4cf253edcd77750c0ab8bada399677fb91548e7f4868dd7b4e` and complete ordered-card hash `0f50965a69d3e47601dc96472c29dd7a193710958b1e40871fd7867a226e8cae` remain identical, as do stored sizes/publication counts. Reads perform no writes or provider requests. Node CPU/wall is not Workers CPU, cold-start cost or deployed latency.

## Wide/scattered 500-token study

An isolated fixture used 500 synthetic mints with maximum-length JSON-escaped names/symbols; other fields were sampled from the archive and no market history copied. Its v2 manifest is **581,212 bytes** and reconstructed cards total 1,086,509 bytes, within unchanged storage bounds. This is deliberately wide metadata, not the largest possible valid schema population or real observed token coverage. No synthetic record was placed in the running store.

Forty requests per shape included serialization; every sampled result matches full original evaluation and reads write nothing:

| Query | Loaded summary pages | Bytes | Wall p50 / p95 | Mean local process CPU |
|---|---:|---:|---:|---:|
| Default 25 by score | 1 | 56,912 | 10.61 / 13.40 ms | **11.30 ms** |
| 25 by liquidity | 5 | 56,890 | 9.39 / 13.59 ms | **10.13 ms** |
| 100 by liquidity | 6 | 226,997 | 14.53 / 18.04 ms | **15.23 ms** |
| Exact mint, one card | 1 | 2,579 | 6.73 / 9.33 ms | 7.05 ms |

The measurements are not monotonic in page count because they also include host scheduling, GC, JIT and different result contents. They demonstrate that the smaller ordinary 244-token mean cannot certify wider inventories or alternate queries. These cases do not exercise the maximum twenty-page scatter; cold isolates, concurrency, full workerd/D1 CPU/read/write accounting and representative daily churn are also still open. No Free acceptance threshold or evidence requirement was weakened. [Workers limits](https://developers.cloudflare.com/workers/platform/limits/).

Private evidence remains ignored, independently pinned and unmodified:

- Before `.tmp/score-validation-before-20261022-003.json`: SHA-256 `2742311458721e2bb849c159b9969e02cd9399b1316132b2764988d89c0b75c3`.
- Final `.tmp/score-validation-after-20261022-004.json`: `552839dde4bbd44da21ce265f54c3d68b7bd2b75d316a5c59f3d684f0be9ec94`. Contended `...after...003.json` is preserved too.
- Component `.tmp/stored-hash-workerd-parity-20261022-001.json`: `69fcb182985a15360ceac9d6a6e629495a8201352aa330562faca0d927cc23b1`.
- Stress `.tmp/wide-scatter-read-study-20261022-001.json`: `737cefa217331c4cd7df1f218c5a4afedd3da2bae3b5518f9a3ed1d26fcac70e`.

## Validation and next build

**197 relevant tests pass**: new JSON-hash parity/failure tests, all paged/current/history/expiry/incremental/cursor/corruption cases, original v1–v4 score and concern/runner controls, election/replay and admin security. The read regression explicitly disables asynchronous Web Crypto after the original writer builds its projection: every original pin still verifies through the independent reader. Worker typecheck and the reusable 13-vector workerd check pass. Before commit, preservation hashes/foreign keys, credential exclusion, security preflight and the existing thesis-only release assertion are verified. This server-only change requires no new UI layout checks; earlier dependency audit findings remain unresolved.

Next prioritize a smaller **verified inventory index** or equivalently proven page format, retaining all canonical address/name/symbol/filter/rank fields and full-inventory completeness. Measure 500-wide, maximum scatter and cold/concurrent workerd+D1 reads with no skipped validation or unsupported hash reassignment. Then combine those costs with actual multi-day source churn, incremental writes, builder CPU, source-trigger overhead, all viewers/polling and shared account usage before admitting automatic rebuilding/public adoption. Raw-store Free capacity, private recovery/offload and qualified activity/prospective scoring remain separate open work. No provider call, quota/reset, evidence eviction, live migration, preview restart or deploy.
