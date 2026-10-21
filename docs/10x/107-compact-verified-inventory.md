# Compact verified inventory and maximum page scatter

22 October 2026 (Australia/Sydney). Continues [106](106-server-hash-verification-and-stress-matrix.md) and PRD §17.7. The admin-only read experiment now stores a lossless v3 inventory index. Public reads and automatic rebuilding remain held.

## Implemented

`discovery/src/score-read-index.ts` replaces repeated inventory object keys with strictly validated twelve-field tuples. Names and symbols use an exact, first-use-ordered text dictionary. The tuple order is address, name reference, symbol reference, eligibility, creation time, score, coverage, liquidity, freshness, full-card hash, body hash and score-page number. Every field and original constraint remains; no normalization, truncation, missing-data substitution, digest reassignment or inventory pruning occurs.

The dictionary permits at most 1,000 strings for 500 identities. The reader rejects dangling, negative, fractional or oversized references, duplicate/unused/out-of-order dictionary entries, oversized names/symbols, extra object keys and missing/extra tuple fields. Empty strings, exact Unicode code units, escaped text and prototype-like strings round trip unchanged. Canonical first-use ordering also makes identical builds deterministic.

The complete packed manifest is strictly parsed and hashed **before decoding**. The original reader then verifies full inventory uniqueness/default ordering/page membership, query filters/global ranks, summary schemas/hashes/cutoff, selected strict bodies, reconstructed full cards and original metadata correspondence. Three read statements and both source/generation barriers remain, including empty-result races. Time bounds, query/input/byte limits, `action_authority: false`, admin authentication/origin/host isolation and public 404 remain unchanged.

This bumps only the experimental serving contract to `discovery-score-read-pages-v3`, including its policy identity. Manifest hashes/cursors therefore change. Stored v1/v2 manifests hold until an **explicit** rebuild; reads never convert or rewrite them. A same-cutoff v2-to-v3 rebuild reuses unchanged bodies and summary pages, replacing only the manifest. No database migration or live rebuild was run. Original full-card/body/score hashes, Web Crypto builders and frozen v1–v4 evaluators remain unchanged.

## Same-input archived comparison

The verified archive was opened read-only; the same 244 candidates and 6,321 market snapshots at `2026-10-21T14:24:50.571Z` were copied into isolated memory. All cards, ranks, concerns and score pins match full original evaluation. Complete ordered-card hash remains `0f50965a69d3e47601dc96472c29dd7a193710958b1e40871fd7867a226e8cae`. The new serving manifest hash is `c846b6eec0b4eead065521c06f9a0bf1002549f8c8adb4328b455563b689bb5b`.

Manifest size falls **94,443 → 58,587 bytes (38.0%)**. The full cards remain 343,525 bytes; response sizes and initial publication counts remain unchanged. Five warmups and 100 serialized reads per shape use the same harness as 106:

| Cards | Response bytes | Previous / v3 wall p50 | Previous / v3 wall p95 | Previous / v3 mean local CPU |
|---|---:|---:|---:|---:|
| 1 | 2,083 | 2.90 / 2.46 ms | 4.92 / 4.38 ms | 3.60 / 2.97 ms |
| 25 | 39,032 | 3.95 / 3.56 ms | 5.40 / 5.61 ms | 4.54 / 4.53 ms |
| 100 | 147,784 | 8.27 / 8.54 ms | 11.95 / 11.86 ms | 9.84 / 9.37 ms |

The ordinary default-page CPU is effectively unchanged; the measured gain here is smaller verified storage/transport. These are separate warm local Node/SQLite runs, including serialization, host scheduling, GC and process CPU quantization. No Workers CPU, cold-isolate latency or deployed D1 acceptance is inferred.

The identical 106 stress fixture with 500 mints and shared maximum-length escaped names/symbols shrinks **581,212 → 118,030 manifest bytes (79.7%)**. Every sampled card still matches; reads perform no writes:

| Query | Summary pages | Previous / v3 wall p50 | Previous / v3 wall p95 | Previous / v3 mean local CPU |
|---|---:|---:|---:|---:|
| Default score, 25 | 1 | 10.61 / 4.66 ms | 13.40 / 6.60 ms | 11.30 / 5.48 ms |
| Liquidity, 25 | 5 | 9.39 / 7.23 ms | 13.59 / 10.23 ms | 10.13 / 10.95 ms |
| Liquidity, 100 | 6 | 14.53 / 10.83 ms | 18.04 / 13.33 ms | 15.23 / 10.95 ms |
| Exact mint, 1 | 1 | 6.73 / 3.72 ms | 9.33 / 6.41 ms | 7.05 / 5.45 ms |

Not every metric improves. Repeated identity text helps compression; it cannot establish general worst-case fit.

## Reproducible distinct-text and maximum-scatter study

```powershell
pnpm exec tsx scripts/discovery-read-index-study.ts .tmp/read-index-study-NEW.json
node scripts/discovery-hash-runtime-check.mjs
```

The first command uses fixed synthetic fixtures in fresh in-memory databases with all migrations, 500 synthetic mints, maximum-length identity text and no market history. It compares results to the full evaluator, measures five warmups plus forty serialized reads per shape and asserts no read writes. A new JSON output under `.tmp` is mandatory; existing reports are never overwritten. There are no credentials, app/live database reads, provider requests, telemetry, source reservations or collection changes. Fixture identity/summary reads in this harness are diagnostic, not a new public query API.

It includes shared text, **500 distinct** escaped names/symbols and a search selecting five cards from each of all twenty summary pages. The scatter fixture is constructed from a first full build, then rebuilt after changing names; it asserts the actual selected-page count is twenty. All sampled returned cards and ranks match independent full evaluation:

| Fixture / query | Manifest bytes | Summary pages | Wall p50 / p95 | Mean local CPU |
|---|---:|---:|---:|---:|
| Shared wide, default 25 | 127,240 | 1 | 4.37 / 5.84 ms | 4.68 ms |
| Distinct wide, default 25 | 502,332 | 1 | 7.14 / 9.23 ms | 7.43 ms |
| Distinct wide, liquidity 100 | 502,332 | 4 | 10.92 / 15.28 ms | 15.63 ms |
| Distinct wide, exact mint | 502,332 | 1 | 5.95 / 10.11 ms | 7.03 ms |
| Distinct wide, scattered 100 | 502,333 | **20** | 14.63 / 19.87 ms | **18.00 ms** |

These synthetic fixtures differ from the preceding archived-source stress fixture and are not direct before/after comparisons. They exercise identity-width and maximum page fanout, not every field's schema maximum. Distinct text largely removes dictionary reuse. Twenty-page fanout remains a material cost: the reader correctly verifies all loaded summaries rather than skipping unselected page members.

The second command extends the existing credential-free local workerd component check. In addition to thirteen independent native/Web Crypto hash vectors, the actual codec round trips 500 distinct escaped identities and rejects three malformed inventories. Existing local compatibility settings/dependencies are used and the runtime is disposed. It has no app/D1 bindings; **component compatibility is not full-reader runtime CPU, cold/concurrent D1 or Free certification**.

Private proofs remain ignored and pinned:

- Archived v3 `.tmp/score-validation-after-20261022-005.json`: SHA-256 `49980555095722af97539fe4491580bb45d4812d76ce229d90d80271d8203e9c`.
- Same stress fixture `.tmp/wide-scatter-read-study-20261022-002.json`: `500aae58b669c79c87f24084fe2183e07c2b8afe068776d9a5e793b06afcd8e4`.
- Reproducible matrix `.tmp/compact-score-inventory-study-20261022-001.json`: `3c4e648cc35bcabb40b9255e574a0c58fcd05e1b143f7d6143e714772ca08101`.
- Previous comparison proofs in 106 are retained unchanged.

## Validation and next work

**204 relevant tests pass**: 55 affected index/read/current/history/expiry/hash tests and 149 unchanged score-v1–v4/counterexample/election/admin-security cases. New tests cover complete lossless round trips, all field/reference constraints, repinned malformed manifests, v2 holds/explicit reuse and maximum twenty-page scatter. Worker typecheck passes. The runtime component check passes thirteen hash vectors, 500-row codec parity and three rejection cases. Preservation digests/foreign keys, credential exclusion, static security preflight and the existing thesis-only release assertion are checked before commit. This server-only change does not require new visual acceptance; the earlier dependency audit findings remain open.

Next reduce and measure scattered-summary validation/transport **without discarding any original field/hash/cutoff proof**. Then exercise the complete reader in cold and concurrent workerd/D1 runs, including serialization and all query shapes. Combine that with original builder CPU, representative multi-day source/body churn, index/trigger writes, every viewer/polling path and account-wide usage before public or automatic adoption. The Free CPU and shared D1 budgets remain requirements, not assumptions. [Workers limits](https://developers.cloudflare.com/workers/platform/limits/), [D1 pricing and index-write accounting](https://developers.cloudflare.com/d1/platform/pricing/).

Raw-store Free capacity, private recovery/offload, remaining dependency findings, broad current data coverage, qualified organic volume/meaningful holder growth and prospective scoring validation remain separate open PRD items. No provider allowance, evidence/action/election gate, current score model or production thesis-only flag changes. No live migration/rebuild, collector restart, evidence eviction, paid service or deploy.
