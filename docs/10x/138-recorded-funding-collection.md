# 138 — Recorded funding collection and ordinary data writes

22 October 2026. Completes the next private collection boundary after [137's cached cycle](137-integrated-cached-wallet-cycle.md): the original `collectFundingHistories` now runs against native target reads and persisted ordinary transaction-cache/direct/second-hop checkpoint writes, using a finite recorded RPC transport and the existing paired quota accounting. This is an isolated Node experiment; D1 remains the application backend and no live provider request is enabled.

## Collection and persistence contract

`collectRecordedFundingOnEvidenceTarget` snapshots the target, encrypted journal, append grant and strict request before asynchronous work. Retain ordered publication UUIDs for each possible write plus two distinct quota publication UUIDs for every supplied response. The request has an explicit mint, at most twenty schema-validated anchors, original hop/cache-recovery/wallet-scope options, time and positive original quota settings. All identities must be distinct. Missing write identities stop at that write, preserving earlier progress and spent counters; unused retained identities do not create publications.

The adapter runs the original `RpcClient` cluster check, then unmodified `collectFundingHistories`. The collector retains its original cursor chain, finalized-window checks, pending order, three-page/twelve-body limits, direct/second-hop turn bounds, eighteen-call ceiling, cached recovery and CAS errors. The adapter supplies the transaction-read callback using the original `walletTransaction` decoder and schema/hash-checked native cache reads. It is not the full wallet snapshot collector: creation/holder/prior-loss aggregation, whole-snapshot record/byte accounting, ordinary unsupported-reader bookkeeping and upgrade recovery remain separate integration work. Unsupported source reads hold; null responses retain the original missing marker rather than becoming a pass.

There is no caller URL, fetch function or transport callback. A finite list permits only genesis, signatures and transaction responses. The original request method, parameters and response ID are checked; the original decoder handles HTTP/envelope/format errors. Each response body is bounded to three million bytes, with sixteen MiB for all recorded bodies/parameters, before use. This is test-input allocation, not a new provider/research limit. Responses are not independently authenticated source receipts and do not qualify evidence, scores or current coverage.

Every recorded dispatch first invokes 136's unchanged wallet-then-shared-RPC reservation workflow. A wallet charge remains spent when the shared reservation declines or a later response/write fails. Missing quota identities, unconfirmed commits and any reconciled reservation stop dispatch. A recovered counter result is never reused to buy another response. All outcomes retain `source_authorized=false`, zero real provider requests and false runtime/action/evidence/Free acceptance flags. `rpc_calls` and `recorded_responses` are separate diagnostics for original attempts and supplied responses, not real provider usage.

The strict `wallet_collection` plan admits one exact original statement: transaction-cache `INSERT OR IGNORE`, direct/second-hop checkpoint upsert, or direct/second-hop cache-repair CAS. It cannot write quotas, control, candidates, receipts or arbitrary SQL. Binding counts, hashes, payload byte limits, wallet/anchor identities and checkpoint time are checked before encrypted intent readiness and target SQL. The TypeScript publisher also runs the original transaction/checkpoint schemas and checkpoint validation; a transaction must retain its normalized hash. Result arrays remain empty, with original change counts. Duplicate transaction insertion remains the original zero-row insert; it does not overwrite an existing body.

Second-hop inserts require the instruction-specific `signature:index` key. Missing instruction indexes hold before recorded dispatch and in the native plan validator; `signature:undefined` is never admitted. Cache repair may update the exact legacy signature key selected by the original loader. A new fixed native `checkpoint_key` read preserves preferred-key ordering and legacy fallback, BLOB-decodes NUL/Unicode and checks length before expansion inside a read-only fenced transaction. No generic SQL input is exposed. Every write retains append-generation/owner fencing; the original collector's ordinary checkpoint SQL has no added wallet-lease predicate. This private experiment must not be substituted for a production scheduler/lease/source-permit lifecycle.

## Outcomes and interruption handling

`completed` returns original scans, call/response/write-position diagnostics and every publication outcome. A completed scan can still be partial or contain terminal missing bodies: inspect its original coverage gaps. `held` identifies the phase and safe reason, with any original `SourceError` retry delay and all earlier publication outcomes. It never refunds spent allowance or claims a rolled-back whole turn when earlier writes committed.

Known-ID pending publication recovery executes only the exact original-grant intent. Committed recovery is read-only, including after append-owner transfer; old-owner pending execution remains held. A late cache failure retains the earlier page, while explicit known-ID recovery can finish that one cached write. Lost acknowledgement stops collection before subsequent checkpoint updates. Whole-collector resume is not implemented: regenerated times and write-position ordering must not be reconstructed heuristically. A new ordinary run requires fresh quota identities; it cannot turn old counter history into new source permission.

## Validation

```text
pnpm test:discovery-wallet-collection-target
pnpm test:discovery-publication
pnpm test:discovery-intents
pnpm test:discovery-producer-publication
pnpm test:discovery-wallet-cached-target
pnpm test:discovery-wallet-quota-target
pnpm test:discovery-wallet-cycle-target
pnpm test:discovery-wallet-replay-target
pnpm exec tsc --noEmit -p tsconfig.evidence-scratch.json
```

**20 new cases** and **146 related cases** pass: **166 distinct cases**, plus scoped types. CI includes the new suite. Four original-collector cases match all **87 synthetic metadata tables**: ordinary direct/second-hop collection and direct/legacy-second-hop cache repair. Expected original execution is captured first; original database access is disabled during target execution. No oracle forwarding or prerequisite copying occurs. The two offloaded raw evidence columns are outside this metadata comparison; original evidence is unchanged.

The fixture reuses an old normalized recorded transaction. Its two absent wire-header readonly counters are explicitly synthetic parser scaffolding; signature-page boundary rows and the second-hop instruction anchor are synthetic too. The test is an integration/decoder regression, not a newly observed RPC envelope or independently proven second-hop flow. No additional mint/population, freshness or wash-trading claim follows.

Other cases cover wrong cluster/429 delays, shared-quota failure with retained wallet spend, null/incorrect-slot bodies, missing/duplicate IDs, reservation replay refusal, late SQL failure, lost acknowledgement, concurrent legacy checkpoint CAS, strict SQL/hash/key domains, malformed returned rows, stale grants, caller mutation and response byte bounds. Fresh processes stop after readiness and after cache commit, then recover the exact publication without collection arguments or duplicate SQL. Private final transcript `.tmp/wallet-collection-target-20261022-138-002.tap`, SHA-256 **`2fbce1b69dc30b2db9319ea0b7915e147130674a1288bae15e0e420341a33f23`**, records all twenty cases.

Four original legacy receipt intents reconcile read-only in fresh processes. Private report `.tmp/wallet-collection-compat-20261022-138-003.json`, SHA-256 **`0a31955cec4d68a24b33d3d1d76a002c17b1fbff6c568dcce6ab61b619544d87`**, pins ten final code/configuration files and all fourteen original journal files; the old target/journal bytes remain unchanged. No collection plan is published into that frozen store. Security preflight/blocklist, existing built thesis-only closure, retained row-hash/foreign-key checks, actual credential/key-byte exclusion and ignored/untracked private-artifact checks pass. No full Discovery/frontend rebuild, hosted CI, remote D1, production source/owner authentication, off-device/power-loss or shared Free/storage/CPU certification is claimed.

## Next integration boundary

Join these ordinary data writes with 137's scheduler and 136's accounting in a complete recorded provider-backed wallet cycle. Add catch-up reservation/shared failure-backoff mutations, ordinary unsupported-read bookkeeping and the remaining original snapshot/recovery reads and writes. Keep original source-permit/dispatch/lease guards, result handling and durable whole-workflow recovery explicit. Automatic candidate selection is still open; this fixture cannot justify live source integration.

F5 remains partial pending fenced new-generation handoff, stopped-owner adoption/rollback, private/root authorization, protected-key/off-device recovery, chronological growth/retention and shared Free/read/write/CPU admission. Continue ordinary admitted F1 breadth, F3 organic volume/meaningful holder growth and prospective held-out F4 calibration. D1/model-v4, all original evidence/hashes/cohorts/elections/spent allowances, provider/source/evidence/time/action/financial/release gates and thesis-only exposure remain. No live collection, provider spending, quota reset, evidence deletion, runtime adoption, restart, migration or deploy.
