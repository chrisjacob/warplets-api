# 143 — Durable captured post-commit cohort recovery

22 October 2026. Extends [142's private recorded workflow](142-recorded-automatic-wallet-selection.md) with encrypted, retained post-commit cohort publications. Candidate saves and explicit/automatic wallet snapshots can opt in with a distinct `cohortPublicationId`. The original producer commit and cohort transaction remain separate. D1 remains the application backend; no runtime or provider collection is activated.

## Publication and preservation

`publishEvidenceCohortBatch` admits the exact original `captureCohort` statements after the producer commits. It checks the current candidate against the captured assessment and replays the unchanged original cohort builder without executing SQL. Its strict `candidate_cohorts` plan embeds the original retained producer plan, a separate stable UUID, the original one-to-three ordered cohort statements and fingerprints of existing first-observation rows. Only live candidate-save parents and successful receipt-backed wallet-snapshot parents are accepted. Other metadata, control, quota and recursive cohort plans are rejected.

Encrypted intent readiness precedes cohort SQL. Execution requires the exact accepted parent publication hash, original generation/owner/epoch and result contract. Receipt-backed parents are authenticated and verified against their committed immutable reference; the parent cannot be executed by the cohort plan. Original SQL, bindings, assessment hashes, timestamp, eligibility policy and first-observation behavior remain unchanged. The plan uses the existing encrypted journal and target schema, without migration or receipt-format changes.

Each original daily cohort/wallet/selection key has a retained SHA-256 fingerprint or an absent marker. The transaction verifies these before SQL, then verifies the actual surviving rows against the original result vector before committing. A competing first writer after readiness holds rather than changing the retained result. Existing rows preserve their bytes and return their original zero-change results. Committed reconciliation also verifies the survivor: deletion, replacement or a self-consistently rehashed payload cannot be silently accepted as the original first observation. Bounded raw UTF-8 reads preserve original text bytes for these checks.

An identical retry reuses its exact existing intent and original fingerprints. It does not rebuild first observations from today's candidate. Partial, corrupt or incomplete readiness stays held; it is never overwritten or resealed automatically. A changed candidate after capture cannot refresh the saved historical assessment during known-ID recovery.

## Caller outcomes and recovery boundary

Candidate saves and explicit/automatic snapshot requests accept the optional distinct cohort UUID before producer work; duplicate identities hold. Existing callers without that opt-in retain their prior behavior. Durable callers report `cohort_publication` separately from the original producer, cohort and post-commit outcomes. A cohort failure or lost acknowledgement does not roll back committed source evidence. Inspect all outcomes; a successful producer does not imply a confirmed cohort.

The existing known-ID recovery path can execute a ready pending cohort under its exact original append grant or reconcile an already committed cohort read-only under the current owner. Ownership transfer cannot execute an old owner's pending work. Historical reconciliation grants no lease, source request, quota refund, qualification, action or runtime authority. It never calls the scheduler, collector or original producer again.

This closes recovery **after cohort capture and encrypted readiness**, including process exit before SQL and after commit but before acknowledgement. A crash after the producer commits but **before cohort readiness** still requires durable workflow progress to identify and capture the original post-commit job safely. Selection/progress is still in memory. Whole-turn automatic resumption, orphan discovery, explicit supersession and old-job acknowledgement handling remain open; do not approximate them by rerunning the scheduler, replacing IDs, reviving a lease or repeating source work.

## Validation

```text
pnpm test:discovery-cohort-publication
pnpm exec tsc --noEmit -p tsconfig.evidence-scratch.json
```

The focused suite has **24 cases**, and the fourteen related publication/candidate/wallet suites have **317 cases**: **341 distinct cases**, including 27 additions to the previous combined matrix. The focused suite covers original holder/metadata candidate parity across all 87 retained metadata tables, successful and zero-change first observations, late atomic rollback, acknowledgement loss, absent/changed parents, policy tampering, ownership transfer, partial readiness, first-writer races and committed survivor/result tampering. Fresh subprocesses stop after readiness or commit and recover using only the retained cohort ID. Three added snapshot/automatic caller cases cover original-table parity and independent cohort failure/recovery without repeating source or producer work.

The final focused transcript is private `.tmp/cohort-publication-20261022-143-001.tap`, SHA-256 **`24f6bfd6ddee28e6ebced998fea20a89495bc013d78b201fbfba677990cf5a87`**. The related transcript `.tmp/cohort-related-20261022-143-001.tap` has SHA-256 **`0fb2c92db52398aa22a8f0697611035721a98ba460235dac7b9d5b932eb76bd2`**. The private compatibility report `.tmp/cohort-publication-compat-20261022-143.json`, SHA-256 **`09bc4add14cf36e27b19a5505a349f7d718c524346cb94cc952e0df7f11377bd`**, pins all thirteen changed code/configuration files and all fourteen original journal files. Four legacy receipt publications reconcile read-only in fresh processes; the original frozen target and journal remain byte-identical. No new cohort is published in that frozen target.

Scoped types, security preflight/blocklist, original row-hash/foreign-key checks and the existing built thesis-only release check pass. Final credential/key-byte exclusion and ignored/untracked artifact checks preserve private custody. CI includes the new suite; hosted CI and a full Discovery/frontend rebuild were not run. Synthetic and previously recorded fixtures confer no new chain observation, market breadth, organic-volume qualification, scoring calibration, production authentication, off-device/power-loss recovery or combined Free/CPU acceptance.

## Next boundary

Persist original-job/selected-scope progress and the producer-commit-to-cohort-readiness transition, with explicit unknown acknowledgements, orphan handling and supersession. Then prove fenced new-generation handoff and stopped-owner adoption/rollback. F5/private/root/key/off-device recovery, chronological growth/retention and combined Free storage/read/write/CPU acceptance remain partial. Continue admitted F1 breadth, F3 organic volume/meaningful holder growth and prospective F4 holdouts alongside that work.

D1/model-v4, original evidence/hashes/receipts/cohorts/elections, spent allowances, all provider Free limits and source/evidence/time/action/financial/release gates, and thesis-only exposure remain. No live collection, spending, quota reset, evidence deletion, runtime adoption, restart, migration or deploy.
