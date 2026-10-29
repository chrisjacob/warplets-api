# Production preparation and recovery draft

Status: **not approved for activation**. This document prepares later review; it does not authorize deployments, remote resources, new provider budgets or financial actions. Existing Network, legal, thesis and product routes remain on their released deployment. The launchpad remains isolated and local.

## Required controls and authorities

The eventual production configuration must have five independent controls: **serving, participation, launching, funding and claims**. All start disabled. An operations scheduler is a separate control and must not enable any of them implicitly. The current local Worker has no launch/funding/claim implementations and always rejects those actions. It cannot be promoted into a financial service by changing an environment variable.

Record a versioned configuration containing the approved rules hash; exact program/SDK/binary hashes; chain/cluster; mint, pool and distributor allowlists; separate storage bindings; RPC and oracle limits; and the named people/keys permitted to prepare, select, sign, fund, pause and recover. Store signing material outside the application database and Git. Decide multisig/custody, backup and incident replacement before selecting an execution adapter. Neither an operator bearer token nor a Farcaster login confers signing authority.

Deployments and financial activation need separate approval. The authority packet must state which operations require human or multisig approval, transaction limits, upgrade authorities, LP/position control, mint/freeze authority revocation, fee destinations and reserve handling. Do not silently default unresolved fields to the fixture.

## Prepare → bootstrap → activate

1. **Prepare:** independently review dependencies, real-wallet/device QA, rules, source coverage, protocol execution and the authority model. Create isolated launchpad resources and approved routes only when separately authorized. Deploy compatible code with all five controls disabled. Apply only additive launchpad migrations; do not alter the shared Network database or reuse its ingestion owner.
2. **Bootstrap:** verify the authoritative ownership snapshot, wallet scopes, accepted complete history, independent prices, correction provenance and approved source allowances. Replay accepted evidence against the same rules/version and compare score/settlement commitments. Register future operator-reviewed rounds. Keep historical finalized entitlements unchanged. No publication or ingestion call may reset consumed quotas.
3. **Activate reads:** enable serving only after one internally validated snapshot. Check hostname/routing, desktop/mobile views, cache/privacy headers, public/private response separation and existing products. Public reads must remain collection-free.
4. **Activate participation:** require the approved rule packet and real-account/physical-phone QA. Verify clocks, cycle commitment, freeze/reveal order, signing origins, duplicate scope controls and a working pause before accepting votes.
5. **Controlled financial cycle:** only after separate approval and executed protocol/distributor proof, enable bounded launching, then funding, then claims independently. Reconcile actual mint/pool/supply/authorities/timestamp and distributor funding before exposing claimability. Use actual launch +24h through +240h release times. Do not treat a submitted transaction, an API acknowledgement or an unfunded entitlement as confirmation.
6. **Observe:** verify scheduled jobs, snapshot publication, provider failures and usage, source freshness, proof roots, transaction reconciliation, reward conservation and public API errors across the first complete cycle. Add an operator rota and alerts with named responders before widening the cohort.

## Monitoring and operating limits

| Signal                                                | Required response                                                                                                                       |
| ----------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| Ownership freeze missed or stale                      | Leave round unavailable; record skip/delay explicitly. Never backdate evidence.                                                         |
| Unknown price, unsupported receipt or history gap     | Keep holding provisional and block settlement.                                                                                          |
| Job lease expires / response is lost                  | Resume from durable checkpoint with a new fenced lease; inspect blocked jobs.                                                           |
| Source allowance exhausted                            | Stop collection and retain consumed usage. No quota reset, cap increase or provider substitution.                                       |
| Provisional head is stale                             | Report its real as-of time; diagnose jobs. Do not trigger collection from a reader.                                                     |
| Settlement root differs on replay                     | Stop affected finalization, preserve all inputs and investigate a versioned correction.                                                 |
| Launch/funding/claim transaction outcome is ambiguous | Reconcile signature, accounts and chain state before retrying. Never create a new financial intent merely because a response timed out. |
| Supply, allocation or funding conservation fails      | Pause the relevant financial control and alert the signing/treasury owners.                                                             |
| Existing product or routing regression                | Disable launchpad serving and restore the prior application deployment. Preserve evidence and isolated data.                            |

Actual request/credit budgets, alert thresholds, retention, maximum cohorts and job throughput must be measured against the selected production plan. Current new-source budgets are zero. Current explicit local evidence bounds are documented in OPERATIONS.md; larger histories and production throughput need further work. No load certification or increased paid plan is implied.

## Pause and rollback

Pause participation, launching, funding and claims independently; keep read-only history available when safe. Stop the local runner with Ctrl+C or disable the future scheduler. Disable serving independently if the UI/API is unsafe. Record configuration/deployment IDs, rules/authority versions, migration state, source manifests, snapshot roots, financial intents/signatures and the decision maker.

An application rollback must not roll back finalized entitlements, additive migrations, accepted evidence or consumed provider allowances. Restore the previous application deployment if needed, leaving isolated launchpad records intact. Chain transfers and permanent LP locks are irreversible; recovery means reconciliation and a reviewed follow-up action, not pretending the transaction did not happen. Never restore an entire local database over shared production state.

The current build can exercise non-financial job/evidence recovery locally. Persisted launch/funding/claim lifecycles, on-chain reconciliation, custody, alerts and concrete deployment rollback commands must be implemented and validated after the protocol and production configuration are selected. Their absence is a readiness blocker.
