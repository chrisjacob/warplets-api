# Overnight handoff — 31 October 2026

The independently executable overnight scope is implemented on `codex/10x-reviewed-overnight`, with focused PRs **#107–120** retained for review. This complete branch targets released `main`, not another feature branch. Nothing was merged, deployed, publicly exposed, registered with a host, posted socially or submitted financially on mainnet. Existing products, local previews, archived discovery references and provider caps are preserved.

## What is ready to review

- **Simple app journey:** Today, Rewards, Leaders and History; skippable/replayable onboarding, reused Connect UI, bounded mini-app discovery, safe-area handling, native Solana challenge signing, back navigation and explicit account/privacy context.
- **Markets and performance:** immutable evidence/corrections, screening provenance, common-start ATTN versus OG charts with gaps/losses retained, historical windows and collection-free reads. ATTN means the individual daily edition, not another ecosystem token.
- **Trading recognition:** fee-inclusive moving weighted-average realized USD P&L, 24h/30d/all rankings, per-OG-unit results, public profiles for all accepted traders, historical snapshot links and shareable P&L cards. Deposits, airdrops, rewards and self-transfers do not become profits. Trading/sharing does not earn reward points.
- **Sharing and discovery:** immutable server-derived candidate, launch, comparison, rank and P&L cards; actual 1200×800 Farcaster and 1200×630 Open Graph PNGs; prepared icon/root metadata. Only user actions open a composer or system share sheet. Owner association, canonical origin and host registration remain pending.
- **Notifications:** signed Farcaster events, encrypted app-scoped tokens, explicit preferences, deduplicated leased outbox and unknown-outcome reconciliation. Base has separate wallet-bound permission/status and pacing. Both share three distinct events/day/user. **Fake transport only; real delivery and enable controls remain disabled.**
- **Protocol and custody proof:** exact legacy/v0 transaction packet decoding, signatures, account privileges and finalized-blockhash lifetime checks; actual captured-Meteora buy/sell execution with strict slippage and lost-response reconciliation; actual source-built 2-of-3 vault CPI into Jito creation/funding, direct released claim and policy-timed clawback. Mainnet handoff is still rejected. Squads is evaluated, not selected production custody; Splits remains the EVM treasury preference.
- **Performance/security:** rendering dependency fixes verified with real offline PNG generation, bounded streamed API responses, backoff/hidden/offline polling, session recovery, bounded score/trading publication, immutable materialized public reads and redacted private health. No public auth bypass or signing endpoint.

The [focused delivery record](OVERNIGHT-DELIVERY.md) maps each change to its PR. Existing approved `local-v1`, final allocations, 90/10 split, ten daily releases, one raw OG initialization unit and fully locked Jito/clawback policy are retained.

## Evidence and limits

| Layer | Result | Practical limit |
| --- | --- | --- |
| Foundation | 116 core + 11 script tests; typechecks, isolated boundaries, app build and Worker dry-run pass | No deployment |
| Browser | 40 desktop/mobile viewport journeys pass; Chromium/WebKit gateway regressions run in CI | No claim of physical iPhone/Android, wallet handoff or registered-host certification |
| Linux protocol | Actual captured-program launch→settlement→fund→timed claim, local buy/sell, recovery and 100 allocations across ten overlapping campaigns | Disposable keys, local clock and accounts; not mainnet execution or +240h observation |
| Custody | Actual source-built vault/Jito proof passed run [41087980837](https://github.com/chrisjacob/warplets-api/actions/runs/41087980837) | Source ELF differs from captured mainnet ELF; provider/source correspondence and actual custody pending |
| Scale | 1,000 traders/40,000 events, paged publication; one-SELECT market/board/profile reads; 365-campaign reward/history suite | SQLite lab timings, not production D1 certification |
| Startup | 71.6 KiB gzip against 80 KiB budget | No field Core Web Vitals; DevTools trace tooling unavailable |
| Security | Production audit has one unpatched low deepmerge finding and two existing ignored high browser-installer findings; no unignored moderate/high/critical | No new audit exceptions; reassess dependencies before production |
| Public blockchain | 24 of 50 approved attempts consumed in one persistent ledger; dated account/program/fee/rent evidence retained | Full ownership only 5/10,000; no paid-source increase; no mainnet writes |
| Existing production | Network, dashboard, thesis, existing-product URLs, legal pages and August archive URLs returned HTTP 200 at 03:47 AEDT | HTTP/API smoke only; Network still stale/incomplete |

Latest focused and full-integration checks are visible on GitHub; an older successful parent run is not treated as the new head's result. CI installs from frozen lockfiles and repeats root/security/shared-Connect/existing-product build and routing checks. Local ignored evidence is under `.tmp/qa-next-stage/`, including final foundation/browser logs, public smoke JSON, program captures and custody artifact. These are not placed in Git. Public address observations and retained binary hashes are summarized in [LIVE-READS-2026-10-31.md](LIVE-READS-2026-10-31.md).

## Local review

A separate latest-build preview is prepared at **http://127.0.0.1:5198/**, proxying only the local Worker on **8800**. The existing 5194/8797 preview remains untouched. New storage is `meme/.wrangler/review-state`, with private operator material in `meme/.wrangler/review-operator`. It contains only the explicit simulated demo, not production/old-preview data. Empty market/trading states are expected until simulated evidence is imported; browser regression fixtures cover the populated journeys. Financial controls remain disabled. No phone-access tunnel is running.

To restart, use separate PowerShell terminals from this worktree:

```powershell
pnpm --dir meme review:migrate
pnpm --dir meme review:worker
```

```powershell
$env:MEME_LOCAL_WORKER_PORT='8800'
$env:VITE_WALLETCONNECT_PROJECT_ID=''
pnpm --dir meme review:dev
```

For private local status in another terminal:

```powershell
$env:MEME_OPERATOR_TARGET='review'
pnpm --dir meme operator status --check
```

The demo round is intentionally time-bounded and may be closed by morning. It is not a production round and must not be relabeled as observed evidence. Ordinary regression uses fresh disposable SQLite and ports 5196/8798, with no live authentication bypass in the app.

## Next phases and external gates

1. **Review the integrated build.** Keep focused PRs open; independently review shared Connect/dependencies and current main-targeting diff. No merge is authorized automatically. The archived branch/tag still resolves to `5d5987125cafa288877bbc853dc7e844b3bf831f`.
2. **Real-wallet and host QA.** Resume supervised warpmoji desktop/iOS Base/Trust/Solana proofs, then Android and actual Farcaster/Base host flows. User unlocking/authentication/signing and physical-device handoffs remain separate from viewport tests. Balajis remains read-only. Choose canonical origin/owner association, approved frame policy, Base registration and notification credentials/permissions before live host delivery. No API key or paid allowance is assumed.
3. **Complete authoritative evidence.** Supply an approved collection budget and source/feed configuration, reconcile the full fresh ownership/history/independent-price cohort, and replay it deterministically. Missing scope, stale ownership, unsupported history and unknown prices still block settlement. The normalized trading adapter trusts accepted private evidence; it does not independently certify arbitrary manual trade claims.
4. **Approve actual launch configuration and custody.** Selected OG mint, numeric liquidity bounds/fee decay, program/version correspondence, license assessment, actual three signers and 2-of-3 vault/receiver, treasury/recovery and public abuse/dispute/reserve procedures remain gates. Draft numbers were not adopted silently. See [CONFIGURATION-PROPOSAL.md](CONFIGURATION-PROPOSAL.md).
5. **Controlled financial cycle.** With approved evidence/configuration, complete the mainnet adapter/signing handoff, missing-signature discovery, exact cost packet and human-approved transactions. Durable nonces remain unsupported. Simulate first, reconcile before retry, then observe actual launch +24h…+240h; local clock advancement does not replace this. No funds are requested now.
6. **Production readiness and separate activation.** Isolated resources/routing, named monitoring/incident responders, actual deployment rollback commands, sustained infrastructure measurements and independent serving/participation/launching/funding/claim controls must pass review before deployment or financial activation. Funded direct on-chain claims cannot be paused by the app.

**Network follow-up:** the read-only check at 03:47 AEDT found a snapshot created **30 October 05:03:03 AEDT**, `stale:true`, with an incomplete scan. The already documented October cap was not changed. November rollover/catch-up must be observed after **1 November 11:00 AEDT**; this work did not create an automation or reset the allowance.
