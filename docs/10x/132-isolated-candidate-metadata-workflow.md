# 132 — Isolated candidate metadata workflow

22 October 2026. Continues [131's persist-before-execute publisher](131-persist-before-execute-producer-publication.md). The original **live, holder-receipt-backed candidate save** now runs entirely on an isolated target, including its non-receipt proof/candidate reads and separate cohort transaction. No oracle forwarding or prerequisite-row copying occurs in this workflow. Receipt-free candidate refreshes, wallet/control/cache/checkpoint paths and whole-application adoption remain open.

## Delivered workflow

`saveCandidateOnEvidenceTarget(publication, journal, grant, input)` in `scripts/lib/evidence-candidate-target.ts` invokes the unchanged production `saveCandidate`. Input includes caller-retained publication/stage UUIDs, the original candidate, raw holder evidence and optional transactions/account state. Configuration, grant and all input objects are snapshotted before IO without reordering JSON properties or substituting schema-normalized payloads.

An internal, non-exported statement adapter supports only the original function's exact proof read, merged live-candidate read, receipt batch and three cohort statement shapes. Prepared statements have no native delegate. The receipt batch uses 131's authenticated staging, synced encrypted intent and saved-plan publication. Unsupported methods/statements or absent holder input hold; this is not a general D1 proxy. No Node tool is imported by the Worker.

Two explicit coordinator APIs provide the non-receipt path:

- `readEvidenceCandidateMetadata` accepts only candidate-by-address or immutable-proof-by-address/kind requests. Native read-only SQLite checks the target/stage/source pins, schema and snapshotted current grant inside a transaction, including a final fence before return. Byte counts are checked **before loading body bytes**: candidate payload at most 2,000,000 bytes, proof hash text at most 4,096. Fatal UTF-8 decoding of BLOB reads preserves NUL/Unicode. A missing row returns scoped `null`; corrupt/oversized rows hold.
- `writeEvidenceCandidateCohorts` accepts one original cohort plus optional wallet/selection records, at most three unique kinds. All records must share address/day/time, retain exact payload hashes and match their address/time/recommendation or wallet/selection labels. Fixed bound SQL runs atomically under the current target fence and requires an existing committed parent publication. No caller SQL, raw database handle, authority write or quota mutation is exposed. Payloads are individually limited to 2,000,000 UTF-8 bytes; these are offline artifact bounds, not provider/research limits.

The original merge rules, immutable proof check, market/raw transaction/account evidence writes, holder first-time/reference retention and separate `captureCohort` logic remain. Cohort time still follows the maximum merged evidence time; first cohort rows retain original `INSERT OR IGNORE` behavior. The coordinator does not replace assessment, qualify market activity or authorize an election/action.

## Caller outcomes and recovery

The wrapper adds `workflow=candidate_save` and `cohort=not_started/completed/unconfirmed` to the explicit publisher outcome. An acknowledged receipt publication remains `state=committed` if the following merged read or cohort transaction fails; `post_commit=failed` and a generic error code describe that separate failure. Unknown receipt acknowledgement remains held/unconfirmed and never proceeds into cohort work. Native diagnostics and private bindings are not returned.

Explicitly retrying the **same retained inputs and UUIDs under the original grant** reconciles the saved receipt publication without replaying producer SQL, rereads current merged metadata and retries the original idempotent cohort transaction. A lost cohort commit acknowledgement remains unconfirmed until such an explicit retry; no automatic retry, compensation or quota refund occurs. The original SQL result positions stay available independently of cohort completion.

This wrapper does not provide ID-only reconstruction of all candidate arguments, durable cohort-completion acknowledgement or replacement-owner cohort recovery. 131's known-ID committed-only receipt reconciliation remains available separately. A replaced owner cannot finish post-read/cohort work using the old grant. Historical sessions, jobs and leases never activate.

## Verification

Run from repository root:

```text
pnpm test:discovery-candidate-target
pnpm test:discovery-publication
pnpm test:discovery-producer-publication
pnpm test:discovery-publication-read
pnpm exec tsc --noEmit -p tsconfig.evidence-scratch.json
```

The **13 candidate cases** compare the real original writer with the isolated workflow, including all **87 original tables' retained metadata values**, exact encrypted raw holder receipt, two original cohort snapshots and the eleven original producer result positions. The expected oracle is run first, then its access is disabled while the target executes. No before-batch prerequisite copier is present. Synthetic prerequisite state, where needed, is seeded before archive/clone. These 87 synthetic migration tables differ from the older frozen store's 83 tables; neither count denotes current live capacity or production acceptance.

Cases cover exact retries, newer preexisting metadata merge, immutable proof conflicts, later saves retaining first holder/reference/cohort rows, late producer rollback with spent allowances preserved, late cohort atomic rollback, lost cohort acknowledgement and explicit retry, ownership change after producer commit, exact bounded read-only NUL/Unicode/absence behavior, fixed cohort shape/hash/scope/parent admission, three cohort result positions, stale grants/pins/schema, unsupported fixture/missing-holder paths and mutable caller input. Generic error results retain the original receipt commit distinction.

The 29 coordinator, 14 producer-publication and 20 unified-read regressions add **63 cases**, for **76 distinct cases**, plus scoped types. CI includes the candidate suite. No fresh full Discovery suite, frontend build, native remote D1 test or hosted CI pass is claimed.

Read-only comparison against the independently pinned frozen capacity file checks **476 retained live-mode candidate payloads and 775 immutable proof hashes**, plus two scoped absence cases. All bytes match; largest candidate is 60,321 bytes. Existing target/capacity hashes remain unchanged, with zero provider calls, database writes or new observations. This is dated retained metadata, not fresh active inventory or F1 coverage.

Final private report `.tmp/candidate-metadata-read-20261022-132-final.json`, SHA-256 **`17d9a214caeb0561d6a02583f407c8cdae2a844bd57442878302265db7fe74fc`**, pins the six final implementation/test/config files and exact aggregate candidate/proof hashes. Its complete local read wall time is 31,995 ms; this is not billed CPU, sustained-load evidence or a shared Free budget. Final 13-case transcript `.tmp/candidate-target-20261022-132-final.tap`, SHA-256 **`d91f5b404b62fa772a3d602066c9253d78847c9a02100cc04188fd07f8fcb914`**. The earlier 12-case transcript/read report remain private and are not counted again.

Security preflight/blocklist, existing built thesis-only closure and original retained row-hash/foreign-key checks pass. Scoped credential/key-byte exclusion and ignored/untracked private-artifact checks pass; original frozen target, capacity, journal and prior proof bytes remain unchanged. No clean-audit, fresh frontend build or public release acceptance is inferred.

The API retains the separate-batch/result-order semantics documented by [Cloudflare D1](https://developers.cloudflare.com/d1/worker-api/d1-database/) and is tested on native Node 22.22.3 [SQLite](https://nodejs.org/api/sqlite.html). Native SQLite/Node outcomes do not certify remote D1/object atomicity, billed CPU, portable power-loss recovery or shared Free entitlement. Per-read stage/fence verification overhead and aggregate concurrent memory remain unqualified.

## Next delivery boundary

Complete **receipt-free candidate updates**, wallet/control/cache/funding-checkpoint reads and writes, and original wallet/replay caller outcome handling on the isolated target. Qualify these complete workflows without oracle forwarding or prerequisite copying. Then implement fenced **new-generation** handoff and stopped-owner adoption **and rollback**, without reactivating historical sessions, leases or jobs.

Private/root authorization, off-device custody/loss recovery, chronological growth, orphan/intent retention and measured shared Free/storage/read/write/CPU acceptance remain open. F1 broad admitted observations, F3 organic volume/meaningful holder-growth qualification and F4 held-out evaluation remain required. Original evidence/model-v4, provider/research allowances, every source/evidence/time/action/election/financial/release gate and thesis-only production closure remain. No live changes, collection, quota reset, migration, restart, upload, spending, evidence deletion, runtime adoption or deploy.
