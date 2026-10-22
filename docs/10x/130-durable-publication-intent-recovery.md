# 130 — Durable publication intent recovery

22 October 2026. Continues [129's original producer-batch bridge](129-original-producer-batch-compatibility.md). Adds encrypted on-disk publication intents and explicit read-only reconciliation across a process restart. Application D1, production writers, original evidence and every release/evidence gate remain unchanged. No runtime storage adoption occurs.

## Delivered recovery contract

`scripts/discovery-evidence-intents.mjs` creates a **new immediate `.tmp` child** for a journal. Its independently pinned, authenticated context binds the publication target pin, stage pin, generation, original source archive/reference pins and random salt. The existing protected evidence key stays outside the journal. Separate HKDF roles authenticate the context and derive each publication's AES-256-GCM plan key; this does not reuse payload/descriptor encryption keys. Context/target/stage/key substitutions hold.

`persistEvidencePublicationIntent` validates the complete coordinator plan and staged receipt, then writes an encrypted `intent.bin` and a small `ready.json` **exclusively**, syncing each file before acknowledgement. The encrypted body retains the original generation/owner/epoch, exact normalized operation/binding order, publication UUID and original staged ticket/UUID. SQL/private bindings are not written as plaintext journal payloads. The coordinator's existing operation/SQL/binding/aggregate limits remain; serialized intents have an additional 16 MiB file bound, fixed-size reads and file-growth checks. These are offline artifact bounds, not provider or research limits, and do not certify peak RAM or Worker CPU.

Callers must retain the journal context pin, publication ID, independently pinned target/stage configuration and protected key reference. Recovery looks up a **known** publication ID; it does not enumerate an authoritative population, prove global absence or invent a replacement ID. Identical persistence retries verify/reuse the existing bytes. Changed same-ID plans or original grants hold; incomplete/corrupt existing files are never overwritten, repaired or treated as absent. Partial artifacts remain unadmitted for later explicit recovery/retention decisions.

`readEvidencePublicationIntent` authenticates and validates the saved plan and checks current target ownership again after file IO, before returning it. Each operation snapshots its supplied grant so mutating a caller object during IO cannot silently adopt a replacement owner's authority. Reading a plan grants no new evidence or execution rights. Stage ciphertext/body/hash verification still happens before SQL publication or reconciliation.

`publishStoredEvidenceIntent` may execute only under the **exact original grant**, including its epoch. The coordinator still fences the current owner inside the SQL transaction. `reconcileStoredEvidenceIntent` instead calls the new `reconcileEvidenceAppend`: it opens SQLite read-only, requires an existing exact committed publication, verifies its receipt/reference and returns original per-position results without executing producer SQL. A replacement current owner may reconcile a committed old plan; it cannot publish an old owner's uncommitted plan. Returning the same owner UUID at a later epoch does not revive it. New-generation transitions remain unimplemented.

SQL-committed/post-commit-failed outcomes remain separate. An explicit callback may be retried after reconciliation without replaying producer SQL or refunding prior source allowances. Callback execution is caller-owned, not a fenced or durably completed cohort executor. Local UUID/pin consistency is not production authentication. Mutable local authority and filesystem custody retain the private trusted-host boundary from 127–129.

## Process restart verification

Run `pnpm test:discovery-intents`. Its **20 cases** cover both receipt types, immutable persistence, confidentiality, fresh-process recovery after readiness, fresh-process reconciliation after SQL commit but before acknowledgement, replacement-owner pending/committed behavior, owner/epoch reuse, ciphertext/readiness corruption, GCM forgery with recomputed unkeyed hashes, source-context/key substitutions, changed same-ID plans, preflight/stage/escaped-JSON byte holds, partial-file process exits, growing-file bounds, ownership changes during decryption, grant-object mutation, path/key separation and post-commit retry.

The subprocess fault driver stops at named boundaries with `process.exit`; the next Node process receives retained paths/pins/grant and publication ID **without the original plan arguments**. Partial cipher and pre-readiness stops cannot publish or overwrite their artifacts. This proves controlled local process-boundary recovery. File sync plus these tests do **not** certify directory-entry persistence under power loss, portable filesystem durability, independent off-device recovery or production host custody.

The 29 publication, 15 original-producer and 20 unified-read regressions are also rerun: **84 distinct cases**, plus `pnpm exec tsc --noEmit -p tsconfig.evidence-scratch.json`. CI includes the intent suite. Earlier full Discovery/958-receipt comparison results are not represented as fresh runs; production source, config, dependency and provider/research limits remain unchanged.

Final private synthetic transcript: `.tmp/evidence-intents-20261022-130.tap`, SHA-256 **`ac1023e22ac2252bf085e91522d72aecca802c66a2a49d2fb5aa2cab09e29449`**. All 20 cases pass, with zero failures/skips. The earlier 19-case local run is not counted a second time.

## Frozen committed-plan reconstruction

`scripts/discovery-evidence-intent-study.mjs` accepts ten arguments:

```text
TARGET TARGET_PIN STAGE STAGE_PIN KEY
AUTHORITY_REPORT AUTHORITY_PIN STAGING_REPORT STAGING_PIN NEW_JOURNAL
```

It independently pins 127's authority report and 126's staging report, verifies the four original staged row hashes, reconstructs their **already committed** exact plans into a new encrypted journal and reconciles each in a fresh read-only subprocess. Existing metadata, staging files and source reports stay unchanged. Recovery configurations contain paths/pins/grant/ID, not original SQL plans or key bytes. No new observation or cohort callback is created.

This is historical committed-plan reconstruction, **not evidence that the original historical process persisted an intent before its SQL commit**. Actual precommit/postcommit-stop behavior is covered by the separate synthetic fault suite.

The four-case rehearsal passes: four fresh processes, identical plans/result vectors, zero provider requests/database writes and unchanged target bytes. Private report `.tmp/evidence-intent-study-20261022-001/restart-study.json`, SHA-256 **`e335232b11fa7afb09c9ca1137b51387ac4a9e1b72c87b508c3ceefe0d0be1af`**. Original target SQLite SHA-256 remains **`c7f024df051272e9f065aa046f2fa8f281de944d3a42c1ad1a2032f50456d4fc`**. Only the new private journal/recovery files and report are written; no original target is adopted or changed.

Final code reconciles all four again in fresh read-only processes, with every existing proof/target and all 14 new journal files byte-identical afterward. Security preflight/blocklist, existing thesis-only built closure and original row-hash/foreign-key checks pass. Actual credential/key-byte exclusion passes for the 13 scoped files, 19 private transcript/journal/proof/target artifacts and 66 existing built assets; no plaintext original SQL plan appears in the journal. Private keys/artifacts remain ignored and untracked. No fresh frontend build, hosted CI result or production acceptance is claimed.

The implementation follows current [Node filesystem](https://nodejs.org/api/fs.html), [crypto](https://nodejs.org/api/crypto.html) and [SQLite](https://nodejs.org/api/sqlite.html) documentation. Local process recovery is not native D1/object atomicity, remote latency, shared account Free entitlement or performance acceptance.

## Remaining delivery boundary

Next implement a complete isolated target path for all non-receipt metadata/cache/checkpoint/cohort reads and writes, including original caller handling for committed SQL with failed post-commit work. Integrate persist-before-execute intent discipline without oracle forwarding or synthetic prerequisite copying; keep returned SQL outcomes distinct from unknown acknowledgements and cohort completion. Then prove a fenced new-generation handoff and stopped-owner adoption **and rollback**, without reactivating historical sessions, leases or jobs.

Independent off-device custody/loss recovery, production private/root authorization, chronological growth, orphan/intent retention, complete source coverage and measured read/write/storage/CPU/shared Free acceptance remain open. F1 broad admitted observations, F3 meaningful organic volume/holder-growth qualification and F4 held-out evaluation remain required. Model-v4, original evidence, source/time/research/action/election/financial/release gates and thesis-only closure remain. No live changes, collection, quota reset, migration, restart, upload, spending, evidence deletion, runtime switch or deploy.
