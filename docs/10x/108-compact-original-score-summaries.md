# Compact original score summaries with unchanged integrity proofs

22 October 2026 (Australia/Sydney). Continues [107](107-compact-verified-inventory.md) and PRD §17.7. This delivers smaller summary storage/transport in the admin-only read experiment. It does **not** establish a CPU improvement or authorize public/automatic adoption.

## Implemented

`discovery/src/score-read-summaries.ts` encodes each original page of up to 25 score summaries as strict tuples plus exact-value dictionaries. Tuple fields are address, header reference, score, coverage, ceiling, input hash, result hash, record hash and risk-flag-array reference. Headers retain the original version, timestamp and policy hash. Complete risk-flag arrays are shared only when their JSON values, ordering and duplicates match exactly; different headers/flags remain representable. Nothing is inferred from a manifest or another token.

All scalar, date, hash, literal and risk-flag schemas come directly from `ScoreSummaryV4Schema`. Dictionary entries are bounded to 25, references to 0–24, pages to 1–25 members and flags to the original 24-member limit. The reader rejects dangling/fractional/negative references, duplicate/unused/out-of-order dictionaries, extra object fields and missing/extra tuple members. Canonical dictionary keys are calculated once per entry. No normalization, truncation, flag reordering or replacement values occur. If the original summary gains cross-field refinements, restore full-summary parsing before adopting those changes.

The reader strictly parses the complete packed envelope, reconstructs **every original member in its original schema field order**, then verifies the **original full-page hash**. Existing page hashes continue to describe the uncompressed original summary array; they are not reassigned to tuples. Selected full-card/body hashes, page membership, every loaded member's cutoff and all inventory/cursor/source/generation/action checks remain. All 500 summaries are reconstructed and checked in the twenty-page scatter case, including the 400 members outside the selected response. Default-order page slicing replaces repeated full-inventory filtering only after complete contiguous page membership has been proved.

Both stored and expanded pages retain the original **100,000-byte** limit. Builders check original and packed sizes; readers check expanded size before hashing. A regression constructs a small valid packed envelope that expands beyond that bound and requires a hold. `storedJsonTextHash` hashes the already serialized, validated, bounded original UTF-8 bytes without a second JSON serialization. It shares the existing native SHA implementation; original Web Crypto writers/evaluators and all frozen scoring artifacts remain unchanged.

## Serving format and upgrade behavior

Only the experimental contract becomes `discovery-score-read-pages-v4`; **the current scoring model remains discovery-score-v4**. Inventory tuples, details schema, sixty-second window, all original input/response bounds, three read statements and read-only generation barriers remain. Public endpoints still return 404; existing admin/host/origin/no-store guards and `action_authority: false` remain.

Serving manifest policy/hash/cursors change with the contract. Stored v1–v3 generations hold without read-time conversion or writes. An explicit same-cutoff rebuild from real v2/v3-shaped manifests and original flat summary arrays reuses unchanged bodies, rewrites the compact summary payloads and manifest atomically, and retains **every original summary-page hash**. Isolated tests verify this, rejection of old cursors and late-failure rollback. No new migration is needed or run, and no live rebuild or restart occurred.

Logical publication counts remain unchanged after the format transition: an identical rebuild writes zero rows; a time-only 244-token refresh still changes ten summary pages plus the manifest. This is fewer payload bytes, not fewer rows billed by D1. The builder still performs full evaluation at the original cutoff, and the existing global admission requirements remain. [D1 batch transaction semantics](https://developers.cloudflare.com/d1/worker-api/d1-database/), [D1 pricing/index-write accounting](https://developers.cloudflare.com/d1/platform/pricing/).

## Controlled synthetic comparison

The fixed [107 study](107-compact-verified-inventory.md) ran before code changes and after the final implementation, without a concurrently launched test suite. Each shape uses a fresh in-memory database, 500 synthetic mints, no market history, five warmups and forty serialized reads. The updated script also records actual packed/original summary bytes and the number of verified members:

```powershell
pnpm exec tsx scripts/discovery-read-index-study.ts .tmp/summary-study-NEW.json
```

Across each fixture's twenty pages, summary payloads shrink **265,520 → 135,180 bytes (49.1%)**. A single 25-member page is 13,276 → 6,759 bytes. These totals exclude the unchanged manifest/details and database/index overhead; actual network framing, database file size and billing are not measured. Distinct-wide manifests remain 502,332 bytes (502,333 for scatter). All result sizes, cards, ranks and original score hashes match full evaluation; reads perform no writes or provider IO.

| Fixture / query | Summary pages / members | Original → packed page bytes read | Before / after wall p50 | Before / after wall p95 | Before / after mean process CPU |
|---|---:|---:|---:|---:|---:|
| Shared wide, default 25 | 1 / 25 | 13,276 → 6,759 | 4.44 / 4.35 ms | 6.82 / 6.55 ms | 6.25 / 5.90 ms |
| Shared wide, liquidity 100 | 4 / 100 | 53,104 → 27,036 | 8.67 / 8.81 ms | 12.33 / 10.91 ms | 9.75 / 10.55 ms |
| Distinct wide, default 25 | 1 / 25 | 13,276 → 6,759 | 7.24 / 7.74 ms | 9.70 / 10.91 ms | 8.60 / 8.20 ms |
| Distinct wide, liquidity 25 | 1 / 25 | 13,276 → 6,759 | 7.78 / 8.22 ms | 10.30 / 10.78 ms | 7.78 / 12.10 ms |
| Distinct wide, liquidity 100 | 4 / 100 | 53,104 → 27,036 | 14.00 / 10.14 ms | 19.96 / 13.19 ms | 18.40 / 10.55 ms |
| Distinct wide, exact mint | 1 / 25 | 13,276 → 6,759 | 9.22 / 7.09 ms | 14.45 / 9.46 ms | 9.00 / 7.03 ms |
| Distinct wide, scattered 100 | **20 / 500** | **265,520 → 135,180** | **14.24 / 14.20 ms** | 20.19 / 19.52 ms | **17.20 / 22.25 ms** |

This is a storage/transport gain, **not a demonstrated general CPU gain**. Some CPU cases improve and others regress; maximum-scatter median latency is effectively unchanged and measured process CPU is higher. The separate local runs include host scheduling, JIT, GC and CPU quantization; they cannot establish causality for each difference or compliance with Workers Free CPU. The running background environment was not stopped. No warm local mean is treated as full-reader runtime, cold-start, concurrency, remote D1 or Free certification. [Workers limits](https://developers.cloudflare.com/workers/platform/limits/).

## Archived and runtime parity

The same verified archive was opened read-only; 244 candidates and 6,321 market snapshots at `2026-10-21T14:24:50.571Z` were copied into memory. Every original card/hash/rank still matches. Ordered full-card hash remains `0f50965a69d3e47601dc96472c29dd7a193710958b1e40871fd7867a226e8cae`; the new serving manifest hash is `fb319ecdc9daee9e424d1a07b7f31cb42f34d9e625ea6d891bc45dca41b6529c`. Manifest/card bytes remain 58,587 / 343,525. The 25-card response remains 39,032 bytes, local wall p50/p95 3.63 / 5.75 ms and mean CPU 5.32 ms (previous 3.56 / 5.61 ms and 4.53 ms). This ordinary query also does not prove a CPU improvement.

`node scripts/discovery-hash-runtime-check.mjs` now checks both native hash entry points against thirteen independent Web Crypto vectors, retains the 500-row inventory round trip/three malformed-inventory rejections, and adds a 25-member page with 24 flags per summary. The original/decoded summary bytes and independent Web Crypto page digest match; three malformed summary envelopes are rejected. Existing compatibility settings/dependencies are used, the credential-free isolated runtime has no app/D1 bindings, and it is disposed. This remains a **component** compatibility proof.

Private ignored reports are preserved and pinned:

- Before `.tmp/compact-score-summary-before-20261022-001.json`: SHA-256 `5fb2d60f58a53876627050d791e6f098259385163822debe4099d236b539022a`.
- After `.tmp/compact-score-summary-after-20261022-001.json`: `17e9b31ff5618bbebbc34d84f559285554151131e82cf933735adc811908ccd0`.
- Archive `.tmp/score-validation-after-20261022-006.json`: `6d6db6a38989b5f85ea97a7fcbb542af51f8ac52aa74ea46e95dbb1f59c2323d`.

## Validation and next decision

**210 relevant tests pass**: 61 affected codec/read/hash/inventory/history/expiry cases plus 149 original score-v1–v4/counterexample/election/admin-security cases. Worker and standalone study typechecks pass. Tests cover mixed headers/flags, exact hash/schema field order, Unicode, flag ordering/duplicates, all field/reference constraints, expanded-size holds, actual old-format upgrades, unselected-member cutoff corruption, incremental reuse, cursor/source/generation races and atomic failure. Runtime component parity passes. Evidence preservation/foreign keys, credential exclusion, static security preflight and the existing thesis-only artifact/config assertion are checked before commit; earlier dependency audit findings remain open.

**Next prioritize full-reader workerd/D1 profiling, cold isolates and concurrent reads before another format optimization.** Use representative and wide/distinct/scattered shapes with complete serialization and explicit integrity verification. Attribute the remaining CPU to parsing, validation, hashing, ordering or transport; require repeatable evidence before selecting another optimization. Component-only checks and warm Node process CPU cannot close that gate. No further format bump is justified solely by a smaller local default mean.

Public/automatic adoption additionally requires representative multi-day builder/churn/trigger/index/write accounting and all viewers/polling/account-wide admission. Raw-store Free capacity/private recovery, broad current source coverage, qualified organic 24h demand and meaningful holder growth, prospective score validation and remaining security findings stay open. No provider allowance, quota reset, evidence eviction, current score model, action/election/release gate, production flag, paid service, live migration/rebuild/restart or deploy changes.
