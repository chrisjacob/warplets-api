# 139 — Integrated recorded direct-funding wallet cycle

22 October 2026. Joins [137's scheduler/lease integration](137-integrated-cached-wallet-cycle.md), [136's paired quota accounting](136-isolated-wallet-quota-reservations.md) and [138's ordinary data writes](138-recorded-funding-collection.md) around the original `runWalletCycle` **direct_funding** branch. An explicit-mint recorded turn now runs through planning, acquisition, catch-up, pacing, RPC decoding, checkpoint/cache progress, original continuation replay, work publication, atomic completion/release or original failure/backoff. The application still uses D1; no live source or runtime switch is enabled.

## Complete original branch

`runRecordedDirectWalletCycleOnEvidenceTarget` snapshots the strict request, source/target/journal and append grant before asynchronous work. Retain ten distinct control/work/completion publication UUIDs, an ordered vector for ordinary checkpoint/cache/unsupported-read writes and a distinct wallet/RPC publication pair for every supplied response. The original scheduler still generates its own fresh job UUID, stored with the lease intent before SQL. Duplicate identities hold before work; a missing ordered write identity stops that write without refunding earlier spend or undoing earlier progress.

The original shared pause/backoff, active index, retained explicit-mint lookup and planner run against fixed native reads and fully admitted authenticated old receipts. The adapter preflights the selected candidate using the original planner; only `direct_funding` is admitted to acquire a lease. Unsupported reads cannot be swallowed into an apparent supported plan. Disabled/paused/shared-backoff outcomes return before acquisition; a busy lease retains the original waiting result. Cached continuation remains available through 137's separate adapter. New snapshots, refreshes, reader-upgrade recovery and automatic selection are held here rather than partially executed.

After acquisition, unchanged `runWalletCycle` invokes unchanged `continueFunding`, which invokes unchanged `collectFundingHistories` and the original RPC decoder. This covers the original record/sample/byte accounting, finalized paging, cached reads, transaction identity/hash checks, terminal missing/unsupported markers, checkpoint persistence, temporary analysis replay and work-stage calculation. The original candidate wallet snapshot, timestamps, evidence hash, profiles and research cohorts do not become fresh. A temporary replay used to describe work is not a new eligible observation.

Recorded transport accepts only a bounded list of supplied genesis/signature/transaction HTTP bodies and expected method/parameters. It has no URL or fetch callback. Original HTTP/envelope/cluster/format checks remain. Every response uses fresh accepted wallet-then-shared-RPC reservations; a reconciled counter result stops dispatch. The original catch-up slot remains eighteen units inside the original allowance formula, capped at 180; normal wallet/shared quotas and their spent-unit behavior remain unchanged. Supplied positive limits reproduce operator settings only on the isolated clone; they are not an entitlement or permission to change real provider/research settings.

A new read-only dispatch check requires the exact accepted acquisition under the current append grant, the current wallet lease with strict expiry, matching candidate evidence hash, no pause and no active shared RPC backoff. It runs before each counter operation and again before returning a recorded response. A lease replacement after reservation withholds the response while preserving spent counters and the replacement owner. This added private admission check cannot authorize live transport. Ordinary checkpoint SQL still has its original predicates; append-owner fencing is not certification of a fully fenced production wallet runtime.

## Distinct direct-turn publication domain

`wallet_direct_cycle` binds the original acquisition context, source evidence hash and wallet/RPC limits. Every new plan requires its exact accepted acquisition parent under the same generation/owner/epoch inside the SQL transaction. It admits only:

- One exact original catch-up reservation, including eighteen-unit increment and original cap predicate.
- One original work upsert, ordinary unsupported-reader insert, shared rate-limit backoff update or failed funding-run insert.
- The original three-statement successful run/attempt/owner-conditioned release batch, atomically and in order.

Hashes, contexts, binding counts, source/mint/job identities, dates, counter/work bounds, pinned reader version, terminal outcome codes and the original SQL are checked. The TypeScript work publisher also uses the original work schema. The pre-existing domains still handle ordinary data writes, lease/pacing/failure release and paired quotas; their contracts are not broadened to accept this plan.

Only exact catch-up plans additionally accept zero or one strict `{used}` result, matching changes, eighteen-unit granularity and the original computed cap. Every other direct-turn result array remains empty. The original paired-quota and lease result contracts remain separate. Existing journal version, encrypted context and target schema remain unchanged.

Committed child reconciliation checks the acquisition parent's original committed ownership and generation, allowing current-owner read-only recovery after append-owner transfer. It never executes former-owner pending work or reacquires a historical lease. Fresh-process readiness recovery can execute one exact original-grant pending publication; committed recovery never reapplies SQL. Keep original known IDs and protected key references.

## Outcomes and failures

`completed` means the original scheduler returned; inspect `result.state`, its error/progress and every publication outcome. Original progressed/failed/disabled/paused/waiting results remain distinct. Progress can be `refresh_required`, partial or `source_limited`, and missing/unsupported bodies remain gaps. `held` identifies preflight/support/publication boundaries that did not complete. A successful publication is not proof of a successful turn or current lease.

Original rate limits persist shared backoff and failed-turn retry scheduling. Unsupported transaction formats record the actual reader with `is_recovery=0`, retain the terminal marker and avoid consuming upgrade-recovery allowance. Wallet spend survives shared-budget failure; catch-up reservations and source attempts survive later errors. A late completion error rolls back all three success statements, retains independently collected cache/checkpoint/work progress and follows the original failed-run/release/attempt path. An unknown lease acknowledgement stops the workflow. An unknown RPC-counter acknowledgement withholds dispatch and records the original caller's failure path; explicit known-ID reconciliation recovers counter history without another charge.

Whole-turn resumption is not implemented. The original scheduler creates a new job UUID and original helpers regenerate times; do not infer write positions, replace IDs or reuse past counter results to issue another request. Every wrapper outcome retains `source_authorized=false`, zero real provider requests and false runtime/action/evidence/Free acceptance flags. Recorded response diagnostics describe fixtures only.

## Validation and preserved evidence

```text
pnpm test:discovery-wallet-direct-cycle-target
pnpm test:discovery-publication
pnpm test:discovery-intents
pnpm test:discovery-producer-publication
pnpm test:discovery-wallet-cached-target
pnpm test:discovery-wallet-quota-target
pnpm test:discovery-wallet-cycle-target
pnpm test:discovery-wallet-replay-target
pnpm test:discovery-wallet-collection-target
pnpm exec tsc --noEmit -p tsconfig.evidence-scratch.json
```

**24 new cases** and **166 related regressions** pass: **190 distinct cases**, plus scoped types. CI includes the new suite. Twelve complete original-call comparisons match all **87 synthetic metadata tables**: body collection, paging, missing and unsupported bodies, rate limit, RPC exhaustion, wallet exhaustion, no catch-up, disabled, paused, shared backoff and busy lease. Expected execution runs first, and original database access is disabled while the isolated target executes. There is no oracle forwarding or prerequisite copying. The two offloaded raw evidence columns are outside this metadata comparison; original raw evidence is unchanged.

The fixture reuses an old normalized recorded transaction, with explicit synthetic wire-header counters and boundary/page setup. It is not a new independently captured RPC envelope, additional token coverage or prospective scoring validation. Full snapshot and reader-upgrade branches are not exercised by these comparisons.

Other tests cover late completion failure, lost lease/RPC acknowledgements, replacement wallet owner before dispatch, counter-history reuse refusal, strict catch-up/source/SQL domains, missing and transferred parents, cached-path/duplicate-ID holds, caller mutation, stale grants, corrupt catch-up results and stale wallet ownership. Fresh processes stop after synced readiness and after catch-up commit, then recover by retained publication ID without cycle arguments or another reservation. Private transcript `.tmp/wallet-direct-cycle-target-20261022-139-001.tap`, SHA-256 **`2ccbd3f0d170a7be8e8bf21399fd67cc2a91028f638c6257a9ec13af9f3eaad8`**, records the final twenty-four cases.

Four original legacy receipt intents reconcile read-only in fresh processes with unchanged frozen target/journal bytes. Private compatibility report `.tmp/wallet-direct-cycle-compat-20261022-139-002.json`, SHA-256 **`fe1d301c209d04a8a8b01c20a7b7b29c885485b4e1bff60e86c57023110eed9c`**, pins ten final code/configuration files and all fourteen original journal files. No direct-turn plan is published into the original frozen store. Security preflight/blocklist, existing built thesis-only closure, retained row-hash/foreign-key checks, actual credential/key-byte exclusion and ignored/untracked private-artifact checks pass. No full Discovery/frontend rebuild, hosted CI, remote D1, production owner/source authentication, off-device/power-loss recovery or measured shared Free/storage/CPU certification is claimed.

## Next boundary

Complete the original recorded **snapshot/refresh and reader-upgrade recovery branches**, including remaining source reads, claim/finish guards, receipt/candidate/profile/cohort publication and explicit post-commit handling. Then cover automatic selection and durable whole-workflow recovery before considering fenced new-generation handoff, stopped-owner adoption and rollback. Do not convert this one integrated recorded branch into a live backend by reconnecting transport.

F5/private/root/key/off-device acceptance, chronological growth/retention and shared Free/read/write/CPU admission remain partial. Continue ordinary admitted F1 breadth, F3 organic volume/meaningful holder growth and prospective held-out F4 calibration. D1/model-v4, original evidence/hashes/cohorts/elections/spent allowances, all provider/source/evidence/time/action/financial/release gates and thesis-only exposure remain. No live collection, provider spending, quota reset, evidence deletion, runtime adoption, restart, migration or deploy.
