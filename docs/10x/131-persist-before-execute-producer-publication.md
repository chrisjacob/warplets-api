# 131 — Persist-before-execute producer publication

22 October 2026. Continues [130's encrypted intents](130-durable-publication-intent-recovery.md). This completes the bounded offline **producer-batch execution** path. Non-receipt metadata/cache/checkpoint/cohort access and the application's D1 backend remain unchanged.

## Delivered contract

`scripts/lib/evidence-producer-plan.ts` extracts the recorder's plan construction into a standalone function. It derives exact holder/wallet receipt SQL from the unchanged production writer using preparation/binding only; it has no database, oracle or execution delegate. Both recorder and publisher use this implementation. Original SQL/bindings, receipt position, immutable holder first-time behavior, zero-row compare-and-swap results and coordinator/stage bounds remain.

`publishEvidenceProducerBatch(publication, journal, grant, batch, afterCommit?)` performs the complete sequence:

1. Snapshot configuration, original grant, caller-retained publication/stage UUIDs and ordered batch before asynchronous IO. Validate the coordinator plan before creating staged artifacts.
2. Authenticate and stage the receipt under that stable stage UUID.
3. Persist and verify the exact encrypted intent, including file sync of its readiness record.
4. Publish **from the saved intent**, through original-grant and in-transaction owner/generation/epoch checks. In-memory statements are never executed directly.
5. Return original per-position results after acknowledged SQL commit. Run optional caller-owned post-commit work afterward, preserving its independent completion/failure status.

The caller must retain both UUIDs, independent journal/target/stage pins and protected key reference before submitting. No ID is generated, replaced or guessed. Identical retries verify existing artifacts and reconcile original results. Changed same-ID plans hold without overwriting intents. Artifact, SQL and owner failures never create a successful D1 result vector or refund spent allowances.

`recoverEvidenceProducerBatch(..., {publicationId, mode}, afterCommit?)` requires an explicit choice: `publish` attempts the saved intent under its exact original grant; `reconcile` uses native read-only SQLite and can only verify an already committed matching publication. No original SQL statements are supplied. Replacement current owners can reconcile committed old publications, but cannot execute former-owner pending batches. Reusing an owner UUID at a later epoch does not revive its grant. Failed read-only reconciliation never automatically falls back to publication.

| Result | Meaning and caller action |
|---|---|
| `state=committed`, `post_commit=not_requested/completed` | SQL acknowledgement and exact original results are available; callback scope is explicit. |
| `state=committed`, `post_commit=failed` | SQL is committed. Explicitly retry suitable caller work through reconciliation; never relabel SQL as rolled back. |
| `state=held`, phase `preflight/stage/persist`, `sql_attempt=not_started` | This invocation did not enter SQL publication. This is **not proof that an earlier attempt with these IDs never committed**. Inspect retained identities; never invent replacement IDs. |
| `state=held`, phase `publish`, `sql_attempt=unconfirmed` | No success vector. Conservatively includes SQL rollback, failed stored-plan/owner checks and unknown acknowledgement. Reconcile the retained ID before deciding what happened. |
| `state=held`, phase `reconcile`, `sql_attempt=read_only` | Recovery could not establish an exact matching commit. No producer SQL executed. Retain the hold and original artifacts. |

Held results expose bounded generic codes, without SQL, private bindings or native filesystem diagnostics. Callbacks remain explicit caller-owned work: completion is not durable, retry is not automatic, and an arbitrary callback is not a fenced cohort executor. Exactly-once external effects are not promised. This is an offline outcome contract, not a fabricated full D1 response or application backend.

## Verification and limits

Run from repository root:

```text
pnpm test:discovery-producer-publication
pnpm test:discovery-producer-batches
pnpm test:discovery-publication
pnpm test:discovery-intents
pnpm exec tsc --noEmit -p tsconfig.evidence-scratch.json
```

The new **14 cases** exercise both receipt types without oracle execution or prerequisite-row copying, check the unchanged target at intent readiness sync and verify the original source file remains byte-identical. Coverage includes readiness-sync failure, late SQL rollback with spent allowances retained, actual post-commit/pre-acknowledgement fault injection, callback failure/explicit retry, invalid/substituted/changed plans, owner replacement/epoch reuse, mutable caller arguments, original zero-row CAS and fresh-process recovery after integrated readiness/commit stops. Subprocess recovery uses paths/pins/grant and a known ID without original batch statements.

The existing **15 producer cases** now run actual candidate-save, wallet-cycle and cached-replay success batches through this publisher and recover from stored intents. Exact changes vectors remain candidate `[1,1,1,1,1,1,1,1,1,1,1]`, wallet `[1,1,1,1,1,0,1,1]`, cached replay `[1,1,0,1,1,1,1]`; SQL/result/receipt positions, affected rows and separate original cohort results match. Those comparison fixtures **retain the oracle and synthetic prerequisite copier for expected pre-batch state**. Neither is called or accepted by the publisher. Complete original caller/backend compatibility is still open.

Coordinator and intent regressions add **29 + 20 cases**, for **78 distinct passing cases**, plus scoped types. CI runs the new suite. Production code, migrations, dependencies, model-v4, provider/research limits and all source/evidence/time/action/election/financial/release gates remain unchanged. Existing built thesis-only closure and original retained row hashes/foreign keys are checked separately. No fresh frontend build, full Discovery suite, native D1 runtime test or hosted CI result is claimed for this offline-only change.

The new recovery API also reconciles 130's four already-committed frozen plans in fresh read-only processes, verifying original result vectors and unchanged target/journal bytes. This is a historical **committed-plan read**, not a new observation, original historical precommit custody or new-generation adoption rehearsal. Private scalar report `.tmp/producer-publication-check-20261022-131.json`, SHA-256 **`61973b551c88c2fcb45de7710d21dedf8c72dd86bf2d12c7198dea88678c8e50`**. It pins the nine implementation/configuration files used for those reads, records four exact result vectors and zero provider requests/database writes/new observations, and retains every acceptance/authority flag as false.

Security preflight/blocklist, existing thesis-only built closure and original retained row-hash/foreign-key checks pass. Actual credential/key-byte exclusion passes for all 15 scoped files, 19 private report/journal/proof/target artifacts and 66 existing built assets. Keys and private artifacts remain ignored/untracked. These checks do not certify a clean dependency audit, a new frontend build or public release readiness.

File sync/process-exit tests retain the limitations of [Node filesystem](https://nodejs.org/api/fs.html) and [SQLite](https://nodejs.org/api/sqlite.html) semantics: directory-entry persistence under power loss, independent off-device custody and remote D1/object atomicity remain uncertified. Existing per-plan/artifact bounds are unchanged; aggregate concurrent memory, runtime CPU, shared Free read/write/storage costs and growth remain unqualified. Local pins/UUID fencing retain the private trusted-host boundary and are not production authentication.

## Next delivery boundary

Complete an isolated target path for **all non-receipt metadata/cache/checkpoint/cohort reads and writes**, including original caller handling of these outcomes. Remove oracle forwarding and prerequisite copying from whole-target qualification; never wire the recorder, publisher or stripped schema into the Worker as a backend. Then implement fenced **new-generation** handoff and stopped-owner adoption **and rollback**, without reactivating historical sessions, leases or jobs.

Private/root authorization, off-device custody/loss recovery, chronological growth, orphan/intent retention and measured shared Free/CPU acceptance remain open. F1 broad admitted observations, F3 organic volume/meaningful holder-growth qualification and F4 held-out evaluation remain required. Original evidence and thesis-only production closure remain. No live changes, collection, quota reset, migration, restart, upload, spending, evidence deletion, runtime adoption or deploy.
