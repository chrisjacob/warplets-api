# 146 — Durable cached-wallet job progress

22 October 2026. Builds the first durable original-job layer after [145's linked producer/cohort recovery](145-linked-wallet-snapshot-readiness.md). Private explicit-mint cached turns can now retain a job manifest before their lease attempt and reconstruct known progress read-only by its ID. This does not resume a scheduler or dispatch sources. D1 remains the application backend; automatic and source-backed job manifests remain outstanding.

## Retained job scope

`runCachedWalletCycleOnEvidenceTarget` accepts optional `progressId`. Retain that UUID before calling: a lost acknowledgement may leave durable readiness even when the caller did not receive `job_progress`. Reusing an existing manifest ID holds before another scheduler turn; duplicate identities and partial readiness also hold. Callers without the opt-in keep their original behavior.

After original cache-only admission, the adapter verifies the selected candidate against its current native row and retains an encrypted `wallet_cached_job` manifest before publishing the original lease intent or executing its SQL. The manifest captures the original scheduler-generated job/lease context, explicit mint, admitted cached/invalid/limited/empty stage, complete candidate byte hash, original wallet-source hash, unchanged wallet/RPC/market limits, seven control/completion identities and up to twenty original wallet/anchor checkpoint identities. No source body or replacement job is invented. Original admission, checkpoint/replay rules and SQL remain unchanged.

Manifest construction checks that its known publication IDs have no prior ledger commit or retained intent. Existing, partial or conflicting identities are rejected rather than adopted. Immutable publication identities, original owner fencing and job/role checks continue to hold races; this is not a new distributed reservation or permission system. Empty scope retains the requested absent mint with null candidate/source hashes. Original disabled/paused/backoff outcomes before a lease request do not create a manifest. An absent manifest is unknown progress, not proof that work was never attempted or permission to retry.

The strict manifest has an empty operations tuple and cannot enter any publication executor. Both journal publication and publication reconciliation reject it explicitly. It uses the existing authenticated encrypted intent context, protected key and readiness protocol; the journal version and SQLite schema are unchanged. Its own descriptor has a 256,000-byte bound. This is a data/resource bound, not a new research or provider quota.

## Read-only inspection

`inspectCachedWalletJob` accepts only `progressId` alongside the existing private publication/journal context and current grant. It never receives the original scheduler request, source callbacks or statements, and never falls back to publishing. A fixed native selector reads at most 28 declared IDs, with a 128 KiB result-JSON bound per ledger record. Queries use bound UUIDs; there is no caller SQL proxy or unbounded journal scan.

For each declared step, the inspector verifies the exact original grant, plan hash, role/domain, original job/mint/source and checkpoint wallet/anchor scope. Already committed steps use the existing authenticated read-only reconciliation and original result contract. The manifest itself must have no SQL publication record. Valid history belonging to another job cannot be adopted merely because its IDs were listed in a new descriptor.

Step states have deliberately limited meanings:

- `not_retained`: neither an intent nor a ledger commit was found; the original outcome remains unknown.
- `pending`: authentic readiness exists without a confirmed commit; this grants no execution permission.
- `committed`: original native reconciliation confirmed the retained publication/result vector, including zero-change results.
- `orphan_commit`: a known ledger ID lacks its original intent directory; it is unconfirmed and is never reconstructed automatically.
- `held`: damaged, partial, mismatched or otherwise unconfirmed history.

The summary reports `incomplete`, `lease_declined`, `finish_recorded`, `failure_recorded` or `unconfirmed`. These describe publication history, not successful execution of every SQL predicate, current ownership, evidence quality or permission. In particular, a legitimate zero-change finish remains `finish_recorded` with its original `[0,0,0,0]` result vector. Inspect the individual results.

The reader rechecks ledger headers/result hashes, manifest/step readiness and the owner fence before returning. A changed ledger snapshot, changed readiness or owner loss withholds all successful diagnostics. Individually damaged steps hold the job while retaining independently verified history when the final fence/snapshot remains consistent. A current owner may inspect a former owner's original history after transfer or lease expiry; `original_owner_current` describes the original grant only. All inspection outcomes have `current_authority=false`, `source_authorized=false`, zero provider requests and false runtime/action/evidence/Free acceptance flags.

Inspection performs no SQL publication, quota refund/reset, lease renewal, job revival, reselection, source dispatch, file repair, cleanup or supersession. It is the durable scope/inspection foundation, not automatic cached-turn resumption. Source-backed and automatic-turn progress, response consumption and whole-workflow reconstruction remain open.

## Validation

```text
pnpm test:discovery-wallet-cycle-target
pnpm exec tsc --noEmit -p tsconfig.evidence-scratch.json
```

The affected matrix has **409 distinct cases across sixteen suites**: the previous 386 plus **23 new cached-job cases**. The cached-cycle suite now has 45 cases. Two opt-in original turns, including legacy terminal-reader markers, match all retained columns across all 87 metadata tables with oracle access disabled. Fresh subprocesses stop after manifest readiness, lease commit, checkpoint commit and finish commit. A separate fresh process reconstructs progress with only the retained ID and private context, leaving database bytes unchanged.

The concurrent matrix initially passed 408 cases; the new finish-stop subprocess exceeded its 30-second test allowance under load. Only the new cached-job restart-test subprocess allowance was increased to 60 seconds, retaining exact expected exit-code assertions and adding timeout diagnostics. The complete affected 45-case suite then passes; all 364 other cases passed in the initial matrix with unchanged implementation. These two runs cover all 409 distinct cases. No application/provider timeout or limit changed.

Further cases cover ID reuse/duplication, partial manifests/steps, non-executable schema, known orphan commits, wrong-job scope, changed ownership, malformed/oversized results, replacement-owner history, ownership loss and ledger races during inspection, original zero-change finish results, busy/empty scopes and refusal to adopt prior IDs. Existing provider, quota, recovery, snapshot, candidate and cohort regressions remain part of the final matrix.

Private focused transcript `.tmp/wallet-job-focused-20261022-146-001.tap`, SHA-256 **`b76f076d9c8ba22237377f293b28ef44f2dbb1fc67641ea3957c179a32d9fcc7`**. Initial matrix transcript `.tmp/wallet-job-20261022-146-001.tap` (408 pass, one timeout), SHA-256 **`8c2c94b4033645c2c010c0576213f56c214a4915ea1117afaef87e9316bdc56b`**. Final affected-suite transcript `.tmp/wallet-job-cycle-final-20261022-146-002.tap` (45 pass), SHA-256 **`e0d337a0c75457caa4bd6810e0db56a6d742d9ceb11bd5f38e63af442ff74fe1`**. Final private compatibility report `.tmp/wallet-job-compat-20261022-146-002.json`, SHA-256 **`e721d65d1876a18bca6228b3c4d1a370f3aca09b7f2966616efd8358e4830fe0`**, pins all seven changed code files and all fourteen original journal files. Four legacy receipt plans reconcile read-only in fresh processes; the original frozen target and journal remain byte-identical. No new job manifest is written in that frozen target.

Scoped types, security preflight/blocklist, original row-hash/foreign-key checks and the existing built thesis-only release check pass. Final credential/key-byte exclusion and ignored/untracked artifact checks preserve private custody. Existing CI includes the expanded cached-cycle suite; hosted CI and a full Discovery/frontend rebuild were not run. Synthetic migrated metadata and old recorded inputs provide no new market breadth, organic-volume/holder-growth qualification or scoring calibration. Additional encrypted descriptors and bounded repeated reads have not been admitted for production Free/storage/CPU budgets, power-loss/off-device recovery or production authentication.

## Next boundary

Extend durable selected-job scope to automatic and recorded source-backed turns, retaining planning pins, original response/checkpoint/recovery identities and durable response-consumption progress. Preserve spend-before-call and unknown-acknowledgement semantics: recovered counters never permit another dispatch. Add explicit orphan discovery, supersession and expired-job handling before automatic resumption, then prove fenced new-generation handoff and stopped-owner adoption/rollback. F5/private/root/key/off-device recovery, chronological growth/retention and shared Free storage/read/write/CPU acceptance remain partial. Continue admitted F1 breadth, F3 organic volume/meaningful holder growth and prospective F4 holdouts alongside that work.

D1/model-v4, original evidence/hashes/receipts/cohorts/elections, spent allowances, all provider Free limits and source/evidence/time/action/financial/release gates, and thesis-only exposure remain. No live collection, spending, quota reset, evidence deletion, runtime adoption, restart, migration or deploy.
