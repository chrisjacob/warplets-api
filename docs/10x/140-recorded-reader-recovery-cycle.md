# 140 — Integrated recorded reader-upgrade recovery

22 October 2026. Completes the original `reader_recovery` scheduler branch on the isolated evidence target, following [139's direct-funding turn](139-recorded-direct-wallet-cycle.md). The unchanged scheduler now invokes the original recovery planner, guarded claim, current transaction decoder, atomic cache/receipt finish and original completion or failure/backoff path using fixed recorded responses. D1 remains the application backend. Snapshot refresh and live transport remain separate, held work.

## Original branch and retained identities

`runRecordedRecoveryWalletCycleOnEvidenceTarget` shares 139's private engine while retaining a distinct strict request: the existing control/workflow IDs and response quota pairs, plus up to two distinct per-signature claim, finish and error-finish publication IDs. Direct-funding callers retain their existing request and entry point. All identities, recordings, source/target/journal and append grant are snapshotted before asynchronous work. Missing/duplicate recovery IDs hold before acquisition. The original scheduler still generates its own fresh job UUID and persists the lease intent before SQL.

The original planner must select `reader_recovery`. Fully admitted authenticated prior receipts, original retained-body replay and the original `fundingRecoveryCandidates` function determine the exact windows/signatures before acquisition; every selected signature needs retained identities. The scheduler retains its original contender/age/risk check. Other stages are held in this adapter. Disabled, pause, shared-backoff and busy-lease outcomes retain the original behavior.

Fixed native reads add only the original daily recovery count, current-reader existence lookup and hash-bound preferred/legacy checkpoint-key selection. Reads are owner-fenced and read-only; key length is checked before BLOB decoding. Counts include all original recovery claims, including interrupted or failed ones. The current-reader lookup does not become absent because a previous attempt failed, and older-reader receipts are retained. There is no generic SQL endpoint.

The unmodified `recoverFundingBodies` function controls eligibility, retained-record/sample/byte validation, genesis check, each guarded claim, decoder/identity/time/wallet checks and finish/failure handling. Its **twenty-per-day** and **two-per-turn** limits remain fixed, as do existing wallet/shared-RPC and catch-up accounting. No disabled GMGN calibration cap is restored. Every recorded response requires fresh accepted paired quotas and current dispatch authority; recovered counter history is not a new request permit. There is no caller URL/fetch callback or live provider IO.

## Claim and finish publication

The new strict `wallet_reader_recovery` domain retains the original lease context, source evidence hash, exact recovery row and stable claim ID. Only the exact original direct/second-hop claim statement or original finish batch is admitted. Binding checks retain the pinned reader, signature, slot/block time, hop, wallet, exact anchor/checkpoint hash, original UTC day, twenty/two claim bounds and SQL predicates. Altered caps, reader/SQL/context, extra operations and compare-and-swap overrides hold. Captured original statements independently verify the templates in the tests.

Each new claim requires the exact accepted lease publication under the same append grant. The original SQL still checks candidate evidence, exact unsupported marker/page, absent cache, lease, pause/backoff and both claim allowances. Only a claim may return zero or one strict `{signature}` row, with the exact requested signature and matching change count. All finish result arrays remain empty; older domains retain their original result contracts. A declined zero-row claim cannot authorize a finish or consume a body response.

A finish also requires the exact accepted claim plan and original grant. Success publishes the original guarded cache insert plus terminal receipt update atomically and in order. Negative/error finishes use the original guarded receipt update alone. Native validation binds every row field and normalized body hash/identity; the TypeScript publisher also runs the original transaction schema, validity, wallet and time checks. Missing/unsupported outcomes remain terminal uncertainty, never an available body without a hash.

The original finish predicates and immutable receipt trigger remain. A changed checkpoint or lost owner produces the original zero-row result rather than forced adoption. Cache collisions are not overwritten. A late finish failure rolls back the tentative cache insert; the original recovery caller may record its terminal error. Subsequently executing that earlier pending finish cannot revive a terminal receipt: both original guards return zero and the cache remains absent. Charged claims and quotas are not reset or refunded.

Reconciliation checks retained result shape, generation and the lease/claim parents using their original committed ownership. A current append owner may read already-committed history after transfer, but cannot execute former-owner pending work. A recovered claim result records a past claim; it does not authorize a new read or revive a wallet lease. Journal format, encryption context and target schema remain unchanged.

## Outcomes and evidence boundaries

`completed` means the original scheduler returned; inspect its state, `recovery.attempted/recovered`, errors and every publication. A progressed turn may recover zero bodies. `held` identifies an unsupported/preflight/publication boundary. Unknown claim acknowledgement leaves a charged reading claim and withholds the body request. Unknown finish acknowledgement preserves any committed body/available receipt; the caller's later failure handling cannot rewrite that terminal success. Known-ID reconciliation is read-only and never redispatches.

Recovery writes verified cache and reader-attempt metadata only. It does **not** adopt checkpoints, publish a new wallet evidence snapshot, refresh candidate timestamps/profiles/cohorts or qualify a score/action. Original hashes and observations survive. Whole-turn resumption is still uncertified: retain IDs and original contexts rather than reconstructing write positions, replacing jobs or reusing source spend. Every cycle-adapter outcome retains `source_authorized=false`, zero real provider requests and false runtime/action/evidence/Free acceptance flags.

## Validation

```text
pnpm test:discovery-wallet-recovery-cycle-target
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

**27 new cases** and **190 related regressions** pass: **217 distinct cases**, plus scoped types. CI includes the new suite. Fourteen complete original-call comparisons match all **87 synthetic metadata tables**: available/two-body/missing/unsupported/wrong-identity results, genesis/body rate limits, older-reader retention, final daily unit, no catch-up, disabled, paused, shared backoff and busy lease. Expected original execution runs first, then original database access is disabled while the target runs. No oracle forwarding or prerequisite copying occurs. The two offloaded raw evidence columns are outside this metadata comparison; original raw evidence is unchanged.

Other cases cover required identities, refusal to repurchase terminal current-reader failures, atomic rollback and terminal non-revival, lost claim/finish acknowledgements, exact original caps/guards, declined claims, changed checkpoints, corrupt parent results, owner transfer, fixed read-only selectors, stale grants and caller mutation. Fresh processes stop after synced readiness and after claim commit, then recover the exact original claim result without workflow arguments or duplicate SQL. Full-turn fixtures cover direct funding windows; the new tests do not independently certify decoded second-hop provenance.

Fixtures reuse an old normalized recorded body with explicit synthetic wire-header/page scaffolding. The two-body case also changes signature/slot/time synthetically. These are integration/decoder regressions, not new independently captured RPC envelopes, current token breadth, organic demand or scoring calibration. Private final transcript `.tmp/wallet-recovery-cycle-target-20261022-140-001.tap`, SHA-256 **`16784c3e3f7a522ad0f381fea854f3e28d680c5b9eecfe63ef7f118ae6da6f05`**, records all twenty-seven cases.

Four original legacy receipt intents reconcile read-only in fresh processes with unchanged old target/journal bytes. Private report `.tmp/wallet-recovery-cycle-compat-20261022-140.json`, SHA-256 **`20fbfc0026c274132018fe35be9ec4b989c01da1e8c2aa57045cf2975fef401a`**, pins ten final code/configuration files and all fourteen original journal files. No recovery plan is published into the original frozen store. Security preflight/blocklist, existing built thesis-only closure, retained row-hash/foreign-key checks, actual credential/key-byte exclusion and ignored/untracked private-artifact checks pass. No full Discovery/frontend rebuild, hosted CI, remote D1, production source/owner authentication, off-device/power-loss recovery or measured shared Free/storage/CPU acceptance is claimed.

## Next boundary

Complete the original recorded **snapshot/refresh branch**: remaining source reads, fresh receipt/candidate/profile publication and explicit cohort/post-commit outcomes. Then cover automatic selection and durable whole-workflow recovery before fenced new-generation handoff, stopped-owner adoption and rollback. Recovery/cache progress alone must not be relabeled fresh evidence or used to reconnect live transport.

F5/private/root/key/off-device admission, chronological growth/retention and shared Free/read/write/CPU acceptance remain partial. Continue ordinary admitted F1 breadth, F3 organic volume/meaningful holder growth and prospective held-out F4 calibration. D1/model-v4, all original evidence/hashes/cohorts/elections/spent allowances, provider/source/evidence/time/action/financial/release gates and thesis-only exposure remain. No live collection, provider spending, quota reset, evidence deletion, runtime adoption, restart, migration or deploy.
