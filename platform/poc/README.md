# Disposable mainnet proof-of-concept programme

Updated 25 November 2026. This is an engineering experiment plan, not an official token launch or product deployment.

## Scope and authority

The owner requested commit/push without deployment, mainnet experiments under disposable names, independent overnight investigation, new isolated test wallets and a total US$10 SOL funding budget. These instructions supersede the old blueprint's blanket prohibition on *planning and preparing* these experiments; they do not erase technical custody failures.

The latest approved architecture is a [local browser-wallet runner](runner/README.md). The user initiates each mainnet action and signs its exact prepared packet in their browser wallet. The server verifies signatures and broadcasts that user-approved packet; it has no funded-wallet keys or autonomous spending service. Do not fund the earlier generated lab wallets for this flow. No app deployment, main/dev merge, remote Cloudflare mutation, public marketing or paid subscription is included.

**Current state: local runner implemented and tested; funded mainnet probes await browser approval. No complete mainnet POC has passed.** See [RUN_STATE.json](RUN_STATE.json) and [MORNING_HANDOFF.md](MORNING_HANDOFF.md). Existing captured-program results remain dated historical evidence, not fresh mainnet execution.

## Experiment queue

[experiments.json](experiments.json) is the test register: P00 harness; P01 original mint; P02 ATT/original pool; P03 allocations; P04 Stake; P05 Earn; P06 permanent NFT claims; P07 mint/reveal; P08 Cards; P09 wallets/marketplaces; P10 complete recovery rehearsal. Each row carries prerequisites, steps, pass criteria and its current blocker.

Run P00 and the P04/P06 custody feasibility work first. P01/P02 may be isolated protocol experiments before the complete campaign. P03 cannot be certified as a funded integrated allocation until Stake and NFT liabilities are enforceable. Never activate a purported complete ATT campaign using database-only custody. A small on-chain sample complements, but does not replace, full 10,000-slot accounting tests.

Test existing product rules rather than silently changing them for an easier pass. Official original-token supply/chain/designer allocation and the monthly paired campaign remain open in the [current decision](../spec/BRAND_ALIGNMENT_DECISION_2026-11-24.md). A temporary SPL mint is a test fixture, not approval of those release choices.

## Disposable identities and budget

Use random unbranded names such as `QA-<random>-A`, `QA-<random>-B` and `Discard Test <random>`. Metadata must clearly say "Disposable technical test. No promised utility." Do not use 10X, Warplet, official artwork, release tickers, brand URLs or investment language. These are public assets: names do not hide funding links, account graphs or source provenance.

Keep operational public addresses and signatures in a local evidence directory by default. The app repository may itself be public, so push redacted findings without mappings that unnecessarily connect these experiments to the brand. Never commit keys, encrypted keys, wallet manifests, provider credentials or raw private post captures.

US$10 is the total initial resource ceiling, not a guarantee that every experiment fits. Quote SOL conversion, protocol fees, account rent, network/priority fees, retries and locked liquidity before each proposed signed step. Treat locked capital as fully spent against the limit. Keep refundable rent and recoverable balances separate from consumed fees; do not finance the next test using expected refunds. Stop when the next step exceeds remaining approved resources. No top-up, subscription or larger budget is implied.

## Commands

Run from the repository root using Node 22.16+:

```text
node --test platform/poc/poc.test.mjs
node platform/poc/runner/server.mjs
node platform/poc/run-local.mjs <new-local-evidence-directory>
```

Wallet generation is Windows-only. It creates five roles (payer, treasury, alice, bob, negative) under the current Windows user's local application-data directory. Private seed/public-key bytes are encrypted with Windows DPAPI CurrentUser before disk write. Only public addresses and the local manifest path are printed. There is no plaintext key export or transaction signer. DPAPI relies on the current Windows profile: preserve its recoverability and do not treat the files as portable seed backups.

The local runner refuses an existing output directory, runs the full Node reference suite and generated-contract check, retains stdout/stderr and SHA-256 digests, and records exit codes. It does not execute mainnet scripts, deploy the app or run a permanent background service. Site/edge/beacon packages and physical wallet checks are separate scopes.

The browser runner includes typed transaction builders, simulation, signature validation, finalized receipt reconciliation and selected account postconditions. Its [coverage table](runner/README.md) lists each implemented probe and each blocked funded adapter. It must not be represented as an executable full mainnet campaign.

## Evidence and stopping rules

Each result must contain experiment/step ID, code revision, environment class, configuration/program digests, genesis, observed slots/finality, expected and observed raw-unit deltas, transaction signatures where applicable, network/protocol/rent costs, pass/fail/blocked assertions, unresolved liabilities and next reproducible command. Retain raw evidence plus hashes locally. A signature alone does not prove success.

Stop the affected experiment on unexpected recipient/instruction/authority, program drift, unexplained balance variance, stale evidence, ambiguous outcome or exhausted budget. Reconcile unknown submissions before preparing another attempt. Never erase a failed assertion or change a product promise to produce a green result. Preserve liabilities and report an incompatible protocol as a finding.

An overnight run can cover local arithmetic, authority/failure simulations and implementation. It cannot finish a genuine 24/48-hour vesting or ten-day emission lifecycle in one night. Accelerated experiments and elapsed mainnet observations must be labelled separately.

## Source evidence

- [Protocol findings](../validation/protocol-status.md), [Core](../lab/CORE-VAULT.md), [Kamino](../lab/KAMINO.md).
- [Release gates](../blueprint/RELEASE_GATES.md), [transaction recovery](../transactions/README.md), [physical compatibility](../compatibility/physical-device-checklist.md).
- [App/admin handoff](INTEGRATION_HANDOFF.md).
- Microsoft DPAPI: https://learn.microsoft.com/en-us/dotnet/standard/security/how-to-use-data-protection
- Solana confirmation: https://solana.com/developers/cookbook/transactions/confirmation
