# Attempt journal and finality

30 October 2026. This is a **local execution controller and review model**. It adds no public signing/submission endpoint and keeps mainnet handoff and retries disabled.

One immutable business key identifies a launch, distributor creation, allocation funding or claimant release. Its original intent remains unchanged. Every explicit retry now adds an immutable attempt with its own ordinal, plan hash, recovery key, previous signature and reason. A response lost after committing a new attempt is recovered with the same recovery key. Changing cost ceilings, accounts, instructions, destinations, expected amounts or release boundaries cannot be hidden inside a retry. A pre-submission attempt may explicitly renew only its expiry window; a new simulation and approval reservation are then required.

After a wallet handoff, `unknown` and `submitted` block replacement attempts. Cancellation, missing signatures, RPC errors and elapsed wall time do not prove absence. Record a recovered signature and reconcile the matching transaction/account evidence first. An adapter may declare absence only after actual chain expiry plus a complete intent search. The local adapter deliberately keeps a missing-signature search incomplete: automatic complete-history discovery and actual recent-blockhash/nonce lifetimes still need the future mainnet adapter. No blind resubmission is added here.

Local approval reservations bind the active attempt, plan hash and simulation hash and explicitly name their authority `local-test-controller`. They are append-only test records, **not human mainnet authorization**. Mainnet requires the separately reviewed packet, exact native/token budget, authorized accounts and human financial confirmation; no path here enables it.

## Compatible states

| Field                                         | Meaning                                                                                            |
| --------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `state: submitted`, `chain_status: confirmed` | Transaction observed; no finalized financial receipt yet                                           |
| `state: submitted`, `chain_status: pending`   | Confirmation was lost or has not reached required finality; keep reconciling                       |
| `state: confirmed`, `chain_status: finalized` | Legacy-compatible terminal state, backed by finalized matching evidence                            |
| `chain_status: legacy-local-confirmed`        | Migrated local harness observation; not recertified as finalized                                   |
| `state: failed`                               | Completely reconciled failure/expired absence; explicit local recovery may prepare another attempt |

Only finalized matching evidence creates the immutable receipt used by local funded/claimed projections. Reconciliation observations now carry an explicit `commitment`, separately from `status` and `complete`. Both terminal successes and terminal failures require `finalized` commitment and complete evidence; a malformed Boolean, missing commitment, oversized observation or processed-only confirmation fails closed. Existing terminal journal entries are retained, not reinterpreted or used to recalculate historical allocations.

The read-only Solana simulator adapter checks the exact requested signature against the decoded, cryptographically verified transaction, its fee payer, complete signer set, instructions and message-wide account privileges. A different valid transaction with identical instructions cannot impersonate the requested signature. It rejects unsafe slot/fee values and fees exceeding the plan's native ceiling. The fee check does not constitute a complete launch/rent/liquidity cost estimate.

It requests `getSignatureStatuses` with `searchTransactionHistory: true`, checks the RPC context, and matches both slot and execution error to the decoded transaction. A finalized status requires a second `getTransaction` read at `finalized`; the body, signature, slot, execution error and fee must agree. Successful finalization then reads independently decoded account state at finalized commitment with a minimum context slot. Confirmed errors remain pending until finalized failure evidence exists. See [Solana status RPC](https://solana.com/docs/rpc/http/getsignaturestatuses) and [transaction RPC](https://solana.com/docs/rpc/http/gettransaction).

Null transaction/status/finalized-body results and transport errors remain unresolved; they never establish expired absence or authorize another handoff. The adapter accepts only loopback simulator endpoints, legacy transaction encoding and `solana-local` plans. Unsupported versioned messages fail closed. It adds no mainnet read adapter, signer, broadcaster or public route. Actual recent-blockhash/nonce lifetime capture and complete missing-signature discovery remain explicit future gates.

Run `pnpm --dir packages/meme-qa test:chains` for signed offline RPC fixtures and the supported local simulators. The new fixtures cover signature substitution, incorrect signer/instruction privileges, inconsistent slots/errors/fees, missing finalized bodies, RPC/account-read outages, expired app timers and confirmation loss. A durable-controller scenario proves that concurrent finalization after an outage creates one immutable receipt under the original attempt/approval. Linux CI separately runs the captured-program launch-to-claim cycle using these finalized account-read requirements; mocked RPC fixtures alone do not certify actual program execution or mainnet behavior.

## Funding and batches

Funding plans must commit a `preconditionHash`. Immediately before reserving the wallet handoff, a read adapter must re-read the distributor configuration and return a matching plan/configuration hash, chain context and observation no older than 15 seconds. Slow reads also force simulation/expiry revalidation. The executable local cycle checks program owner/discriminator, mint, root, total/count, release/clawback timestamps, admin/receiver, vault mint/authority and expected pre-funding balance. Its read-back decoder stays in the QA package; mainnet program/RPC adapters and custody remain unimplemented gates.

Claim batches remain sequential and bounded to ten operations per call. They reconcile uncertainty before invoking a wallet, retain partial successes and stop on an ambiguous result. `complete` retains its existing processed-batch meaning; additive `processedAll` and `allClaimed` distinguish finishing the list from every claim succeeding. A failed item needs explicit recovery; it is never silently presented as claimed. Financial UI buttons remain disabled.
