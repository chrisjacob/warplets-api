# App and admin integration handoff

This document separates proposed integration work from verified discoveries. Do not turn a passing fixture or a mainnet public read into an enabled customer financial action.

| POC | Customer-facing integration after acceptance | Admin integration after acceptance |
| --- | --- | --- |
| P00/P01 | Verified mint identity, decimals, authority disclosures and transaction cost preview | Versioned launch manifest; approved recipients, payer, limits, source/program hashes |
| P02 | Exact-input quotes, slippage bounds, activation clock, total fee breakdown, stale-data holds | Pool configuration, lock and fee-owner audit, quote/execution reconciliation |
| P03 | Accurate allocation disclosure and independently backed claims | Supply ledger, reserved unminted liabilities, idempotent funding status, activation readiness |
| P04 | Deposit, accrued rewards, harvest, withdrawal and end-state balances | Enforced authority matrix, curve/precision audit, earned-vs-unused ledger, permitted surplus recovery |
| P05 | Supported-post evidence, eligibility, final award, partial claim and portable proof | Complete cutoff captures, moderation capacity, immutable board/root/funding reconciliation, empty-vs-pending state |
| P06 | Current-owner claim, inherited history, metadata provenance and remaining rewards | Reserve-to-asset commitment, allowed plugins, ownership/finality observations, burn/authority alerts |
| P07 | Reservation/payment/draw/reveal/refund status with one operation identity | Inventory locks, fairness commitment, retry/refund evidence and reconciliation |
| P08 | Upgrade/reroll preview, fees, persistent cooldown, remaining eligibility | Atomic or reviewed escrow transitions, version fences, immutable historical snapshots |
| P09 | Supported-wallet matrix, listing/sale states, current claimant, metadata freshness | Exact wallet/venue versions, escrow ownership checks, actual royalty receipts |
| P10 | Honest pending/unknown/finalized states and recovery path | Durable attempts, reconciliation queue, scoped holds, backup/proof restore and cost reports |

## Required implementation discipline

1. Keep the operational lab isolated from existing production bindings, wallets and databases. Preserve existing capabilities as disabled until the specific production action is independently accepted.
2. Use typed, protocol-specific instruction factories. Validate network/genesis, accounts, privileges, recipients, programs, token extensions, lookup tables, blockhash expiry, output bounds and exact costs. A generic RPC or instruction endpoint is not an authority boundary.
3. Persist intent, immutable business identity and attempt separately. Authenticate observations; preserve pending/unknown outcomes. Recover before retrying a financially ambiguous operation.
4. Establish current ownership at execution, not from a cached profile or marketplace image. NFT slot commitments, economic attributes and historical allocations cannot be rewritten by visual metadata permissions.
5. Port only tested adapters to the selected hosted runtime. Node coverage does not establish D1 transaction/concurrency or R2 publication parity.
6. Add focused regression tests for each discovered defect and record which source/program/configuration changes invalidate the evidence.
7. Customer/internal UI can be deferred during POCs. Define the service/action/state contract first, then add the minimal customer/admin controls needed to operate it.
8. Do not change the existing app, schedules, public product status or economic policy merely because a standalone test script exists.

## Discovery record template

- ID / date / POC:
- Evidence class: local | captured-program | read-only-mainnet | funded-mainnet.
- Exact commit/program/configuration:
- Expected behaviour:
- Observed behaviour and reproducible evidence paths:
- User impact and affected existing modules:
- Proposed implementation change and regression:
- Customer control needed:
- Admin control needed:
- Costs, limits, authority assumptions:
- Acceptance status and unresolved decisions:

## Known discoveries carried forward, not rerun mainnet results

D01: unrestricted Kamino administration can remove principal (see lab/KAMINO.md).
D02: ordinary Core burns can strand asset-signer funds; experimental veto removal/permanent delegates conflict with required rights (lab/CORE-VAULT.md).
D03: wallet-bound Rewards leaves do not transfer with an NFT; the captured asset-signer composition demonstrated a narrower transferable claim.
D04: quote vectors lack exact pre-swap live/program-state parity.
D05: synthetic wallet/browser tests do not establish physical signing or marketplace escrow compatibility.
D06: X embedding excerpts are not complete scoring evidence (earn/SUPPORTED_POSTS.md).
D07: current app capabilities explicitly disable financial execution; generated routes must not be mistaken for a production broadcaster.

## Runner findings, 25 November 2026

D08: Meteora's position NFT token account is a protocol PDA (`derivePositionNftAccount`), not an associated token account. Fee collection must use the SDK-derived address; the local builder was corrected before mainnet use.

D09: A restored checkout lacked the beacon package's `@noble/curves` dependency. Two focused tests initially failed to load. Installing the existing frozen beacon lockfile restored all 95 focused checks; preserve that setup requirement in local/admin tooling.

D10: Browser rerenders during navigation/polling could discard observation drafts. The runner now changes POC navigation synchronously and preserves note/recipient drafts. Browser regression covers save/reload. Customer/admin evidence entry needs the same protection.

D11: Transaction timeout must preserve the prepared message, signature, budget reserve and attempt identity before broadcasting. A restarted process must reconcile rather than rebuild. The runner checks signatures, full receipt-message identity and final account effects; mock timeout/restart and duplicate-submit regressions pass.

D12: Estimate total payer debit using simulation, then observe again immediately before submission. A fixed network-fee estimate omits rent/protocol account creation. The runner adds a conservative reserve and rejects price/cost drift beyond it. Actual receipts account once; unexpected overspend holds new actions. This is not an on-chain spending cap.

D13: Same-program mainnet reads matched all four saved binary/deployment/authority fingerprints at slot 473720144. A later Core check matched at slot 473736743. This keeps prior custody counterexamples relevant; it does not establish source-to-binary verification or acceptance of arbitrary configurations.

### Porting sequence for the next agent

1. Review `runner/catalogue.mjs` and the coverage table. Implemented probes are narrower than complete product POCs; never enable production based on their existence.
2. Use `runner/protocols.mjs` for pinned SDK/wire construction and postcondition ideas. Replace wallet-bound accelerated rewards, payer-owned allocation accounts and local NFT metadata before any customer integration.
3. Port `engine.mjs` concepts (immutable attempt, cost reservation, signature-before-send persistence, exact message binding, final receipt/effect verification) into the app's existing intent/recovery services. Retain production capability gates and independently test D1/R2 semantics.
4. Add customer cost/recipient review, wallet-rejection/expiry recovery, pending/unknown states and portable receipts. Add admin program-drift alerts, reconciliation queues, spending holds and evidence export. No admin override may silently erase an uncertain attempt.
5. Resolve P04/P06 custody, select randomness/payment/storage integrations for P07/P08, implement real-marketplace adapters for P09, then cost and execute those probes through human wallet approval. Record full 24/48-hour and ten-day results separately from shortened tests.

See `VALIDATION_RESULTS.json` and `MORNING_HANDOFF.md` for actual local/read-only evidence and remaining acceptance limits. No funded mainnet execution is claimed.
