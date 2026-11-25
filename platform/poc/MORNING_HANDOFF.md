# Morning review

Open **http://127.0.0.1:4195** on this Windows machine. If the server stopped, run `platform/poc/runner/start.ps1` from the `C:\Users\ichri\Documents\Codex\10x` checkout. Keep the terminal open. Nothing is deployed.

1. Review the P00–P10 plan and local results. **Run all local checks** needs no wallet and makes no financial transactions.
2. Use **Check mainnet / SOL price** for the current network and funding conversion. The whole run has a $10 budget; it is not guaranteed to cover every probe.
3. Select a separate test account in your browser wallet and connect it. Use a Wallet Standard wallet supporting Solana `signTransaction`. Fund that account yourself. The five encrypted, unfunded lab wallets are not used by this runner.
4. Start with P01 original and attention mints. **Prepare** constructs and simulates; inspect its account/instruction and cost details. **Approve in browser wallet** requests the signature and submits that exact packet. Each transaction requires this step.
5. **Recover / check expiry** reconciles a pending signature against finalized chain receipts. Do not replace an ambiguous transaction or reset the database to bypass a pending state.
6. Continue P02 pairing/swaps/fees, P03 allocation, P05 short vesting, and P06 NFT creation/transfer as budget permits. The pair is permanently locked. Transfer recipients must be other wallet addresses you control.
7. Export evidence and add observations for actual wallets/marketplaces. Notes remain unverified evidence.

## What was verified

- 95 focused repository tests passed after restoring the existing beacon dependency from its frozen lockfile. These cover all eleven POC groups; they are local/model/captured-evidence checks.
- Runner tests cover packet construction, limits, signature/message binding, concurrency, receipt checks, timeout/restart recovery, budget changes and HTTP isolation. See `VALIDATION_RESULTS.json` for the final count.
- Browser QA passed desktop 1440px and mobile 390px, including mock wallet rejection, explicit approval, finalized receipt, reload protection and manual evidence capture. No real wallet was signed.
- Generated contracts remain in sync.
- Public mainnet reads confirmed the saved four program fingerprints at finalized slot 473720144. A later Core-only check matched at slot 473736743. Source-to-binary parity remains unverified.
- The earlier broad reference-suite run was interrupted without a completion report; it is **not** claimed as passing.
- **Zero funded mainnet transactions, zero mainnet POCs accepted, $0 spent by this work.**

## Remaining acceptance gaps

The runnable mainnet probes are narrower than complete product acceptance. Kamino principal custody, NFT burn/claim protections, paid-mint randomness/refunds, atomic Card progression, and actual marketplace/physical-device compatibility remain blocked or require further adapters. All have local checks, plans, and evidence capture in the page; none is represented as a funded mainnet pass. Original token launch policy is still provisional.

The rewards probe is deliberately accelerated to a 60-second cliff and another 60 seconds of linear vesting, and is wallet-bound. It does not prove NFT-bound claims or the real 24/48-hour vesting schedule. Ten-day farm and full-duration vesting checks still need elapsed time.

NFT metadata is served only on loopback. Wallet/marketplace indexing of publicly hosted metadata is not established. Allocation destinations are labelled payer-owned accounts, not trustless product vaults.

## Local evidence and next-agent handoff

The live evidence database is `%LOCALAPPDATA%\SolanaPocRunner\evidence.sqlite`; it stores public addresses, partial packets, signatures, receipts and logs, never wallet seed phrases. Do not delete it to reset the budget. The server lock prevents a second instance writing the same state. Keep a copy of **Export evidence** for review; public Git gets only redacted findings.

Use [INTEGRATION_HANDOFF.md](INTEGRATION_HANDOFF.md) for customer/admin requirements and [runner/README.md](runner/README.md) for implementation boundaries. Existing production financial capabilities stay disabled. The prior app checkpoint `09114c8` was pushed successfully.
