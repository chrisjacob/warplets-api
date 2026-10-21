# 126 — Authenticated private append staging

22 October 2026. Implements the object-staging prerequisite in [125's publication contract](125-atomic-evidence-append-contract.md). Application D1 writes and all source/evidence/action/release gates remain unchanged. This is an offline staging implementation; metadata publication and a usable whole-application encrypted target remain outstanding.

## Delivered contract

`scripts/discovery-evidence-append-stage.mjs` exposes `createEvidenceAppendStage`, `stageEvidenceAppend` and `readStagedEvidenceAppend`. Targets must be fresh private `.tmp` directories outside `.wrangler` and existing archive/catalog/stage artifacts. The existing exact 32-byte protected evidence key must remain outside the target; no new master key or credential is created or printed.

A pinned context binds the format version, caller-supplied generation, source archive/reference pins and a new random salt. An HMAC authenticates that context. HKDF-SHA256 derives separate context, payload and descriptor keys; each exclusively allocated stage UUID gets separate payload/descriptor keys. AES-256-GCM also binds context, UUID and role as additional authenticated data. The encrypted descriptor authenticates the exact metadata, raw/gzip hashes and lengths, row hash and encrypted payload descriptor. Token identities and payloads are absent from plaintext readiness files. Independent targets get different contexts even with identical generation/source inputs.

**Binding a supplied source/generation claim does not certify that source or establish current owner authority.** The caller must retain an independently admitted context pin. The study below obtains source/catalog admission through the existing complete frozen resolver. Production private/root/generation authorization and stale-owner fencing remain separate requirements.

Staging checks strict row layout, exact UTF-8, original raw payload hash and agreement between embedded mint/slot or wallet observation time and receipt metadata. It retains raw JSON property order and source timestamps. Holder bodies remain capped at 2,000,000 bytes and wallet bodies at their existing 1,800,000 bytes; compressed bodies and decrypted descriptors are bounded. These are integrity/binding checks, not chain certification, holder independence, organic-volume qualification or a new scoring rule. Original producer certification remains required.

Each stage creates `object.bin`, `descriptor.bin`, then `ready.json` with exclusive writes and file synchronization. It verifies the on-disk readiness ticket, decrypts/authenticates both objects, checks bounded decompression and reconstructs the original row **before returning a ticket**. Reads allocate only the previously admitted file size plus one byte and reject growth, shrinkage, excessive read fragmentation or invalid file/link paths. No plaintext payload cache/file or original-store fallback is added.

Retries with the same UUID verify the existing stage and reuse its exact ticket/files. Different content/table/identity holds; identical holder content observed later keeps its first staged receipt time. Wallet time must match its hashed body. Interrupted stages remain unreferenced and cannot be overwritten by a retry. A completed readiness write followed by a lost acknowledgement reconciles through verification on the same UUID. Corruption never becomes a new stage, missing row or passing check. Original caller-supplied UUIDs must survive retries; this is per-stage idempotency, not a global cross-UUID publication/deduplication guarantee.

All API receipts explicitly retain `published:false`, `evidence_admitted:false`, zero provider/database writes and no runtime/action authority. A staged object or private `readStagedEvidenceAppend` result cannot update candidates, jobs, cohorts, freshness, scores, elections or financial state. No SQL publication is attempted, so source allowances/checkpoints cannot be refunded or reset here. File synchronization plus these fault tests is not a portable power-loss/directory-durability certificate, an off-device backup or hostile-host access control.

## Validation and frozen-data study

`pnpm test:discovery-append-stage` passes **32 tests**, with no skips: holder/wallet exact roundtrips and retries, first-time retention, identity conflicts, independent contexts, invalid bindings/layouts, UTF-8 byte boundaries and exact maximum-sized inputs, faults at all three write stages, lost acknowledgement, corrupt files, checksum recomputation without a valid GCM tag, cross-context ciphertext substitution, growth after file stat, wrong keys/pins, nested/live paths and a directory junction. Synthetic fixtures use disposable private paths with checked cleanup; production code never deletes partial stages. Existing **13 encrypted-read and 35 atomic-write/wallet regressions** also pass: **80 tests total** for this change. Security CI adds the staging suite. Production code, dependencies, migrations, model-v4 and allowance settings are untouched; the prior full-suite result in 125 is not presented as a new full-suite run.

The reusable command is:

```text
node scripts/discovery-evidence-append-study.mjs CAPACITY_DIR CAPACITY_PIN REFERENCES_DIR REFERENCES_PIN SEALED_DIR KEY_FILE NEW_PRIVATE_OUTPUT
```

It admits the complete frozen metadata/reference/catalog population using the existing resolver, enumerates both tables within a 10,000-row bound, selects their distinct smallest/largest receipts, stages and verifies all four one at a time, checks exact original row hashes and retry tickets, and releases its report only after the resolver's final source/key pin checks. The output must be a new immediate child of `.tmp`. Source/key arguments are paths/pins; no secret bytes are logged. This is a four-receipt historical stress sample, not all 958 receipts, current coverage, new collection or a full backend parity certificate.

| Frozen sample | Original payload bytes | Ciphertext bytes, including encrypted descriptor |
|---|---:|---:|
| Smallest holder | 6,533 | 2,370 |
| Largest holder | 1,994,988 | 367,787 |
| Smallest wallet | 15,160 | 6,305 |
| Largest wallet | 1,759,708 | 328,218 |
| **Total, all original row hashes identical** | **3,776,389** | **704,680** |

Private result: `.tmp/evidence-append-study-20261022-001/staging.json`, SHA-256 **`5ea273fdb1a4ff6078bc9c3e23d7c0df6249f56f85deadbcae55948a87d24722`**. Staged files remain under its private `stage` directory. The study uses the restored metadata/reference pins from 121/124, the original sealed pack and the key recovered in 120. It writes 13 staging files plus its report, with **zero provider requests, database writes or publications**. Ciphertext totals exclude context/readiness/report bytes and filesystem allocation; they are not total storage or shared Free acceptance. Existing original evidence, failed/spent allowances and production thesis-only closure are checked separately before commit. Actual key/credential exclusion and ignored/untracked private outputs remain mandatory.

Current [Node crypto](https://nodejs.org/api/crypto.html) and [filesystem](https://nodejs.org/api/fs.html) documentation informed API usage; no new crypto package/service is added. Derived Buffer keys are cleared after use; JavaScript strings and all runtime memory are not claimed to be securely erased.

## Next implementation

Build an isolated metadata transaction coordinator for authenticated staged references with the producer's existing candidate/run/profile/work operations. It must check the independently authorized generation and owner **inside the same transaction**, preserve immutable hash collisions and spent allowances, reconcile lost SQL acknowledgements, distinguish post-commit cohort failures and retain recoverable unreferenced stages. New staged tickets must not masquerade as old frozen-catalog membership or absence proofs. Then prove the whole usable target's original/new read/write behavior and fenced stopped-owner adoption/rollback. The stripped capacity schema remains unusable as the whole application's store.

Independent off-device custody/loss recovery, ordinary later-day growth, actual SQL/object/read/write/storage/CPU cost, orphan retention and account-wide Free/no-spend admission remain open. Continue broad admitted observations, meaningful holder/volume qualification and held-out ranking evaluation alongside these dependencies. No live collection, mutation, quota reset, evidence deletion, migration, restart, runtime adoption, upload, spending or deploy.
