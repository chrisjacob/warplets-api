# Mainnet-aware QA

Implemented on 30 October 2026 (Sydney). This is an isolated test system, not deployment or financial activation. Use `pnpm --dir packages/meme-qa check`, `test:browser`, and `test:chains`. Browser tests use ports 5196/8798 and an in-memory database; existing previews on 5194/8797 are untouched. CI runs on the existing Ubuntu runner with no production credentials.

## Wallet custody and recovery

Dedicated public addresses, generated with secure library randomness:

| Network | QA address |
| --- | --- |
| Base mainnet (8453) | `0x46ffE8698Ee310C6611eAe457a4337824B2dE8d8` |
| Solana mainnet-beta | `4nMefVCeaxegYL1w2aUDEafEDT1F2V92vrpZ4gkooLyB` |

**Do not fund yet.** The owner selected an itemized estimate before funding. These are not production custody or multisig signers. No mainnet writes are enabled.

The encrypted vault is outside every Git worktree at `C:\Users\cjacob\AppData\Local\10x\qa-wallets\2026-10-30`. Both `wallets.dpapi` and `wallets.backup.dpapi` were decrypted in memory and their derived addresses verified. No plaintext key file was created. Protection is Windows DPAPI **CurrentUser**, including a purpose-specific entropy value. Copying these files alone does not enable recovery on another Windows profile or machine. This is a same-profile backup proof, not portable disaster recovery.

Run `pnpm --dir packages/meme-qa wallets verify <vault-directory>` under the same Windows profile to verify both files and the backup checksum. To restore after accidental primary-file loss, copy the verified encrypted backup to a protected directory outside Git, restore the original filename there, and verify against `public-manifest.json`. Do not replace or regenerate the original keys. There is intentionally no secret-printing CLI or browser signing service. Before funding, the owner must establish a private wallet-import/portable-recovery procedure and confirm the actual wallet can be used. Never paste a private key or seed phrase into chat. Real extension wallets and Base smart accounts require separate setup and user-controlled credentials.

## Evidence and execution boundaries

- The captured public Solana program fixture was collected with two `getMultipleAccounts` requests at finalized slot **463107036**, 30 October 2026 01:54:35 UTC. The compressed archive, individual account data, binary hashes, program links and authority metadata are checked before use. Ordinary tests have no mainnet RPC fallback.
- The Meteora deployed binary hash is `967ff9fb161eec2e62f66d2c899100739fb747c445f697b8625c86b31b9a2022`, with upgrade authority `JADaUV8kvDpDbJr55wxXJHVaBS3VCj8thZZHjfeuCVLd`. Jito is `51043e9794e69f0b071d741abd29fc274694ab60e412a1ed6d0dd38e258703ac`, with no upgrade authority in this observation. Neither is asserted reproducibly built from the reviewed source. A later capture must be reviewed; do not automatically replace these pins.
- `capture --public-read-only <ignored-directory>` makes exactly two public Solana RPC requests, never uses Network credentials and refuses to overwrite a capture. It does not authorize Helius/Pyth calls or change any budget. Their existing zero allowances remain.
- Anvil executes fresh local Base transactions and snapshot recovery. It is not a proof of Base smart-account or Warplet mainnet ownership. Surfpool runs the captured deployed Solana programs **offline**, with disposable local keys and test balances. Local time changes and privileged account injection are confined to that simulator.
- The browser harness invokes the real local Worker and real SQLite migrations. It substitutes an external verified Farcaster assertion and registers a disposable Wallet Standard signer using real Ed25519 message signatures. It does not prove actual Farcaster relay, browser extension, Base smart-wallet, or physical-phone compatibility. Harness routes and credentials exist only in a separate test process, never in application entry points.
- Captured binaries are regression artifacts, not application dependencies. Jito's upstream source is GPL-3.0; Meteora source and binary licensing/source correspondence must be assessed before any redistribution or production signer integration. Source references remain in PROTOCOL-FEASIBILITY.md. No program source has been imported into the app.

## Durable transaction review

The additive local migration records immutable plans/business keys, expected effects, explicit native fee ceilings, release/expiry times, simulation evidence, append-only events and unique confirmed receipts. Compare-and-swap handoff reservation happens **before** a wallet prompt; lost responses remain unknown and cannot be blindly retried. Confirmation requires the injected read adapter to match the plan, network, signature and expected-state hash. A signature alone is not confirmation. Existing immutable entitlements are not rewritten or marked funded by an operator assertion.

`/api/meme/operator/transactions` is loopback-only and operator-authenticated. GET returns at most 100 review records; POST prepares a bounded review plan. It has no key, signer, simulation RPC, submission or confirmation endpoint. Mainnet handoff remains rejected even after successful simulation. The transaction state machine's adapters are exercised directly in tests; a production execution service is not implemented or enabled by this endpoint.

## Human test packet and remaining gates

1. Provision dedicated holder/non-holder Farcaster identities and approved Base wallet links. Any account purchase or Warplet transfer is a separate human action. Complete browser extension and Base smart-account setup without exporting personal keys.
2. Specify OG mint, numeric price range, opening fees, authorities, treasury/reserve handling and actual 2-of-3 custody. The approved participation and Jito timing policies do not need approval again unless changed.
3. Prepare exact transactions, run read-only simulations, and present separate ETH/SOL costs: execution gas, Base L1 data fee, Solana priority fee, new-account rent, creation fees and bounded retry allowance. Token/NFT purchases, liquidity and permanent locks are separate line items and approvals. `estimateBudget` uses exact integer wei/lamports and rounds contingency upward; it is an estimator, not a live fee quote or funding authorization.
4. Only after owner approval and portable recovery verification, request the scoped deposit. The user performs final financial wallet confirmations. Resume automatic receipt/state reconciliation afterward; an ambiguous result blocks resubmission.
5. Record actual browser/wallet versions, test commit, real-account and physical iOS/Android outcomes. Real mainnet +240h timing is a separate observation; accelerated simulator tests are not that proof.

Live full-cohort history/price reconciliation, funded application UI and claim-all adapters, production multisig integration, wider swap decoding, alerts/on-call procedures, reserve/dispute policy and production activation remain gated. Reports must distinguish local execution, live reads, mainnet writes and physical-device checks. No missing-access check is a pass.
