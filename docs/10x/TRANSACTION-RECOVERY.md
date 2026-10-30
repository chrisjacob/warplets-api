# Attempt journal and finality

30 October 2026. This is a **local execution controller and review model**. It adds no public signing/submission endpoint and keeps mainnet handoff and retries disabled.

One immutable business key identifies a launch, distributor creation, allocation funding or claimant release. Its original intent remains unchanged. Every explicit retry now adds an immutable attempt with its own ordinal, plan hash, recovery key, previous signature and reason. A response lost after committing a new attempt is recovered with the same recovery key. Changing cost ceilings, accounts, instructions, destinations, expected amounts or release boundaries cannot be hidden inside a retry. A pre-submission attempt may explicitly renew only its expiry window; a new simulation and approval reservation are then required.

After a wallet handoff, `unknown` and `submitted` block replacement attempts. Cancellation, missing signatures, RPC errors and elapsed wall time do not prove absence. Record a recovered signature and reconcile the matching transaction/account evidence first. An adapter may declare absence only after actual chain expiry plus a complete intent search. The local adapter deliberately keeps a missing-signature search incomplete: automatic complete-history discovery and actual recent-blockhash/nonce lifetimes still need the future mainnet adapter. No blind resubmission is added here.

Local approval reservations bind the active attempt, plan hash and simulation hash and explicitly name their authority `local-test-controller`. They are append-only test records, **not human mainnet authorization**. Mainnet requires the separately reviewed packet, exact native/token budget, authorized accounts and human financial confirmation; no path here enables it.

## Compatible states

| Field | Meaning |
| --- | --- |
| `state: submitted`, `chain_status: confirmed` | Transaction observed; no finalized financial receipt yet |
| `state: submitted`, `chain_status: pending` | Confirmation was lost or has not reached required finality; keep reconciling |
| `state: confirmed`, `chain_status: finalized` | Legacy-compatible terminal state, backed by finalized matching evidence |
| `chain_status: legacy-local-confirmed` | Migrated local harness observation; not recertified as finalized |
| `state: failed` | Completely reconciled failure/expired absence; explicit local recovery may prepare another attempt |

Only finalized matching evidence creates the immutable receipt used by local funded/claimed projections. The Solana harness now checks `getSignatureStatuses` with `searchTransactionHistory: true`, matches its slot to the decoded transaction and waits for actual reported finality. It no longer labels a confirmed transaction finalized. See [Solana status RPC](https://solana.com/docs/rpc/http/getsignaturestatuses) and [transaction RPC](https://solana.com/docs/rpc/http/gettransaction).

## Funding and batches

Funding plans must commit a `preconditionHash`. Immediately before reserving the wallet handoff, a read adapter must re-read the distributor configuration and return a matching plan/configuration hash, chain context and observation no older than 15 seconds. Slow reads also force simulation/expiry revalidation. The executable local cycle checks program owner/discriminator, mint, root, total/count, release/clawback timestamps, admin/receiver, vault mint/authority and expected pre-funding balance. Its read-back decoder stays in the QA package; mainnet program/RPC adapters and custody remain unimplemented gates.

Claim batches remain sequential and bounded to ten operations per call. They reconcile uncertainty before invoking a wallet, retain partial successes and stop on an ambiguous result. `complete` retains its existing processed-batch meaning; additive `processedAll` and `allClaimed` distinguish finishing the list from every claim succeeding. A failed item needs explicit recovery; it is never silently presented as claimed. Financial UI buttons remain disabled.
