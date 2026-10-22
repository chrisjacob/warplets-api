# 137 — Integrated cached wallet cycle

22 October 2026. Connects the unchanged original `runWalletCycle` to the isolated evidence target for an explicit mint whose funding work can continue entirely from authenticated retained receipts and transaction cache. This joins control checks, lease acquisition, planning, checkpoint advancement and completion/release in one original caller. D1 remains the application backend; this private Node adapter is not wired into maintenance or a Worker.

## Original cycle and target authority

`runCachedWalletCycleOnEvidenceTarget` snapshots the source, target, journal, append grant and request before asynchronous work. Inputs require an explicit mint, time, original enabled/limit settings, seven distinct retained control/completion publication UUIDs and retained per-wallet/anchor checkpoint UUIDs. The original scheduler still creates its own fresh job UUID. That job, original acquisition bindings, six-minute expiry and mint are persisted in the encrypted lease intent before SQL executes. No receipt or stage UUID is invented for control writes.

Fixed native reads supply the original shared pause/backoff state, usage, selected candidate, attempts and current-evidence work rows. Existing admitted receipt/cache/checkpoint reads remain unchanged. SQL is fixed; callers cannot supply a query. Text reads preserve NUL and Unicode through BLOB decoding. Control strings are bounded at 4,096 bytes; attempts hold above 10,000 rows, 4,096 bytes per field or 16 MiB aggregate; the original twenty-row work selection holds above two million bytes per payload or 16 MiB aggregate. Lengths are checked before payload expansion. These are explicit private allocation holds, not changed provider limits or silent truncation.

Before acquiring the lease, the adapter uses the candidate already selected by the original active index, falling back to the original explicit-mint retained lookup. The original planner admits cached funding or its original cache-invalid/source-limited waiting outcome. Cached funding also requires authenticated prior evidence and all needed checkpoint identities before acquisition. An unsupported read cannot masquerade as a supported cache-invalid plan when the original planner catches an exception. Source-backed/unsupported planning holds. This preflight adds read-only work before the original lease; it does not copy oracle output or seed prerequisites after execution begins.

The distinct strict `wallet_cycle_control` domain admits exactly one of six original SQL statements: acquisition, pacing, release, failed-run insertion, failure release or failed-attempt pacing. Acquisition preserves the original expiry/due predicates and drains `RETURNING id` before commit. Only this exact statement accepts zero or one strict `{id:1}` row with matching changes. Quota plans retain their separate `{used}` contract; all other result arrays remain empty. A known job already in wallet runs or currently owning the wallet lease cannot be renewed through a new acquisition. This check is not a registry of every historical empty job or a whole-backend adoption certificate.

Every subsequent control plan requires the exact accepted lease publication, context hash and original generation/owner/epoch inside the fenced transaction. Its original owner-conditioned SQL still determines zero-row race results. Cached checkpoint/completion uses 135's unchanged domain and original guarded SQL. Recovery validates stored result shapes and generation; child reconciliation checks the parent's original committed ownership after append-owner transfer. Former-owner pending execution remains held.

## Outcomes and recovery

`completed` means the original scheduler returned. Inspect its `result.state`, error and every publication outcome: disabled, paused, waiting, empty, progressed and failed remain distinct. Late completion failure preserves an earlier checkpoint, rolls back all four completion statements and follows the original local failed-run/attempt/release path without a source call. `held` records the boundary where support, identity, authority or publication acknowledgement was not established. All outcomes retain zero provider requests and `source_authorized=false`; runtime/action/evidence/Free acceptance flags remain false.

Retain identities and recover known publication IDs explicitly. Fresh-process readiness recovery may execute the exact original-grant pending acquisition once; committed recovery is read-only. A recovered `{id:1}` is evidence of a past acquisition, not proof of a current lease or a request permit. Whole-cycle automatic retry/resumption is not certified: the unchanged scheduler generates a new job UUID, so rerunning it with old publication IDs conflicts rather than silently resuming. Do not reconnect transport, reacquire historical jobs, reset allowances or infer workflow completion from one recovered publication.

## Validation and preserved evidence

```text
pnpm test:discovery-wallet-cycle-target
pnpm test:discovery-publication
pnpm test:discovery-intents
pnpm test:discovery-wallet-cached-target
pnpm test:discovery-wallet-quota-target
pnpm test:discovery-producer-publication
pnpm exec tsc --noEmit -p tsconfig.evidence-scratch.json
```

The **22 new cases** and **109 related cases** pass: **131 distinct cases**, plus scoped types. CI includes the new suite. Two complete original cycles, covering pending and terminal-marker cache recovery, match all **87 original synthetic metadata tables** with ordered changes `[[1],[1],[1],[1,1,1,1]]`. Eight additional original guard/outcome cases also match all retained table values: disabled, paused, shared backoff, busy lease, expiry equality, not due, empty mint and invalid cache. Original execution is captured first; target execution has no oracle forwarding or prerequisite copying. Offloaded raw columns are outside this metadata comparison; no original receipt is modified.

Other cases cover pre-lease source holds, retained identities, late completion failure, lost lease acknowledgement, parent/grant ownership, exact SQL/time/result validation, NUL/Unicode, attempt allocation bounds, caller mutation and stale grants. Two fresh processes stop after synced readiness and after SQL commit, then recover the original lease result without original workflow arguments or duplicate acquisition. The failure case asserts retained checkpoint/failed-turn effects; it is not a separate full-table oracle failure comparison. Work byte bounds are implemented but not claimed as separately exhaustive maximum-allocation coverage.

Private final transcript `.tmp/wallet-cycle-target-20261022-137-002.tap`, SHA-256 **`78f69c065f4b431ce370dc9f60bbe3208c40264e593deb27f5faec7facaffe98`**, records the 22 cases against the final adapter. Private compatibility report `.tmp/wallet-cycle-compat-20261022-137.json`, SHA-256 **`26786d157ff4ae9f3b072fc507e767fecc7c8b695b050937ec50e44572ceb63f`**, pins ten final code/configuration files and all fourteen original journal files. Four legacy receipt intents reconcile read-only in fresh processes, with frozen target/journal bytes unchanged. No new cycle plan is inserted into the original frozen target.

Security preflight/blocklist, existing built thesis-only closure, retained row-hash/foreign-key checks, actual credential/key-byte exclusion and ignored/untracked private-artifact checks pass. Original target, capacity, journal and prior proof artifacts remain unchanged. No full Discovery/frontend rebuild, hosted CI, remote D1, production authentication, off-device/power-loss recovery, new real observation or shared Free/storage/CPU certification is claimed.

## Next integrated boundary

Complete the ordinary source-backed path's transaction-cache and direct/second-hop checkpoint writes, catch-up reservation/failure-backoff mutations and source-permit/dispatch/caller outcomes. Then exercise the original provider-backed cycle against admitted recorded transport and its existing quotas before any live integration. Keep automatic candidate selection and durable whole-workflow recovery explicit rather than treating this explicit-mint experiment as universal coverage.

F5 stays partial until fenced new-generation handoff, stopped-owner adoption and rollback, private/root authorization, protected-key/off-device recovery, chronological growth/retention and shared Free/read/write/CPU admission are proven. Continue ordinary admitted F1 breadth, F3 organic volume/meaningful holder growth and prospective held-out F4 calibration. D1/model-v4, source provenance, original evidence/hashes/cohorts/elections, spent allowances, all provider/evidence/time/action/financial/release gates and thesis-only exposure remain. No live collection, runtime adoption, spending, quota reset, evidence deletion, restart, migration or deploy.
