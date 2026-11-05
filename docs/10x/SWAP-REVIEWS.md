# Packet-bound local swap reviews

Migration 0022 introduces a separate trade-review journal. A swap never masquerades as a reward claim and does not alter historical launch/funding/claim intents. An operation key binds wallet, network, quote, mint decimals, pool/account evidence, exact message, expected effects and fee/slippage limits. Input and output trading fees are separately declared and already included in raw input/net output; no double deduction is made.

The supported adapter is intentionally narrow: a single exact-in legacy Meteora DAMM-v2 swap on an existing standard SPL pair. The checker pins the deployed program and instruction discriminator, fourteen account roles/privileges, pool/mints/vaults, signer, input amount and exact minimum output. Compute-budget instructions are bounded and their signature/priority fee cannot exceed the review. Extra transfers, account creation, referrals, Token-2022 hooks, partial fills and wrapping are unsupported. They require a reviewed adapter; they are not silently substituted. OG purchase through a general router and integrated-host transaction signing remain separate live integration gates.

The test adapter uses the actual pinned SDK quote. It removes only SDK-generated idempotent ATA creates after independently checking that the expected user/mint accounts already exist in finalized local state. The signed swap itself cannot create an account or incur hidden rent. Quotes are short-lived and wallet/network specific. Simulation names the exact packet; handoff requires fresh blockheight/blockhash evidence and unchanged pool preconditions. A changed quote or packet requires cancelling an unsent review and preparing a new operation. A handed-off/unknown transaction blocks replacement until reconciliation.

Disposable local signing verifies the signature against the exact stored message. Finalized wire/status/account checks produce one immutable receipt. Lost responses, concurrent handoffs, read outages and missing signatures never authorize blind retry. Mainnet handoff is rejected before any reader or signer is invoked. There is no public preparation, signing or submission endpoint; the private operator status route is read-only. The user-facing buy controls remain disabled.

```text
pnpm --dir meme operator swap-status swap:<hash>
```

Cross-platform tests cover hidden effects, weakened minima, changed accounts/signers, one active order, real Ed25519 signatures, cancellation, ambiguous submissions and committed-but-lost receipts. Linux CI additionally executes real quoted buy and sell swaps against the pinned captured pool program, binding both to packet-backed simulation and finality. This proves a supported local path; physical host wallets, general OG sourcing, production source trust, economics, live route coverage and separate financial authorization remain gates.
