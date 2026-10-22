# 129 — Original producer batch compatibility

22 October 2026. Continues [128's unified private reads](128-unified-private-evidence-reads.md) and [127's fenced publication coordinator](127-fenced-metadata-publication.md). Adds an offline recorder and plan bridge for the actual candidate-save, wallet-snapshot and cached-wallet-replay batches. Application D1 and the three production writer functions remain unchanged. This completes a bounded synthetic producer-batch comparison, not whole-application storage adoption.

## Delivered bridge

`scripts/lib/evidence-producer-batches.ts` exposes `recordEvidenceProducerBatches(database, hooks?)`. Its `db` records preparation/binding while forwarding execution to the supplied **offline oracle** database. Non-evidence batches retain their original behavior. Exact holder/wallet receipt SQL is derived from the real `d1EvidenceWriteStore` through preparation without execution; no permissive recognizer or second copy of its SQL is introduced. Each bound statement has its own values, foreign statements hold, and returned recordings are defensive copies.

Only successful evidence batches are retained, with the original statement order, SQL, bindings and per-position change counts. The recorder holds at most 16 committed/in-flight batches and 32 MiB of SQL/string-binding bytes, at most 128 statements/100 bindings/16,384 SQL characters per statement and 10 MiB per captured batch. It reserves capture capacity before asynchronous hooks; unsuccessful oracle execution releases only that memory reservation. A post-success observer error does not erase the recorded SQL commit. These bounds apply to temporary private capture memory; they do not reinstate runtime research limits or alter provider allowances. Recordings include private raw bindings in memory and must not be logged or treated as a public cache.

`prepare(stage, {publicationId, stageId, statements})` requires exactly one canonical receipt statement with the original binding layout. It replaces that position with the coordinator's receipt operation and preserves every other SQL/binding position exactly. The coordinator now exports its existing plan validator, so identifiers, allowed tables, SQL/binding/operation/aggregate limits are checked **before** object staging. Invalid/foreign/multiple receipt layouts, quota writes and forbidden SQL cannot create stage files. Staging still verifies raw hash, bytes, body identity and observation metadata; no content is silently normalized or rehashed to make it pass.

The caller supplies stable publication and stage UUIDs. Exact retries reuse the verified stage and reconcile the same committed plan without reapplying producer SQL. Different logical observations use distinct publication IDs; identical holder content retains its first receipt time and original reference. The plan is submitted separately to `publishEvidenceAppend` under its original target pin and current generation/owner/epoch grant. Preparation grants no evidence or ownership authority. Source budgets, checkpoints, leases, failed-attempt pacing and cohort work remain the original caller's responsibility.

## Actual producer coverage

The suite calls the original `saveCandidate`, `runWalletCycle` and `replayLegacyWallets`; their SQL is not recreated in the fixtures. All migrations are applied. The wallet transport returns synthetic JSON locally, with real fetch forbidden; its logical calls still exercise the original quota reservations. Candidate saves include market/owner signals, immutable proofs, creation/graduation transaction bodies and account-state evidence in their original positions.

For comparison, a **test-only prerequisite copier** initializes the synthetic target's affected rows and already-spent allowances/claimed lease from the oracle immediately before its batch. It skips offloaded receipt payloads and never changes publication-authority/reference tables. This fixture setup is not a production SQL path, a relocation procedure, a quota refund or evidence of whole-target collection compatibility. Source-cache and checkpoint writes outside the captured batch still need an admitted complete backend.

Each successful batch preserves SQL/bindings, receipt position, complete change-count vector, every affected typed row and exact newly published raw receipt bytes. Source D1 and encrypted-target rows are compared directly. Candidate and wallet cohort tables stay unchanged until an **explicit separate callback** runs the original `captureCohort` on the stored, schema-parsed current candidate; resulting cohort bytes/hashes then match the oracle. Cached replay continues to leave cohorts untouched. A failed cohort callback reports `committed` SQL with `post_commit:failed`; retry reconciles SQL and runs the callback without replaying producer mutations or refunding allowances.

Cached replay's compare-and-swap result remains at position one. A zero-row update remains a committed batch with the original `wallet_snapshot_changed_during_replay` caller outcome; the bridge does not add a one-row expectation or relabel it a successful upgrade. All three producers also undergo a later-statement failure after receipt publication: target candidate/run/profile/work/reference/journal changes roll back together, while prior synthetic source allowances remain spent. Stale ownership after staging holds the complete plan and leaves the staged object unadmitted. Original SQL failures still propagate, retain rollback and produce no successful recording.

## Verification

Run from the repository root:

```text
pnpm test:discovery-producer-batches
pnpm exec tsc --noEmit -p tsconfig.evidence-scratch.json
```

The **15 cases** cover the three actual producer successes, three late-statement rollbacks, forbidden/preflight/binding bounds, independent rebinding/defensive snapshots, stale ownership, zero-row replay CAS, actual cohort failure/retry, original SQL failure, recording-count and concurrent in-flight bounds, and repeated actual candidate saves. CI runs this suite and the existing scoped type check. Related regression checks are the 35 original atomic-write/wallet cases, 29 publication cases and 20 unified-read cases: **99 distinct cases** in total. Earlier full Discovery test counts and 128's 958-receipt frozen comparison are not represented as fresh runs.

The final private synthetic transcript is `.tmp/producer-batches-20261022-129-final.tap`, SHA-256 **`1767a5bce22415f84b620f47f265adf392b371301480d4e37c1113fa4432578a`**: 15 passed, zero failed/skipped. Its scalar diagnostics record the actual ordered result vectors:

| Original producer | Operations | Receipt position (zero based) | Original and encrypted change counts |
|---|---:|---:|---|
| Candidate save, including transaction/account evidence | 11 | 2 | `1,1,1,1,1,1,1,1,1,1,1` |
| Wallet snapshot | 8 | 1 | `1,1,1,1,1,0,1,1` |
| Cached wallet replay | 7 | 0 | `1,1,0,1,1,1,1` |

All affected rows, separate cohort rows and raw new receipt bytes match; exact retries reconcile. The zero-change positions are retained, not replaced by success assumptions. The transcript is an execution record of synthetic data, not retained provider evidence, current market coverage, a frozen real write rehearsal or a Free/runtime certificate. The earlier 14-case transcript is retained separately rather than overwritten.

Security preflight/blocklist, the existing thesis-only built release check and original row-hash/foreign-key checks pass. Existing frozen read proofs, publication authority report and metadata target hashes remain unchanged. Actual credential/key-byte exclusion passes for the 14 scoped files, six private transcript/proof/target artifacts and 66 existing built assets; private keys/artifacts remain ignored and untracked. No fresh frontend build or hosted CI result is claimed.

The recorder follows the documented [D1 batch contract](https://developers.cloudflare.com/d1/worker-api/d1-database/) and [prepared-statement methods](https://developers.cloudflare.com/d1/worker-api/prepared-statements/). This checks local SQLite-backed D1-compatible execution; it does not certify native D1/object atomicity, power-loss durability, remote latency or Worker CPU limits.

## Next delivery

Build a whole-target read/write rehearsal with all non-receipt metadata/cache/checkpoint/cohort paths, explicit caller handling for SQL-committed/post-commit-failed outcomes, and durable publication/stage identity recovery after a process restart. Then prove a fenced **new-generation** handoff, stopped-owner adoption and rollback without reactivating copied historical sessions, leases or jobs. The recorder's oracle forwarding and synthetic prerequisite copying must never become a runtime storage adapter.

Cohort callbacks still need caller-owned current-owner checks and idempotence; the callback API is not a fenced cohort executor. An in-memory recording and caller-supplied UUID do not certify durable recovery or resolve unknown commit acknowledgements by themselves.

Private/root authorization, independent off-device custody/loss recovery, ordinary later chronological archives/growth, orphan retention and measured shared Free/read/write/storage/CPU acceptance remain open. Broad admitted F1 observations, meaningful organic volume/holder-growth F3 qualification and held-out F4 evaluation remain required. Original evidence/model-v4, all source/time/research/action/election/financial/release gates and thesis-only closure remain. No live mutation, collection, quota reset, migration, restart, upload, spending, evidence deletion, runtime adoption or deploy.
