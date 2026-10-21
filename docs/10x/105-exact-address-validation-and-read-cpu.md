# Exact address validation and verified-read CPU

22 October 2026 (Australia/Sydney). Continues [104 — incremental score storage](104-incremental-score-summary-storage.md) and PRD §17.7. Reduces repeated address/schema validation work while preserving the current v2 projection format, all original score hashes, strict evidence fields and frozen-cutoff semantics. No migration, new source, dependency, schedule or public adoption.

## Implementation

The old `validAddress` predicate decoded the complete base58 string with arbitrary-precision arithmetic merely to check that it represented 32 bytes. Manifest entries, summaries and details repeatedly perform this check. `publicKey`, `fromBase58`, byte decoding, PDA/curve/signature operations and the accepted key definition remain unchanged.

The predicate now checks the exact encoded range:

1. Reject invalid alphabet characters and impossible string lengths (32–44 characters). The invalid-character check also rejects trailing newlines and Unicode lookalikes.
2. Count leading `1` characters, each representing one zero byte. Exactly 32 leading ones with no tail is the zero public key; more leading ones cannot be a 32-byte key.
3. With `z` leading zero bytes, require the nonzero tail to encode exactly `32-z` bytes: between `256^(31-z)` and `256^(32-z)-1`, inclusive. Precompute the two base58 strings for every width using the **unchanged encoder**. Compare lengths, then same-length strings. The base58 alphabet is ASCII-sorted, so this is an exact numeric range comparison.

The table is small immutable module state, without request/user data or I/O. It has a one-time initialization cost, excluded from warm read timings below. The existing decoder fallback remains for callers outside the typed string contract. Zod address fields still require strings. This remains an encoding-length check: the zero key and off-curve 32-byte values remain accepted as before; it grants no ownership, signature, on-curve, provenance, eligibility or safety pass.

The page reader also validates each strict component **once**. `Body` and the dated v4 summary are already fully parsed before combination; the current `Card` schema is exactly those two shapes, so re-parsing the same fields adds no constraint. Combining them now requires an existing parsed summary and retains details/full-card hashes, exact indexed fields, page membership/cutoff and source/generation barriers. Missing/extra body fields and missing original summary hashes still hold. If Card gains cross-field refinements, restore full-object parsing or explicitly validate those new refinements; field composition alone would then be insufficient.

No cross-request cache, address whitelist, regex-only acceptance, schema field removal, score change or integrity shortcut is introduced. Projection/policy/score identities do not change because accepted data and output semantics are unchanged.

## Same-input measurement

Before and after used the same previously verified archive opened read-only, cutoff `2026-10-21T14:24:50.571Z`, **244 current candidates / 6,321 market snapshots**, copied into new in-memory fixtures. Five warmup reads preceded 100 measured requests for each page size, including JSON response serialization. No live database, archive, original proof, migration ledger, provider allowance or process was changed.

| Cards | Response bytes (unchanged) | Before wall p50 / p95 | Final wall p50 / p95 | Before / final mean process CPU |
|---|---:|---:|---:|---:|
| 1 | 2,083 | 9.57 / 12.58 ms | 7.31 / 11.96 ms | 11.57 / 8.12 ms |
| 25 | 39,032 | **12.57 / 15.19 ms** | **9.59 / 12.85 ms** | **13.75 / 10.62 ms** |
| 100 | 147,784 | 21.90 / 28.54 ms | 17.35 / 21.82 ms | 26.87 / 21.41 ms |

All **244 original evaluator cards** match, including all v4 hashes, concerns, coverage and ranks. The complete ordered-card content hash is identical before/after: `0f50965a69d3e47601dc96472c29dd7a193710958b1e40871fd7867a226e8cae`. The projection manifest hash, storage payload sizes and initial publication counts also match. Reads make no writes or provider calls.

In a separate 48,800-address validation loop on those same valid mints, the old predicate took 454.44 ms wall; the final range predicate took 9.27 ms. The unchanged decoder still took 515.61 ms in the final process. These are local observations, not a promised speedup on every runtime/input. Initial address-only measurements are preserved separately from the final component-composition run.

Local Node/SQLite process CPU includes host scheduling, background work, GC and timer quantization. It is not Workers CPU, deployed latency, cold-start cost or D1 billing. Default mean CPU **10.62 ms** and larger-page results still do not demonstrate Workers Free fit. Full-width 500-token metadata, filter scatter, cold starts, concurrency, shared polling/read/write budgets and real runtime tails remain acceptance work. Public adoption and automatic rebuilding remain held. [Workers limits](https://developers.cloudflare.com/workers/platform/limits/), [Workers best practices](https://developers.cloudflare.com/workers/best-practices/workers-best-practices/).

Private proof files remain ignored:

- `.tmp/score-validation-before-20261022-001.json`, SHA-256 `fde5f16a5985e97ed9667cd8eb2b175f594a49720c429a5cf20c7fe86aabcdfb`.
- `.tmp/score-validation-after-20261022-002.json`, SHA-256 `3009ac12ce626ece72af786cfcddf7eb0ae3892681948c73f9cd56f84d5674b4`.
- Earlier address-only `...after...001.json` and helper `.tmp/bench-score-validation.ts` are retained. No prior artifact was overwritten.

## Validation and next work

Four new differential tests compare the predicate with the unchanged decoder across every leading-zero width, inclusive minimum/maximum and adjacent invalid values; 20,480 deterministic generated key/mutation cases; zero-key lengths; invalid ASCII in every position; newline/Unicode; canonical byte decoding and previous non-string behavior. The existing page corruption regression now explicitly covers injected score objects, omitted reasons and missing original record hashes, alongside all prior hash, race, temporal, quota/overflow and replay checks.

The full Discovery suite passes **1,361 tests / 86 files**; frontend Discovery consumers pass **150 tests / 30 files**. The final address/page suite passes 19 tests (already included in the server total); Worker typecheck passes. Original evidence hashes/foreign keys, actual credential exclusion, security preflight and the existing built thesis-only assertion pass. No layout change requires visual QA. Existing dependency audit findings and Free raw-store/recovery constraints remain open.

Next prioritize measured compact inventory/page verification for worst-width and scattered queries, cold/runtime profiling, multi-day admitted change rates and safe aggregate rebuild/read admission. Keep the original v4 evaluator, score hashes, schema constraints, sixty-second frozen window, all evidence/action/election/financial/provider gates and the thesis-only production flag. No deploy.
