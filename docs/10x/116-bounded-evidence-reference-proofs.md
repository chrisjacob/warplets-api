# Bounded evidence reference proofs

22 October 2026 (Australia/Sydney). Implements the bounded per-reference integrity step from [115 — private scratch index](115-private-evidence-scratch-index.md). A selected reference can now be verified against an independently retained Merkle commitment without hashing the whole database. This remains private offline tooling; production resolver adoption and F5 acceptance remain open.

## Tool and trust boundary

`scripts/discovery-evidence-references.mjs` adds build/full-verification/selected-lookup commands, using existing Node SQLite/SHA-256, Zod and the unchanged encrypted-object decoder. No dependency, key generation, provider request, binding, Worker route or migration is added.

```powershell
node scripts/discovery-evidence-references.mjs build INDEX_DIRECTORY INDEX_MANIFEST_PIN NEW_PRIVATE_DIRECTORY
node scripts/discovery-evidence-references.mjs verify REFERENCE_DIRECTORY REFERENCE_MANIFEST_PIN
node scripts/discovery-evidence-references.mjs lookup REFERENCE_DIRECTORY REFERENCE_MANIFEST_PIN SEALED_DIRECTORY KEY_FILE TABLE ORIGINAL_PAYLOAD_HASH NEW_PRIVATE_JSON
pnpm test:discovery-archives
```

Build first verifies 115's entire pinned source database, reconstructs and checks its original catalog and complete populations, and retains the source index/sealed/catalog/archive pins. Each leaf commits its original ordinal, exact evidence metadata/row hash, original object size/hashes and encrypted object size/hash/nonce/tag. Shared source-contract validators enforce the original table-specific metadata and object constraints. No payload is normalized or copied into this database.

The root context commits the format version, all four source pins and row/object counts. Hash framing is explicit:

- Context digest: SHA-256 of the context JSON in the format's fixed field order.
- Leaf: SHA-256 of byte `0x00`, the 32-byte context digest and canonical reference JSON, including the ordinal.
- Parent: SHA-256 of byte `0x01`, the 32-byte left hash and 32-byte right hash.
- An odd final node duplicates itself. The verifier requires the duplicate sibling to match the current hash. Empty trees use byte `0x02` plus the context digest.

This is a versioned project format. [RFC 9162 section 2.1](https://www.rfc-editor.org/rfc/rfc9162.html#section-2.1) describes the leaf/internal domain distinction; this tool defines its own source-context framing and duplicate-last rule. Sibling direction comes from ordinal bits, and exact path length comes from the committed population count. Count, source-context, order and role are therefore part of the commitment. Canonicalization orders metadata fields and descriptors consistently; original strings, slots, BOM/NUL/Unicode and original row hashes survive unchanged.

`references.json` pins the context, algorithm, root, confidentiality and whole reference-database identity. **Retain its manifest pin independently of the database.** Hashes establish membership relative to that trusted commitment, not publisher identity, market truth, freshness, token safety or action authority. A caller's self-recomputed unknown pin is not independent provenance. Root publication/adoption and expected source/generation policies remain production prerequisites.

Selected lookup validates the retained manifest, exact database schema and one bounded reference/proof row from an indexed SQL query. It verifies membership and requested table/identity, then validates the original sealed-envelope pin and decrypts one authenticated payload object. Original gzip/raw sizes and hashes, strict text decoding and complete original row hash remain mandatory. It reports zero whole-index bytes hashed, zero encrypted-catalog bytes read, one payload object, and `other_references_verified: false` / `other_objects_verified: false`.

A valid selected proof can remain usable after unrelated reference data changes; full verification detects the changed database. A missing selected row holds with an explicit **no proof of original absence** error. Point proofs do not establish enumeration/filter completeness, availability of other rows or current-generation validity. No list/history API adopts these proofs here.

Full `verify` still checks the exact whole-file hash/size before and after, SQLite integrity, population/order, every proof and the recomputed root. It verifies reference metadata only and reports `payload_objects_verified: false`. Build verifies every saved reference before writing its final completion manifest. Original source files and rejected/partial artifacts are retained.

## Privacy and bounds

The new database contains **plaintext sensitive metadata**, original hashes and encrypted-object descriptors. It stays ignored/local, separate from encrypted packs and source artifacts; it is not encrypted by 114. Dedicated keys remain separate and are never copied or printed. CLI lookup explicitly exports plaintext only to a new separate private JSON file, with aggregate stdout. No runtime, public download, upload, restore adoption or deletion is introduced.

All paths resolve inside repository `.tmp`, outside `.wrangler`. Links, sidecars, unsafe nesting inside existing evidence artifacts and overwrite attempts hold. Owner-only file/directory modes are requested; Windows ACLs, hostile concurrent filesystem mutation and off-device/key custody remain uncertified. Existing encrypted/unencrypted archives remain intact.

Bounds: at most 10,000 references/objects, at most 14 sibling hashes, at most 128 KiB canonical reference JSON and 1 KiB proof JSON, 4 KiB manifest and 64 MiB SQLite file. The SQL query caps returned JSON fields before Node parses them. Construction/full-verification loops have five-minute deadlines after source admission. Existing original payload/encryption bounds and all provider/local research budgets remain unchanged. These are offline format constraints, not Free hosting certification.

## Frozen-snapshot result and storage decision

Uses the same historical 885-holder / 73-wallet archive as 113–115, not today's newest store or a multi-day growth measurement.

| Measurement | Result |
|---|---:|
| References / unique payload objects | 958 / 958 |
| Independently verified Merkle paths / exact original rows | 958 / 958 |
| Referenced original payload bytes | 925,125,445 |
| Final reference SQLite bytes / pages | 2,076,672 / 507 |
| Manifest bytes / total new artifact bytes | 983 / 2,077,655 |
| SQL rows inserted for full build | 958 |
| Largest SQLite cell record payload | 1,526 bytes |
| Selected reference JSON bytes | 746–762 |
| Proof JSON bytes / sibling hashes per lookup | 671 / 10 |
| Combined selected reference/proof JSON | 1,417–1,433 bytes |
| Whole-index bytes hashed / encrypted catalog bytes read per lookup | 0 / 0 |

The initial `WITHOUT ROWID` draft allocated 4,599,808 bytes, with **958 overflow pages** consuming 3,923,968 bytes. Its larger proof records made that layout expensive. A strict rowid table using ordinal as integer primary key and a unique table/identity index allocates 2,076,672 bytes with **zero overflow pages**, while preserving the exact same Merkle root. Final allocation: 480 table pages, 26 identity-index pages and one schema page, all 4,096 bytes. This decision follows measured allocation and SQLite's documented [large-record tradeoffs](https://www.sqlite.org/withoutrowid.html#when_to_use_without_rowid), not an assumption that one layout is always smaller.

The final database is 524,288 bytes larger than 115's metadata index. Proofs trade storage and full-rebuild work for bounded selected integrity checks; immutable publication, incremental updates, all other database tables, chronological growth and shared budgets remain unmeasured. SQL row inserts exclude internal index writes and are not billed D1 write counters.

Six first/last/largest probes took 23.19–36.28 ms locally, each reading one 5,364–367,039-byte encrypted object plus bounded metadata. Selected JSON counts exclude SQLite page IO, schema/envelope checks, keys and response framing. These observations are not a controlled performance comparison, remote latency, billed Worker CPU, D1 row metering or Free acceptance. The full build took 5.75 seconds while tests were also running; it is not an isolated benchmark.

An independent implementation checks every Merkle path, direction/odd-node rule and original row hash, then compares every recovered row and payload byte directly with frozen SQLite raw TEXT bytes. All 958 match. Original archive, original index and final reference database hashes remain identical after recovery.

| Retained artifact | SHA-256 |
|---|---|
| Source index canonical manifest | `2b998c2045a34c29f6fa0cdae611f9482c6cda367f0555f90a6d6982a565baed` |
| Merkle root, identical for both layouts | `5d1b2649992e2fbeea6069a54beb09da83554252647e5870ca97486fad777933` |
| Final reference canonical manifest | `b61440eb7a4b5dee5c26ad228c2c841ac596d20cd0f79ec23bce17337f754772` |
| Final reference SQLite file | `dec8ae1b2302c6fbfd9e829a3422803b9841114211239289b1bea3037d6e824b` |
| Independent proof file | `1c6a0b9f811628bad0e3dd0965434e785fc9289cca27f5e0ef7f65b09abbc9fe` |

Final private artifacts: `.tmp/discovery-evidence-references-20261022-002/{references.json,references.sqlite}`, `.tmp/evidence-references-build-20261022-002.json` and `.tmp/evidence-references-proof-20261022-002.json`. The rejected draft in `...-001` and its build report remain retained; its unpublished draft layout is not accepted by the final schema validator. Manifest pins hash canonical serialized bodies; file pins hash complete bytes. Source sealed/catalog/archive pins and key location remain documented in 113–115 and the final manifest.

## Verification and next work

**51 archive tests pass:** 43 existing tests and eight new cases covering independent three-leaf vectors, empty/single/odd/power-of-two/10,000-leaf limits, source-context replay, metadata/descriptor/ordinal/proof substitutions, excessive fields, exact shared/empty/NUL/Unicode recovery, selected-only scope after unrelated mutation, missing-data holds, source/catalog independence, wrong keys/ciphertext, private paths/nesting/links/sidecars, manifest/schema contracts and exclusive private CLI exports. Existing security CI includes the suite; no hosted result is claimed.

Original live evidence hashes/foreign keys, syntax, security preflight and the existing built thesis-only closure assertion pass. API/encryption-key exclusion and ignored/untracked private artifacts are checked separately. No application runtime/UI/dependency/migration changes require application rebuilds for this offline slice; unrelated Network/legal work is excluded.

Next test the bounded verifier/query path in an isolated workerd/native-D1 harness with representative maximum proofs and payloads, independent root/generation admission and measured CPU/read/write/serialization costs. Design private resolver authorization and preserve old cohort/election replay before runtime wiring. Measure the remaining complete metadata store, admitted chronological growth and shared viewer/maintenance costs. Protected key restore/off-device recovery, existing account-wide Free entitlement/no-spend controls and stopped-owner relocation/rollback remain open. Continue broad admitted F1/F3 qualification under existing budgets.

All source/Free/evidence/time/action/election/financial gates, score-v4, thesis-only production closure and public/automatic experimental serving holds remain. No live relocation, source collection, restart, remote operation or deploy.
