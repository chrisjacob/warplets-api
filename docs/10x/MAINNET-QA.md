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

1. Use the owner's existing **warpmoji** account for supervised local sign-in/message-signing QA; a new Farcaster account is not required. This does not change its Farcaster wallet links, account settings or assets, and does not authorize financial use of that account. **balajis** is a public read-only reference, never a signing identity. A second owner-controlled non-holder account is optional; its actual signing check remains pending if unavailable. Complete browser extension and Base smart-account setup without exporting personal keys.
2. Specify OG mint, numeric price range, opening fees, authorities, treasury/reserve handling and actual 2-of-3 custody. The approved participation and Jito timing policies do not need approval again unless changed.
3. Prepare exact transactions, run read-only simulations, and present separate ETH/SOL costs: execution gas, Base L1 data fee, Solana priority fee, new-account rent, creation fees and bounded retry allowance. Token/NFT purchases, liquidity and permanent locks are separate line items and approvals. `estimateBudget` uses exact integer wei/lamports and rounds contingency upward; it is an estimator, not a live fee quote or funding authorization.
4. Only after owner approval and portable recovery verification, request the scoped deposit. The user performs final financial wallet confirmations. Resume automatic receipt/state reconciliation afterward; an ambiguous result blocks resubmission. The owner approved exactly **one raw OG unit** for pool initialization on 30 October; include it separately, with the chosen mint and decimals, rather than treating it as gas or rounding it to zero.
5. Record actual browser/wallet versions, test commit, real-account and physical iOS/Android outcomes. Real mainnet +240h timing is a separate observation; accelerated simulator tests are not that proof.

The local suite now joins real protocol execution to the actual Worker: executed pool launch, cryptographic Solana identity, vote, immutable settlement, distributor creation, funding, released claim and lost-response recovery. A separate suite exercises 100 distributors and all releases across ten campaigns. The bounded claim-all controller processes at most ten intents per call and reconciles ambiguous outcomes before continuing. These are local tests with substituted Farcaster assertions, fixture economics and disposable single-signature custody; they do not certify live identities, mainnet, production custody or real market conditions.

Existing entitlement fields remain unchanged. Additive read fields distinguish `finality`, `fundingState`, `releaseState`, `claimState`, `executionMode` and `allocationId`; `claimable` stays false. Simulated funding/claim states come only from locally verified receipts. The UI groups unlike states separately and uses short labels. The production app still has no financial submission path.

### Read-only fee reference

Observed at 13:21:55 AEDT on 30 October, finalized slot 463114728, using four public RPC reads:

| Item | Native cost |
| --- | --- |
| Base / Solana identity message signing | 0 ETH / 0 SOL |
| One-signature Solana base transaction fee, zero priority fee | 0.000005 SOL |
| Standard SPL mint rent, 82 bytes | 0.0010668 SOL |
| Standard SPL token-account rent, 165 bytes | 0.00148844 SOL |
| Illustrative one-mint/one-token-account/one-fee total, including 25% contingency | 0.0032003 SOL |

This is a reference, **not the launch budget or a funding request**. It excludes priority fees, other program accounts and creation fees, Base L1/execution fees for any proposed write, purchases and liquidity. Run `pnpm --dir packages/meme-qa fees --public-read-only <public-Solana-address> <ignored-output-file>` to obtain a new dated reference; it has no signer/broadcast path. The exact controlled transaction packet and chosen OG remain prerequisites for a funding estimate.

Live full-cohort history/price reconciliation, real extension/smart-wallet/phone QA, mainnet financial adapters, production multisig integration, wider swap decoding, alerts/on-call procedures, reserve/dispute policy and production activation remain gated. Reports must distinguish local execution, live reads, mainnet writes and physical-device checks. No missing-access check is a pass.

### Supplied real-account cases

The owner controls FID **1431382** (`warpmoji.eth`), not FID **37** (`balajis.eth`). `fixtures/accounts.json` restricts access accordingly. The generated QA keys remain separate from both accounts. `accounts --public-read-only <ignored-output-file>` makes seven public Base calls at one finalized block and never changes an account or imports a key.

The first observation at 13:35 AEDT used finalized block **53268080**, whose actual chain timestamp was **12:58:27 AEDT**. Its zero balance therefore described state before the owner's purchase, not current ownership. The checker now reports the block timestamp as `asOf`, the separate `observedAt`, finality and block age, and includes a regression for this exact lag. A recent RPC response must never turn an older finalized block into a current ownership claim.

**Corrected ownership:** warpmoji bought token **9425** at **13:26:35 AEDT on 30 October**, in block **53268924**, transaction [`0xadbfd5…62114`](https://basescan.org/tx/0xadbfd5b3060e0599efe22de28f0a92ba7c1aa8a9b1264ca97885104ea2062114). The successful receipt contains the ERC721 Transfer from `0x4709a4b12daf0eedae0ef48a28a056640dee0846` to the supplied `0xf2916b54cc0a01d78118ae7f8146217f1cd80b86` wallet. Both latest block **53270163** and finalized block **53269613** independently confirm `ownerOf(9425)` and balance **1**. The production [Warplet detail](https://warplet.10x.meme/warplets?warplet=9425), cached API and ownership source also show `warpmoji.eth`, FID **1431382**, as owner. The older source row was checked one second before the recorded purchase. Warpmoji is a verified holder reference at those observations and remains available for supervised local signing QA.

The balajis checks remain public read-only. A complete current Farcaster linked-wallet scope has not been established; the supplied note mentions an additional wallet that was not listed. Cached associations contain the three listed addresses, but do not prove there are no others. Complete buy/sell/transfer history is not certified by these samples. Neither original allocation nor an old FID association may replace a fresh ownership freeze.
