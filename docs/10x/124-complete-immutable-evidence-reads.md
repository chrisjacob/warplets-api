# Complete immutable holder/wallet read contract

22 October 2026 (Australia/Sydney), baseline `caeb982`. Continues the compatible-read prerequisite in [122](122-shared-evidence-read-contract.md) with the resource/review discipline from [123](123-stream-resource-security-review.md). All application SELECTs against the two offloaded holder/wallet evidence tables now pass through the explicit read store. D1 remains the application backend. Encrypted reads remain private offline experiments; writers and operational adoption are unchanged.

## Application changes and preserved behavior

`EvidenceReadStore` adds `holderReceipt(hash, address?)` and `walletReceipt(hash, address?)` to its existing four bounded history/acquisition methods. Each exact-hash read returns one original row or null, optionally restricted to the requested mint. Bound D1 statements retain the original primary-key/identity semantics through the existing binding, following [D1 prepared-statement guidance](https://developers.cloudflare.com/d1/worker-api/prepared-statements/). No generic SQL proxy, writer, provider request, binding or backend switch is exposed.

The remaining consumers now use that contract:

- Wallet continuation/planning uses `priorWalletEvidenceFromStore`; the existing `priorWalletEvidence(db, candidate)` wrapper still selects D1. Missing cached evidence, original evidence hash, asset/pool/creation scope and regenerated-analysis equality checks are unchanged. An absent candidate analysis still returns null.
- Wallet-cycle holder inputs use `walletHolderInputFromStore`, retaining the existing nullable lookup and holder schema validation without changing its historical selection or timestamps. It does not add new analysis credit or reinterpret missing holder data.
- Activity summaries retrieve the same mint-scoped wallet receipt before the existing parser/summary. Missing wallets remain unknown.
- Raw holder/wallet evidence responses retain the original serialized data field order/shape, hash identity, 404 behavior and no-store headers. Existing routing/authorization/loopback/production-exposure boundaries remain in place.

The original four methods, history cutoffs/order/ties/selection, byte ceilings and frozen hash semantics remain unchanged. Source inspection now finds only the existing INSERTs outside the read-store module for these two table names. Account/ordinary transaction evidence, profiles, checkpoints and other tables retain their current D1 contracts; they were not removed from the capacity copy.

## Admitted frozen absence versus missing objects

The offline encrypted implementation first performs the exact-hash/mint lookup against the **fully admitted frozen metadata population**. No matching row returns null for that snapshot only. This does not prove absence from the chain, current live store or market and grants no clean/organic/safety credit. Every admitted reference/catalog population and final file pin still has to match the original source.

If matching metadata exists, the adapter requires its original descriptor and resolves the original authenticated payload. Missing/corrupt ciphertext, wrong keys, invalid proofs and changed metadata throw; none is caught and converted into null. Existing direct resolver calls for an unknown reference still hold with `no_absence_proof`. This distinction preserves legacy nullable D1 lookup behavior without suppressing storage failures or weakening selected-object verification. No plaintext payload cache or original-database fallback is added.

## Complete real-data parity

The v2 private comparison retains the original 188 history/acquisition cases and adds every holder/wallet raw receipt plus retained candidate wallet/holder continuation outcomes. Candidate bodies are iterated one at a time with a 1,900,000-byte guard and a complete-count check; the 1,000-candidate, 10,000-receipt, 2 MiB report and existing resolver work bounds remain. Minimal legacy synthetic fixtures explicitly report when the candidate-payload column is absent; the real full-schema archive must exercise candidate continuations. Rejected continuation results retain exact error-name/message hashes in the denominator.

The real comparison uses the original 21 October archive and the exact metadata/reference files restored by 121, with the original sealed pack and the key recovered by 120. This is the same frozen historical population, not current coverage or a new source observation.

| Comparison scope | Result |
|---|---:|
| History/acquisition/participation/trade cases | **188 / 188 identical** |
| Original raw holder/wallet rows | **958 / 958 identical** |
| Retained candidate continuation cases | **480 / 480 identical**, no held cases |
| Total authenticated payload resolutions | 1,482 |
| Raw payload bytes resolved | 1,286,353,387 |
| Encrypted payload bytes read | 233,491,255 |
| Plaintext payload cache entries | 0 |
| Provider requests / database writes | **0 / 0** |

The continuation population includes retained candidate modes and candidates with no referenced analysis; their original null behavior remains. Counts are not distinct newly observed tokens or newly completed wallet jobs. The original 188 per-case input/report results are unchanged from 122. Full raw lookup compares complete row hashes containing the original payload strings; no normalized replacement is used. All raw reference rows remain authenticated against original source/catalog/proof pins.

Private final report: `.tmp/evidence-read-parity-20261022-002/read-parity.json`, SHA-256 **`564177aa8cc139ee35f835410ca638af16a6553ed6548560182ed580437a3e36`**. The v1 report remains retained. Original archive/capacity/reference/sealed pins remain those documented in 118–122; no evidence/key file is moved or overwritten. The final one-at-a-time candidate enumeration is additionally checked against the report's complete frozen candidate order/count and byte bound.

## Verification and next implementation

Six new offline integration cases cover full raw rows, optional mint scope, no-resolution absent rows, unchanged wallet continuation replay/asset checks, nullable holder-cycle inputs, corrupt-object rejection, complete report populations and malformed stored holder bodies. Two new actual Worker tests cover exact legacy response serialization/status/headers and activity-summary parity with zero provider calls/writes. Existing fixtures validate original holder objects without rebuilding their JSON property order before hashing. Existing replay, source and security suites remain required.

All **1,397 Discovery tests across 94 files** and **13 offline read-store tests** pass (**1,410 total**), plus Discovery/app and scoped tooling typechecks. Security preflight, existing thesis-only built closure, original 1,732 live hashes/foreign keys, original/restored artifact pins, private ignored/untracked status, actual credential/key exclusion and whitespace pass separately. No new frontend build or hosted CI result is claimed. Existing security CI runs the expanded read-store suite and now includes the actual Worker response/activity compatibility tests; no new workflow/dependency/service is needed.

The isolated Worker dependency build includes only the D1 implementation, retaining its existing `node:crypto` external; the offline adapter/SQLite/filesystem dependencies stay out of that graph. This is compilation/import-boundary evidence, not a new runtime deployment, workerd CPU certificate or public serving acceptance.

Next: specify and test compatible append/write publication, preserving original transaction atomicity, failed/spent allowances, immutable collisions and recovery authority; then design fenced stopped-owner adoption/rollback with a usable target. The stripped capacity schema remains unusable as the whole application's store. A local read adapter is not the production encrypted backend. Private/root/generation authorization, independent off-device custody/loss recovery, later chronological growth and actual shared account Free/read/write/CPU/storage acceptance remain open. Continue ordinary admitted broad-token observation and participation qualification alongside those engineering prerequisites.

Original data, model-v4, source/provider/research limits, action/election/financial gates and thesis-only production closure remain. No source collection, live mutation, quota reset, migration, restart, evidence deletion, runtime adoption, spending or deploy.
