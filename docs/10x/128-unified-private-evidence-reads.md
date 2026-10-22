# 128 — Unified private evidence reads

22 October 2026. Continues [127's fenced publication coordinator](127-fenced-metadata-publication.md). The offline Node adapter now implements all six `EvidenceReadStore` methods across original frozen receipts and newly published encrypted receipts. Application D1 remains the default. This is one compatibility step toward affordable storage; no runtime adoption, source collection or deploy occurs.

## Delivered contract

`scripts/lib/evidence-publication-read-store.ts` takes a fully admitted frozen resolver, an independently pinned publication target/stage and a fixed generation/owner/epoch grant. It opens the target read-only through bounded, explicit index/receipt selectors. It exposes no caller SQL and performs no metadata writes.

Original rows retain their original catalog/Merkle authority. The resolver's new `receiptIdentity` returns immutable metadata, byte length and complete row hash from the fully admitted catalog; null means absent from that frozen population only. Existing `describe`/`resolve` unknown-reference errors remain unchanged. The adapter checks the publication header's capacity/archive/reference pins against that source and compares every selected base identity exactly. It also checks the original frozen index prefix, or the original exact-hash identity, against the target. Deleting frozen metadata and its base binding therefore cannot silently shorten a selected index or convert the original receipt to null. Original holder/wallet index limits are 97/2; insertion cannot require a frozen row outside the original selected prefix to enter those merged limits.

New rows authenticate their encrypted staged descriptor against the pinned stage ticket, original metadata, byte length and complete row hash. The new `describeStagedEvidenceAppend` reads at most the existing 65,536-byte descriptor bound without reading/decompressing payload bodies. Missing/corrupt bodies do not disappear from indexes; selected body reads still authenticate ciphertext, bounded decompression, raw payload identity, receipt/body consistency and complete row hash. No raw payload cache is introduced.

Holder ordering remains `observed_at, slot, payload_hash`, with inclusive start/cutoff and limit 97. Wallet ordering remains newest `observed_at DESC, payload_hash DESC`, with inclusive bounds and limit two. Holder duplicates retain the first observation time and original reference. Payload lookups require exact authenticated metadata and a safe nonnegative byte bound. As in the earlier frozen adapter, this includes checking the caller's byte count, a stronger guard than D1's SQL predicate alone. Raw receipt responses preserve original fields, property order, payload bytes and optional mint scope; their metadata does not acquire index-schema acceptance merely by being stored.

Unknown exact-hash lookups and wrong-mint/byte/metadata matches return null without resolving a body. Null describes the admitted frozen population plus the currently owned local publication namespace. It is **not a global or hostile-host absence proof**: as in 127, mutable private SQLite authority is trusted in this prototype. Selected orphan metadata/references, overlapping authority, altered identities and missing/corrupt selected objects hold. Malicious deletion of both dynamic metadata and its reference is not certified absent by an authenticated append-only journal.

Each operation reselects its metadata and checks the same grant after asynchronous authentication/decryption, before returning. Ownership transfer, selected-reference changes and a concurrent append changing the selected index withhold that operation's result. This is a conservative consistent-read hold, not a retry or allowance refund. Separate index/payload calls remain separate operations; no cross-call transaction, ownership lease or production authentication is claimed. Original frozen-session final file/key checks still gate release from the enclosing resolver.

## Verification

Run `pnpm test:discovery-publication-read`: **20 cases** cover both base/new receipt types and all six methods, exact D1 comparison, source/target immutability, inclusive bounds/ties/97-and-two limits, first holder time, missing/corrupt descriptors/bodies, no body resolution for rejected matches, frozen baseline deletion, orphan/overlapping authority, changed identities, foreign metadata/invalid bounds, NUL/Unicode raw metadata, source substitution, stale owners, ownership changes during descriptor/body IO and concurrent append selection changes. A dedicated ordering regression verifies that the last owner check follows all asynchronous file IO for both an index and a decrypted receipt. Review moved descriptor authentication ahead of the final SQL fence; repeating it after that fence could otherwise outlive ownership. Synthetic fixtures apply the complete migration schema; their private inserts are storage exercises, not qualified observations.

Also rerun: **29 publication, 32 staging, 13 original encrypted-read and seven historical scratch replay cases** — **101 distinct cases** in total — plus `pnpm exec tsc --noEmit -p tsconfig.evidence-scratch.json`. CI includes the new suite and scoped types. No production source, migration, dependency, provider/research limit, scoring model or feature flag changes. Earlier full Discovery results are not represented as a new full-suite run.

Security preflight/blocklist, existing thesis-only built closure and the original live row-hash/foreign-key checks pass. Final code rechecks the smallest/largest four frozen holder/wallet receipts through all six methods, with eight authenticated resolutions and unchanged target bytes. Every original typed value across all 83 tables / 39,408 rows still matches the pinned capacity inventory. Actual credential/key-byte exclusion passes for the 19 scoped files, five private proof/target artifacts and 66 existing built assets; private artifacts/keys remain ignored and untracked. No fresh frontend build, hosted CI result or production runtime acceptance is claimed.

## Frozen full-population comparison

The reusable existing parity runner accepts an offline store factory and labels injected comparisons explicitly. `scripts/discovery-evidence-publication-read-study.ts` binds it to this adapter and the independently pinned 127 authority report/current grant. It reads the existing private publication target, compares every original receipt, candidate continuation and predetermined per-address history/acquisition/participation/trade outcome to original D1, then checks target/header/report hashes again. Held outcomes compare complete error fingerprints; matching absence or a shared boolean alone is insufficient. Only the new private output reports are written; existing target/source files are read-only.

```text
pnpm exec tsx scripts/discovery-evidence-publication-read-study.ts
  ARCHIVE ARCHIVE_PIN CAPACITY CAPACITY_PIN REFERENCES REFERENCE_PIN
  SEALED KEY PUBLICATION_TARGET TARGET_PIN STAGE CONTEXT_PIN
  AUTHORITY_REPORT AUTHORITY_REPORT_PIN NEW_PRIVATE_OUTPUT
```

Use 127's existing target/pins and current authority report, 126's stage/pin, and restored-key/source paths. `NEW_PRIVATE_OUTPUT` must be a new immediate `.tmp` child; existing artifacts are never overwritten. This comparison uses base duplicates from 127 and does not invent new real observations. Mixed newly published rows are exercised by the synthetic suite.

| Rehearsal result | Value |
|---|---:|
| Original exact raw receipts, all identical | **958** |
| Original candidate continuation cases, all identical | **480** |
| Predetermined history/acquisition/participation/trade cases, all identical | **188** |
| Held history / continuation cases | **0 / 0** |
| Authenticated payload resolutions / raw bytes processed | **1,482 / 1,286,353,387** |
| Cached plaintext payloads | **0** |
| Provider requests / database writes / runtime activations | **0 / 0 / 0** |
| Existing publication target/header/authority report changed | **No** |

Private report: `.tmp/evidence-publication-read-study-20261022-001/publication-read.json`, SHA-256 **`3a5faedf9e1026e2a24e0a1d07d51662ed5aad0490950cb649a4e50390c265d9`**. Its complete `read-parity.json` SHA-256 is **`3a0fa0c19758f24856f59957541c60ba4f8d2e36325627f50c88243bd1eb4e7c`**. The original private target SQLite SHA-256 remains **`c7f024df051272e9f065aa046f2fa8f281de944d3a42c1ad1a2032f50456d4fc`**. These are semantic/immutability proofs, not a production throughput or Free-cost measurement. The full frozen comparison is supplemented by the final fence-order regression and final-code smallest/largest selected reads.

The implementation follows the [Node SQLite API](https://nodejs.org/api/sqlite.html) and [SQLite transaction documentation](https://www.sqlite.org/lang_transaction.html). Local SQLite results do not certify Workers/D1 CPU, remote latency, shared account Free entitlement or power-loss recovery.

## Remaining delivery boundary

Next adapt and compare all three original producer batches against the isolated target, preserving SQL/result positions, failure pacing, spent allowances, lost-acknowledgement reconciliation and separate post-commit cohort work. Then prove whole-target read/write compatibility, fenced **new-generation** handoff and stopped-owner adoption **and rollback** without reactivating historical sessions. This adapter does not make the stripped metadata schema a usable whole-application backend.

Independent off-device custody/loss recovery, ordinary later chronological archives/growth, orphan retention, private/root authorization and actual read/write/storage/CPU/shared Free acceptance remain open. Broad admitted F1 observations, qualified organic-volume/holder-growth F3 work and held-out F4 evaluation remain required. Model-v4, original evidence and all source/time/research/action/election/financial/release gates and thesis-only closure remain. No live mutation, quota reset, migration, restart, upload, spending, evidence deletion, runtime adoption or deploy.
