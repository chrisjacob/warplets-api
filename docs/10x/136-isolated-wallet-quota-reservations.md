# 136 — Isolated wallet quota reservations

22 October 2026. Implements the original wallet-subset/shared-RPC reservation helper against the isolated evidence target, following [135's cached funding continuation](135-isolated-cached-funding-continuation.md). It preserves spend-before-call accounting without making a provider request. This is offline counter compatibility, not a runtime switch, Free entitlement or source permit. D1 remains the application backend.

## Exact paired reservation contract

`wallet_quota` is a separate strict plan domain with one operation: either the exact original wallet-daily increment or the exact original shared-RPC increment. Both retain their original `RETURNING used`, conflict predicate and one-unit accounting. No generic `RETURNING`, market/catch-up operation, quota reset/refund, lease write, receipt or stage UUID is admitted. Day and positive safe-integer limits are bound to the fixed SQL parameters; invalid dates, changed operators, extra statements/expectations and mixed domains hold before IO. These supplied limits reproduce operator settings in an isolated experiment; they do not alter any production/provider/research limit.

Both plans retain the same two distinct caller-supplied publication UUIDs, day and limits. A reused wallet identity cannot be paired silently with a fresh RPC identity or changed cap. Within the fenced SQL transaction, a new RPC increment requires the exact successful wallet publication under the same generation/owner/epoch and matching paired plan hash. A missing, declined, foreign-domain or differently owned parent holds without an RPC charge. The original wallet charge remains spent if the shared RPC reservation fails or is declined; the two increments are intentionally not combined into a transaction that refunds it.

Encrypted intent readiness still precedes SQL. Native statement iteration drains the fixed `RETURNING` result before committing. A committed result retains either one strict `{used}` row and `changes=1`, or an empty result and `changes=0`. Values must be positive safe integers within the paired cap. **Only this quota domain accepts a returned row**; receipt, candidate metadata and cached-progress plans still require their exact original empty result arrays. Existing journal version, cryptographic context, schema and old ciphertext bytes remain unchanged.

Reconciliation validates both the stored quota result and, for RPC, its retained successful parent using the **original commit's** ownership. This permits current-owner read-only recovery after a transfer without authorizing execution of former-owner pending work. A missing/corrupt parent/result holds; nothing is reconstructed or recharged. Cross-domain and same-ID changed plans retain the existing immutable-ID conflict behavior.

## Original helper and explicit outcomes

`reserveWalletQuotaOnEvidenceTarget` invokes unchanged `reserveWalletQuota`, which invokes unchanged shared `reserveQuota`. Its private adapter accepts only the exact wallet-then-RPC `.first()` sequence and uses `publishEvidenceWalletQuotaBatch` for each saved plan. There is no generic database handle, oracle delegate, source transport, lease acquisition or collection path. Inputs/limits/IDs/authority are snapshotted before asynchronous work.

`reserved` means both recorded counter operations returned the original accepted rows. `rejected` retains the original `SourceError` code and UTC day-boundary retry delay, including the sixty-second floor. A wallet rejection does not attempt the shared reservation. `held` means preflight/publication/acknowledgement did not establish a complete reservation result; inspect phase and each publication outcome. Lost acknowledgements stop the sequence before any provider work. A committed empty row set is a known declined reservation, not a SQL error or permission to retry under a replacement ID.

Exact same-pair/day/limit retry under the original grant recovers immutable results without a duplicate charge and can finish an interrupted second counter operation. Explicit known-ID recovery also works without helper arguments. Neither a retry nor read-only reconciliation creates a **new** request permit: every wrapper outcome retains `source_authorized=false`, zero provider requests and all runtime/action/evidence/Free acceptance flags false. A future provider-backed caller still needs admitted scheduling, lease, source and dispatch handling; this counter prototype must not be connected directly to transport.

## Validation

```text
pnpm test:discovery-wallet-quota-target
pnpm test:discovery-wallet-cached-target
pnpm test:discovery-intents
pnpm test:discovery-candidate-metadata
pnpm test:discovery-producer-publication
pnpm test:discovery-publication
pnpm exec tsc --noEmit -p tsconfig.evidence-scratch.json
```

The new **23 cases** and **101 related regressions** pass: **124 distinct cases**, plus scoped types. CI includes the new suite. Six original-helper cases match all **87 synthetic tables' retained metadata values**: empty day, last unit, wallet exhaustion, RPC exhaustion, both exhausted and new-day accounting without changing yesterday. The two offloaded raw columns are outside this metadata comparison; no raw receipt is modified. Expected original execution is captured first and original database access disabled while the target runs. No oracle forwarding or prerequisite copying occurs.

Tests cover immutable paired retries, out-of-order/declined/foreign parents, original wallet spend retained after RPC failure, distinct new attempts up to the cap, late SQL failure, lost wallet/RPC acknowledgements, readiness failure, owner transfer, original-owner pending holds, strict day/cap/provider/SQL/result validation, mutable caller inputs and stale pins/grants. Fresh processes stop after synced readiness and after SQL commit; known-ID recovery returns the exact original row without duplicate SQL. Missing-parent and cross-domain result corruption also hold during read-only recovery. Private final transcript `.tmp/wallet-quota-target-20261022-136-001.tap`, SHA-256 **`151b010e29609b60c185d783f0b72f9cfe553c0388d154d6087dc2e3af3b8c21`**, records all twenty-three new cases.

Four legacy receipt intents reconcile read-only in fresh processes with all old target/journal bytes unchanged. Private report `.tmp/wallet-quota-compat-20261022-136.json`, SHA-256 **`4e97b5db4951b056e14dfa8bf1720aa1b5eef80057941734fdf88a8448e2e206`**, pins ten final code/configuration files and all fourteen original journal files. No quota plan is published into the frozen original store, and no real allowance is consumed. Security preflight/blocklist, existing built thesis-only closure, retained row-hash/foreign-key checks, actual credential/key-byte exclusion and ignored/untracked private-artifact checks pass. Original capacity, target, proof and journal artifacts remain private and unchanged. No fresh full Discovery suite, frontend build, native remote D1, hosted CI, production authentication, off-device/power-loss recovery or measured shared Free/storage/CPU acceptance is claimed.

## Next delivery boundary

Complete wallet control acquisition/lease fencing, catch-up reservations, failure/backoff and provider-backed dispatch/caller handling, transaction-cache and ordinary direct/second-hop checkpoint writes. The full scheduler/wallet cycle, source permit/dispatch lifecycle and production quota adoption remain open. Then prove fenced **new-generation** handoff, stopped-owner adoption **and rollback** without reactivating historical owners, sessions, leases or jobs.

Private/root authorization, independent off-device custody/loss recovery, whole-workflow/durable cohort recovery, chronological growth/orphan/intent retention and shared Free/read/write/CPU admission remain open. Continue admitted broad F1 observations, qualified F3 organic volume/meaningful holder growth and prospective held-out F4 calibration. Original evidence/model-v4, all provider/research/source/evidence/time/action/election/financial/release gates and thesis-only closure remain. No live collection, quota reset, migration, restart, evidence deletion, spending, runtime adoption or deploy.
