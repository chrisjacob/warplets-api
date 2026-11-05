# Exact message packets and lifetimes

Migration 0017 appends immutable message packets to existing transaction attempts. Original plans, business keys, receipts and finalized entitlements remain unchanged. No signing/submission route is added and mainnet handoff still fails closed.

The shared dependency-free decoder validates canonical legacy/v0 Solana messages, account keys, signer/writable privileges, instructions, exact blockhash and packet size. Versioned messages require bounded lookup-table evidence with source hashes and context. Unsupported message versions, durable nonces, missing/unapproved accounts, noncanonical vectors and extra fields are rejected. Mainnet packets pin the actual genesis hash, independently observed in one approved public read.

Attaching a packet resets simulation and increments the durable intent revision. It is idempotent after a lost response; packets cannot be changed after handoff. A simulation must name the active packet hash. A fresh pre-handoff reader must return matching genesis/context and a valid blockhash at or below lastValidBlockHeight. Slow preflight work forces freshness revalidation. Approval events retain the packet and lifetime observations. Packet-backed signatures must cryptographically authorize the exact message before entering the submission journal.

```text
pnpm --dir meme operator packet-attach <tx:hash> <unsigned-packet.json>
pnpm --dir meme operator packet-status <tx:hash>
```

These commands use the existing authenticated loopback transport. The restricted gateway does not expose operator routes. They confer no human or multisig signing authority. Legacy local harness intents without packets retain their existing behavior; they are not retroactively recertified.

The QA planner compiles one exact message before simulation. The local sender signs that message without refreshing its blockhash behind the review. The inspector checks all Ed25519 signatures, message hash, finalized body and independently read account state. Legacy and v0 compiler interoperability and durable state tests use disposable keys and injected RPC fixtures. Linux CI runs the actual captured-program cycle with attached packets and fresh lifetime checks.

The lifetime reader checks genesis, finalized block height, blockhash validity and unchanged lookup-account hashes. An expired packet prevents handoff; it does not prove the absence of a previous submission. `completeIntentSearch` remains false. Missing-signature discovery and production source trust still need separate complete coverage. No mainnet write or automatic retry is implemented by this read-only adapter.
