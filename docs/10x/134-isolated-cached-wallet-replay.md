# 134 — Isolated cached wallet replay

22 October 2026. Completes the unchanged original cached-wallet replay against the isolated evidence target, following [133's candidate metadata plans](133-receipt-free-candidate-metadata.md). This is an offline Node workflow, not a runtime backend or adoption approval. Application D1, model-v4, collection, allowances and every evidence/release gate remain unchanged.

## Fixed metadata reads and authenticated receipts

`readEvidenceWalletMetadata` accepts only three strict request kinds: the original live active-candidate index, an exact transaction-cache signature, or an exact direct/second-hop funding checkpoint keyed by mint, wallet and anchor signature. No caller SQL, generic database handle, write, cache repair or control operation is exposed. Each read uses a native read-only transaction with target pin and generation/owner/epoch checks before and after selection. A missing scoped cache/checkpoint row remains absent; invalid or oversized content holds rather than becoming empty evidence.

The index retains original order and 500-row selection. Lengths are checked before reading bodies: at most 2,000,000 UTF-8 bytes per candidate and 16 MiB in aggregate. Cache/checkpoint payloads are limited to 250,000 bytes, with 4,096 bytes per hash/time field. These are isolated allocation bounds, not provider/research quota changes. Native BLOB reads and fatal UTF-8 decoding preserve embedded NUL and multibyte text. Existing original decoders still validate hashes, shapes, historical fetched-at cutoffs and checkpoint meaning; metadata retrieval alone grants no semantic qualification.

`readWalletReplayReceipt` completes the existing frozen-source admission and authenticated unified receipt read, including final source/file/key checks, before releasing a body to the original producer. It then reselects the target under the retained grant and compares the selected state, with no further asynchronous file IO before return. A transferred owner, changed selection/pin, wrong key or missing/corrupt body holds. Corruption is never treated as a clean missing result.

## Complete original replay and explicit outcomes

`replayLegacyWalletsOnEvidenceTarget` invokes the unchanged production `replayLegacyWallets` using a private adapter limited to its exact queries and ordered receipt/candidate-CAS/work/profile batch. There is no oracle forwarding or prerequisite copying. The caller retains distinct publication/stage UUIDs for each selected mint, at most ten. All selected legacy candidates must have identities before receipt reads or SQL; duplicate, missing or invalid identities hold. Inputs are snapshotted before asynchronous work.

The existing publisher persists and syncs the encrypted intent before executing original ordered SQL under the owner fence. Original timestamps, cohorts, spent allowances and decoder behavior remain. The cached replay has no RPC transport or reservation path; it adds no provider calls, cache/checkpoint repairs or quota/control writes. Failed SQL rolls back atomically while retaining intent and spent allowances. A zero-row candidate compare-and-swap retains the original committed publication and replay error rather than fabricating a successful upgrade or rollback.

The outer `state=completed` means the original replay loop returned. Callers must inspect both its `result.errors`/`result.upgraded` and each recorded publication outcome. Held or unconfirmed publication is not success. Once upgraded, the original selector skips that candidate on a rerun; that skip is not historical publication recovery. Use explicit retained-ID `recoverEvidenceProducerBatch` reconciliation for a committed or unknown-acknowledgement publication. Reconciliation is read-only and never invents a replacement identity or refunds quotas.

## Validation

```text
pnpm test:discovery-wallet-replay-target
pnpm test:discovery-publication
pnpm test:discovery-publication-read
pnpm test:discovery-producer-publication
pnpm exec tsc --noEmit -p tsconfig.evidence-scratch.json
```

The new **15 cases** and **63 related regressions** pass: **78 distinct cases**, plus scoped types. CI includes the new suite. All **87 synthetic tables' retained metadata values** match the original workflow; the two offloaded raw-payload columns are checked through authenticated receipt reads. Expected oracle results are captured first and original database access disabled during target execution. The complete original seven-operation result remains `[1,1,0,1,1,1,1]`. The retained temporary-WSOL fixture reproduces the original decoder's zero-to-one buyer recovery; this is an old fixture regression, not a new chain observation or broader coverage claim.

Cases cover valid cached checkpoint recovery, future cache exclusion, corrupt hashes, late SQL rollback, lost commit acknowledgement and read-only reconciliation, actual zero-row CAS, identity preflight, exact NUL/Unicode, row allocation guards, scoped absence, stale owners/pins, final ownership fencing after complete source admission, missing ciphertext/wrong keys and mutable caller inputs. Synthetic missing-body fault injection is restored before fixture cleanup; original evidence is untouched.

Private final test transcript `.tmp/wallet-replay-target-20261022-134-001.tap`, SHA-256 **`a40241af58efc29a01cf4c6ac62c5874dfd60cc81cb81e029aaa420d1e50230a`**, records all fifteen new cases. Private read-only report `.tmp/wallet-metadata-read-20261022-134.json`, SHA-256 **`fcb87b0fd00a6388abbe1ff6dacb50863ed86eff5d5bf5c995da5a122ecd5726`**, pins six final code/configuration files. Every selected field matches the frozen source: **244 active candidates, 604 transaction-cache rows, 144 direct checkpoints and 24 second-hop checkpoints**, plus three scoped absence checks. No sampling was used. The largest cache/checkpoint payload is 16,785 bytes. Original target/capacity bytes are unchanged, with zero database writes, provider requests or new real observations. The report's **32,856 ms local wall time** is not billed CPU or Free acceptance. This dated snapshot is not current live inventory or admitted F1 coverage; no full historical-wallet replay rerun is claimed.

Security preflight/blocklist, existing built thesis-only release closure and retained original row-hash/foreign-key checks pass. Actual credential/key-byte exclusion and ignored/untracked private-artifact checks pass. Prior target, capacity, proof and all fourteen original journal file hashes remain unchanged. No fresh frontend build, full Discovery suite, native remote D1, hosted CI, power-loss recovery or production authentication result is claimed.

## Next delivery boundary

Implement isolated wallet **control/quota/lease and failure/backoff paths**, transaction-cache and funding-checkpoint **writes**, then complete the original provider-backed wallet cycle with spend-before-call and explicit SQL/post-commit/unknown-acknowledgement behavior. These are still open; cached replay does not complete them. Then prove fenced **new-generation** handoff and stopped-owner adoption **and rollback** without reactivating historical sessions, leases or jobs.

Private/root authorization, independent off-device custody/loss recovery, durable cohort/replacement-owner workflow recovery, growth/orphan/intent retention and measured shared Free/storage/read/write/CPU acceptance remain open. Continue broad admitted F1 observations, qualified F3 organic volume/meaningful holder growth and prospective held-out F4 calibration. No new source/score qualification follows from this storage work. All source/evidence/time/action/election/financial/release gates and thesis-only closure remain. No live collection, quota reset, migration, restart, evidence deletion, spending, runtime adoption or deploy.
