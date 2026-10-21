# Private evidence scratch index

22 October 2026 (Australia/Sydney). Implements the scratch compact metadata/index step from [114 — encrypted selective evidence](114-encrypted-selective-evidence.md). A standalone SQLite index can now resolve individual original evidence rows without opening or parsing the complete encrypted catalog. This is a private offline prototype, not live evidence relocation or a production D1 resolver. F5 remains partial.

## Implemented commands and integrity boundary

`scripts/discovery-evidence-index.mjs` uses existing Node SQLite, Zod and the original archive/encryption validators. No dependency, Worker binding, migration, source collection, remote service or spend is added.

```powershell
node scripts/discovery-evidence-index.mjs build SEALED_DIRECTORY SEALED_MANIFEST_PIN KEY_FILE NEW_PRIVATE_DIRECTORY
node scripts/discovery-evidence-index.mjs verify INDEX_DIRECTORY INDEX_MANIFEST_PIN
node scripts/discovery-evidence-index.mjs lookup INDEX_DIRECTORY INDEX_MANIFEST_PIN SEALED_DIRECTORY KEY_FILE TABLE ORIGINAL_PAYLOAD_HASH NEW_PRIVATE_JSON
pnpm test:discovery-archives
```

`build` first fully verifies every original row in the pinned encrypted source pack. It authenticates the catalog and copies only metadata and original/encrypted object descriptors into a new standalone strict SQLite database. The index stores one shared source header, one row per unique object and one row per original evidence identity, with original order retained. A foreign key connects identities to objects. Primary keys serve exact identity/object lookup; a covering secondary index serves bounded observation-history queries by table/address, ordered by observation text and identity. No dates are reinterpreted or marked fresh.

Before writing the completion manifest, the builder reconstructs the entire original object catalog in its original order and verifies its retained canonical SHA-256, complete table populations, schemas and metadata. It checks SQLite integrity/foreign keys, records allocation/query plans, closes the database and pins its exact file bytes. SQLite TEXT identity/address/time fields are compared as bytes during reconstruction, preserving embedded NULs rather than accepting Node's truncated ordinary TEXT conversion. The new index omits payload bodies and retrieves them from the existing encrypted object pack; the key is never copied into the index.

The new `index.json` manifest binds version, confidentiality, exact database filename/size/hash, source sealed/catalog/archive pins and row/object counts. Keep its pin independently. `verify` checks those pins, standalone-file/schema constraints, integrity/foreign keys and complete reconstructed original catalog. It explicitly reports **metadata verification**, with `payload_objects_verified: false`; this command does not contact the encrypted pack or require a key.

`lookup` verifies the whole pinned index database before opening it read-only, fetches one evidence row and its object descriptor through primary keys, validates the pinned sealed envelope, and authenticates/decompresses one encrypted payload object. Original gzip/raw size and hash, exact selected identity/metadata schema and complete row hash remain required. The database hash is checked again before returning. The full encrypted catalog and original archive need not be present. It reports `objects_read: 1`, `encrypted_catalog_bytes_read: 0`, `other_objects_verified: false` and the actual whole-index hashing byte count. It does not confer freshness, source truth, action or election authority.

Whole-file hashing is the offline integrity boundary; this is not a proof suitable for individual remote D1 queries. The retained index pin, created after complete source verification, remains essential. An unknown caller's self-recomputed pin is not independent provenance. Encryption/decoder helpers are shared with 114 without changing its format, limits or existing behavior.

## Privacy, paths and bounds

**The scratch index contains plaintext sensitive metadata**, including addresses, times, original row/object hashes and encrypted-object descriptors. It is an additional ignored local artifact outside the sealed pack; it is not covered by that pack's encryption. Do not serve or upload it. Existing plaintext source archives remain private and unchanged. The dedicated encryption key remains in the separate location documented in 114.

All inputs/outputs resolve inside ignored repository `.tmp`, outside `.wrangler`; unsafe paths, file links, journal sidecars and Wrangler junction aliases hold. The new index directory must be separate from the sealed source. Files/directories use exclusive creation and requested owner-only modes. Existing outputs are not replaced or activated. Windows ACL enforcement, concurrent hostile filesystem mutation, off-device custody and key recovery remain uncertified. CLI lookup writes plaintext only to a separate new private JSON file and prints aggregate counts/hashes, never row contents or keys.

The offline index database is bounded to 64 MiB, its manifest to 4 KiB and each source population to 10,000 rows/objects; existing original payload/catalog/encrypted-object bounds remain. Population counts are checked before full reconstruction. Construction's row loop has a five-minute deadline after initial source verification. These are scratch-tool format limits, not changes to provider Free budgets or local research admission. There is no scheduler, TTL, deletion, source reset, live migration, restore adoption or collector restart.

## Frozen-snapshot measurements

The source is the same historical 885-holder / 73-wallet snapshot used by 113/114, not a measurement of today's full live database or sustained growth.

| Measurement | Result |
|---|---:|
| Original evidence identities / unique objects | 958 / 958 |
| Referenced original payload bytes, retained outside index | 925,125,445 |
| SQLite index bytes | 1,552,384 |
| Manifest bytes / total new index artifact | 698 / 1,553,082 |
| Page size / allocated pages / free pages | 4,096 / 379 / 0 |
| Largest SQLite cell record payload | 9,044 bytes |
| Largest evidence-row / object record payload | 588 / 433 bytes |
| Explicit SQL row inserts for a full build | 1,917 |
| Whole index build, including source verification | 13.81 seconds locally |
| Index construction/checks after source verification | 136 ms locally |
| Independent original row and payload-byte matches | 958 / 958 |

Physical allocation: source header 12,288 bytes; object table 507,904; evidence-row table 655,360; address-history index 184,320; object/row ordinal uniqueness indexes 81,920 / 106,496; SQLite schema 4,096. The footprint includes those indexes and SQLite record overhead, not just serialized JSON lengths. Explicit SQL row changes exclude internal index writes and are not D1 billed write counts. No incremental build or later-day growth measurement is claimed.

Exact lookup plans use primary-key searches for the identity and object. Address history uses `evidence_rows_by_address` as a covering index. These are SQLite plans, not measured D1 rows read/written. The largest observed record is below D1's published [2,000,000-byte string/BLOB/row limit](https://developers.cloudflare.com/d1/platform/limits/); that single-snapshot comparison does not certify future rows, complete-store allocation, account Free entitlement or production feasibility.

An independent proof compares **every indexed recovery** directly with original SQLite raw TEXT-column bytes, complete row JSON/hash and payload bytes. All 958 match; both original database and index file hashes remain identical. Six additional first/last/largest probes read one 5,364–367,039-byte object each, zero encrypted catalog bytes, and hash **3,104,768 index bytes per lookup**, taking 38.89–59.61 ms locally. The index is larger than the 784,565-byte encrypted catalog and adds storage; this is not a network-byte reduction, a controlled performance improvement, Worker CPU or Free certification. Whole-file integrity hashing remains a production blocker.

| Retained artifact | SHA-256 |
|---|---|
| Source sealed canonical manifest | `ebc5cbf3fbbbdf4ef46d01bf755d059a8fbe033a80b5595c8b5adf388309c76d` |
| Source object catalog canonical manifest | `207372536ffc586ced760196e6d45213de258f27d5f731ce4cf3720bdaef3c3f` |
| Original SQLite file | `40f45fa51b9e5287b2ee44dfb98c094b414504d25a69984b2a24ee5dc2fbf2ec` |
| New index canonical manifest | `2b998c2045a34c29f6fa0cdae611f9482c6cda367f0555f90a6d6982a565baed` |
| New index SQLite file | `29a2bcec57b132c2ecdd2481be877442ee6e99372bf772cc3a9a53188aef50fa` |
| Independent proof file | `c824dc7383da15eeddcaeaf4b303c6ad84533fc1d504616a79711dd1f3c400f3` |

Private artifacts: `.tmp/discovery-evidence-index-20261022-001/{index.json,evidence-index.sqlite}`, `.tmp/evidence-index-build-20261022-001.json` and `.tmp/evidence-index-proof-20261022-001.json`. Manifest pins cover canonical serialized bodies; file pins cover actual bytes. No original archive, sealed pack or recovery key was replaced.

## Verification and next work

**43 archive tests pass:** 36 existing tests plus seven index tests covering full original catalog reconstruction, exact NUL/Unicode/empty/shared payload recovery, plans/allocation, catalog/source independence, wrong pins/keys, missing identities, ciphertext corruption, key separation, changed index bytes, caller-repinned population/schema/metadata failures, unsafe paths/links/sidecars, exclusive outputs, malformed contracts and private CLI exports. Existing security CI includes the suite through `test:discovery-archives`; no hosted result is claimed.

Original live evidence hash/foreign-key preservation, syntax, security preflight and the existing built thesis-only closure assertion pass. Actual API/encryption-key exclusion and ignored/untracked private artifacts are checked separately. No application runtime/UI/dependency/migration changes require fresh application builds for this offline slice; unrelated Network/legal work is excluded.

Next design bounded per-reference integrity proofs rooted in independently retained source/catalog identity, replacing whole-database hashing without dropping any original row/object/source checks. Compare proof storage/read/write costs and privacy against this scratch baseline before runtime adoption. Measure the remaining complete metadata store and chronological admitted growth; this subset's 1.55 MB cannot establish full D1 capacity. Private runtime authorization, old cohort/election replay, protected key restore/off-device recovery, stopped-owner relocation/rollback, actual account-wide Free/no-spend controls and shared viewer/maintenance costs remain open. Continue broad admitted F1 observations and preregistered F3 economic qualification without extra unapproved source traffic.

V4, all source/Free/evidence/time/action/election/financial gates, production thesis-only closure and public/automatic experimental serving holds remain. No live relocation, source collection, restart, remote operation or deploy.
