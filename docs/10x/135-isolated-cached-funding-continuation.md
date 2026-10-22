# 135 — Isolated cached funding continuation

22 October 2026. Completes the original cache-only funding continuation and its separate completion batch on the isolated evidence target, following [134's cached wallet replay](134-isolated-cached-wallet-replay.md). Verified saved transaction bodies can advance funding checkpoints without purchasing new data or creating a new wallet/scoring observation. This remains offline Node tooling; D1 is still the application backend.

## Narrow durable write contract

`wallet_cached_progress` is a distinct strict publication-plan domain. It accepts either **one exact original guarded direct-checkpoint compare-and-swap**, or the **four exact original completion statements**, in order. It has no receipt, ticket or stage UUID. Original receipt plans still require one authenticated receipt, and candidate metadata plans retain their separate scope. Unknown/mixed shapes, altered SQL/guards, additional operations, expectation overrides and arbitrary quota/control/receipt/candidate writes hold.

Checkpoint plans bind payload/hash, mint/wallet/anchor, prior checkpoint hash, candidate evidence hash, attempted-at time and lease owner. Completion plans share one owner/time/mint/source identity and retain the original work/run/attempt/lease-release statements and sixty-second schedule. Payload identity/hash and UTF-8 allocation checks occur before intent IO; payloads are limited to 250,000 bytes. Completion work must retain zero RPC calls. These are private allocation bounds, not provider/research quota changes. The original schemas and cached-evidence decoder still supply semantic validation; storing a checkpoint or run grants no independent evidence qualification.

`publishEvidenceWalletCachedBatch` snapshots and validates inputs, syncs an encrypted immutable intent, then executes from that authenticated saved plan under the existing target/generation/owner/epoch fence. The shared publication-ID namespace prevents same-ID changed or cross-domain plans. Journal version, cryptographic context, previous ciphertext bytes and SQL schema remain unchanged. Original-grant pending publication and current-owner committed-only read-only reconciliation remain separate; a replacement owner cannot execute an old pending intent. No lease acquisition, allowance reservation/refund or historical job/session activation is provided.

## Complete original helper workflow

`continueCachedFundingOnEvidenceTarget` invokes unchanged `continueCachedFunding` followed by unchanged `recordCachedFundingWork`. Its private adapter accepts only their exact authenticated wallet receipt, bounded cache/checkpoint reads, original checkpoint statement and original four-statement batch. It exposes no generic SQL/runtime backend or oracle delegate. Before any checkpoint can advance, the original prior-evidence and expanded-scope readers validate the retained input and require stable publication UUIDs for every prepared direct wallet/anchor, at most twenty, plus one completion UUID. Wider v5 scopes use the original preparation and limits. No duplicate or inferred identities are accepted.

The original projection verifies cached transaction hash, signature, slot, time, wallet reference and successful execution before advancing a checkpoint. Missing pending bodies remain unresolved; corrupt bodies hold. Original candidate evidence hash, checkpoint hash, lease ownership/expiry and pause predicates execute inside the original SQL. Candidate payloads/timestamps, immutable receipts, cohorts, profiles, spent allowances and source-health status remain unchanged. The workflow computes newly completed windows from the original prepared checkpoint coverage; callers do not supply an invented count. It has no RPC client or provider transport.

Checkpoint advances commit independently, as in the original code. A later failure does not undo an earlier valid checkpoint. The four completion writes commit atomically: work, run, attempt pacing and lease release. A zero-row checkpoint CAS remains a known committed publication with result `[0]`, while the workflow holds with the original `funding_cache_checkpoint_or_owner_changed` reason. Completion with a lost lease can return `state=completed, recorded=false` and `[0,0,0,0]`; callers must not report that as a recorded successful turn. Inspect **recorded, held phase/reason and every publication outcome**, not just the outer state. Unknown SQL acknowledgement remains held until explicit retained-ID reconciliation.

Recovery publishes/reconciles the saved immutable plan by known ID without original workflow arguments. An automatic whole-workflow retry is **not** certified: the original helpers generate current attempt times and may see already advanced checkpoints. Regenerating SQL under an old UUID can conflict, and a later fresh turn has different completion accounting. Reconcile or recover each known publication first; do not recycle IDs, infer success from a missing workflow result, overwrite corrupt intents or silently manufacture replacement IDs. Full workflow reconstruction/replacement-owner recovery remains open.

## Validation

```text
pnpm test:discovery-wallet-cached-target
pnpm test:discovery-intents
pnpm test:discovery-candidate-metadata
pnpm test:discovery-wallet-replay-target
pnpm test:discovery-producer-publication
pnpm test:discovery-publication
pnpm exec tsc --noEmit -p tsconfig.evidence-scratch.json
```

The new **23 cases** and **93 related regressions** pass: **116 distinct cases**, plus scoped types. CI includes the new suite. Both pending-body and terminal-marker recovery use the retained recorded v1 funding fixture and match all **87 synthetic tables' retained metadata values**, with exact original results `[1]` then `[1,1,1,1]`. The two offloaded raw columns are outside this metadata comparison; the selected wallet receipt is authenticated through the shared reader. Expected original execution is captured first, then original database access is disabled during target execution. No oracle forwarding or prerequisite copying occurs. The old fixture is not a fresh source receipt, population study or scoring promotion.

Tests cover corrupt/future/failed/wrong-slot/signature/wallet bodies, unresolved absence, all five checkpoint predicates, completion ownership loss, late four-statement rollback with earlier progress retained, stable-ID preflight and caller mutation, strict plan/scope/schedule/byte rejection, stale generation/owner/epoch and wrong target pins. Fresh processes stop after synced readiness and after commit; known-ID recovery preserves original results without duplicate SQL. Lost acknowledgement and replacement-owner pending holds remain distinct. Private final transcript `.tmp/wallet-cached-target-20261022-135-001.tap`, SHA-256 **`096f33c871328c07de8e014dcf60afba0e3f3a6a1870d7089d4c90298674e0d4`**, records all twenty-three cases.

Four legacy receipt intents also reconcile read-only in fresh processes using the extended parser/dispatcher. Private report `.tmp/wallet-cached-compat-20261022-135.json`, SHA-256 **`5df970012ad9a3578c982aa8c4b7ebc81edeb59d35f659c183609b89e1ece744`**, pins ten final code/configuration files and all fourteen original journal files. Target/journal bytes remain unchanged; zero provider requests, database writes or new real observations occur in this frozen compatibility check. No cached-progress plan is published into the old frozen store.

Security preflight/blocklist, existing built thesis-only closure, original row-hash/foreign-key checks, actual credential/key-byte exclusion and ignored/untracked private-artifact checks pass. Original target, capacity, proofs and journal remain private and unchanged. No fresh full Discovery suite, frontend build, native remote D1, hosted CI, production authentication, power-loss/off-device recovery or measured shared Free/storage/CPU acceptance is claimed.

## Next delivery boundary

Complete wallet control **acquisition**, source/catch-up quota reservations, failure/backoff and provider-backed caller paths, transaction-cache and ordinary direct/second-hop checkpoint writes. This slice only completes cache-only continuation and its existing guarded completion/release, not the scheduler or entire wallet cycle. Preserve spend-before-call and explicit SQL/post-commit/unknown-acknowledgement handling. Then prove fenced **new-generation** handoff, stopped-owner adoption **and rollback** without reviving historical owners, sessions, leases or jobs.

Private/root authorization, independent off-device custody/loss recovery, whole-workflow/durable cohort recovery, chronological growth/orphan/intent retention and shared Free/read/write/CPU admission remain open. Continue broad admitted F1 observations, qualified F3 organic volume/meaningful holder growth and prospective held-out F4 calibration. Original evidence/model-v4, provider/research limits, every source/evidence/time/action/election/financial/release gate and thesis-only closure remain. No live collection, quota reset, migration, restart, evidence deletion, spending, runtime adoption or deploy.
