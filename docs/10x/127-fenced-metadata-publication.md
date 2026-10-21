# 127 — Fenced private metadata publication

22 October 2026. Continues [126's authenticated staging](126-authenticated-append-staging.md) and [125's atomic write contract](125-atomic-evidence-append-contract.md). Adds an isolated Node/SQLite coordinator for staged references and bounded producer mutations. Application D1, original evidence, source allowances, model-v4 and release/action gates remain unchanged. This is not a production backend or an operational cutover.

## Delivered coordinator

`scripts/discovery-evidence-publication.mjs` creates a **new immediate child of `.tmp`**, using the complete admitted frozen metadata/reference/catalog resolver. It clones the metadata database through SQLite backup and adds four experiment tables: current publication authority, original base receipt hashes/lengths, new encrypted references and committed publication results. All base references must match the complete original evidence population and raw payload identities. An immutable independently pinned header is written only after the source resolver's final source/key checks pass. Partial or existing targets are never overwritten or reinitialized. Historical sessions, leases and operational controls are copied as historical values and never activated.

The stage module adds authenticated `inspectEvidenceAppendStage`; this exposes only previously pinned context fields, with no key material. The capacity tool adds read-only `metadataValueInventory`, reusing its existing exact typed-value fingerprints for clone comparisons. Neither changes existing reader/writer behavior.

Publication accepts one authenticated stage ticket, a stable publication UUID, exactly one receipt position and a bounded ordered list of producer SQL operations. A plan can contain at most 128 operations, 100 bindings per operation, 16,384 SQL characters per operation and 10 MiB of aggregate SQL/string bindings. Only the existing candidate/history/proof/run/attempt/control/work/profile write tables are permitted. SQL parameters remain bound. Transaction control, multiple statements, comments, `RETURNING`, quota/source-usage writes and direct publication-authority/reference writes are rejected. These are offline experiment work bounds, not changes to collection/research/provider budgets or a claim of complete producer compatibility.

The coordinator verifies the staged object before opening the write transaction. Inside **`BEGIN IMMEDIATE`**, it checks the expected target schema, generation, owner and monotonic ownership epoch **again**, then executes receipt/reference and producer operations in order. A later statement or explicit compare-and-swap expectation failure rolls back run/candidate/profile/work/receipt/reference/journal mutations together. Prior source allowances and checkpoints stay outside this transaction and cannot be refunded through its allowed SQL. Existing callers still own their original failed-attempt/backoff handling; this experiment does not replace those loops.

New receipts insert their original metadata and authenticated encrypted ticket atomically. Existing base or dynamic receipts require the original row hash, payload length and identity to match; no reference is substituted. Identical holder content observed later keeps the first metadata time and original reference. Wallet observation time must match its hashed body. Orphan metadata, missing references, overlapping base/dynamic authority and immutable collisions hold. A base duplicate remains a frozen reference and is never relabeled as a new dynamic receipt.

The committed journal records plan hash, original authority and per-position result changes. Reusing a publication UUID with different operations/ticket holds. An exact retry authenticates the object and rechecks its committed receipt metadata, then returns the recorded results without replaying producer writes. If SQL commit succeeded but its acknowledgement was lost, the next **currently authorized** owner can reconcile that UUID. Missing/corrupt committed evidence is held rather than silently reconstructed or declared successful.

`transferEvidencePublicationOwner` compares current authority inside its transaction and increments the epoch, including when the same owner returns later. Stale owners cannot publish, reconcile or read dynamic references. The experimental dynamic reader authenticates a new published ticket and checks owner/reference/metadata again after decryption, before releasing the row. Base or unknown lookups explicitly require the frozen resolver; this narrow reader is not a complete `EvidenceReadStore`, a global absence proof or the unified application backend.

Optional cohort/post-commit work runs **after** SQL closes and receives an isolated copy of the receipt. Failure returns `state:committed` with `post_commit:failed`, never a false SQL failure or quota refund. Callback status is returned, not persisted as a certified cohort outcome. Caller-owned cohort writes still need their own idempotence, source/time checks and ownership discipline; this callback is not a fenced cohort executor.

Generation binding and owner UUID/epoch checks establish local experiment consistency, **not production identity authentication, custody or host access control**. The target header is independently pinned; mutable local SQLite authority is trusted within this private rehearsal. Current-generation owner transfer is implemented; new-context generation transitions, stopped-owner adoption and rollback are not certified. No runtime uses these APIs.

## Verification

All **29 publication cases** pass in the final complete suite. Coverage includes full migrated schemas, ordered producer/receipt results, new dynamic reads, frozen base duplicates, first holder time, exact NUL/multibyte metadata bytes, immutable/missing-reference holds, later-statement rollback, spent allowances, compare-and-swap expectations, wrong generation/owner/epoch, same-owner return, ownership changes between object verification and SQL, ownership changes during a read, lost commit acknowledgement, current-owner reconciliation, post-commit callback failure/isolation, invalid SQL/plans, existing targets, schema/pin changes and corrupt committed ciphertext. Metadata text is decoded from SQLite BLOB casts to preserve the original bytes. Fixtures are synthetic private clones and never touch live data.

Reproducible full command: `pnpm test:discovery-publication`. Existing **32 staging, seven capacity, 13 encrypted-read and 35 atomic-write/wallet cases** also pass: **116 distinct cases verified**. CI adds the complete publication suite. The earlier 1,412-test Discovery result is not presented as a new full-suite run; no production TypeScript/config/dependency change requires a new runtime build. Security/closure/original-row/actual-credential checks remain separate.

Final security preflight/blocklist, existing thesis-only built closure and original live row hash/foreign-key checks pass. Actual keys/credentials are absent from the 13 scoped files, new private artifacts and 66 scanned existing assets; private outputs remain ignored/untracked. Final code reconciles all four frozen records again with unchanged target SQLite bytes and rechecks all 83 original tables' typed values. No fresh frontend build, hosted CI result or production runtime acceptance is claimed.

## Frozen full-metadata rehearsal

`scripts/discovery-evidence-publication-study.mjs` accepts eleven arguments:

```text
CAPACITY_DIR CAPACITY_PIN REFERENCES_DIR REFERENCES_PIN SEALED_DIR KEY_FILE STAGE_DIR CONTEXT_PIN STAGING_REPORT STAGING_REPORT_SHA256 NEW_PRIVATE_TARGET
```

It independently pins 126's staging report, admits its frozen sources, checks each staged row against its original frozen row, publishes its base duplicate with an unchanged-value candidate SQL operation, transfers publication ownership, rejects the old owner and reconciles all four records under the current owner. It then compares exact stored types/bytes for every original table and checks SQLite integrity/foreign keys. It does not invent new source observations, candidate assessments, historical job successes or cohort timestamps. New dynamic inserts/reads are exercised in synthetic tests, not misrepresented as new real observations.

| Rehearsal result | Value |
|---|---:|
| Original tables / rows, all typed values identical | **83 / 39,408** |
| Complete original base receipt bindings | **958** |
| Committed/reconciled publication records | **4 / 4** |
| Changed original values / replaced base references / new dynamic references | **0 / 0 / 0** |
| Private target SQLite bytes | **83,386,368** |
| Provider requests / live database writes / runtime activations | **0 / 0 / 0** |

Private report: `.tmp/evidence-publication-study-20261022-001/rehearsal.json`, SHA-256 **`614b914d29874708e61c8589a0e8b5a9df3e3dcbbc5e09708bdebc3f0c9ac931`**. Its new `metadata.sqlite` and pinned `publication.json` remain private; original staged files, sealed objects, restored metadata and protected keys remain unchanged. This rehearsal **does write its new private clone**. Database bytes exclude external frozen/staged payload packs, other artifacts and filesystem allocation; they are not complete storage, D1 import, per-account Free or CPU acceptance.

The implementation follows current [Node SQLite API](https://nodejs.org/api/sqlite.html) and [SQLite transaction](https://www.sqlite.org/lang_transaction.html) documentation. It proves local SQLite semantics, not Workers/D1 execution, portable power-loss recovery, off-device custody or production authorization.

## Next implementation

Bridge the complete application read contract across original frozen and newly published references, including index/cutoff/tie/byte/missing/corrupt behavior, and adapt all three original producer batches without altering their failure, result-position or post-commit cohort semantics. Then prove whole-target read/write parity, fenced new-generation handoff and stopped-owner adoption **and rollback**, without reactivating historical sessions or using a bookkeeping-only stopped flag. The stripped schema with this experiment's narrow reader is still unusable as the whole application's store.

Independent off-device custody/loss recovery, later chronological growth, orphan retention, actual D1/object/read/write/storage/CPU costs and shared account Free/no-spend/private-root admission remain open. Continue broad admitted observations, meaningful volume/holder qualification and held-out ranking evaluation alongside capacity work. All evidence/time/research/action/election/financial gates and thesis-only closure remain. No live collection, mutation, quota reset, migration, restart, runtime adoption, upload, spending, evidence deletion or deploy.
