# Evidence reference runtime and admission checks

22 October 2026 (Australia/Sydney). Implements an isolated runtime slice of [116 — bounded reference proofs](116-bounded-evidence-reference-proofs.md): shared proof/codec contracts now run in installed workerd with native local D1 and local object storage. This is synthetic acceptance tooling, not a production resolver, remote resource or Free-CPU certification.

## Implemented

Shared modules in `scripts/lib/evidence-reference-{contract,proof}.mjs` contain strict metadata/object schemas, canonicalization, the unchanged v1 Merkle framing and bounded authenticated payload recovery. They import no filesystem or SQLite APIs. Existing offline tools import/re-export the shared contract, keeping their formats, original hashes and path/adoption boundaries. A bundle guard rejects offline storage modules and filesystem/SQLite imports in the runtime bundle.

`scripts/lib/evidence-reference-runtime-worker.mjs` is bundled only by the new study. It is outside application entry points and has no deployed route. `scripts/discovery-reference-runtime-study.mjs` creates a new ignored directory, synthetic keys/token, isolated native D1/local object bindings and blocked egress, then disposes its runtime. It loads compatibility date `2026-09-01` and `nodejs_compat` from the existing local configuration without modifying it. No application/provider credentials, real token data, existing evidence stores or remote D1/R2 resources are attached.

```powershell
pnpm test:discovery-reference-runtime .tmp/reference-runtime-NEW
pnpm test:discovery-archives
```

Run from the repository root with an existing `.tmp` parent and a new output directory. Unsafe paths, Wrangler/junction destinations, nesting inside evidence artifacts and existing outputs hold. Owner-only modes are requested; Windows ACLs are not certified. Synthetic local storage remains private/ignored. The security workflow now runs the runtime command after the 51 archive tests; no hosted CI result is claimed.

The test-only admission model uses an independently configured manifest/pin, generation, identity and short grant window. A request cannot supply its own trusted manifest. Normal requests:

1. Require a local host, Bearer authorization and the existing shared admin-browser guard; responses use existing no-store security headers.
2. Reject unknown/expired grants against a controlled synthetic clock before any database query.
3. Read the generation/manifest pin and require agreement with the configured grant.
4. Query one bounded reference/proof, verify identity/ordinal/root membership, then retrieve one size-bounded encrypted object.
5. Check ciphertext/gzip/raw hashes and lengths, AES-GCM authentication, bounded decompression, strict UTF-8 including BOM/NUL preservation, and the complete original row hash.
6. Recheck generation/pin before serializing and hashing the complete recovered row. Return only a synthetic receipt, never the payload or key.

This fixture tests selected proof/codec components and local generation admission. Complete source publication, sealed-envelope admission and real private authorization remain outside it; existing offline sealed-envelope checks remain in place.

Negative fixtures inject generation changes after reference validation and after payload recovery. Both hold before releasing a row receipt. A wrong initial root stops after one generation query with no object access. An invalid proof stops before object access. Expired grants execute zero database queries. The clock is fixed for controlled tests; real clock progression and production grant publication/rotation are not certified here.

The Miniflare RPC proxy rejects a hostile Origin before dispatch, returning plain text. The browser-guard test therefore injects a hostile Origin **inside the worker after authentication**, then invokes the actual shared guard. This negative-only test switch and race/expiry switches exist solely in the study worker, not the application. It is not an end-to-end browser-origin certification.

Current primary [Workers practices](https://developers.cloudflare.com/workers/best-practices/workers-best-practices/), [crypto](https://developers.cloudflare.com/workers/runtime-apis/nodejs/crypto/), [zlib](https://developers.cloudflare.com/workers/runtime-apis/nodejs/zlib/) and [D1 result metadata](https://developers.cloudflare.com/d1/worker-api/return-object/) were checked, alongside the installed Miniflare binding schema and official Workers types `5.20261021.1` downloaded as private read-only declarations. No dependency or lockfile changed. Runtime bindings/operations are exercised directly; no generated application bindings were edited.

## Measurements and limits

Five positive shapes cover ordinary BOM/NUL/Unicode, the 14-sibling/10,000-leaf proof bound, maximum compressible payload, maximum valid ASCII payload and maximum allowed metadata fields. The trees contain their declared synthetic populations, but **only eight selected references** (five positive, three malformed) are seeded in D1. This measures selected queries, not a full 10,000-row store, complete source publication, broad token coverage or deployment coldness.

| Shape | Raw payload bytes | Internal serialized row bytes | Warm median / p95 local wall ms |
|---|---:|---:|---:|
| Ordinary, 10 siblings | 1,017 | 1,147 | 13.31 / 15.63 |
| Maximum proof, 14 siblings | 1,010 | 1,140 | 13.47 / 15.22 |
| Maximum compressible | 2,000,000 | 2,000,137 | 50.59 / 62.91 |
| Maximum ASCII/control text | 2,000,000 | 4,220,220 | 144.16 / 162.18 |
| Maximum metadata | 14 | 73,784 | 17.99 / 19.09 |

Each warm case has eight samples after two warmups (upper sample median and nearest-rank p95); first reads are retained separately. Every successful read reports **three local D1 rows read and zero written**: generation before, reference and generation after, one row each. These are native local D1 metadata counters, not deployed billing evidence. The largest proof JSON is 939 bytes; the largest selected metadata JSON is 74,309 bytes. Local schema/fixture setup and negative-race writes are separate from normal read counters.

Four concurrent maximum-ASCII requests show roughly 507 ms local wall latency, exposing queueing/cost rather than certifying concurrency capacity. AES-GCM tag failure, malformed UTF-8, declared gzip overrun and ciphertext corruption all hold. Normal D1 rows remain unchanged; negative fixtures restore their original rows. Outbound attempts are zero. No source research allowance is consumed.

The worker serializes and hashes the complete row internally, then returns a 659–662-byte receipt. Timings include local proxy/storage/proof/decrypt/decompress/serialization/hash work and receipt transport; they do not transfer the full row. The 4.22 MB expansion demonstrates why raw payload bytes are insufficient to budget serialization. No heap peak, billed Worker CPU, actual remote object latency, deployed D1 metering, production authorization, true storage-coldness or shared account-wide budget is certified. All `cpu_acceptance`, `free_acceptance` and application runtime-adoption flags remain false.

## Preservation proofs

All **51 archive tests pass** after extraction, including the original independent Merkle vectors and all storage/path/corruption gates. A separate private Node check validates every shared proof and decodes all **958 frozen records / 925,125,445 payload bytes** directly against the original SQLite raw text/row hashes. Original archive and reference file hashes remain unchanged; the original root is still `5d1b2649992e2fbeea6069a54beb09da83554252647e5870ca97486fad777933`. This real-data check runs in Node only; no real evidence or key enters workerd.

| Retained artifact | SHA-256 |
|---|---|
| Final synthetic runtime report | `f1557581f2d82dc10b2aa39a2b7bad3d0e16c7e54fe8e1fc8dfe2a5ae953e18d` |
| Runtime worker bundle | `52892ca39563ac8c7f1539452bd00fe6db73edcf5ab396f4063d01e37735f788` |
| Node shared-contract original-data proof | `151c88558b496ff41605f02d0628f4aff8e31e484ae9336e4c4bd26a7a5b4413` |

Private artifacts: `.tmp/reference-runtime-20261022-004/{report.json,reference-worker.mjs,isolated-runtime/}` and `.tmp/evidence-reference-shared-parity-20261022-117.json`. Earlier failed setup runs and the preliminary complete report in `...-003` remain retained; do not substitute them for the final pin. Report/bundle pins identify bytes, not measurement authorship. Synthetic data is regenerated per invocation; wall times and random fixtures vary.

Original live evidence hashes/foreign keys, syntax, security preflight, actual credential exclusion and existing built thesis-only closure are checked separately. No application runtime/UI/migration/configuration changes require an application rebuild for this test-only slice. Unrelated Network/legal changes are excluded.

## PRD decision and next implementation

Keep full raw resolution in private operator/maintenance experiments until actual CPU, authorization, root publication and recovery acceptance are demonstrated. Public serving should continue toward bounded precomputed views under its existing independent acceptance gates. Large raw decode/serialization must not be enabled because a proof is small or a local query is indexed. No format/model/gate relaxation is justified by these wall timings.

Next measure complete metadata-store allocation and admitted chronological growth, then integrate the resolver in a scratch replay of old cohort/election inputs while retaining every original archive and hash. Preserve failed receipts, spent allowances and exact old score semantics. Protected key restore/off-device recovery, stopped-owner relocation/rollback, production root/generation/private admission and account-wide Free/no-spend/read/write/CPU costs remain open. Continue broad admitted F1/F3 qualification without new source traffic outside existing budgets.

All source/Free/evidence/time/action/election/financial gates, score-v4, thesis-only production closure and public/automatic experimental serving holds remain. No live evidence relocation, collection, restart, remote resource or deploy.
