# 133 — Receipt-free candidate metadata

22 October 2026. Completes the receipt-free live candidate-save branch following [132's holder-backed workflow](132-isolated-candidate-metadata-workflow.md). The original writer now runs both branches against the isolated target. Application D1 and every production/evidence/release gate remain unchanged; wallet/control/cache/checkpoint compatibility and whole-store adoption are still open.

## Distinct metadata plan and durable execution

`validateEvidenceCandidateMetadataPlan` defines an explicit `kind=candidate_metadata` plan with a retained publication UUID and ordered SQL operations. It has **no receipt, ticket or stage UUID**. The first operation must be the original live candidate insert shape with five bindings matching its JSON address/pool/time/mode. Subsequent writes are restricted to original proof, market-history, transaction-evidence and account-evidence inserts. Receipt/authority/quota/cohort tables, additional candidate mutations, comments, multiple statements and `RETURNING` hold. Existing statement/binding/count/10 MiB operation bounds remain.

The original `validateEvidencePublicationPlan` still requires exactly one authenticated receipt. It does not accept metadata plans. `validateEvidenceTargetPlan` explicitly selects one strict plan domain; unknown kinds or mixed shapes cannot fall through into a weaker receipt check. Plan hashes include the distinct shape/kind, and both domains share the existing publication-ID namespace. Changed same-ID or cross-domain plans hold rather than overwriting either durable intent or committed results.

The existing encrypted journal now reads either domain. Target/source/stage-context/generation pins, protected separate key, role-separated encryption, original grant, immutable file/readiness checks, file sync and final owner checks remain. A metadata plan still requires the authenticated target/stage context; it does not create or admit a staged body. Existing receipt plan/context/ciphertext bytes and SQL schema are unchanged. Older readers reject the new shape; they are not claimed to execute new metadata plans.

`publishEvidenceCandidateMetadataBatch` validates/snapshots the batch, persists its encrypted intent and only then publishes from the saved plan. The shared coordinator atomically commits original ordered SQL results and its publication journal under the in-transaction owner/generation/epoch fence. `recoverEvidenceProducerBatch` dispatches by the authenticated saved plan: original-grant publication can execute pending work; explicit current-owner read-only reconciliation requires an existing exact commit. No fallback to writes, replacement ID or quota refund occurs.

## Original candidate workflow

`saveCandidateOnEvidenceTarget` now accepts optional `holderEvidence` and `stageId`. When the original writer will append a holder receipt, a retained stage UUID is required. For a receipt-free save, omit `stageId`; supplying one holds rather than inventing a fake receipt identity. Fixture mode remains unsupported by this offline live workflow.

The unchanged production `saveCandidate` supplies the real SQL, immutable proof check, timestamp-aware candidate merge and separate `captureCohort` work. Its first batch goes through the appropriate durable publisher; later cohort statements retain 132's fixed, fenced transaction. No oracle/delegate or prerequisite copier participates in execution. Receipt-free updates leave holder/wallet receipt metadata, base references, dynamic references and staged-object population unchanged. Existing retained holder analysis is merged according to the original rules; this does not requalify missing/corrupt raw evidence.

Known SQL commit and post-commit failure remain separate. Explicitly retrying the same retained inputs/publication UUID under the original grant reconciles producer SQL and retries idempotent cohort work without reapplying producer writes. Unknown SQL acknowledgement remains held until explicit reconciliation. Pending former-owner work cannot execute under a replacement owner or a reused owner UUID at a later epoch. ID-only receipt-free SQL recovery works in a fresh process without original statements; complete candidate-argument reconstruction and replacement-owner cohort recovery remain open.

## Validation

Run from repository root:

```text
pnpm test:discovery-candidate-metadata
pnpm test:discovery-candidate-target
pnpm test:discovery-producer-publication
pnpm test:discovery-intents
pnpm test:discovery-publication
pnpm exec tsc --noEmit -p tsconfig.evidence-scratch.json
```

The new **15 cases** cover complete original receipt-free saves across all **87 synthetic tables' retained metadata values**, original cohort bytes/results, retained-holder/newer-field merge, exact retry, encrypted intent readiness before SQL, confidentiality, sync failure, late SQL rollback with spent allowances retained, unknown acknowledgement, actual original cohort failure/retry, plan/table/domain rejection, changed-ID-content holds, owner replacement/epoch reuse, corrupt intent retention, mutable caller inputs, direct coordinator scope/fencing and fresh-process precommit/postcommit stops. The original seven-operation result remains `[1,1,1,1,1,1,1]`, with no new receipt objects or references. Expected oracle output is captured first, then access is disabled while the target runs; no prerequisite copying occurs.

Existing holder-backed candidate (13), producer-publication (14), encrypted-intent (20) and coordinator (29) regressions add **76 cases**, for **91 distinct passing cases**, plus scoped types. CI includes the new suite. No fresh full Discovery suite, frontend build, native remote D1 result or hosted CI pass is claimed.

Four previously committed **legacy receipt** intents also reconcile in fresh read-only processes through the extended parser/dispatcher, with exact original result vectors and every existing target/journal byte unchanged. Private report `.tmp/candidate-metadata-compat-20261022-133.json`, SHA-256 **`1b4347586846ff1697c46a20c9d9b8e4a3f98d354d39a33d5c94599ddbd57d84`**, pins eleven final code/configuration files and all fourteen frozen journal files. It records zero provider calls, database writes or new observations. No metadata plan was published into this older frozen target; new metadata execution/restart behavior is verified by the synthetic suite.

Security preflight/blocklist, existing built thesis-only closure and original retained row-hash/foreign-key checks pass. Scoped credential/key-byte exclusion and ignored/untracked private-artifact checks pass. Original frozen target/capacity/proofs/journal remain private and unchanged. The [Node SQLite](https://nodejs.org/api/sqlite.html) and [crypto](https://nodejs.org/api/crypto.html) implementation is tested locally; this is not remote D1/object atomicity, power-loss/off-device recovery, runtime authentication, billed CPU or shared Free acceptance. Existing artifact bounds remain; concurrent memory, growth and operational costs still need qualification.

## Next delivery boundary

Implement isolated **wallet/control/cache/funding-checkpoint reads and writes**, retaining original spend-before-call allowances, lease fencing, failure/backoff behavior and caller result handling. Qualify complete wallet/replay workflows without oracle forwarding or prerequisite copying. Then prove fenced **new-generation** handoff and stopped-owner adoption **and rollback**, without reactivating historical sessions, leases or jobs.

Private/root authorization, off-device custody/loss recovery, durable cohort completion, replacement-owner workflow recovery, chronological growth/orphan/intent retention and measured shared Free/storage/read/write/CPU acceptance remain open. F1 broad admitted observations, F3 organic volume/meaningful holder growth and F4 held-out evaluation remain required. Original evidence/model-v4, provider/research allowances, every source/evidence/time/action/election/financial/release gate and thesis-only closure remain. No live changes, collection, quota reset, migration, restart, upload, spending, evidence deletion, runtime adoption or deploy.
