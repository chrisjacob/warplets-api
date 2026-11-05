# Local transaction rehearsal

Ported the canonical encoder and bounded legacy/v0 message decoder from the reviewed October branch. The lab verifies the message digest, packet lifetime, local genesis identity, signers, exact programs, ordered instructions, account privileges, lookup evidence and simulated fee/output limits against an independently supplied local plan. Owner signatures must verify against those same message bytes.

Use `node --test transactions/intents.test.mjs` from the platform directory to replay a signed, synthetic receipt through submission, an unknown outcome, confirmation and finalization. Idempotency keys and business identity share one immutable plan. Attempts have their own identities. An ambiguous submission permits reconciliation only. Only an unsubmitted expired packet can be replaced; a new attempt must pass the complete check again.

The operator CLI accepts local evidence files. It has no broadcast method or RPC URL. Submitted/confirmed/finalized are labels on observed fixture events. Only the owner can retrieve an intent summary from the public API. Network provenance, typed production instruction factories, trusted RPC/simulation sources, persistence parity and independent review remain prerequisites to enabling a real adapter.
